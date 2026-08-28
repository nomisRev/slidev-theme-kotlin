<script setup lang="ts">
import { computed } from 'vue'
import { useSlideContext } from '@slidev/client'
import type { KodeeProps } from './kodee-props'
import Kodee from './Kodee.vue'

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

const { $frontmatter, $slidev } = useSlideContext()

const defaults = computed<KodeeProps>(() => ({
  variant: props.defaultVariant,
  size: props.defaultSize,
  position: props.defaultPosition,
}))

const kodeeConfig = computed<KodeeProps | null>(() => {
  // A slide-level value wins. Otherwise use the deck-wide theme setting.
  const configured = $frontmatter?.kodee ?? $slidev?.configs.themeConfig?.kodee

  if (configured === undefined || configured === null || configured === false)
    return null

  if (configured === true)
    return defaults.value

  if (typeof configured === 'string') {
    return {
      ...defaults.value,
      variant: configured,
    }
  }

  if (typeof configured === 'object') {
    // Only the known options: anything else in the frontmatter object would
    // otherwise fall through `v-bind` onto the mascot's DOM element.
    const { variant, size, position, x, y, scale } = { ...defaults.value, ...configured }
    return { variant, size, position, x, y, scale }
  }

  return null
})
</script>

<template>
  <Kodee v-if="kodeeConfig" v-bind="kodeeConfig" />
</template>
