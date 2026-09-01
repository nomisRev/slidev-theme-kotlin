import { reactive, ref } from 'vue'
import type { PersistedAnnotationGeometry } from './geometry'

/** Shared development-only state, keyed by opaque source locators. */
export const annotationEditMode = ref(false)
export const selectedAnnotationId = ref<string>()
export const selectedAnnotationPart = ref<'label' | 'width' | 'start' | 'end' | 'body'>()
export const annotationDrafts = reactive(new Map<string, PersistedAnnotationGeometry>())
export const annotationGeometryVersion = ref(0)
/** The draft most recently changed; lets its owner repaint without waking every annotation. */
export const annotationDraftChange = ref<{ locator: string, kind: 'connector' | 'label' | 'clear' }>()
/** Bumped only when all labels must re-place around a changed label layout. */
export const annotationLabelLayoutVersion = ref(0)
/** Identifies the label whose layout publication caused the version bump. */
export const annotationLabelLayoutChange = ref<{ locator: string }>()
const activeLabelLayoutGestures = new Map<string, boolean>()
export const annotationEditorStatus = ref<string>()
export interface AnnotationEditorActions {
  isManualConnector: () => boolean
  toggleConnectorAttachment: () => Promise<void>
  /** The geometry authored in the source binding, the baseline an edit must be undone to. */
  persistedGeometry: () => PersistedAnnotationGeometry
}
const actions = new Map<string, AnnotationEditorActions>()
export const annotationEditorRegistryVersion = ref(0)
/** Registers a component's actions; the returned function removes them under whichever locator they hold by then. */
export function registerAnnotationEditorActions(locator: string, value: AnnotationEditorActions) {
  actions.set(locator, value); annotationEditorRegistryVersion.value++
  return () => { for (const [key, current] of actions) if (current === value) { actions.delete(key); annotationEditorRegistryVersion.value++ } }
}
export function annotationEditorActionsFor(locator: string | undefined) { return locator ? actions.get(locator) : undefined }
/** Whether the currently mounted slide has at least one editable annotation. */
export function hasRegisteredAnnotationEditors() { return actions.size > 0 }
interface AnnotationUndo { locator: string, geometry: PersistedAnnotationGeometry | null }
const history: AnnotationUndo[] = []
/**
 * Re-key everything held for an annotation when its locator changes, for
 * example when a write elsewhere in the file moved the tag to another line.
 * A component watches its locator prop and calls this, so an in-progress
 * selection, draft, undo history and toolbar actions all follow the tag.
 */
export function migrateAnnotationLocator(previous: string, next: string) {
  if (previous === next) return
  if (selectedAnnotationId.value === previous) selectedAnnotationId.value = next
  const draft = annotationDrafts.get(previous)
  if (draft) {
    annotationDrafts.delete(previous); annotationDrafts.set(next, draft)
    annotationDraftChange.value = { locator: next, kind: 'clear' }
    annotationLabelLayoutVersion.value++
    annotationLabelLayoutChange.value = { locator: next }
    annotationGeometryVersion.value++
  }
  for (const entry of history) if (entry.locator === previous) entry.locator = next
  const registered = actions.get(previous)
  if (registered) { actions.delete(previous); actions.set(next, registered); annotationEditorRegistryVersion.value++ }
}
export function recordAnnotationUndo(locator: string, geometry: PersistedAnnotationGeometry | null) { history.push({ locator, geometry: geometry ? { ...geometry } : null }); if (history.length > 100) history.shift() }
export interface AnnotationUndoSession { undoRecorded?: boolean }
export function recordAnnotationUndoOnce(session: AnnotationUndoSession | undefined, locator: string, geometry: PersistedAnnotationGeometry | null) { if (session?.undoRecorded) return; recordAnnotationUndo(locator, geometry); if (session) session.undoRecorded = true }
export function takeAnnotationUndo(locator: string) { for (let index = history.length - 1; index >= 0; index--) if (history[index].locator === locator) return history.splice(index, 1)[0] }
let shortcutInstalled = false
// Matched by physical key (`event.code`): on macOS, Option+Shift+A composes
// 'Å', so an `event.key` comparison would never fire there.
export function installAnnotationEditorShortcut() { if (shortcutInstalled || typeof window === 'undefined') return; shortcutInstalled = true; window.addEventListener('keydown', (event) => { if (event.altKey && event.shiftKey && event.code === 'KeyA') { event.preventDefault(); window.dispatchEvent(new Event('drawn-annotation-editor-toggle')) } }) }
export function selectAnnotation(locator: string, part: 'label' | 'width' | 'start' | 'end' | 'body' = 'label') { selectedAnnotationId.value = locator; selectedAnnotationPart.value = part; released = undefined }
export function clearAnnotationSelection(locator?: string) { if (locator !== undefined && selectedAnnotationId.value !== locator) return; selectedAnnotationId.value = undefined; selectedAnnotationPart.value = undefined; released = undefined }
/**
 * Saving rewrites the Markdown, and Slidev's HMR then unmounts the slide,
 * re-imports its module and mounts it again. The old component releases its
 * selection on unmount, so nothing stays selected while an annotation is
 * gone; the next component with the same locator claims it back during
 * setup, so an author's selection, outline, keyboard nudging and Undo all
 * survive the save. The release lasts until the author selects or clears
 * something else themselves.
 */
let released: { locator: string, part: NonNullable<typeof selectedAnnotationPart.value> } | undefined
export function releaseAnnotationSelection(locator: string) {
  if (selectedAnnotationId.value !== locator) return
  const part = selectedAnnotationPart.value ?? 'label'
  clearAnnotationSelection(locator)
  released = { locator, part }
}
export function claimAnnotationSelection(locator: string) {
  if (released?.locator !== locator || selectedAnnotationId.value !== undefined) return
  selectAnnotation(locator, released.part)
}
function draftKind(geometry: PersistedAnnotationGeometry) {
  return geometry.x !== undefined || geometry.y !== undefined || geometry.width !== undefined ? 'label' as const : 'connector' as const
}
/** Coalesce dependent-label placement work for the lifetime of a pointer gesture. */
export function beginAnnotationDraftGesture(locator: string, kind: 'connector' | 'label') {
  if (kind !== 'label') return
  activeLabelLayoutGestures.set(locator, false)
  // Publish once at gesture start so labels that route around this one do not
  // remain permanently stale if the gesture is held for a long time.
  annotationLabelLayoutVersion.value++
  annotationLabelLayoutChange.value = { locator }
}
export function endAnnotationDraftGesture(locator: string, kind: 'connector' | 'label') {
  if (kind !== 'label') return
  const changed = activeLabelLayoutGestures.get(locator)
  activeLabelLayoutGestures.delete(locator)
  if (changed) {
    annotationLabelLayoutVersion.value++
    annotationLabelLayoutChange.value = { locator }
  }
}
export function setLabelDraft(locator: string, geometry: PersistedAnnotationGeometry) {
  annotationDrafts.set(locator, { ...annotationDrafts.get(locator), ...geometry })
  const kind = draftKind(geometry)
  if (kind === 'label') {
    if (activeLabelLayoutGestures.has(locator)) activeLabelLayoutGestures.set(locator, true)
    else {
      annotationLabelLayoutVersion.value++
      annotationLabelLayoutChange.value = { locator }
    }
  }
  annotationDraftChange.value = { locator, kind }
  annotationGeometryVersion.value++
}
export function clearLabelDraft(locator: string) {
  annotationDrafts.delete(locator)
  activeLabelLayoutGestures.delete(locator)
  annotationDraftChange.value = { locator, kind: 'clear' }
  annotationLabelLayoutVersion.value++
  annotationLabelLayoutChange.value = { locator }
  annotationGeometryVersion.value++
}
export function clearAllAnnotationDrafts() {
  if (!annotationDrafts.size) return
  annotationDrafts.clear()
  activeLabelLayoutGestures.clear()
  annotationDraftChange.value = undefined
  annotationLabelLayoutVersion.value++
  annotationLabelLayoutChange.value = undefined
  annotationGeometryVersion.value++
}
