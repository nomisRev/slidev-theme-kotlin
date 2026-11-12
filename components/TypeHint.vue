<script setup lang="ts">
import type { CodeHighlightProps } from './code-highlight'
import { computed, reactive, toRefs, useTemplateRef } from 'vue'
import { useCodeHighlight } from './code-highlight'

/**
 * IntelliJ's lambda inlay hint: the grey `this: HTML` pill the IDE draws
 * right after the `{` of a lambda with receiver, or `context(Clock)` after
 * the block of a `context(...)` call, which brings a context into scope
 * without touching `this`. When code follows the `{` on its line, as in
 * `formula { hours * rate }`, the pill sits inside the line between the two. Made for DSL slides, where what each block brings
 * into scope is the whole point. With `type` it is instead the IDE's type
 * inlay, `: Column<String>` right after the name in `text`, pushing the rest
 * of the line to the right as IntelliJ does for a `val x by …`.
 */
const props = defineProps<Omit<CodeHighlightProps, 'message'> & {
  /** The receiver type of the lambda, shown as `this: <receiver>`. */
  receiver?: string
  /** The context a `context(...)` block supplies, shown as `context(<context>)` — no `this:`, as IntelliJ renders it. */
  context?: string
  /** The inferred type of the declaration named by `text`, shown inline as `: <type>` right after it. */
  type?: string
}>()
const container = useTemplateRef<HTMLElement>('container')

if (import.meta.env.MODE === 'development' && !props.receiver && !props.context && !props.type)
  console.warn('[TypeHint] Give `receiver` (rendered `this: …`), `context` (rendered `context(…)`), or `type` (rendered `: …` after `text`) — the hint is not shown.')
if (import.meta.env.MODE === 'development' && props.type && !props.text)
  console.warn('[TypeHint] A `type` hint needs `text`: the name it follows, such as `text="customer"`.')

// Use token-attached inlays even when the opening brace ends the line.
// Floating messages are hidden during Magic Move, while an inlay travels
// with its token and stays visible throughout the transition. When code
// follows the match, the inlay also pushes it right as it does in the IDE.
const highlightProps = reactive({
  ...toRefs(props),
  text: computed(() => props.text ?? (props.type ? undefined : '{')),
  message: computed(() => props.type ? undefined : props.receiver ? `this: ${props.receiver}` : props.context ? `context(${props.context})` : undefined),
})
const { message, messageShown, messageStyle, messageCarried, inlaid } = useCodeHighlight(highlightProps, container, {
  component: 'TypeHint',
  highlightClass: props.type ? 'type-hint-inlay' : 'type-hint-lambda',
  inlay: () => props.type ? `: ${props.type}` : highlightProps.message,
})
</script>

<template>
  <div ref="container" class="type-hint-host">
    <slot />
    <Transition :name="messageCarried ? 'carried' : 'type-hint'">
      <span v-if="messageShown && !inlaid" class="type-hint" :class="{ 'magic-move-carried': messageCarried }" :style="messageStyle">{{ message }}</span>
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
/* The `type` inlay lives inside the code line (see `inlay` in
   code-highlight.ts), so it is unscoped and takes the pill's look while
   staying in the flow: the code after it moves right. */
.type-hint-inlay[data-code-inlay]::after,
.type-hint-lambda[data-code-inlay]::after {
  content: attr(data-code-inlay);
  display: inline-block;
  margin-left: 0.05em;
  padding: 0 0.45em;
  border-radius: 0.5em;
  color: var(--type-hint-color, #6c707e);
  background: var(--type-hint-background, #ebecf0);
  font-size: var(--type-hint-size, 0.85em);
  font-style: normal;
  font-weight: 500;
  line-height: 1.45;
  vertical-align: 0.05em;
  white-space: pre;
  pointer-events: none;
  user-select: none;
}
.type-hint-lambda[data-code-inlay]::after { margin-left: 0.4em; }
html.dark .type-hint-inlay[data-code-inlay]::after,
html.dark .type-hint-lambda[data-code-inlay]::after {
  color: var(--type-hint-color, #8c8c8c);
  background: var(--type-hint-background, #3c3f41);
}
</style>
