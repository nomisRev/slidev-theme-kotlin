<script setup lang="ts">
import { computed } from 'vue'
import { useSlideContext } from '@slidev/client'
import type { KodeeProps } from './kodee-props'
import { resolveKodeeConfig } from './kodee-props'
import Kodee from './Kodee.vue'
import { usesViewTransition } from './kodee-view-transition'

interface Props {
  defaultVariant?: string
  defaultSize?: KodeeProps['size']
  defaultPosition?: KodeeProps['position']
}

const props = withDefaults(defineProps<Props>(), {
  defaultVariant: 'greeting',
  defaultSize: 'small',
  defaultPosition: 'corner',
})

const { $frontmatter, $slidev, $renderContext } = useSlideContext()

// Wherever Slidev renders its global layers (the slideshow in play and
// presenter views, and every printed or exported slide) the mascot is drawn
// by `global-bottom.vue`, once for the whole deck, so that a slide transition
// does not fade one copy out while fading an identical copy in. The overview
// and the presenter's next-slide preview render slides without global layers,
// and there each slide keeps its own mascot.
const drawnPerSlide = computed(() => !['slide', 'presenter'].includes($renderContext.value))

const kodeeConfig = computed<KodeeProps | null>(() =>
  resolveKodeeConfig($frontmatter?.kodee ?? $slidev?.configs.themeConfig?.kodee, {
    variant: props.defaultVariant,
    size: props.defaultSize,
    position: props.defaultPosition,
  }),
)

const viewTransition = computed(() => usesViewTransition($frontmatter?.transition))
</script>

<template>
  <Kodee v-if="drawnPerSlide && kodeeConfig" v-bind="kodeeConfig" :view-transition="viewTransition" />
</template>
