<script setup lang="ts">
import type { CodeHighlightProps } from './code-highlight'
import { useTemplateRef } from 'vue'
import { useCodeHighlight } from './code-highlight'

const props = defineProps<CodeHighlightProps>()
const container = useTemplateRef<HTMLElement>('container')

// Everything but the colours is shared with `SmartCast`; see code-highlight.ts.
const { messageHtml, messageShown, messageStyle } = useCodeHighlight(props, container, { component: 'Warning', highlightClass: 'warning-token' })
</script>

<template>
  <div ref="container" class="warning-host">
    <slot />
    <Transition name="warning-message">
      <span v-if="messageShown" class="warning-message" :style="messageStyle"><i>●</i><span class="annotation-label-content" v-html="messageHtml" /></span>
    </Transition>
  </div>
</template>

<style scoped>
.warning-host { position: relative; }
/* The message sits after the line's last token, like IntelliJ's inline
   diagnostics, in the annotated code's font size unless a deck sets
   `--warning-message-size`; its colour is the darker `--warning-message-color`. */
.warning-message { position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: .32em; color: var(--warning-message-color, #9a7b0f); font-family: var(--slidev-font-sans); font-size: var(--warning-message-size, var(--code-highlight-target-size, 12px)); font-weight: 700; line-height: 1.25; pointer-events: none; transform: translateY(-50%); }
.warning-message i { font-size: .55em; font-style: normal; }
.warning-message-enter-active,
.warning-message-leave-active { transition: opacity .18s ease; }
.warning-message-enter-from,
.warning-message-leave-to { opacity: 0; }
</style>

<!--
  Unscoped: the highlighted elements are Shiki/Magic Move tokens rendered by
  the slot's own code fence, not by this component's template, so Vue's
  scoped-style attribute selector would never match them.
-->
<style>
.warning-token {
  background: var(--warning-color, #faf4d7);
  padding: 0.05em 0;
  transition: background-color .18s ease;
}
/* Darcula paints warnings in its own, darker olive; the message brightens so
   it still reads on the dark slide. A deck's variables win in both schemes. */
html.dark .warning-token { background: var(--warning-color, #52503a); }
html.dark .warning-message { color: var(--warning-message-color, #d4b44a); }
</style>
