<script setup lang="ts">
import type { Component } from 'vue'
import { onMounted, shallowRef } from 'vue'

// Keep all annotation-editor code out of built decks. Both the launcher and
// bottom-right menu are development-server-only requests.
const isDevelopment = import.meta.env.MODE === 'development'
const toolbarModule = './components/DrawnAnnotationEditorToolbar.vue'
const launcherModule = './components/DrawnAnnotationEditorLauncher.vue'
const toolbar = shallowRef<Component>()
const launcher = shallowRef<Component>()

onMounted(async () => {
  if (!isDevelopment)
    return
  ;[toolbar.value, launcher.value] = await Promise.all([
    import(/* @vite-ignore */ toolbarModule).then(module => module.default),
    import(/* @vite-ignore */ launcherModule).then(module => module.default),
  ])
})
</script>

<template>
  <component :is="launcher" v-if="launcher" />
  <component :is="toolbar" v-if="toolbar" />
</template>
