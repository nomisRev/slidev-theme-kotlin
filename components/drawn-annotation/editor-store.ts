import { reactive, ref } from 'vue'
import type { PersistedAnnotationGeometry } from './geometry'

/** Shared, development-only interaction state for DrawnAnnotation instances. */
export const annotationEditMode = ref(false)
export const selectedAnnotationId = ref<string>()
export const annotationDrafts = reactive(new Map<string, PersistedAnnotationGeometry>())
export const annotationGeometryVersion = ref(0)
export const annotationEditorStatus = ref<string>()

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

export function selectAnnotation(id: string) {
  selectedAnnotationId.value = id
}

export function setLabelDraft(id: string, geometry: PersistedAnnotationGeometry) {
  annotationDrafts.set(id, { ...annotationDrafts.get(id), ...geometry })
  annotationGeometryVersion.value++
}

export function clearLabelDraft(id: string) {
  annotationDrafts.delete(id)
  annotationGeometryVersion.value++
}
