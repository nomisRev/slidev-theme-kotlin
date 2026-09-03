<script setup lang="ts">
import { ref } from 'vue'

/**
 * The imports folded off the top of the code fence that follows this
 * component (see `setup/code-imports.ts`). Rendered as a small toggle in
 * the code window's top-right corner; the import lines stay in the DOM,
 * collapsed, so the slide's text still carries the complete snippet.
 */
const props = defineProps<{
  /** Import targets without the `import` keyword, in source order. */
  imports: string[]
}>()

const open = ref(false)

const label = () => `${props.imports.length} ${props.imports.length === 1 ? 'import' : 'imports'}`
</script>

<template>
  <div class="code-imports" :class="{ 'code-imports--open': open }">
    <button
      type="button"
      class="code-imports__toggle"
      :aria-expanded="open"
      :title="open ? 'Hide imports' : 'Show imports'"
      @click="open = !open"
    >
      {{ label() }}
    </button>
    <div v-show="open" class="code-imports__panel" role="region" aria-label="Imports">
      <div v-for="target in imports" :key="target" class="code-imports__line">
        <span class="code-imports__keyword">import</span> {{ target }}
      </div>
    </div>
  </div>
</template>
