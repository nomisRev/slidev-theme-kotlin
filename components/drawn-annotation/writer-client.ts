import type { PersistedAnnotationGeometry } from './geometry'

type GeometryReset = 'label' | 'connector'
interface WriterResponse { geometry?: { label?: { x: number, y: number, width?: number }, connector?: { start: { x: number, y: number }, control?: { x: number, y: number }, end: { x: number, y: number } } }, revision?: string, revisions?: Record<string, string>, error?: string, recovery?: string }
/** Source revisions by Markdown file. A locator names a tag, never a revision. */
const revisions = new Map<string, string>()
/** What this tab last wrote for a locator, until a conflict proves the source moved on. */
let cachedGeometry = new Map<string, PersistedAnnotationGeometry>()
let pendingWrite = Promise.resolve()

function flatten(geometry: WriterResponse['geometry']): PersistedAnnotationGeometry {
  // Only present values are kept: spreading `{ width: undefined }` over a
  // draft would erase fields the response simply did not mention.
  const result: PersistedAnnotationGeometry = {}
  const assign = (key: keyof PersistedAnnotationGeometry, value: number | undefined) => { if (value !== undefined) result[key] = value }
  assign('x', geometry?.label?.x); assign('y', geometry?.label?.y); assign('width', geometry?.label?.width)
  assign('x1', geometry?.connector?.start.x); assign('y1', geometry?.connector?.start.y)
  assign('x2', geometry?.connector?.end.x); assign('y2', geometry?.connector?.end.y)
  assign('cx', geometry?.connector?.control?.x); assign('cy', geometry?.connector?.control?.y)
  return result
}
function documentGeometry(geometry: PersistedAnnotationGeometry | null) {
  if (!geometry) return {}
  const label = geometry.x === undefined || geometry.y === undefined ? undefined : { x: geometry.x, y: geometry.y, ...(geometry.width === undefined ? {} : { width: geometry.width }) }
  const connector = geometry.x1 === undefined || geometry.y1 === undefined || geometry.x2 === undefined || geometry.y2 === undefined
    ? undefined
    : geometry.cx !== undefined && geometry.cy !== undefined
      ? { type: 'quadratic' as const, start: { x: geometry.x1, y: geometry.y1 }, control: { x: geometry.cx, y: geometry.cy }, end: { x: geometry.x2, y: geometry.y2 } }
      : { start: { x: geometry.x1, y: geometry.y1 }, end: { x: geometry.x2, y: geometry.y2 } }
  return { ...(label ? { label } : {}), ...(connector ? { connector } : {}) }
}
/** The Markdown file a locator addresses; the rest of the token stays opaque. */
function locatorFile(locator: string) {
  try {
    // The server base64url-encodes UTF-8 bytes; `atob` alone yields a Latin-1
    // string that mangles a non-ASCII deck filename.
    const bytes = Uint8Array.from(atob(locator.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0))
    const file = JSON.parse(new TextDecoder().decode(bytes)).file
    if (typeof file === 'string') return file
  } catch {}
  throw new Error('invalid source locator')
}
async function response(result: Response, file?: string) {
  const body = await result.json() as WriterResponse
  for (const [name, revision] of Object.entries(body.revisions ?? {})) revisions.set(name, revision)
  // Adopt a write's new revision only from a success. A 409 body carries the
  // *other* author's revision; adopting it would let the next debounced
  // autosave of the same gesture silently overwrite their edit instead of
  // preserving the local draft until "Reload saved geometry" is chosen.
  if (result.ok && file && body.revision) revisions.set(file, body.revision)
  // A conflict means the source changed under this tab, so nothing it
  // remembers about persisted geometry can be trusted any more.
  if (result.status === 409) cachedGeometry = new Map()
  if (!result.ok) throw new Error(body.recovery ? `${body.error}: ${body.recovery}` : body.error ?? `annotation writer returned ${result.status}`)
  return body
}

/** Verify that the development-only source writer is installed and learn the current source revisions. */
export async function loadAnnotationGeometry() { return response(await fetch('/__drawn-annotation-source', { headers: { Accept: 'application/json' } })) }
/** The geometry this tab last saved for a locator, or `null` when the source binding is the only known state. */
export function cachedAnnotationGeometry(locator: string) { const value = cachedGeometry.get(locator); return value ? { ...value } : null }
function enqueue<T>(operation: () => Promise<T>) { const result = pendingWrite.then(operation, operation); pendingWrite = result.then(() => undefined, () => undefined); return result }
async function write(locator: string, geometry: PersistedAnnotationGeometry | null) {
  const file = locatorFile(locator)
  // The first write to a file needs its revision; every response refreshes it.
  if (!revisions.has(file)) await loadAnnotationGeometry()
  const revision = revisions.get(file)
  if (!revision) throw new Error(`unknown source revision for ${file}: reload saved geometry before saving`)
  const result = await response(await fetch('/__drawn-annotation-source', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ locator, expectedRevision: revision, geometry: documentGeometry(geometry) }) }), file)
  const persisted = flatten(result.geometry)
  cachedGeometry.set(locator, persisted)
  return { geometry: { [locator]: persisted }, revision: result.revision }
}
export function saveLabelGeometry(locator: string, geometry: PersistedAnnotationGeometry | null) { return enqueue(() => write(locator, geometry)) }
/** Remove one part from `current`, the geometry the source holds now, and save the rest. */
export function resetAnnotationGeometry(locator: string, part: GeometryReset, current: PersistedAnnotationGeometry | null) {
  const next = { ...current }
  if (part === 'label') { delete next.x; delete next.y; delete next.width } else { delete next.x1; delete next.y1; delete next.x2; delete next.y2; delete next.cx; delete next.cy }
  return enqueue(() => write(locator, next))
}
export function restoreAnnotationGeometry(locator: string, geometry: PersistedAnnotationGeometry | null) { return enqueue(() => write(locator, geometry)) }
