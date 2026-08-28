<script setup lang="ts">
import type { Component } from 'vue'
import { onMounted, shallowRef } from 'vue'

// Keep the complete editor toolbar out of built decks. `@vite-ignore` makes
// this a development-server-only module request rather than a Rollup chunk;
// the toolbar itself performs the normal-slide and writer-plugin checks.
const isDevelopment = import.meta.env.MODE === 'development'
const toolbarModule = './components/DrawnAnnotationEditorToolbar.vue'
const toolbar = shallowRef<Component>()

onMounted(async () => {
  if (isDevelopment)
    toolbar.value = (await import(/* @vite-ignore */ toolbarModule)).default
})
</script>

<template>
  <component :is="toolbar" v-if="toolbar" />
</template>
