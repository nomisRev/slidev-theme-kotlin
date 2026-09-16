<script setup lang="ts">
import type { CodeHighlightProps } from './code-highlight'
import { useTemplateRef } from 'vue'
import { useCodeHighlight } from './code-highlight'

const props = defineProps<CodeHighlightProps>()
const container = useTemplateRef<HTMLElement>('container')

// Everything but the colours is shared with `Warning`; see code-highlight.ts.
const { messageHtml, messageShown, messageStyle } = useCodeHighlight(props, container, { component: 'SmartCast', highlightClass: 'smart-cast-token' })
</script>

<template>
  <div ref="container" class="smart-cast-host">
    <slot />
    <Transition name="smart-cast-message">
      <span v-if="messageShown" class="smart-cast-message" :style="messageStyle"><i>●</i><span class="annotation-label-content" v-html="messageHtml" /></span>
    </Transition>
  </div>
</template>

<style scoped>
.smart-cast-host { position: relative; }
/* The message sits after the line's last token, like IntelliJ's inline
   diagnostics, in the annotated code's font size unless a deck sets
   `--smart-cast-message-size`; its colour is the darker `--smart-cast-message-color`. */
.smart-cast-message { position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: .32em; color: var(--smart-cast-message-color, #3b7a45); font-family: var(--slidev-font-sans); font-size: var(--smart-cast-message-size, var(--code-highlight-target-size, 12px)); font-weight: 700; line-height: 1.25; pointer-events: none; transform: translateY(-50%); }
.smart-cast-message i { font-size: .55em; font-style: normal; }
.smart-cast-message-enter-active,
.smart-cast-message-leave-active { transition: opacity .18s ease; }
.smart-cast-message-enter-from,
.smart-cast-message-leave-to { opacity: 0; }
</style>

<!--
  Unscoped: the highlighted elements are Shiki/Magic Move tokens rendered by
  the slot's own code fence, not by this component's template, so Vue's
  scoped-style attribute selector would never match them.
-->
<style>
.smart-cast-token {
  background: var(--smart-cast-color, #dcf8df);
  border-radius: 3px;
  padding: 0.05em 0.15em;
  margin: 0 -0.15em;
  transition: background-color .18s ease;
}
</style>
