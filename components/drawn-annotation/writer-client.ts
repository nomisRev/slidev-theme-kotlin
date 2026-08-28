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
// A release save can overlap a debounced save from the same drag. Queue writes
// in the browser as well as on the server so each request uses the revision
// returned by the prior one instead of needlessly conflicting with itself.
let pendingWrite = Promise.resolve()

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

function enqueueWrite<T>(operation: () => Promise<T>) {
  const result = pendingWrite.then(operation, operation)
  // Keep later edits usable after a rejected external/stale revision.
  pendingWrite = result.then(() => undefined, () => undefined)
  return result
}

async function writePatch(annotations: Record<string, PersistedAnnotationGeometry | Record<string, null> | null>) {
  if (!revision)
    await loadAnnotationGeometry()
  const saved = await response(await fetch('/__drawn-annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    // Read revision only when this queued operation starts. A previous queued
    // write may have advanced it while this drag was still in progress.
    body: JSON.stringify({ expectedRevision: revision, annotations }),
  }))
  revision = saved.revision
  return saved
}

export function saveLabelGeometry(id: string, geometry: PersistedAnnotationGeometry | null) {
  return enqueueWrite(() => writePatch({ [id]: geometry }))
}

/** Remove either the label or connector override while retaining the other. */
export function resetAnnotationGeometry(id: string, part: GeometryReset) {
  const fields = part === 'label' ? ['x', 'y', 'width'] : ['x1', 'y1', 'x2', 'y2']
  const geometry = Object.fromEntries(fields.map(field => [field, null]))
  return enqueueWrite(() => writePatch({ [id]: geometry }))
}

export async function resetAllAnnotationGeometry() {
  const current = await loadAnnotationGeometry()
  const annotations = Object.fromEntries(Object.keys(current.geometry).map(id => [id, null]))
  if (!Object.keys(annotations).length)
    return current
  return enqueueWrite(() => writePatch(annotations))
}

const GEOMETRY_FIELDS: (keyof PersistedAnnotationGeometry)[] = ['x', 'y', 'width', 'x1', 'y1', 'x2', 'y2']

/**
 * Restore an exact prior rule for Undo (or delete it). Normal saves are
 * deliberately property-wise, but using that operation for Undo leaves fields
 * introduced after the snapshot behind — notably a connector made manual
 * after the snapshot was taken. Null every currently saved field absent from
 * the snapshot in the same serialized write as the fields being restored.
 */
export function restoreAnnotationGeometry(id: string, geometry: PersistedAnnotationGeometry | null) {
  return enqueueWrite(() => {
    if (geometry === null)
      return writePatch({ [id]: null })

    const current = cachedGeometry[id] ?? {}
    const replacement: Record<string, number | null> = {}
    for (const field of GEOMETRY_FIELDS) {
      const value = geometry[field]
      if (value !== undefined)
        replacement[field] = value
      else if (current[field] !== undefined)
        replacement[field] = null
    }
    return writePatch({ [id]: replacement })
  })
}

export function forgetWriterRevision() {
  revision = undefined
  cachedGeometry = {}
}
