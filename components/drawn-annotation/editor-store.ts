import { reactive, ref } from 'vue'
import type { PersistedAnnotationGeometry } from './geometry'

/** Shared development-only state, keyed by opaque source locators. */
export const annotationEditMode = ref(false)
export const selectedAnnotationId = ref<string>()
export const selectedAnnotationPart = ref<'label' | 'width' | 'start' | 'end' | 'body'>()
export const annotationDrafts = reactive(new Map<string, PersistedAnnotationGeometry>())
export const annotationGeometryVersion = ref(0)
export const annotationEditorStatus = ref<string>()
export interface AnnotationEditorActions { isManualConnector: () => boolean, toggleConnectorAttachment: () => Promise<void> }
const actions = new Map<string, AnnotationEditorActions>()
export const annotationEditorRegistryVersion = ref(0)
export function registerAnnotationEditorActions(locator: string, value: AnnotationEditorActions) { actions.set(locator, value); annotationEditorRegistryVersion.value++; return () => { if (actions.get(locator) === value) { actions.delete(locator); annotationEditorRegistryVersion.value++ } } }
export function annotationEditorActionsFor(locator: string | undefined) { return locator ? actions.get(locator) : undefined }
interface AnnotationUndo { locator: string, geometry: PersistedAnnotationGeometry | null }
const history: AnnotationUndo[] = []
export function recordAnnotationUndo(locator: string, geometry: PersistedAnnotationGeometry | null) { history.push({ locator, geometry: geometry ? { ...geometry } : null }); if (history.length > 100) history.shift() }
export interface AnnotationUndoSession { undoRecorded?: boolean }
export function recordAnnotationUndoOnce(session: AnnotationUndoSession | undefined, locator: string, geometry: PersistedAnnotationGeometry | null) { if (session?.undoRecorded) return; recordAnnotationUndo(locator, geometry); if (session) session.undoRecorded = true }
export function takeAnnotationUndo(locator: string) { for (let index = history.length - 1; index >= 0; index--) if (history[index].locator === locator) return history.splice(index, 1)[0] }
let shortcutInstalled = false
export function installAnnotationEditorShortcut() { if (shortcutInstalled || typeof window === 'undefined') return; shortcutInstalled = true; window.addEventListener('keydown', (event) => { if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'a') { event.preventDefault(); window.dispatchEvent(new Event('drawn-annotation-editor-toggle')) } }) }
export function selectAnnotation(locator: string, part: 'label' | 'width' | 'start' | 'end' | 'body' = 'label') { selectedAnnotationId.value = locator; selectedAnnotationPart.value = part }
export function clearAnnotationSelection(locator?: string) { if (locator !== undefined && selectedAnnotationId.value !== locator) return; selectedAnnotationId.value = undefined; selectedAnnotationPart.value = undefined }
export function setLabelDraft(locator: string, geometry: PersistedAnnotationGeometry) { annotationDrafts.set(locator, { ...annotationDrafts.get(locator), ...geometry }); annotationGeometryVersion.value++ }
export function clearLabelDraft(locator: string) { annotationDrafts.delete(locator); annotationGeometryVersion.value++ }
export function clearAllAnnotationDrafts() { if (annotationDrafts.size) { annotationDrafts.clear(); annotationGeometryVersion.value++ } }
