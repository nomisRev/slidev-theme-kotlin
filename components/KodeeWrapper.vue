<script setup lang="ts">
import { computed } from 'vue'
import { useSlideContext } from '@slidev/client'
import Kodee from './Kodee.vue'

interface KodeeConfig {
  variant?: string
  size?: 'small' | 'medium' | 'large'
  position?: 'corner' | 'featured' | 'custom'
  x?: number
  y?: number
  scale?: number
}

interface Props {
  defaultVariant?: string
  defaultSize?: KodeeConfig['size']
  defaultPosition?: KodeeConfig['position']
}

const props = withDefaults(defineProps<Props>(), {
  defaultVariant: 'greeting',
  defaultSize: 'small',
  defaultPosition: 'corner',
})

const { $frontmatter, $slidev } = useSlideContext()

const defaults = computed<KodeeConfig>(() => ({
  variant: props.defaultVariant,
  size: props.defaultSize,
  position: props.defaultPosition,
}))

const kodeeConfig = computed<KodeeConfig | null>(() => {
  // A slide-level value wins. Otherwise use the deck-wide theme setting.
  const configured = $frontmatter?.kodee ?? $slidev.configs.themeConfig?.kodee

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
    return {
      ...defaults.value,
      ...configured,
    }
  }

  return null
})
</script>

<template>
  <Kodee
    v-if="kodeeConfig"
    :variant="kodeeConfig.variant"
    :size="kodeeConfig.size"
    :position="kodeeConfig.position"
    :x="kodeeConfig.x"
    :y="kodeeConfig.y"
    :scale="kodeeConfig.scale"
  />
</template>
