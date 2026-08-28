import type { PersistedAnnotationGeometry } from './geometry'

export type WriterGeometry = PersistedAnnotationGeometry
type GeometryReset = 'label' | 'connector'

interface WriterResponse {
  geometry: Record<string, WriterGeometry>
  revision: string
  error?: string
}

let revision: string | undefined
let cachedGeometry: Record<string, WriterGeometry> = {}

async function response(response: Response): Promise<WriterResponse> {
  const body = await response.json() as WriterResponse
  if (body.geometry)
    cachedGeometry = body.geometry
  // A conflict response includes the server's current revision. Retaining it
  // lets the next deliberate drag save against that revision instead of being
  // stuck returning the same 409 forever.
  if (body.revision)
    revision = body.revision
  if (!response.ok)
    throw new Error(body.error ?? `annotation writer returned ${response.status}`)
  return body
}

export async function loadAnnotationGeometry() {
  const current = await response(await fetch('/__drawn-annotations', { headers: { Accept: 'application/json' } }))
  revision = current.revision
  return current
}

/** Save one property-wise geometry patch through the optional local Vite plugin. */
/** Snapshot known from the writer, before making a new edit. */
export function cachedAnnotationGeometry(id: string): WriterGeometry | null {
  const geometry = cachedGeometry[id]
  return geometry ? { ...geometry } : null
}

export async function saveLabelGeometry(id: string, geometry: PersistedAnnotationGeometry | null) {
  if (!revision)
    await loadAnnotationGeometry()
  const saved = await response(await fetch('/__drawn-annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ expectedRevision: revision, annotations: { [id]: geometry } }),
  }))
  revision = saved.revision
  return saved
}

/** Remove either the label or connector override while retaining the other. */
export async function resetAnnotationGeometry(id: string, part: GeometryReset) {
  if (!revision)
    await loadAnnotationGeometry()
  const fields = part === 'label' ? ['x', 'y', 'width'] : ['x1', 'y1', 'x2', 'y2']
  const geometry = Object.fromEntries(fields.map(field => [field, null]))
  const saved = await response(await fetch('/__drawn-annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ expectedRevision: revision, annotations: { [id]: geometry } }),
  }))
  revision = saved.revision
  return saved
}

export async function resetAllAnnotationGeometry() {
  const current = await loadAnnotationGeometry()
  const annotations = Object.fromEntries(Object.keys(current.geometry).map(id => [id, null]))
  if (!Object.keys(annotations).length)
    return current
  const saved = await response(await fetch('/__drawn-annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ expectedRevision: revision, annotations }),
  }))
  revision = saved.revision
  return saved
}

/** Restore a full prior snapshot for Undo (or delete the generated rule). */
export async function restoreAnnotationGeometry(id: string, geometry: PersistedAnnotationGeometry | null) {
  return saveLabelGeometry(id, geometry)
}

export function forgetWriterRevision() {
  revision = undefined
  cachedGeometry = {}
}
