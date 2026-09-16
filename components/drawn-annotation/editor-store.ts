import { reactive, ref } from 'vue'
import type { PersistedAnnotationGeometry } from './geometry'

/**
 * Shared development-only state, keyed by opaque source locators.
 *
 * `annotationEditMode` is the frozen edit session: while it is on, Slidev
 * navigation is locked by the toolbar, every geometry change stays a local
 * draft, and nothing is written to the Markdown source until the author
 * commits the session with "Done editing annotations".
 */
export const annotationEditMode = ref(false)
export const selectedAnnotationId = ref<string>()
export const selectedAnnotationPart = ref<'label' | 'width' | 'start' | 'end' | 'body' | 'control'>()
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
  /** The slide the annotation sits on; Slidev keeps neighbouring slides mounted too. */
  page: number
  /** Whether the tag draws its leader line (the `connect` prop, or the inherited default). */
  connected: () => boolean
  /** Whether the leader line is drawn when the tag carries no `:connect` binding: the slide's or deck's `drawnAnnotation.connect`. */
  defaultConnected: () => boolean
  isManualConnector: () => boolean
  toggleConnectorAttachment: () => Promise<void>
  /** Whether the connector currently carries a quadratic control point (draft or persisted). */
  hasConnectorControl: () => boolean
  /** Give the connector a quadratic control point, materializing an automatic route first. A plain draft edit, committed with the session. */
  addConnectorControl: () => void
  /** Remove the quadratic control point, returning to a straight manual connector. Removing a saved control point writes immediately. */
  removeConnectorControl: () => Promise<void>
  /** The geometry authored in the source binding, the baseline a draft is compared against. */
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
/** The editable annotations mounted on one slide. */
export function annotationEditorLocatorsOn(page: number) { return Array.from(actions, ([locator, value]) => value.page === page ? locator : undefined).filter((locator): locator is string => !!locator) }
/**
 * Re-key everything held for an annotation when its locator changes, for
 * example when a write elsewhere in the file moved the tag to another line.
 * A component watches its locator prop and calls this, so an in-progress
 * selection, draft and toolbar actions all follow the tag.
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
  const registered = actions.get(previous)
  if (registered) { actions.delete(previous); actions.set(next, registered); annotationEditorRegistryVersion.value++ }
}
let shortcutInstalled = false
// Matched by physical key (`event.code`): on macOS, Option+Shift+A composes
// 'Å', so an `event.key` comparison would never fire there.
export function installAnnotationEditorShortcut() { if (shortcutInstalled || typeof window === 'undefined') return; shortcutInstalled = true; window.addEventListener('keydown', (event) => { if (event.altKey && event.shiftKey && event.code === 'KeyA') { event.preventDefault(); window.dispatchEvent(new Event('drawn-annotation-editor-toggle')) } }) }
export function selectAnnotation(locator: string, part: 'label' | 'width' | 'start' | 'end' | 'body' | 'control' = 'label') { selectedAnnotationId.value = locator; selectedAnnotationPart.value = part; released = undefined }
export function clearAnnotationSelection(locator?: string) { if (locator !== undefined && selectedAnnotationId.value !== locator) return; selectedAnnotationId.value = undefined; selectedAnnotationPart.value = undefined; released = undefined }
/**
 * Saving rewrites the Markdown, and Slidev's HMR then unmounts the slide,
 * re-imports its module and mounts it again. The old component releases its
 * selection on unmount, so nothing stays selected while an annotation is
 * gone; the next component with the same locator claims it back during
 * setup, so an author's selection, outline and keyboard nudging all
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
/**
 * In-flight pointer gestures, counted so the session-level Escape handler can
 * tell "cancel this drag" apart from "cancel the whole edit session".
 */
export const activeAnnotationGestures = ref(0)
/** Coalesce dependent-label placement work for the lifetime of a pointer gesture. */
export function beginAnnotationDraftGesture(locator: string, kind: 'connector' | 'label') {
  activeAnnotationGestures.value++
  if (kind !== 'label') return
  activeLabelLayoutGestures.set(locator, false)
  // Publish once at gesture start so labels that route around this one do not
  // remain permanently stale if the gesture is held for a long time.
  annotationLabelLayoutVersion.value++
  annotationLabelLayoutChange.value = { locator }
}
export function endAnnotationDraftGesture(locator: string, kind: 'connector' | 'label') {
  activeAnnotationGestures.value = Math.max(0, activeAnnotationGestures.value - 1)
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
/**
 * Replace a draft with an exact snapshot instead of merging into it. This is
 * what a cancelled drag uses: the snapshot it recorded is the whole
 * pre-gesture draft state, and `null` means "no draft existed".
 */
export function replaceLabelDraft(locator: string, geometry: PersistedAnnotationGeometry | null) {
  if (geometry) annotationDrafts.set(locator, { ...geometry })
  else annotationDrafts.delete(locator)
  annotationDraftChange.value = { locator, kind: 'clear' }
  annotationLabelLayoutVersion.value++
  annotationLabelLayoutChange.value = { locator }
  annotationGeometryVersion.value++
}
/**
 * Drop one part of a draft, keeping the author's uncommitted edits to the
 * other part. Used when a reset writes the source without that part: clearing
 * the whole draft there would silently discard unrelated pending changes.
 */
export function clearLabelDraftFields(locator: string, part: 'connector' | 'control') {
  const draft = annotationDrafts.get(locator)
  if (!draft) return
  const next = { ...draft }
  if (part === 'connector') { delete next.x1; delete next.y1; delete next.x2; delete next.y2; delete next.cx; delete next.cy }
  // 'control' is finer-grained than 'connector': straightening a connector
  // removes only its quadratic control point, so uncommitted endpoint drafts
  // survive the removal.
  else { delete next.cx; delete next.cy }
  replaceLabelDraft(locator, Object.keys(next).length ? next : null)
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

/**
 * Authoring mistakes an annotation wants shown on the slide while the deck is
 * being written: a `text` that no longer matches its fence, a `target` that
 * selects nothing. The console warning stays; this is what makes it visible to
 * an author who is looking at the slide. Keyed by reporter and message, so a
 * component that re-measures every animation frame holds one entry.
 */
export interface AnnotationAuthoringProblem {
  component: 'DrawnAnnotation' | 'InlineCompilerError' | 'SmartCast' | 'Warning'
  message: string
  /** The slide the reporter sits on; only the current slide's problems are shown. */
  page: number
}
export const annotationAuthoringProblems = reactive(new Map<string, AnnotationAuthoringProblem>())
function authoringProblemKey(reporter: string, message: string) { return `${reporter}\u0000${message}` }
export function reportAnnotationAuthoringProblem(reporter: string, problem: AnnotationAuthoringProblem) {
  const key = authoringProblemKey(reporter, problem.message)
  if (!annotationAuthoringProblems.has(key))
    annotationAuthoringProblems.set(key, problem)
}
/** Drops everything a reporter holds: its match succeeded after all, or it unmounted. */
export function clearAnnotationAuthoringProblems(reporter: string) {
  const prefix = authoringProblemKey(reporter, '')
  for (const key of Array.from(annotationAuthoringProblems.keys())) {
    if (key.startsWith(prefix))
      annotationAuthoringProblems.delete(key)
  }
}
