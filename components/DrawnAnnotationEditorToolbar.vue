<script setup lang="ts">
import { useNav } from '@slidev/client'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  annotationEditMode,
  annotationEditorActionsFor,
  annotationEditorRegistryVersion,
  annotationGeometryVersion,
  annotationEditorStatus,
  annotationDrafts,
  clearAllAnnotationDrafts,
  clearAnnotationSelection,
  clearLabelDraft,
  recordAnnotationUndo,
  selectedAnnotationId,
  takeAnnotationUndo,
} from './drawn-annotation/editor-store'

// Slidev's build pipeline can set `import.meta.env.DEV` while it renders the
// deck. The Vite mode is the reliable boundary: authoring controls exist only
// for the explicit `slidev` serve/development mode, never a built deck.
const isDevelopment = import.meta.env.MODE === 'development'

// Keep the writer out of production output entirely. A variable plus
// `@vite-ignore` leaves this as a normal Vite-served module request in the
// development browser, while the explicit development guard at every caller
// makes it unreachable in a built deck (and prevents Rollup from emitting a
// writer-client chunk with a local file-writing endpoint).
const writerClientModule = './drawn-annotation/writer-client.ts'
function loadWriterClient() {
  return import(/* @vite-ignore */ writerClientModule)
}
// Slidev's CLI export can run through a development-mode server, so mode alone
// is not an export guard. Keep authoring controls exclusively on the primary
// normal-slide route: no print/export, presenter, overview, notes, or preview
// layer can expose a control that changes the deck while it is being shown.
const { hasPrimarySlide, isPresenter, isPrintMode } = useNav()
const editorAvailable = computed(() => isDevelopment && hasPrimarySlide.value && !isPresenter.value && !isPrintMode.value)
const checkingWriter = ref(false)
const canWrite = ref(false)
const selected = computed(() => selectedAnnotationId.value)
const selectedDescription = computed(() => {
  if (!selected.value) return 'Select a visible annotation'
  try {
    const source = JSON.parse(atob(selected.value.replace(/-/g, '+').replace(/_/g, '/')))
    return `${source.file}:${source.start + 1}`
  } catch { return 'Selected annotation' }
})
const selectedConnectorManual = computed(() => {
  // Depend on both registration and local draft changes. A saved CSS update
  // clears the draft, which also refreshes the attached/manual toolbar state.
  annotationEditorRegistryVersion.value
  annotationGeometryVersion.value
  return annotationEditorActionsFor(selected.value)?.isManualConnector() ?? false
})
const canToggleConnector = computed(() => !!annotationEditorActionsFor(selected.value))

async function toggleSelectedConnectorAttachment() {
  const actions = annotationEditorActionsFor(selected.value)
  if (!actions || !canWrite.value)
    return
  await actions.toggleConnectorAttachment()
}

async function toggleEditor() {
  if (!editorAvailable.value)
    return
  if (annotationEditMode.value) {
    annotationEditMode.value = false
    clearAnnotationSelection()
    return
  }
  checkingWriter.value = true
  annotationEditorStatus.value = 'Checking annotation writer…'
  try {
    if (!isDevelopment)
      return
    const { loadAnnotationGeometry } = await loadWriterClient()
    await loadAnnotationGeometry()
    canWrite.value = true
    annotationEditMode.value = true
    annotationEditorStatus.value = 'Select a visible annotation'
  }
  catch {
    canWrite.value = false
    annotationEditorStatus.value = 'Annotation writer plugin is not configured. Add drawnAnnotationEditor() to vite.config.ts.'
  }
  finally {
    checkingWriter.value = false
  }
}

function clearSelectionOnEditorClickOutside(event: PointerEvent) {
  if (!annotationEditMode.value)
    return
  const target = event.target instanceof Element ? event.target : undefined
  // Keep a selection while the author works with any annotation control or
  // toolbar action. A click on the canvas still follows Slidev's normal
  // navigation policy; this listener only removes the stale edit target.
  if (!target?.closest('.drawn-annotation-toolbar, .annotation-label.is-editable, .annotation-connector-editor'))
    clearAnnotationSelection()
}

function keyboardUndo(event: KeyboardEvent) {
  if (!annotationEditMode.value || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'z')
    return
  // Native undo remains available to actual form controls and editable slide
  // content. The editor owns Cmd/Ctrl+Z only when an annotation is selected.
  const target = event.target instanceof Element ? event.target : undefined
  if (!selected.value || target?.closest('input, textarea, select, [contenteditable="true"]'))
    return
  event.preventDefault()
  event.stopPropagation()
  void undoSelected()
}

onMounted(() => {
  window.addEventListener('drawn-annotation-editor-toggle', toggleEditor)
  window.addEventListener('pointerdown', clearSelectionOnEditorClickOutside, true)
  window.addEventListener('keydown', keyboardUndo, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('drawn-annotation-editor-toggle', toggleEditor)
  window.removeEventListener('pointerdown', clearSelectionOnEditorClickOutside, true)
  window.removeEventListener('keydown', keyboardUndo, true)
})

async function resetSelected(part: 'label' | 'connector' | 'all') {
  if (!selected.value || !canWrite.value)
    return
  annotationEditorStatus.value = `Resetting ${part} for ${selected.value}…`
  try {
    if (!isDevelopment)
      return
    const { cachedAnnotationGeometry, resetAnnotationGeometry, saveLabelGeometry } = await loadWriterClient()
    // Resetting is a completed edit too: keep the rule we are about to remove
    // so Undo can restore it instead of making reset a destructive dead end.
    const previous = cachedAnnotationGeometry(selected.value)
    if (part === 'all')
      await saveLabelGeometry(selected.value, null)
    else
      await resetAnnotationGeometry(selected.value, part)
    recordAnnotationUndo(selected.value, previous)
    // A local draft has higher precedence than CSS, so drop it after a reset.
    clearLabelDraft(selected.value)
    annotationEditorStatus.value = `${selected.value} reset to authored defaults`
  }
  catch (error) {
    annotationEditorStatus.value = error instanceof Error ? error.message : 'Unable to reset annotation geometry'
  }
}

async function reloadSavedGeometry() {
  if (!canWrite.value)
    return
  // A 409 leaves the local draft in place deliberately, so an author can
  // inspect it. This explicit recovery action is the safe way to abandon that
  // draft and adopt the revision another browser saved.
  if (annotationDrafts.size && !confirm('Discard unsaved annotation changes and reload saved geometry?'))
    return
  annotationEditorStatus.value = 'Reloading saved annotation geometry…'
  try {
    if (!isDevelopment)
      return
    const { loadAnnotationGeometry } = await loadWriterClient()
    await loadAnnotationGeometry()
    clearAllAnnotationDrafts()
    annotationEditorStatus.value = 'Saved annotation geometry reloaded'
  }
  catch (error) {
    annotationEditorStatus.value = error instanceof Error ? error.message : 'Unable to reload annotation geometry'
  }
}

async function undoSelected() {
  if (!selected.value || !canWrite.value)
    return
  const undo = takeAnnotationUndo(selected.value)
  if (!undo) {
    annotationEditorStatus.value = 'Nothing to undo for this annotation'
    return
  }
  annotationEditorStatus.value = 'Undoing annotation change…'
  try {
    if (!isDevelopment)
      return
    const { restoreAnnotationGeometry } = await loadWriterClient()
    await restoreAnnotationGeometry(undo.locator, undo.geometry)
    clearLabelDraft(undo.locator)
    annotationEditorStatus.value = 'Annotation restored'
  }
  catch (error) {
    annotationEditorStatus.value = error instanceof Error ? error.message : 'Unable to undo annotation geometry'
  }
}

</script>

<template>
  <!-- Global layers are singletons, unlike DrawnAnnotation instances. This
       keeps controls out of nested/clipped annotation canvases. `DEV` is not
       enough here: CLI PNG/PDF export uses a Vite server too. -->
  <aside v-if="editorAvailable" class="drawn-annotation-toolbar" aria-label="Drawn annotation editor" @pointerdown.stop @click.stop>
    <button type="button" :disabled="checkingWriter" :aria-pressed="annotationEditMode" @click="toggleEditor">
      {{ annotationEditMode ? 'Done editing annotations' : 'Edit annotations' }}
    </button>
    <template v-if="annotationEditMode">
      <span class="drawn-annotation-toolbar__selection">{{ selectedDescription }}</span>
      <button type="button" :disabled="!selected" title="Cmd/Ctrl+Z" @click="undoSelected">Undo</button>
      <button type="button" @click="reloadSavedGeometry">Reload saved geometry</button>
      <button type="button" :disabled="!selected" @click="resetSelected('label')">Reset label</button>
      <button type="button" :disabled="!selected" @click="resetSelected('connector')">Reset connector</button>
      <button type="button" :disabled="!canToggleConnector" @click="toggleSelectedConnectorAttachment">
        {{ selectedConnectorManual ? 'Use automatic connector' : 'Make connector manual' }}
      </button>
      <button type="button" :disabled="!selected" @click="resetSelected('all')">Reset selected</button>
    </template>
    <span v-if="annotationEditorStatus" class="drawn-annotation-toolbar__status" role="status">{{ annotationEditorStatus }}</span>
  </aside>
</template>

<style>
.drawn-annotation-toolbar {
  position: fixed;
  z-index: 1000;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  max-width: min(48rem, calc(100vw - 32px));
  padding: 8px;
  border-radius: 6px;
  color: CanvasText;
  background: Canvas;
  box-shadow: 0 2px 10px #0005;
  font: 12px/1.3 ui-monospace, monospace;
}
.drawn-annotation-toolbar button { padding: 4px 7px; border: 1px solid currentColor; border-radius: 3px; color: inherit; background: transparent; font: inherit; }
.drawn-annotation-toolbar button:disabled { opacity: .5; cursor: not-allowed; }
.drawn-annotation-toolbar__selection, .drawn-annotation-toolbar__status, .drawn-annotation-toolbar__error { flex-basis: 100%; }
.drawn-annotation-toolbar__error { color: #b42318; }
@media print { .drawn-annotation-toolbar { display: none; } }
</style>
