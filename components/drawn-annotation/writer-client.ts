import type { PersistedAnnotationGeometry } from './geometry'

type GeometryReset = 'label' | 'connector'
interface WriterResponse { geometry?: { label?: { x: number, y: number, width?: number }, connector?: { start: { x: number, y: number }, end: { x: number, y: number } } }, revision?: string, revisions?: Record<string, string>, error?: string, recovery?: string }
/** Source revisions by Markdown file. A locator names a tag, never a revision. */
const revisions = new Map<string, string>()
/** What this tab last wrote for a locator, until a conflict proves the source moved on. */
let cachedGeometry = new Map<string, PersistedAnnotationGeometry>()
let pendingWrite = Promise.resolve()

function flatten(geometry: WriterResponse['geometry']): PersistedAnnotationGeometry {
  return { x: geometry?.label?.x, y: geometry?.label?.y, width: geometry?.label?.width, x1: geometry?.connector?.start.x, y1: geometry?.connector?.start.y, x2: geometry?.connector?.end.x, y2: geometry?.connector?.end.y }
}
function documentGeometry(geometry: PersistedAnnotationGeometry | null) {
  if (!geometry) return {}
  const label = geometry.x === undefined || geometry.y === undefined ? undefined : { x: geometry.x, y: geometry.y, ...(geometry.width === undefined ? {} : { width: geometry.width }) }
  const connector = geometry.x1 === undefined || geometry.y1 === undefined || geometry.x2 === undefined || geometry.y2 === undefined ? undefined : { start: { x: geometry.x1, y: geometry.y1 }, end: { x: geometry.x2, y: geometry.y2 } }
  return { ...(label ? { label } : {}), ...(connector ? { connector } : {}) }
}
/** The Markdown file a locator addresses; the rest of the token stays opaque. */
function locatorFile(locator: string) {
  try {
    const file = JSON.parse(atob(locator.replace(/-/g, '+').replace(/_/g, '/'))).file
    if (typeof file === 'string') return file
  } catch {}
  throw new Error('invalid source locator')
}
async function response(result: Response, file?: string) {
  const body = await result.json() as WriterResponse
  for (const [name, revision] of Object.entries(body.revisions ?? {})) revisions.set(name, revision)
  if (file && body.revision) revisions.set(file, body.revision)
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
  if (part === 'label') { delete next.x; delete next.y; delete next.width } else { delete next.x1; delete next.y1; delete next.x2; delete next.y2 }
  return enqueue(() => write(locator, next))
}
export function restoreAnnotationGeometry(locator: string, geometry: PersistedAnnotationGeometry | null) { return enqueue(() => write(locator, geometry)) }
