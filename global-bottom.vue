<script setup lang="ts">
import { computed } from 'vue'
import { useNav } from '@slidev/client'
import { configs } from '@slidev/client/env.ts'
import Kodee from './components/Kodee.vue'
import { kodeeDefaultsForLayout, kodeeIdentity, resolveKodeeConfig, slideLayout } from './components/kodee-props'
import { usesViewTransition } from './components/kodee-view-transition'

// One mascot for the whole slideshow, following the current slide's `kodee`
// frontmatter. Slidev keeps a slide transition such as `fade` on the slide
// pages, and a per-slide mascot fades out with the old page while an identical
// one fades in with the new: a blink on every navigation. This layer is a
// sibling of the pages, under them, and only changes when the slide asks for
// a different mascot. Slidev paints the deck background on the document, not
// on the pages, so the mascot still shows through beneath the slide content.
// Print and export render this layer once per printed slide, each with its
// own fixed navigation, so `useNav()` names that slide there. The overview
// and the presenter's next-slide preview render slides without global
// layers; there `KodeeWrapper` draws the mascot per slide.
const { currentSlideRoute, currentSlideNo } = useNav()

const frontmatter = computed<Record<string, any> | undefined>(() => currentSlideRoute.value?.meta.slide?.frontmatter)

const kodeeConfig = computed(() => {
  const layout = slideLayout(frontmatter.value, currentSlideNo.value)
  return resolveKodeeConfig(frontmatter.value?.kodee ?? configs.themeConfig?.kodee, kodeeDefaultsForLayout(layout))
})

// A new key remounts the mascot, replaying its entrance, only when the
// picture or its place actually changes.
const identity = computed(() => kodeeConfig.value ? kodeeIdentity(kodeeConfig.value) : '')

const viewTransition = computed(() => usesViewTransition(frontmatter.value?.transition))
</script>

<template>
  <div class="kodee-layer" aria-hidden="true">
    <Kodee v-if="kodeeConfig" :key="identity" v-bind="kodeeConfig" :view-transition="viewTransition" />
  </div>
</template>

<style scoped>
.kodee-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
