<script setup lang="ts">
import { useNav } from '@slidev/client'
import { computed } from 'vue'
import editIcon from '../assets/edit-3-svgrepo-com.svg'
import { annotationEditorRegistryVersion, hasRegisteredAnnotationEditors } from './drawn-annotation/editor-store'

// `slidev export` renders through a development server, so the launcher would
// otherwise land in every exported PNG: the `@media print` rule below only
// covers PDF export. Presenter view has no editable slide either.
const { isPresenter, isPrintMode } = useNav()
const hasAnnotations = computed(() => {
  annotationEditorRegistryVersion.value
  return hasRegisteredAnnotationEditors() && !isPrintMode.value && !isPresenter.value
})

function openAnnotationEditor(event: MouseEvent) {
  // Slidev ignores its keyboard shortcuts while a button has focus, so a
  // launcher that kept focus after a click would leave the arrow keys dead
  // once the author leaves the editor with Escape.
  ;(event.currentTarget as HTMLElement | null)?.blur()
  window.dispatchEvent(new Event('drawn-annotation-editor-toggle'))
}
</script>

<template>
  <button
    v-if="hasAnnotations"
    class="drawn-annotation-editor-launcher"
    type="button"
    title="Edit annotations"
    aria-label="Edit annotations"
    @click="openAnnotationEditor"
  >
    <img :src="editIcon" alt="" aria-hidden="true">
  </button>
</template>

<style>
.drawn-annotation-editor-launcher {
  position: fixed;
  z-index: 1000;
  top: 16px;
  right: 16px;
  display: grid;
  width: 32px;
  height: 32px;
  padding: 6px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.drawn-annotation-editor-launcher:hover,
.drawn-annotation-editor-launcher:focus-visible { background: #0001; }
.drawn-annotation-editor-launcher img { width: 20px; height: 20px; }
html.dark .drawn-annotation-editor-launcher img { filter: invert(1); }
@media print { .drawn-annotation-editor-launcher { display: none; } }
</style>
