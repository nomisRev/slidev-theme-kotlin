<script setup lang="ts">
import { lockShortcuts, useNav } from '@slidev/client'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PersistedAnnotationGeometry } from './drawn-annotation/geometry'
import { persistedGeometrySignature } from './drawn-annotation/geometry'
import {
  activeAnnotationGestures,
  annotationEditMode,
  annotationEditorActionsFor,
  annotationEditorRegistryVersion,
  annotationGeometryVersion,
  annotationEditorStatus,
  annotationDrafts,
  clearAllAnnotationDrafts,
  clearAnnotationSelection,
  clearLabelDraft,
  clearLabelDraftFields,
  installAnnotationEditorShortcut,
  recordAnnotationUndo,
  replaceLabelDraft,
  selectedAnnotationId,
  setLabelDraft,
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
const committing = ref(false)
const selected = computed(() => selectedAnnotationId.value)
function locatorDescription(locator: string) {
  try {
    // `atob` yields one char per byte; decode those bytes as UTF-8 so a
    // non-ASCII file path in the locator displays intact.
    const bytes = Uint8Array.from(atob(locator.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
    const source = JSON.parse(new TextDecoder().decode(bytes))
    return typeof source.line === 'number' ? `${source.file}:${source.line}` : source.file
  } catch { return 'Selected annotation' }
}
const selectedDescription = computed(() => selected.value ? locatorDescription(selected.value) : 'Select a visible annotation')
const selectedConnectorManual = computed(() => {
  // Depend on both registration and local draft changes. A saved CSS update
  // clears the draft, which also refreshes the attached/manual toolbar state.
  annotationEditorRegistryVersion.value
  annotationGeometryVersion.value
  return annotationEditorActionsFor(selected.value)?.isManualConnector() ?? false
})
const selectedConnectorCurved = computed(() => {
  // Same dependencies as the manual/attached state: registration and drafts.
  annotationEditorRegistryVersion.value
  annotationGeometryVersion.value
  return annotationEditorActionsFor(selected.value)?.hasConnectorControl() ?? false
})
const canToggleConnector = computed(() => {
  // A remounted annotation restores its selection before it registers again.
  annotationEditorRegistryVersion.value
  return !!annotationEditorActionsFor(selected.value)
})

async function toggleSelectedConnectorAttachment() {
  const actions = annotationEditorActionsFor(selected.value)
  if (!actions || !canWrite.value)
    return
  await actions.toggleConnectorAttachment()
}

async function toggleSelectedConnectorCurve() {
  const actions = annotationEditorActionsFor(selected.value)
  if (!actions || !canWrite.value)
    return
  if (actions.hasConnectorControl())
    await actions.removeConnectorControl()
  else
    actions.addConnectorControl()
}

/**
 * Editing is a deliberate frozen session. While it is active:
 * - `lockShortcuts()` — Slidev's public shortcut lock, the same one its
 *   built-in Monaco editor takes on focus — suspends every registered
 *   shortcut: arrow keys, space, page keys, slide jumps, overview, all of
 *   them. It gates the reactive `enabled` condition that Slidev's `magicKeys`
 *   watchers check, so it works upstream of the event race that made
 *   `stopPropagation()` unreliable.
 * - Capture-phase pointer/click blockers stop click-to-navigate, the nav
 *   control buttons, and touch swipes from ever reaching Slidev; the editor's
 *   own controls are exempt.
 * The lock and the mode always change together, through these two functions.
 */
let releaseNavigation: (() => void) | undefined
let statusClearTimer: ReturnType<typeof setTimeout> | undefined

function enterEditSession() {
  clearTimeout(statusClearTimer)
  annotationEditMode.value = true
  releaseNavigation?.()
  releaseNavigation = lockShortcuts()
  annotationEditorStatus.value = 'Select a visible annotation — navigation is paused; Done saves, Esc cancels'
}

function exitEditSession(status?: string) {
  annotationEditMode.value = false
  releaseNavigation?.()
  releaseNavigation = undefined
  clearAnnotationSelection()
  // The status is also what keeps the toolbar rendered while the editor is
  // inactive (so writer configuration errors can be shown). A closing summary
  // is shown briefly; nothing lingers after the author is done.
  annotationEditorStatus.value = status
  clearTimeout(statusClearTimer)
  if (status) {
    statusClearTimer = setTimeout(() => {
      if (!annotationEditMode.value)
        annotationEditorStatus.value = undefined
    }, 5000)
  }
}

/**
 * The drafts that actually differ from what the source holds. The baseline is
 * this tab's last save when there is one (HMR may not have delivered it as a
 * prop yet), otherwise the authored `:geometry` binding. The writer replaces
 * the whole binding, so each draft is completed from its baseline rather than
 * letting a label-only draft erase the connector the source holds.
 */
function dirtyDrafts(cachedAnnotationGeometry: (locator: string) => PersistedAnnotationGeometry | null) {
  const dirty: { locator: string, target: PersistedAnnotationGeometry }[] = []
  for (const [locator, draft] of annotationDrafts) {
    const baseline = cachedAnnotationGeometry(locator) ?? annotationEditorActionsFor(locator)?.persistedGeometry() ?? {}
    const target = { ...baseline, ...draft }
    if (persistedGeometrySignature(target) !== persistedGeometrySignature(baseline))
      dirty.push({ locator, target })
  }
  return dirty
}

const changes = (count: number) => `${count} annotation change${count === 1 ? '' : 's'}`

/**
 * "Done editing annotations": commit every dirty draft, in the order the
 * annotations were first edited during the session, then leave the session.
 * A failed write leaves its draft (and the session) in place: nothing is
 * discarded, and the status names the failure and the two recovery paths —
 * fix and press Done again, or discard via "Reload saved geometry".
 */
async function commitEditSession() {
  if (committing.value)
    return
  committing.value = true
  try {
    if (!isDevelopment)
      return
    const { cachedAnnotationGeometry, saveLabelGeometry } = await loadWriterClient()
    const pending = dirtyDrafts(cachedAnnotationGeometry)
    if (!pending.length) {
      exitEditSession()
      return
    }
    annotationEditorStatus.value = `Saving ${changes(pending.length)}…`
    const failures: { locator: string, message: string }[] = []
    for (const { locator, target } of pending) {
      try {
        const saved = await saveLabelGeometry(locator, target)
        // The writer returns its fixed-four-decimal source snapshot. Adopting
        // it keeps the committed geometry visible until Slidev recompiles the
        // rewritten Markdown, and marks the draft clean.
        const persisted = saved.geometry[locator]
        if (persisted)
          setLabelDraft(locator, persisted)
      }
      catch (error) {
        failures.push({ locator, message: error instanceof Error ? error.message : 'unable to save annotation geometry' })
      }
    }
    if (failures.length) {
      const detail = failures.map(failure => `${locatorDescription(failure.locator)}: ${failure.message}`).join('; ')
      annotationEditorStatus.value = `Saved ${pending.length - failures.length} of ${changes(pending.length)}. Failed — ${detail}. Unsaved changes stay as local drafts: fix the problem and press Done again, or use "Reload saved geometry" to discard them.`
      return
    }
    exitEditSession(`${changes(pending.length)} saved`)
  }
  finally {
    committing.value = false
  }
}

async function toggleEditor() {
  if (!editorAvailable.value)
    return
  if (annotationEditMode.value) {
    await commitEditSession()
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
    enterEditSession()
  }
  catch {
    canWrite.value = false
    annotationEditorStatus.value = 'Annotation writer plugin is not configured. Add drawnAnnotationEditor() to vite.config.ts.'
  }
  finally {
    checkingWriter.value = false
  }
}

/**
 * Escape cancels, in stages: an active drag (handled by the annotation, which
 * marks the event consumed), then the current selection, then — after a
 * confirmation when unsaved changes exist — the whole session, discarding its
 * drafts without writing anything.
 */
async function cancelEditSession() {
  if (committing.value || !isDevelopment)
    return
  const { cachedAnnotationGeometry } = await loadWriterClient()
  const dirty = dirtyDrafts(cachedAnnotationGeometry)
  if (dirty.length && !confirm(`Discard ${changes(dirty.length)} and stop editing annotations?`))
    return
  clearAllAnnotationDrafts()
  exitEditSession(dirty.length ? 'Annotation editing cancelled — unsaved changes discarded' : undefined)
}

function cancelEditSessionOnEscape(event: KeyboardEvent) {
  if (!annotationEditMode.value || event.key !== 'Escape')
    return
  // A drag cancel spent this press: the annotation prevented its default (and
  // the gesture counter covers the listener-order race the same way).
  if (event.defaultPrevented || activeAnnotationGestures.value > 0)
    return
  event.preventDefault()
  event.stopPropagation()
  if (selectedAnnotationId.value) {
    clearAnnotationSelection()
    annotationEditorStatus.value = 'Selection cleared — Esc again cancels editing'
    return
  }
  void cancelEditSession()
}

/**
 * While the frozen session is active, no pointer input outside the editor's
 * own controls may reach Slidev: play.vue navigates on a slide-container
 * pointerdown, the nav controls navigate on click, and touch swipes ride on
 * pointer events. Stopping propagation in the capture phase keeps all of them
 * from firing; other window-level listeners (selection clearing, drag
 * handlers on captured pointers) are unaffected.
 */
const EDITOR_UI_SELECTOR = '.drawn-annotation-toolbar, .drawn-annotation-editor-launcher, .annotation-label.is-editable, .annotation-connector-editor'
function blockNavigationInput(event: Event) {
  if (!annotationEditMode.value)
    return
  const target = event.target instanceof Element ? event.target : undefined
  if (target?.closest(EDITOR_UI_SELECTOR))
    return
  event.stopPropagation()
}

function clearSelectionOnEditorClickOutside(event: PointerEvent) {
  if (!annotationEditMode.value)
    return
  const target = event.target instanceof Element ? event.target : undefined
  // Keep a selection while the author works with any annotation control or
  // toolbar action. A click on the canvas only removes the stale edit target;
  // navigation stays blocked either way for the whole session.
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
  undoSelected()
}

onMounted(() => {
  // The toolbar is the singleton that owns the toggle, so it installs
  // Alt+Shift+A: the shortcut must work on a deck whose current slide has no
  // annotation at all, not only once one has mounted.
  installAnnotationEditorShortcut()
  window.addEventListener('drawn-annotation-editor-toggle', toggleEditor)
  window.addEventListener('pointerdown', blockNavigationInput, true)
  window.addEventListener('click', blockNavigationInput, true)
  window.addEventListener('dblclick', blockNavigationInput, true)
  window.addEventListener('keydown', cancelEditSessionOnEscape, true)
  window.addEventListener('pointerdown', clearSelectionOnEditorClickOutside, true)
  window.addEventListener('keydown', keyboardUndo, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('drawn-annotation-editor-toggle', toggleEditor)
  window.removeEventListener('pointerdown', blockNavigationInput, true)
  window.removeEventListener('click', blockNavigationInput, true)
  window.removeEventListener('dblclick', blockNavigationInput, true)
  window.removeEventListener('keydown', cancelEditSessionOnEscape, true)
  window.removeEventListener('pointerdown', clearSelectionOnEditorClickOutside, true)
  window.removeEventListener('keydown', keyboardUndo, true)
  clearTimeout(statusClearTimer)
  releaseNavigation?.()
  releaseNavigation = undefined
})

// Restoring an automatic connector is not a reset: that transition belongs
// exclusively to the manual/automatic toggle above, so every path to the
// automatic state shares one undo, status and draft-clearing code path.
async function resetSelected(part: 'label' | 'all') {
  if (!selected.value || !canWrite.value)
    return
  annotationEditorStatus.value = `Resetting ${part === 'all' ? 'label and connector' : part} for ${selected.value}…`
  try {
    if (!isDevelopment)
      return
    const { cachedAnnotationGeometry, resetAnnotationGeometry, saveLabelGeometry } = await loadWriterClient()
    // A reset removes saved geometry, which a draft cannot express (drafts
    // only overlay the source), so it is the one kind of session edit that
    // writes immediately. Keep the rule being removed so Undo can restore it
    // — as an uncommitted draft — instead of making reset a dead end.
    const previous = cachedAnnotationGeometry(selected.value) ?? annotationEditorActionsFor(selected.value)?.persistedGeometry() ?? null
    if (part === 'all')
      await saveLabelGeometry(selected.value, null)
    else
      await resetAnnotationGeometry(selected.value, part, previous)
    recordAnnotationUndo(selected.value, previous)
    // Only the reset part of the local draft is spent; uncommitted edits to
    // the other part must survive. "Reset selected" intentionally drops both.
    if (part === 'all')
      clearLabelDraft(selected.value)
    else
      clearLabelDraftFields(selected.value, part)
    annotationEditorStatus.value = `${selected.value} reset to authored defaults`
  }
  catch (error) {
    annotationEditorStatus.value = error instanceof Error ? error.message : 'Unable to reset annotation geometry'
  }
}

async function reloadSavedGeometry() {
  if (!canWrite.value)
    return
  // A failed commit leaves the local drafts in place deliberately, so an
  // author can inspect them. This explicit recovery action is the safe way to
  // abandon those drafts and adopt the revision another author saved.
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

/**
 * Undo restores the recorded pre-gesture draft snapshot locally. It never
 * writes: the restored state is committed — or discarded — with the session.
 */
function undoSelected() {
  if (!selected.value)
    return
  const undo = takeAnnotationUndo(selected.value)
  if (!undo) {
    annotationEditorStatus.value = 'Nothing to undo for this annotation'
    return
  }
  replaceLabelDraft(undo.locator, undo.geometry)
  annotationEditorStatus.value = 'Annotation change undone'
}

</script>

<template>
  <!-- Global layers are singletons, unlike DrawnAnnotation instances. This
       keeps controls out of nested/clipped annotation canvases. `DEV` is not
       enough here: CLI PNG/PDF export uses a Vite server too. -->
  <aside v-if="editorAvailable && (annotationEditMode || annotationEditorStatus)" class="drawn-annotation-toolbar" aria-label="Drawn annotation editor" @pointerdown.stop @click.stop>
    <template v-if="annotationEditMode">
      <button type="button" :disabled="committing" @click="toggleEditor">Done editing annotations</button>
      <span class="drawn-annotation-toolbar__selection">{{ selectedDescription }}</span>
      <button type="button" :disabled="!selected" title="Cmd/Ctrl+Z" @click="undoSelected">Undo</button>
      <button type="button" :disabled="committing" @click="reloadSavedGeometry">Reload saved geometry</button>
      <button type="button" :disabled="!canToggleConnector || committing" @click="toggleSelectedConnectorAttachment">
        {{ selectedConnectorManual ? 'Use automatic connector' : 'Make connector manual' }}
      </button>
      <button type="button" :disabled="!canToggleConnector || committing" @click="toggleSelectedConnectorCurve">
        {{ selectedConnectorCurved ? 'Straighten connector' : 'Curve connector' }}
      </button>
      <button type="button" :disabled="!selected || committing" @click="resetSelected('label')">Reset label</button>
      <button type="button" :disabled="!selected || committing" @click="resetSelected('all')">Reset label &amp; connector</button>
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
