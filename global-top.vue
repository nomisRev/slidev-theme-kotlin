<script setup lang="ts">
import type { Component } from 'vue'
import { onMounted, shallowRef } from 'vue'

// Keep all annotation-editor code out of built decks. The bottom-right menu
// and the authoring-problem chips are development-server-only requests.
const isDevelopment = import.meta.env.MODE === 'development'
const toolbarModule = './components/DrawnAnnotationEditorToolbar.vue'
const problemsModule = './components/DrawnAnnotationProblems.vue'
const toolbar = shallowRef<Component>()
const problems = shallowRef<Component>()

onMounted(async () => {
  if (!isDevelopment)
    return
  ;[toolbar.value, problems.value] = await Promise.all([
    import(/* @vite-ignore */ toolbarModule).then(module => module.default),
    import(/* @vite-ignore */ problemsModule).then(module => module.default),
  ])
})
</script>

<template>
  <component :is="toolbar" v-if="toolbar" />
  <component :is="problems" v-if="problems" />
</template>
