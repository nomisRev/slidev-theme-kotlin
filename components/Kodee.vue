<script setup lang="ts">
import { computed } from 'vue'
import { useSlideContext } from '@slidev/client'

interface Props {
  variant?: string
  size?: 'small' | 'large' | 'medium'
  position?: 'corner' | 'featured' | 'custom'
  x?: number
  y?: number
  scale?: number
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'greeting',
  size: 'small',
  position: 'corner',
  x: undefined,
  y: undefined,
  scale: undefined,
})

// Bundle mascot assets with the theme instead of relying on Slidev to copy a
// dependency's public directory into the consuming presentation.
const kodeeAssets = import.meta.glob('../assets/kodee-*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const variantName = computed(() =>
  props.variant.startsWith('kodee-') ? props.variant : `kodee-${props.variant}`,
)

const kodeeImage = computed(() => kodeeAssets[`../assets/${variantName.value}.svg`])

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
  }

  const variant = variantName.value

  styles.right = '0px'
  if (props.position === 'corner') {
    if (variant === 'kodee-greeting') {
      styles.bottom = '-42px'
      styles.right = '-15px'
    } else if (variant === 'kodee-wink') {
      styles.bottom = '-35px'
      styles.right = '-20px'
    } else if (variant === 'kodee-wave') {
      styles.bottom = '-15px'
      styles.right = '-15px'
    } else if (variant === 'kodee-heart') {
      // This artwork extends 10px farther below its viewBox center than the
      // greeting variant that establishes the default corner baseline.
      styles.bottom = '-32px'
      styles.right = '-30px'
    } else if (variant === 'kodee-jumping') {
      styles.bottom = '-34px'
      styles.right = '-15px'
    } else if (variant === 'kodee-sitting') {
      styles.bottom = '-35px'
      styles.right = '-5px'
    } else if (variant === 'kodee-drinking') {
      styles.bottom = '-36px'
      styles.right = '-31px'
    } else if (variant === 'kodee-in-love') {
      styles.bottom = '-31px'
      styles.right = '-15px'
    } else if (variant === 'kodee-welcome') {
      styles.bottom = '-37px'
      styles.right = '-15px'
    } else if (variant === 'kodee-winter') {
      styles.bottom = '-27px'
      styles.right = '-15px'
    } else if (variant === 'kodee-tiny') {
      styles.height = '100px'
      styles.width = '100px'
      styles.bottom = '-8px'
    } else {
      styles.bottom = '-42px'
    }

  } else if (props.position === 'featured') {
    styles.right = '-5%'
    styles.transform = 'translateY(-40%)'

    if (variant === 'kodee-greeting') {
      styles.top = '13%'
    } else if (variant === 'kodee-wink') {
      styles.top = '10%'
    } else if (variant === 'kodee-wave') {
      styles.top = '16%'
      styles.right = '3%'
    } else {
      styles.top = '0%'
    }

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
  <img
      v-motion
      :initial="motionConfig.initial"
      :enter="motionConfig.enter"
      :leave="motionConfig.leave"
      :src="kodeeImage"
      :alt="`Kodee ${variant}`"
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
