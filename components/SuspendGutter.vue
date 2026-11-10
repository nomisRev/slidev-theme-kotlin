<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useSlideContext } from '@slidev/client'
import { codeTextSegments, trimmedLineRange } from './code-text-match'
import suspendCall from '../assets/gutter/suspendCall@14x14.svg'
import suspendCallDark from '../assets/gutter/suspendCall@14x14_dark.svg'

const props = withDefaults(defineProps<{
  /** One-based source lines, including blank lines; wrap one code fence. */
  lines: number[]
  label?: string
}>(), { label: 'Suspension point' })

const host = useTemplateRef<HTMLElement>('host')
const markers = ref<{ line: number, top: string, left: string, fontSize: string }[]>([])
const { $scale, $zoom, $clicks } = useSlideContext()
const moving = '.shiki-magic-move-enter-active, .shiki-magic-move-leave-active, .shiki-magic-move-move, .shiki-magic-move-container-resize, .shiki-magic-move-container-restyle'
let frame: number | undefined
let mutations: MutationObserver | undefined
let resize: ResizeObserver | undefined
let disposed = false

function sync() {
  const root = host.value
  if (!root)
    return
  const pre = root.querySelector<HTMLElement>('pre.slidev-code')
  const magic = pre?.classList.contains('shiki-magic-move-container') ?? false
  const code = magic ? pre : pre?.querySelector<HTMLElement>('code')
  // Wait for Magic Move to settle, as the theme's other annotations do.
  if (!pre || !code || root.querySelector(moving)) {
    markers.value = []
    return
  }
  const scale = $scale.value * $zoom.value || 1
  const rootBox = root.getBoundingClientRect()
  const preBox = pre.getBoundingClientRect()
  const style = getComputedStyle(pre)
  const segments = codeTextSegments(code, magic)
  // Anchor to the outside of the editor border, without changing code padding.
  const left = `${(preBox.left - rootBox.left) / scale}px`
  const next: typeof markers.value = []
  for (const line of new Set(props.lines)) {
    if (!Number.isInteger(line) || line < 1)
      continue
    const { range } = trimmedLineRange(segments, line)
    const box = Array.from(range?.getClientRects() ?? []).find(rect => rect.width && rect.height)
    // Blank and missing lines have no suspension point to annotate.
    if (!box)
      continue
    const center = box.top + box.height / 2
    // Respect scrollable code windows as well as the editor's own bounds.
    let visible = true
    for (let parent: HTMLElement | null = pre; parent && parent !== root; parent = parent.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
        const bounds = parent.getBoundingClientRect()
        if (center < bounds.top || center > bounds.bottom)
          visible = false
      }
    }
    if (visible)
      next.push({ line, left, top: `${(center - rootBox.top) / scale}px`, fontSize: style.fontSize })
  }
  markers.value = next
}

function schedule() {
  if (!disposed)
    frame ??= requestAnimationFrame(() => { frame = undefined; sync() })
}

watch(() => [props.lines, $scale.value, $zoom.value, $clicks.value], schedule, { deep: true, flush: 'post' })
onMounted(async () => {
  await nextTick()
  if (disposed || !host.value)
    return
  mutations = new MutationObserver((records) => {
    // Only code mutations matter; updating our own overlay must not loop.
    if (records.some(record => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement
      return !target?.closest('.suspend-gutter-markers')
    }))
      schedule()
  })
  mutations.observe(host.value, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] })
  resize = new ResizeObserver(schedule)
  resize.observe(host.value)
  host.value.addEventListener('scroll', schedule, true)
  document.fonts?.ready.then(schedule)
  schedule()
})

onBeforeUnmount(() => {
  disposed = true
  mutations?.disconnect()
  resize?.disconnect()
  host.value?.removeEventListener('scroll', schedule, true)
  if (frame !== undefined)
    cancelAnimationFrame(frame)
})
</script>

<template>
  <div ref="host" class="suspend-gutter">
    <slot />
    <div class="suspend-gutter-markers">
      <span
        v-for="marker in markers"
        :key="marker.line"
        class="suspend-gutter-marker"
        :data-line="marker.line"
        :style="{ top: marker.top, left: marker.left, fontSize: marker.fontSize }"
        role="img"
        :aria-label="`${label} on line ${marker.line}`"
        :title="`${label} on line ${marker.line}`"
      >
        <img class="suspend-gutter-light" :src="suspendCall" alt="" aria-hidden="true" />
        <img class="suspend-gutter-dark" :src="suspendCallDark" alt="" aria-hidden="true" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.suspend-gutter { position: relative; }
.suspend-gutter-markers { pointer-events: none; }
.suspend-gutter-marker {
  position: absolute;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--suspend-gutter-size, 1em);
  height: var(--suspend-gutter-size, 1em);
  margin-left: calc(-1 * var(--suspend-gutter-gap, 0.35em));
  transform: translate(-100%, -50%);
  pointer-events: auto;
}
.suspend-gutter-marker img {
  width: 100%;
  height: 100%;
}
.suspend-gutter-dark { display: none; }
:global(html.dark .suspend-gutter-light) { display: none; }
:global(html.dark .suspend-gutter-dark) { display: block; }
</style>
