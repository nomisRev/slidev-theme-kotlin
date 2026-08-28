import type { PersistedAnnotationGeometry } from './geometry'

type GeometryReset = 'label' | 'connector'
interface WriterResponse { geometry?: { label?: { x: number, y: number, width?: number }, connector?: { start: { x: number, y: number }, end: { x: number, y: number } } }, revision?: string, error?: string, recovery?: string }
let revisions = new Map<string, string>()
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
async function response(result: Response, locator?: string) {
  const body = await result.json() as WriterResponse
  if (locator && body.revision) revisions.set(locator, body.revision)
  if (locator && body.geometry) cachedGeometry.set(locator, flatten(body.geometry))
  if (!result.ok) throw new Error(body.recovery ? `${body.error}: ${body.recovery}` : body.error ?? `annotation writer returned ${result.status}`)
  return body
}

/** Verify that the development-only source writer is installed. */
export async function loadAnnotationGeometry() { return response(await fetch('/__drawn-annotation-source', { headers: { Accept: 'application/json' } })) }
export function cachedAnnotationGeometry(locator: string) { const value = cachedGeometry.get(locator); return value ? { ...value } : null }
function enqueue<T>(operation: () => Promise<T>) { const result = pendingWrite.then(operation, operation); pendingWrite = result.then(() => undefined, () => undefined); return result }
async function write(locator: string, geometry: PersistedAnnotationGeometry | null) {
  // A locator identifies one exact tag, and its file hash is the revision.
  // An initial write necessarily needs a revision; derive it from the locator
  // only after the transform has supplied one via a harmless failed/reloaded
  // save is unsafe, so source locators include no mutable revision. The server
  // accepts its current revision on first write only through this explicit GET.
  let revision = revisions.get(locator)
  if (!revision) {
    try { revision = JSON.parse(atob(locator.replace(/-/g, '+').replace(/_/g, '/'))).revision } catch { throw new Error('invalid source locator') }
  }
  const result = await response(await fetch('/__drawn-annotation-source', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ locator, expectedRevision: revision, geometry: documentGeometry(geometry) }) }), locator)
  return { geometry: { [locator]: flatten(result.geometry) }, revision: result.revision }
}
export function saveLabelGeometry(locator: string, geometry: PersistedAnnotationGeometry | null) { return enqueue(() => write(locator, geometry)) }
export function resetAnnotationGeometry(locator: string, part: GeometryReset) {
  const current = cachedAnnotationGeometry(locator) ?? {}
  if (part === 'label') { delete current.x; delete current.y; delete current.width } else { delete current.x1; delete current.y1; delete current.x2; delete current.y2 }
  return enqueue(() => write(locator, current))
}
export function restoreAnnotationGeometry(locator: string, geometry: PersistedAnnotationGeometry | null) { return enqueue(() => write(locator, geometry)) }
export async function resetAllAnnotationGeometry() { throw new Error('Reset all is unavailable: geometry is source-local to each annotation') }
export function forgetWriterRevision() { revisions = new Map(); cachedGeometry = new Map() }
