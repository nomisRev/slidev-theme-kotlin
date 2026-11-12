<script setup lang="ts">
import type { CodeHighlightProps } from './code-highlight'
import { computed, reactive, toRefs, useTemplateRef } from 'vue'
import { useCodeHighlight } from './code-highlight'

/**
 * IntelliJ's debugger inline value: the grey `numbers: [1, 2, 3]` the IDE
 * draws after a line while it is paused there. Made for output slides, where
 * the value a line produces is shown next to the line instead of in a console
 * beneath the code.
 */
const props = defineProps<Omit<CodeHighlightProps, 'message'> & {
  /** What the line evaluates to, shown after the line as the debugger shows it. */
  value: string
}>()
const container = useTemplateRef<HTMLElement>('container')

const highlightProps = reactive({
  ...toRefs(props),
  message: computed(() => props.value),
})
const { message, messageShown, messageStyle, messageCarried } = useCodeHighlight(highlightProps, container, { component: 'InlineValue' })
</script>

<template>
  <div ref="container" class="inline-value-host">
    <slot />
    <Transition :name="messageCarried ? 'carried' : 'inline-value'">
      <span v-if="messageShown" class="inline-value" :class="{ 'magic-move-carried': messageCarried }" :style="messageStyle">{{ message }}</span>
    </Transition>
  </div>
</template>

<style scoped>
.inline-value-host { position: relative; }
/* Plain grey text in the editor's own font and size, as IntelliJ renders the
   debugger's inline values. */
.inline-value {
  position: absolute;
  z-index: 2;
  padding-left: 0.6em;
  color: var(--inline-value-color, #787878);
  font-family: var(--slidev-code-font-family, 'JetBrains Mono Local', 'JetBrains Mono', ui-monospace, monospace);
  font-size: var(--inline-value-size, var(--code-highlight-target-size, 12px));
  font-weight: 400;
  line-height: 1.25;
  white-space: pre;
  pointer-events: none;
  transform: translateY(-50%);
}
.inline-value-enter-active,
.inline-value-leave-active { transition: opacity .18s ease; }
.inline-value-enter-from,
.inline-value-leave-to { opacity: 0; }
</style>
