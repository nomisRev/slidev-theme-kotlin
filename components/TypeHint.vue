<script setup lang="ts">
import type { CodeHighlightProps } from './code-highlight'
import { computed, reactive, toRefs, useTemplateRef } from 'vue'
import { useCodeHighlight } from './code-highlight'

/**
 * IntelliJ's lambda inlay hint: the grey `this: HTML` pill the IDE draws
 * right after the `{` of a lambda with receiver, or `context(Clock)` after
 * the block of a `context(...)` call, which brings a context into scope
 * without touching `this`. Made for DSL slides, where what each block brings
 * into scope is the whole point.
 */
const props = defineProps<Omit<CodeHighlightProps, 'message'> & {
  /** The receiver type of the lambda, shown as `this: <receiver>`. */
  receiver?: string
  /** The context a `context(...)` block supplies, shown as `context(<context>)` — no `this:`, as IntelliJ renders it. */
  context?: string
}>()
const container = useTemplateRef<HTMLElement>('container')

if (import.meta.env.MODE === 'development' && !props.receiver && !props.context)
  console.warn('[TypeHint] Give `receiver` (rendered `this: …`) or `context` (rendered `context(…)`) — the hint is not shown.')

// The same exact-text match and message placement as `SmartCast` and
// `Warning`, with nothing painted: the hint sits after the `{` that ends
// its line, or after the line when more code follows the brace.
const highlightProps = reactive({
  ...toRefs(props),
  text: computed(() => props.text ?? '{'),
  message: computed(() => props.receiver ? `this: ${props.receiver}` : props.context ? `context(${props.context})` : undefined),
})
const { message, messageShown, messageStyle } = useCodeHighlight(highlightProps, container, { component: 'TypeHint' })
</script>

<template>
  <div ref="container" class="type-hint-host">
    <slot />
    <Transition name="type-hint">
      <span v-if="messageShown" class="type-hint" :style="messageStyle">{{ message }}</span>
    </Transition>
  </div>
</template>

<style scoped>
.type-hint-host { position: relative; }
/* A rounded grey pill in the editor's own font, a little smaller than the
   code, as IntelliJ renders inlay hints. Colours follow IntelliJ Light and
   Darcula unless a deck sets `--type-hint-color` / `--type-hint-background`. */
.type-hint {
  position: absolute;
  z-index: 2;
  padding: 0 0.45em;
  border-radius: 0.5em;
  color: var(--type-hint-color, #6c707e);
  background: var(--type-hint-background, #ebecf0);
  font-family: var(--slidev-code-font-family, 'JetBrains Mono Local', 'JetBrains Mono', ui-monospace, monospace);
  font-size: var(--type-hint-size, calc(var(--code-highlight-target-size, 12px) * 0.85));
  font-weight: 500;
  line-height: 1.45;
  white-space: nowrap;
  pointer-events: none;
  transform: translateY(-50%);
}
.type-hint-enter-active,
.type-hint-leave-active { transition: opacity .18s ease; }
.type-hint-enter-from,
.type-hint-leave-to { opacity: 0; }
</style>

<style>
html.dark .type-hint {
  color: var(--type-hint-color, #8c8c8c);
  background: var(--type-hint-background, #3c3f41);
}
</style>
