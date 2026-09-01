<script setup lang="ts">
import { computed } from 'vue'
import editIcon from '../assets/edit-3-svgrepo-com.svg'
import { annotationEditorRegistryVersion, hasRegisteredAnnotationEditors } from './drawn-annotation/editor-store'

const hasAnnotations = computed(() => {
  annotationEditorRegistryVersion.value
  return hasRegisteredAnnotationEditors()
})

function openAnnotationEditor() {
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
