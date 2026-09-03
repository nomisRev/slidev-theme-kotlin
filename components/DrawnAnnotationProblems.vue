<script setup lang="ts">
import { useNav } from '@slidev/client'
import { computed } from 'vue'
import { annotationAuthoringProblems } from './drawn-annotation/editor-store'

// Slidev's CLI export can run through a development-mode server, so mode alone
// is not an export guard. Like the editor toolbar, the chips exist only on the
// primary normal-slide route: no print/export, presenter, overview, notes, or
// preview layer shows them, so `npm run screenshot` and `export:slide` capture
// the slide exactly as a built deck would.
const { currentPage, hasPrimarySlide, isPresenter, isPrintMode } = useNav()
const available = computed(() => hasPrimarySlide.value && !isPresenter.value && !isPrintMode.value)

// Only the slide being looked at. Slidev mounts the neighbouring slides ahead
// of time, and an annotation there may warn at setup about a typo in its props.
const problems = computed(() => Array.from(annotationAuthoringProblems.entries())
  .filter(([, problem]) => problem.page === currentPage.value)
  .map(([key, problem]) => ({ key, ...problem, short: shorten(problem.message) })))

// The chip shows the start of the message the console prints, not a second
// string to keep in step; the full message sits in the tooltip.
function shorten(message: string) {
  const firstSentence = message.split(/(?<=[.!?])\s/, 1)[0]
  return firstSentence.length > 90 ? `${firstSentence.slice(0, 89)}…` : firstSentence
}
</script>

<template>
  <ul
    v-if="available && problems.length"
    class="drawn-annotation-problems"
    aria-label="Annotation problems on this slide"
  >
    <li
      v-for="problem in problems"
      :key="problem.key"
      class="drawn-annotation-problem"
      :title="`[${problem.component}] ${problem.message}`"
    >
      <strong>{{ problem.component }}:</strong> {{ problem.short }}
    </li>
  </ul>
</template>

<style>
:root {
  --drawn-annotation-problem-color: #d5211a;
  --drawn-annotation-problem-background: #fff;
  --drawn-annotation-problem-font: var(--slidev-font-sans), sans-serif;
  --drawn-annotation-problem-font-size: 13px;
  --drawn-annotation-problem-max-width: 60vw;
}
html.dark {
  --drawn-annotation-problem-color: #ff7b72;
  --drawn-annotation-problem-background: #1e1f22;
}
.drawn-annotation-problems {
  position: fixed;
  z-index: 1000;
  top: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: var(--drawn-annotation-problem-max-width);
  margin: 0;
  padding: 0;
  list-style: none;
  pointer-events: auto;
}
.drawn-annotation-problem {
  padding: 4px 12px;
  border: 2px solid var(--drawn-annotation-problem-color);
  border-radius: 999px;
  background: var(--drawn-annotation-problem-background);
  color: var(--drawn-annotation-problem-color);
  font-family: var(--drawn-annotation-problem-font);
  font-size: var(--drawn-annotation-problem-font-size);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: help;
}
.drawn-annotation-problem strong { font-weight: 700; }
@media print { .drawn-annotation-problems { display: none; } }
</style>
