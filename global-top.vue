<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  annotationEditMode,
  annotationEditorStatus,
  clearAllAnnotationDrafts,
  clearAnnotationSelection,
  clearLabelDraft,
  duplicateAnnotationIds,
  missingAnnotationIds,
  recordAnnotationUndo,
  selectedAnnotationId,
  takeAnnotationUndo,
} from './components/drawn-annotation/editor-store'

const isDevelopment = import.meta.env.DEV
const checkingWriter = ref(false)
const canWrite = ref(false)
const selected = computed(() => selectedAnnotationId.value)
const hasIdProblems = computed(() => duplicateAnnotationIds.value.size > 0 || missingAnnotationIds.value > 0)
// An unrelated legacy annotation without an ID must not prevent editing a
// correctly identified annotation. Duplicates remain unsafe only for the ID
// currently selected; the component itself also refuses to make it editable.
const selectedHasDuplicateId = computed(() => !!selected.value && duplicateAnnotationIds.value.has(selected.value))

async function toggleEditor() {
  if (annotationEditMode.value) {
    annotationEditMode.value = false
    clearAnnotationSelection()
    return
  }
  checkingWriter.value = true
  annotationEditorStatus.value = 'Checking annotation writer…'
  try {
    if (!import.meta.env.DEV)
      return
    const { loadAnnotationGeometry } = await import('./components/drawn-annotation/writer-client')
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

onMounted(() => window.addEventListener('drawn-annotation-editor-toggle', toggleEditor))
onBeforeUnmount(() => window.removeEventListener('drawn-annotation-editor-toggle', toggleEditor))

async function resetSelected(part: 'label' | 'connector' | 'all') {
  if (!selected.value || !canWrite.value)
    return
  annotationEditorStatus.value = `Resetting ${part} for ${selected.value}…`
  try {
    if (!import.meta.env.DEV)
      return
    const { cachedAnnotationGeometry, resetAnnotationGeometry, saveLabelGeometry } = await import('./components/drawn-annotation/writer-client')
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

async function undoSelected() {
  if (!selected.value || !canWrite.value)
    return
  const undo = takeAnnotationUndo(selected.value)
  if (!undo) {
    annotationEditorStatus.value = 'Nothing to undo for this annotation'
    return
  }
  annotationEditorStatus.value = `Undoing ${undo.id}…`
  try {
    if (!import.meta.env.DEV)
      return
    const { restoreAnnotationGeometry } = await import('./components/drawn-annotation/writer-client')
    await restoreAnnotationGeometry(undo.id, undo.geometry)
    clearLabelDraft(undo.id)
    annotationEditorStatus.value = `${undo.id} restored`
  }
  catch (error) {
    annotationEditorStatus.value = error instanceof Error ? error.message : 'Unable to undo annotation geometry'
  }
}

async function resetAll() {
  if (!canWrite.value || !confirm('Reset all saved DrawnAnnotation geometry?'))
    return
  annotationEditorStatus.value = 'Resetting all annotation geometry…'
  try {
    if (!import.meta.env.DEV)
      return
    const { loadAnnotationGeometry, resetAllAnnotationGeometry } = await import('./components/drawn-annotation/writer-client')
    // Preserve each existing rule independently. This makes Reset all
    // recoverable by selecting an annotation and using Undo afterwards.
    const current = await loadAnnotationGeometry()
    await resetAllAnnotationGeometry()
    for (const [id, geometry] of Object.entries(current.geometry))
      recordAnnotationUndo(id, geometry)
    // Drafts render ahead of CSS HMR. Leaving one behind would make a reset-all
    // look like it failed until the slide was reloaded.
    clearAllAnnotationDrafts()
    annotationEditorStatus.value = 'All annotations reset to authored defaults'
  }
  catch (error) {
    annotationEditorStatus.value = error instanceof Error ? error.message : 'Unable to reset annotation geometry'
  }
}
</script>

<template>
  <!-- Global layers are singletons, unlike DrawnAnnotation instances. This
       keeps controls out of nested/clipped annotation canvases. -->
  <aside v-if="isDevelopment" class="drawn-annotation-toolbar" aria-label="Drawn annotation editor" @pointerdown.stop @click.stop>
    <button type="button" :disabled="checkingWriter" :aria-pressed="annotationEditMode" @click="toggleEditor">
      {{ annotationEditMode ? 'Done editing annotations' : 'Edit annotations' }}
    </button>
    <template v-if="annotationEditMode">
      <span class="drawn-annotation-toolbar__selection">{{ selected ? `Selected: ${selected}` : 'Select a visible annotation' }}</span>
      <button type="button" :disabled="!selected || selectedHasDuplicateId" @click="undoSelected">Undo</button>
      <button type="button" :disabled="!selected || selectedHasDuplicateId" @click="resetSelected('label')">Reset label</button>
      <button type="button" :disabled="!selected || selectedHasDuplicateId" @click="resetSelected('connector')">Use automatic connector</button>
      <button type="button" :disabled="!selected || selectedHasDuplicateId" @click="resetSelected('all')">Reset selected</button>
      <button type="button" :disabled="duplicateAnnotationIds.size > 0" @click="resetAll">Reset all</button>
    </template>
    <span v-if="annotationEditorStatus" class="drawn-annotation-toolbar__status" role="status">{{ annotationEditorStatus }}</span>
    <span v-if="annotationEditMode && hasIdProblems" class="drawn-annotation-toolbar__error" role="alert">
      {{ duplicateAnnotationIds.size ? `Duplicate IDs: ${[...duplicateAnnotationIds].join(', ')}.` : '' }}
      {{ missingAnnotationIds ? `${missingAnnotationIds} annotation${missingAnnotationIds === 1 ? '' : 's'} without a valid ID.` : '' }}
Annotations with missing or duplicate IDs cannot be saved; fix them before editing those annotations.
    </span>
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
