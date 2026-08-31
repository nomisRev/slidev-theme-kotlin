<script lang="ts">
// Module scope, shared by every mascot instance.

// Bundle mascot assets with the theme instead of relying on Slidev to copy a
// dependency's public directory into the consuming presentation.
const kodeeAssets = import.meta.glob('../assets/kodee-*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

// Per-variant offsets for the `corner` position. Each artwork carries its own
// padding inside its viewBox, so the baseline is tuned by hand to sit on the
// slide edge; `kodee-heart`, for example, extends 10px farther below its
// viewBox center than `kodee-greeting`, which establishes the default.
const CORNER_OFFSETS: Record<string, Record<string, string>> = {
  'kodee-greeting': { bottom: '-42px', right: '-15px' },
  'kodee-wink': { bottom: '-35px', right: '-20px' },
  'kodee-wave': { bottom: '-15px', right: '-15px' },
  'kodee-heart': { bottom: '-32px', right: '-30px' },
  'kodee-jumping': { bottom: '-34px', right: '-15px' },
  'kodee-sitting': { bottom: '-35px', right: '-5px' },
  'kodee-drinking': { bottom: '-36px', right: '-31px' },
  'kodee-in-love': { bottom: '-31px', right: '-15px' },
  'kodee-welcome': { bottom: '-37px', right: '-15px' },
  'kodee-winter': { bottom: '-27px', right: '-15px' },
  'kodee-tiny': { bottom: '-8px', width: '100px', height: '100px' },
}

// Per-variant offsets for the `featured` position, over its shared baseline.
const FEATURED_OFFSETS: Record<string, Record<string, string>> = {
  'kodee-greeting': { top: '13%' },
  'kodee-wink': { top: '10%' },
  'kodee-wave': { top: '16%', right: '3%' },
}
</script>

<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useSlideContext } from '@slidev/client'
import type { KodeeProps } from './kodee-props'

const props = withDefaults(defineProps<KodeeProps>(), {
  variant: 'greeting',
  size: 'small',
  position: 'corner',
})

const variantName = computed(() =>
  props.variant.startsWith('kodee-') ? props.variant : `kodee-${props.variant}`,
)

const kodeeImage = computed(() => kodeeAssets[`../assets/${variantName.value}.svg`])

// A typo'd variant renders nothing, so name the alternatives instead of
// leaving the author to diff file names against their frontmatter.
if (import.meta.env.DEV) {
  watchEffect(() => {
    if (!kodeeImage.value) {
      const available = Object.keys(kodeeAssets)
        .map(path => path.replace('../assets/kodee-', '').replace('.svg', ''))
        .sort()
        .join(', ')
      console.warn(`[Kodee] Unknown variant "${props.variant}" — no mascot is shown. Available variants: ${available}`)
    }
  })
}

// Compute size classes and dimensions
const sizeConfig = computed(() => {
  switch (props.size) {
    case 'large':
      return variantName.value === 'kodee-wave'
        ? {width: '500px', height: '500px'}
        : {width: '600px', height: '600px'}
    case 'medium':
      return { width: '320px', height: '320px' }
    case 'small':
    default:
      return { width: '200px', height: '200px' }
  }
})

// Compute position styles
const positionStyles = computed(() => {
  const styles: Record<string, string> = {
    position: 'absolute',
    width: sizeConfig.value.width,
    height: sizeConfig.value.height,
    right: '0px',
  }

  const variant = variantName.value

  if (props.position === 'corner') {
    Object.assign(styles, { bottom: '-42px' }, CORNER_OFFSETS[variant])
  } else if (props.position === 'featured') {
    Object.assign(styles, { right: '-5%', transform: 'translateY(-40%)', top: '0%' }, FEATURED_OFFSETS[variant])
  } else if (props.position === 'custom' && props.x !== undefined && props.y !== undefined) {
    styles.left = `${props.x}px`
    styles.top = `${props.y}px`
  }

  return styles
})

const { $frontmatter, $slidev } = useSlideContext()

// Whether slide navigation hands Kodee to the browser's View Transition (the
// `view-transition-name` below) instead of v-motion. That is only the case
// when the deck — or this slide — actually uses the `view-transition`
// transition AND the browser implements the API; checking API support alone
// would silently disable the entrance animation in every modern browser,
// even in decks using a different transition. Slidev falls back to a normal
// transition in browsers without the API, so v-motion takes over there too.
const usesViewTransition = computed(() =>
  ($frontmatter?.transition ?? $slidev?.configs.transition) === 'view-transition'
  && typeof document !== 'undefined' && 'startViewTransition' in document)

// Compute v-motion animation config
const motionConfig = computed(() => {
  const baseScale = props.scale ?? 1
  const viewTransition = usesViewTransition.value

  return {
    initial: {
      opacity: viewTransition ? 1 : 0,
      scale: baseScale,
    },
    enter: {
      opacity: 1,
      scale: baseScale,
      transition: {
        type: 'spring',
        stiffness: 100,
        damping: 15,
        mass: 1,
        duration: viewTransition ? 0 : undefined,
      },
    },
    leave: {
      opacity: viewTransition ? 1 : 0,
      scale: baseScale,
      transition: {
        duration: viewTransition ? 0 : 300,
      },
    },
  }
})
</script>

<template>
  <!-- The mascot is decoration; an empty alt keeps screen readers from
       announcing it on every slide. -->
  <img
      v-if="kodeeImage"
      v-motion
      :initial="motionConfig.initial"
      :enter="motionConfig.enter"
      :leave="motionConfig.leave"
      :src="kodeeImage"
      alt=""
      :style="positionStyles"
      class="kodee-character"
  />
</template>

<style scoped>
.kodee-character {
  pointer-events: none;
  object-fit: contain;
  view-transition-name: kodee-mascot;
}
</style>
