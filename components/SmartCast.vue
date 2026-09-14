<script setup lang="ts">
import type { ClicksInfo } from '@slidev/types'
import type { TextSegment } from './code-text-match'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useIsSlideActive, useNav, useSlideContext } from '@slidev/client'
import { useMutationObserver } from '@vueuse/core'
import { findTextInSegments } from './code-text-match'
import { clearAnnotationAuthoringProblems, reportAnnotationAuthoringProblem } from './drawn-annotation/editor-store'

// Slidev's build renderer can leave `import.meta.env.DEV` true. Authoring
// warnings belong to Vite's explicit serve mode only, the same boundary
// DrawnAnnotation's and InlineCompilerError's editors use.
const isDevelopment = import.meta.env.MODE === 'development'

const props = defineProps<{
  /** One-based source line number inside the single fenced code block this component wraps. Optional when `text` identifies the target. */
  line?: number
  /** Exact rendered code text to paint as smart-cast, e.g. `"nullable.length"`. */
  text?: string
  /** Which occurrence of `text` to paint, 1-based. */
  occurrence?: number | string
  /** Slidev click at which the highlight appears. Supports relative values like "+1". Omit (or pass 0) to show it from the start. */
  at?: number | string
  /** First Slidev click at which the highlight is taken away again. */
  until?: number | string
  /**
   * `at` and `until` in one, for a highlight that belongs to a single click:
   * `:on="2"` is `:at="2" :until="3"`, and `on="0"` shows it before the first
   * click only. Give `at` and `until` separately for a highlight that stays
   * on screen for several clicks.
   */
  on?: number | string
}>()

const slideContext = useSlideContext()
const { $clicksContext, $clicks } = slideContext
const { isPrintMode } = useNav()
const isCurrentSlide = useIsSlideActive()
const id = useId()
const container = useTemplateRef<HTMLElement>('container')

// The Shiki/Magic Move token elements the current match touches. Painting the
// highlight directly onto these — rather than an absolutely positioned overlay,
// as InlineCompilerError draws its squiggle — puts the highlight behind their
// own text automatically (a same-element background always paints behind that
// element's own content) and lets it travel with Magic Move for free, since
// it is the moving element's own style rather than a box tracking it.
const targets = shallowRef<HTMLElement[]>([])
const textMatches = ref(0)
const hasTarget = computed(() => targets.value.length > 0)

// Slidev reserves click 0 for the pre-click state and warns when anything
// registers at 0, so `at` values <= 0 mean "visible from the start".
function isFromStart(at?: number | string) {
  if (at === undefined)
    return true
  if (typeof at === 'string' && '+-'.includes(at[0]))
    return false
  return +at <= 0
}
if (isDevelopment && props.on !== undefined && (props.at !== undefined || props.until !== undefined))
  console.warn('[SmartCast] `on` is `at` and `until` in one, so the separate `at` / `until` given here are ignored. Use either `on` alone, or `at` and `until`.')
const at = props.on ?? props.at
const until = props.on === undefined ? props.until : isFromStart(props.on) ? 1 : '+1'
const fromStart = isFromStart(at)
// Click resolution waits for onMounted so relative values see the clicks
// registered by the elements mounted before this one, mirroring how Slidev's
// own components resolve their `at` props.
const clickInfo = shallowRef<ClicksInfo | null>(null)
onMounted(() => {
  if (!$clicksContext)
    return
  if (!fromStart) {
    clickInfo.value = until === undefined
      ? $clicksContext.calculateSince(at!)
      : $clicksContext.calculateRange([at!, until])
  }
  else if (until !== undefined) {
    clickInfo.value = $clicksContext.calculateRange([1, until])
  }
  if (clickInfo.value)
    $clicksContext.register(id, clickInfo.value)
})
const visible = computed(() => {
  if (!isCurrentSlide.value)
    return false
  const info = clickInfo.value
  if (!info)
    return true
  return fromStart ? $clicks.value < info.end : info.isActive.value
})

// The wrapped code block renders in one of two shapes, discovered lazily
// because Magic Move only renders after mount. The <pre>/<code> element
// itself survives step changes, so it is cached across syncs.
let codeHost: HTMLElement | null = null
let isMagicMove = false

function findCodeHost(host: HTMLElement): HTMLElement | null {
  if (!codeHost?.isConnected) {
    codeHost = host.querySelector<HTMLElement>('pre.shiki-magic-move-container')
    isMagicMove = !!codeHost
    if (!codeHost)
      codeHost = host.querySelector<HTMLElement>('.slidev-code code')
  }
  return codeHost
}

function appendTextSegments(element: HTMLElement, segments: TextSegment[]) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      return parent?.closest('.shiki-magic-move-leave, .shiki-magic-move-leave-to')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })
  let node: Node | null
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode()))
    segments.push({ node: node as Text, text: (node as Text).data })
}

/**
 * Rebuilds the code's rendered text while retaining each text node. Magic Move
 * uses <br> elements where static Shiki uses `.line` wrappers, so normalising
 * both shapes here lets an exact match cross syntax-token spans in either one.
 */
function codeTextSegments(code: HTMLElement, line?: number): TextSegment[] {
  const segments: TextSegment[] = []
  if (isMagicMove) {
    let currentLine = 1
    for (const child of code.children) {
      if (child.tagName === 'BR') {
        if (line === undefined)
          segments.push({ text: '\n' })
        currentLine++
        continue
      }
      if ((line === undefined || currentLine === line) && child instanceof HTMLElement
        && !child.className.includes('shiki-magic-move-leave'))
        appendTextSegments(child, segments)
    }
  }
  else {
    const lines = Array.from(code.querySelectorAll<HTMLElement>('.line'))
    const selected = line === undefined ? lines : lines.slice(line - 1, line)
    selected.forEach((lineEl, index) => {
      appendTextSegments(lineEl, segments)
      if (line === undefined && index < selected.length - 1)
        segments.push({ text: '\n' })
    })
  }
  return segments
}

function requestedOccurrence() {
  const occurrence = Math.trunc(props.occurrence ?? 1)
  return Number.isFinite(occurrence) && occurrence > 0 ? occurrence : 1
}

function findTarget(host: HTMLElement): { range: Range | null, matches: number } {
  const code = findCodeHost(host)
  if (!code || !props.text)
    return { range: null, matches: 0 }
  if (props.line !== undefined && (!Number.isInteger(props.line) || props.line < 1))
    return { range: null, matches: 0 }
  const match = findTextInSegments(codeTextSegments(code, props.line), props.text, requestedOccurrence())
  return { range: match.range, matches: match.matches }
}

const HIGHLIGHT_CLASS = 'smart-cast-token'

// Elements this component created by splitting a Shiki token's text node (see
// paintRange below), as opposed to an existing token element it only added
// the highlight class to. Only the former need undoing — the DOM surgery
// reversed — when they stop being the match; the latter just lose the class.
const createdWrappers = new Set<HTMLElement>()

/** Every text node the range touches, in document order. */
function textNodesInRange(range: Range): Text[] {
  const ancestor = range.commonAncestorContainer
  // A match entirely inside one Shiki token is one text node, which is its
  // own common ancestor — a TreeWalker rooted there would look at its
  // (nonexistent) children instead of the node itself.
  if (ancestor.nodeType === Node.TEXT_NODE)
    return [ancestor as Text]
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT, {
    acceptNode: node => range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  const nodes: Text[] = []
  let node: Node | null
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode()))
    nodes.push(node as Text)
  return nodes
}

/**
 * Paints the exact matched range rather than whichever Shiki token(s) contain
 * it — Shiki can merge unrelated neighbouring syntax into the same token (for
 * example a leading `) ` next to the receiver it precedes), and painting that
 * whole token would highlight text the check never touched. A text node whose
 * match covers it entirely reuses its existing parent element (typically the
 * token span itself, or a wrapper from a previous sync); a partial match is
 * split out of its text node and wrapped in a new element, so only that exact
 * substring gets the highlight's background.
 */
function paintRange(range: Range): HTMLElement[] {
  const painted: HTMLElement[] = []
  for (const node of textNodesInRange(range)) {
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.data.length
    if (start >= end)
      continue
    if (start === 0 && end === node.data.length) {
      if (node.parentElement)
        painted.push(node.parentElement)
      continue
    }
    let target = node
    if (end < target.data.length)
      target.splitText(end)
    if (start > 0)
      target = target.splitText(start)
    const wrapper = document.createElement('span')
    target.parentNode!.insertBefore(wrapper, target)
    wrapper.appendChild(target)
    createdWrappers.add(wrapper)
    painted.push(wrapper)
  }
  return painted
}

/** Reverses paintRange's split: moves the wrapper's content back out and drops it. */
function unwrap(el: HTMLElement) {
  const parent = el.parentNode
  if (!parent)
    return
  while (el.firstChild)
    parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
  if (parent instanceof HTMLElement)
    parent.normalize()
}

// classList.add/remove always re-sets the attribute, even when the class is
// already (ab)sent, which fires this component's own `attributeFilter:
// ['class']` mutation observer again. Guarding on `contains` first keeps a
// steady-state sync a no-op instead of retriggering itself forever.
function paint(range: Range | null) {
  const nextTargets = range ? paintRange(range) : []
  for (const el of targets.value) {
    if (nextTargets.includes(el))
      continue
    if (createdWrappers.has(el)) {
      createdWrappers.delete(el)
      // A leaving Magic Move clone is mid-animation; Magic Move will discard
      // it itself, so restructuring it here would only fight that teardown.
      if (el.isConnected && !el.closest('.shiki-magic-move-leave, .shiki-magic-move-leave-to'))
        unwrap(el)
    }
    else if (el.classList.contains(HIGHLIGHT_CLASS)) {
      el.classList.remove(HIGHLIGHT_CLASS)
    }
  }
  for (const el of nextTargets) {
    if (!el.classList.contains(HIGHLIGHT_CLASS))
      el.classList.add(HIGHLIGHT_CLASS)
  }
  targets.value = nextTargets
}

function clear() {
  paint(null)
}

function sync() {
  const host = container.value
  if (!host)
    return
  if (!visible.value) {
    clear()
    return
  }
  const target = findTarget(host)
  textMatches.value = target.matches
  paint(target.range)
}

// The code lines do not exist until Shiki Magic Move renders its first step,
// and are replaced for every subsequent step; re-painting on every mutation
// keeps the highlight on the current step's tokens instead of stale ones.
useMutationObserver(container, sync, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })

onMounted(async () => {
  await nextTick()
  sync()
  document.fonts?.ready.then(sync)
})

onBeforeUnmount(() => {
  clear()
  $clicksContext?.unregister(id)
  clearTimeout(missingTargetWarning)
  if (isDevelopment)
    clearAnnotationAuthoringProblems(id)
})
watch([() => props.line, () => props.text, () => props.occurrence], sync)
watch(visible, sync)
watch(isCurrentSlide, sync)

// A target that is absent from the current code step has nothing to paint, so
// the highlight stays off. Silent in production, but tell the slide author
// after Magic Move has had time to settle.
let missingTargetWarning: ReturnType<typeof setTimeout> | undefined
function warnMissingTarget(message: string) {
  console.warn(`[SmartCast] ${message}`)
  reportAnnotationAuthoringProblem(id, { component: 'SmartCast', message, page: slideContext.$page.value })
}
watch([visible, hasTarget, () => props.line, () => props.text, () => props.occurrence, textMatches], ([isVisible, found]) => {
  clearTimeout(missingTargetWarning)
  if (!isDevelopment)
    return
  clearAnnotationAuthoringProblems(id)
  if (isVisible && !found) {
    missingTargetWarning = setTimeout(() => {
      const scope = props.line === undefined ? '' : ` on line ${props.line}`
      if (!props.text)
        warnMissingTarget('`text` is required — the highlight is not shown.')
      else if (props.line !== undefined && (!Number.isInteger(props.line) || props.line < 1))
        warnMissingTarget('`line` must be a positive integer — the highlight is not shown.')
      else if (textMatches.value > 0)
        warnMissingTarget(`Text "${props.text}" only matched ${textMatches.value} time${textMatches.value === 1 ? '' : 's'}${scope}, but \`occurrence\` asks for match ${requestedOccurrence()} — the highlight is not shown.`)
      else
        warnMissingTarget(`Text "${props.text}" was not found${scope} — it must match the rendered code exactly.`)
    }, isPrintMode.value ? 0 : 1500)
  }
}, { immediate: true })
</script>

<template>
  <div ref="container" class="smart-cast-host">
    <slot />
  </div>
</template>

<style scoped>
.smart-cast-host { position: relative; }
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
