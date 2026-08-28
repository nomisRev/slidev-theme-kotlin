import { reactive, ref } from 'vue'
import type { PersistedAnnotationGeometry } from './geometry'

/** Shared, development-only interaction state for DrawnAnnotation instances. */
export const annotationEditMode = ref(false)
export const selectedAnnotationId = ref<string>()
/** Which control selected the annotation, for keyboard nudging semantics. */
export const selectedAnnotationPart = ref<'label' | 'width' | 'start' | 'end' | 'body'>()
export const annotationDrafts = reactive(new Map<string, PersistedAnnotationGeometry>())
export const annotationGeometryVersion = ref(0)
export const annotationEditorStatus = ref<string>()

/** Operations supplied by the currently mounted annotation instance. */
export interface AnnotationEditorActions {
  isManualConnector: () => boolean
  toggleConnectorAttachment: () => Promise<void>
}

// The toolbar lives outside annotation instances, so use this narrow registry
// rather than giving it access to component DOM or geometry state.
const annotationEditorActions = new Map<string, AnnotationEditorActions>()
export const annotationEditorRegistryVersion = ref(0)

export function registerAnnotationEditorActions(id: string, actions: AnnotationEditorActions) {
  annotationEditorActions.set(id, actions)
  annotationEditorRegistryVersion.value++
  return () => {
    if (annotationEditorActions.get(id) === actions) {
      annotationEditorActions.delete(id)
      annotationEditorRegistryVersion.value++
    }
  }
}

export function annotationEditorActionsFor(id: string | undefined) {
  return id ? annotationEditorActions.get(id) : undefined
}

/** Persisted snapshots, one per completed edit, used by the toolbar Undo action. */
interface AnnotationUndo {
  id: string
  geometry: PersistedAnnotationGeometry | null
}
const annotationUndoHistory: AnnotationUndo[] = []

export function recordAnnotationUndo(id: string, geometry: PersistedAnnotationGeometry | null) {
  annotationUndoHistory.push({ id, geometry: geometry ? { ...geometry } : null })
  // This is an authoring convenience, not a full document-history system.
  if (annotationUndoHistory.length > 100)
    annotationUndoHistory.shift()
}

/** State carried by one pointer gesture, including any debounced autosaves. */
export interface AnnotationUndoSession {
  undoRecorded?: boolean
}

/**
 * A long pointer drag can save more than once, but it remains one authoring
 * gesture. Preserve the geometry from before its first save exactly once so
 * Undo returns to the pre-drag snapshot rather than merely to an intermediate
 * autosave position.
 */
export function recordAnnotationUndoOnce(session: AnnotationUndoSession | undefined, id: string, geometry: PersistedAnnotationGeometry | null) {
  if (session?.undoRecorded)
    return
  recordAnnotationUndo(id, geometry)
  if (session)
    session.undoRecorded = true
}

export function takeAnnotationUndo(id: string) {
  for (let index = annotationUndoHistory.length - 1; index >= 0; index--) {
    if (annotationUndoHistory[index].id === id)
      return annotationUndoHistory.splice(index, 1)[0]
  }
}

// IDs are registered by mounted annotations. Keeping this independently of
// the writer means duplicate IDs are diagnosed before a browser can overwrite
// another annotation's rule.
const annotationIds = new Map<string, number>()
export const duplicateAnnotationIds = ref(new Set<string>())
export const missingAnnotationIds = ref(0)

function publishIdDiagnostics() {
  duplicateAnnotationIds.value = new Set([...annotationIds].filter(([, count]) => count > 1).map(([id]) => id))
}

export function registerAnnotationEditorId(id: string | undefined, valid: boolean) {
  if (!valid || !id) {
    missingAnnotationIds.value++
    return () => missingAnnotationIds.value--
  }
  annotationIds.set(id, (annotationIds.get(id) ?? 0) + 1)
  publishIdDiagnostics()
  return () => {
    const count = annotationIds.get(id) ?? 0
    if (count <= 1)
      annotationIds.delete(id)
    else
      annotationIds.set(id, count - 1)
    publishIdDiagnostics()
  }
}

export function isDuplicateAnnotationId(id: string | undefined) {
  return !!id && duplicateAnnotationIds.value.has(id)
}

let shortcutInstalled = false

export function installAnnotationEditorShortcut() {
  if (shortcutInstalled || typeof window === 'undefined')
    return
  shortcutInstalled = true
  window.addEventListener('keydown', (event) => {
    // Alt+Shift+A is intentionally outside Slidev's normal navigation keys.
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      // The global toolbar owns the writer availability check. Dispatching
      // rather than flipping state here keeps the shortcut from enabling an
      // editor that cannot persist because the Vite plugin is absent.
      window.dispatchEvent(new Event('drawn-annotation-editor-toggle'))
    }
  })
}

export function selectAnnotation(id: string, part: 'label' | 'width' | 'start' | 'end' | 'body' = 'label') {
  selectedAnnotationId.value = id
  selectedAnnotationPart.value = part
}

/** Clear selection without leaving a stale keyboard target on an unmounted slide. */
export function clearAnnotationSelection(id?: string) {
  if (id !== undefined && selectedAnnotationId.value !== id)
    return
  selectedAnnotationId.value = undefined
  selectedAnnotationPart.value = undefined
}

export function setLabelDraft(id: string, geometry: PersistedAnnotationGeometry) {
  annotationDrafts.set(id, { ...annotationDrafts.get(id), ...geometry })
  annotationGeometryVersion.value++
}

export function clearLabelDraft(id: string) {
  annotationDrafts.delete(id)
  annotationGeometryVersion.value++
}

/** Drop every local preview after a document-wide reset. */
export function clearAllAnnotationDrafts() {
  if (!annotationDrafts.size)
    return
  annotationDrafts.clear()
  annotationGeometryVersion.value++
}
