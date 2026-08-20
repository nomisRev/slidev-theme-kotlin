<script setup lang="ts">
import { computed } from 'vue'
import { useSlideContext } from '@slidev/client'
import KodeeWrapper from './components/KodeeWrapper.vue'

const { $frontmatter, $page } = useSlideContext()

// The first slide defaults to the `cover` layout without declaring it in
// frontmatter, so mirror Slidev's own layout resolution.
const layout = computed(() => $frontmatter.layout ?? ($page.value === 1 ? 'cover' : 'default'))

const featured = computed(() => ['cover', 'intro'].includes(layout.value))
</script>

<template>
  <div class="kodee-layer" aria-hidden="true">
    <KodeeWrapper
      :default-size="featured ? 'large' : 'small'"
      :default-position="featured ? 'featured' : 'corner'"
    />
  </div>
</template>

<style scoped>
.kodee-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
