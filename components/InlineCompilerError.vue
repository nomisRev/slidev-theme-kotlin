<script setup lang="ts">
import type { ClicksInfo } from '@slidev/types'
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, shallowRef, useId, watch } from 'vue'
import { useNav, useSlideContext } from '@slidev/client'
import { useMutationObserver, useResizeObserver } from '@vueuse/core'

const props = defineProps<{
  /** One-based source line number inside the single fenced code block this component wraps. Optional when `text` identifies the target. */
  line?: number
  /** Exact rendered code text to underline. When `line` is also given, only that line is searched. */
  text?: string
  /** Which occurrence of `text` to underline, 1-based. */
  occurrence?: number
  message: string
  /** Slidev click at which to reveal the diagnostic. Supports relative values like "+1". Omit (or pass 0) to show it from the start. */
  at?: number | string
  /** First Slidev click at which to hide the diagnostic. */
  until?: number | string
  /**
   * `at` and `until` in one, for a diagnostic that belongs to a single click:
   * `:on="2"` is `:at="2" :until="3"`, and `on="0"` shows it before the first
   * click only. Give `at` and `until` separately for a diagnostic that stays
   * on screen for several clicks.
   */
  on?: number | string
}>()

const { $clicksContext, $clicks, $scale, $zoom } = useSlideContext()
const { isPrintMode } = useNav()
const id = useId()
const container = ref<HTMLElement>()
const position = ref({
  left: '0px',
  top: '0px',
  maxWidth: 'none',
  '--inline-compiler-error-target-size': '12px',
})
// The wavy underline is one absolutely positioned element spanning the whole
// offending expression: per-token `text-decoration: underline wavy` restarts
// the wave's phase at every Shiki span boundary, breaking the squiggle.
const underline = ref({ left: '0px', top: '0px', width: '0px' })
// The exact rendered range to underline, plus the token elements that contain
// it. A Magic Move step may not contain the requested line or text (yet), and
// an empty line has no range; without one the message has no anchor and stays
// hidden. The elements are retained separately so ResizeObserver can follow
// the range even though a DOM Range itself cannot be observed.
const targetRange = shallowRef<Range | null>(null)
const targets = shallowRef<HTMLElement[]>([])
const textMatches = ref(0)
const hasTarget = computed(() => !!targetRange.value)
// True while Shiki Magic Move is transitioning between steps.
const animating = ref(false)

// Slidev reserves click 0 for the pre-click state and warns when anything
// registers at 0, so `at` values <= 0 mean "visible from the start".
function isFromStart(at?: number | string) {
  if (at === undefined)
    return true
  if (typeof at === 'string' && '+-'.includes(at[0]))
    return false
  return +at <= 0
}
// `on` resolves into the separate values here, so everything below only ever
// reads `at` and `until`. Slidev ranges accept a relative end, so '+1' means
// "one click after the start" whether `on` itself is absolute or relative; an
// `on` that shows from the start is gone at the first click.
if (import.meta.env.DEV && props.on !== undefined && (props.at !== undefined || props.until !== undefined))
  console.warn('[InlineCompilerError] `on` is `at` and `until` in one, so the separate `at` / `until` given here are ignored. Use either `on` alone, or `at` and `until`.')
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
    // Visible from the start; the range still registers the hide click so the
    // slide waits for it even when nothing else on the slide is clickable.
    clickInfo.value = $clicksContext.calculateRange([1, until])
  }
  if (clickInfo.value)
    $clicksContext.register(id, clickInfo.value)
})
onUnmounted(() => $clicksContext?.unregister(id))
const visible = computed(() => {
  const info = clickInfo.value
  if (!info)
    return true
  return fromStart ? $clicks.value < info.end : info.isActive.value
})

// The diagnostic must not appear while Magic Move is still animating, and a
// click can reveal it a few frames before the step transition it also
// triggers begins. `revealed` therefore trails `canReveal` by a beat, so the
// message never flashes at a stale position.
const canReveal = computed(() => visible.value && hasTarget.value && !animating.value)
const revealed = ref(false)
// Classes Shiki Magic Move keeps on its elements only while a step transition
// is playing. They are private constants of MagicMoveRenderer (renderer.mjs
// in @shikijs/magic-move), so `sawAnimating` below asserts in DEV that they
// still exist after an upgrade.
const MAGIC_MOVE_ANIMATING = [
  '.shiki-magic-move-enter-active',
  '.shiki-magic-move-leave-active',
  '.shiki-magic-move-move',
  '.shiki-magic-move-container-resize',
  '.shiki-magic-move-container-restyle',
].join(', ')
let sawAnimating = false
let stepSwaps = 0
let warnedClassDrift = false

// The wrapped code block renders in one of two shapes, discovered lazily
// because Magic Move only renders after mount. The <pre>/<code> element
// itself survives step changes, so it is cached across syncs.
let codeHost: HTMLElement | null = null
let isMagicMove = false

function findCodeHost(host: HTMLElement): HTMLElement | null {
  if (!codeHost?.isConnected) {
    // Shiki Magic Move v2 renders tokens directly in a <pre>, separated by
    // <br> elements; a static block renders `.line` spans inside <code>.
    codeHost = host.querySelector<HTMLElement>('pre.shiki-magic-move-container')
    isMagicMove = !!codeHost
    if (!codeHost)
      codeHost = host.querySelector<HTMLElement>('.slidev-code code')
  }
  return codeHost
}

function findLineTargets(host: HTMLElement, line: number): HTMLElement[] {
  const code = findCodeHost(host)
  if (!code || !Number.isInteger(line) || line < 1)
    return []

  const tokens: HTMLElement[] = []
  if (isMagicMove) {
    let currentLine = 1
    for (const child of code.children) {
      if (child.tagName === 'BR') {
        if (++currentLine > line)
          break
        continue
      }
      // Outgoing tokens of the previous step linger (absolutely positioned)
      // during a transition and must not count toward the new step's lines.
      if (currentLine === line && child instanceof HTMLElement
        && !child.className.includes('shiki-magic-move-leave'))
        tokens.push(child)
    }
  }
  else {
    const lineEl = code.querySelectorAll<HTMLElement>('.line')[line - 1]
    if (lineEl) {
      const spans = Array.from(lineEl.children).filter((c): c is HTMLElement => c instanceof HTMLElement)
      // Prefer token spans over the block-level line span. The range builder
      // below trims whitespace inside a token too, since Shiki commonly puts
      // a line's indentation in the same span as its first keyword.
      if (spans.length)
        tokens.push(...spans)
      else if (lineEl.textContent?.trim())
        tokens.push(lineEl)
    }
  }
  // Drop wholly whitespace-only edge tokens. Shiki can also combine an
  // indent and the first keyword in one token; rangeForElements trims that
  // remaining whitespace inside the edge text nodes.
  while (tokens.length && !tokens[0].textContent?.trim())
    tokens.shift()
  while (tokens.length && !tokens[tokens.length - 1].textContent?.trim())
    tokens.pop()
  return tokens
}

interface TextSegment {
  node?: Text
  text: string
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

/** Finds an exact text match even when Shiki split it across token spans. */
function findTextTarget(code: HTMLElement, needle: string, line?: number) {
  const segments = codeTextSegments(code, line)
  const value = segments.map(segment => segment.text).join('')
  const starts: number[] = []
  for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + 1))
    starts.push(index)

  const start = starts[requestedOccurrence() - 1]
  if (start === undefined)
    return { range: null, elements: [] as HTMLElement[], matches: starts.length }

  const end = start + needle.length
  let offset = 0
  let startNode: Text | undefined
  let endNode: Text | undefined
  let startOffset = 0
  let endOffset = 0
  const elements: HTMLElement[] = []
  for (const segment of segments) {
    const next = offset + segment.text.length
    if (segment.node) {
      if (!startNode && start >= offset && start < next) {
        startNode = segment.node
        startOffset = start - offset
      }
      if (start < next && end > offset && segment.node.parentElement
        && !elements.includes(segment.node.parentElement))
        elements.push(segment.node.parentElement)
      if (startNode && end > offset && end <= next) {
        endNode = segment.node
        endOffset = end - offset
        break
      }
      // A match ending on a normalised line break cannot put its boundary in
      // that synthetic segment, so retain the last real text node it covered.
      if (startNode && end > next) {
        endNode = segment.node
        endOffset = segment.text.length
      }
    }
    offset = next
  }
  if (!startNode || !endNode)
    return { range: null, elements: [] as HTMLElement[], matches: starts.length }

  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return { range, elements, matches: starts.length }
}

function rangeForElements(elements: HTMLElement[]): Range | null {
  if (!elements.length)
    return null

  // A token is not necessarily just code: Shiki often emits the leading
  // indentation together with the first keyword (for example, `    return`).
  // Select text-node offsets rather than whole token elements so a line
  // diagnostic begins at the first actual character, not in its indent.
  const nodes: Text[] = []
  for (const element of elements) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node: Node | null
    // eslint-disable-next-line no-cond-assign
    while ((node = walker.nextNode()))
      nodes.push(node as Text)
  }

  const value = nodes.map(node => node.data).join('')
  const start = value.length - value.trimStart().length
  const end = value.trimEnd().length
  if (start === end)
    return null

  let offset = 0
  let startNode: Text | undefined
  let endNode: Text | undefined
  let startOffset = 0
  let endOffset = 0
  for (const node of nodes) {
    const next = offset + node.data.length
    if (!startNode && start >= offset && start < next) {
      startNode = node
      startOffset = start - offset
    }
    if (!endNode && end > offset && end <= next) {
      endNode = node
      endOffset = end - offset
      break
    }
    offset = next
  }
  if (!startNode || !endNode)
    return null

  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

/** Returns the source line containing the start of a rendered target range. */
function rangeLine(code: HTMLElement, range: Range): number | undefined {
  const start = range.startContainer instanceof HTMLElement
    ? range.startContainer
    : range.startContainer.parentElement
  if (!start)
    return undefined

  if (!isMagicMove) {
    const line = start.closest<HTMLElement>('.line')
    if (!line)
      return undefined
    const lines = Array.from(code.querySelectorAll<HTMLElement>('.line'))
    const index = lines.indexOf(line)
    return index < 0 ? undefined : index + 1
  }

  // Magic Move's tokens and <br>s are direct children of the <pre>. Climb to
  // the direct token containing the Range boundary, then count its line.
  let token: HTMLElement | null = start
  while (token?.parentElement && token.parentElement !== code)
    token = token.parentElement
  if (!token || token.parentElement !== code)
    return undefined

  let line = 1
  for (const child of code.children) {
    if (child === token)
      return line
    if (child.tagName === 'BR')
      line++
  }
  return undefined
}

function findTarget(host: HTMLElement) {
  const code = findCodeHost(host)
  if (!code)
    return { range: null, elements: [] as HTMLElement[], matches: 0 }

  if (props.text !== undefined) {
    if (!props.text || (props.line !== undefined && (!Number.isInteger(props.line) || props.line < 1)))
      return { range: null, elements: [] as HTMLElement[], matches: 0 }
    return findTextTarget(code, props.text, props.line)
  }

  if (props.line === undefined)
    return { range: null, elements: [] as HTMLElement[], matches: 0 }
  const elements = findLineTargets(host, props.line)
  if (!elements.length)
    return { range: null, elements, matches: 0 }

  return { range: rangeForElements(elements), elements, matches: 0 }
}

function sync() {
  const host = container.value
  if (!host)
    return

  const nextTarget = findTarget(host)
  const nextTargets = nextTarget.elements
  textMatches.value = nextTarget.matches
  targetRange.value = nextTarget.range
  const targetsChanged = targets.value.length !== nextTargets.length
    || targets.value.some((el, index) => el !== nextTargets[index])
  if (targetsChanged) {
    // Magic Move replaces its rendered code after this component has mounted.
    if (import.meta.env.DEV && isMagicMove && targets.value.length)
      stepSwaps++
    targets.value = nextTargets
  }

  animating.value = !!host.querySelector(MAGIC_MOVE_ANIMATING)
  if (animating.value)
    sawAnimating = true
  if (import.meta.env.DEV && !warnedClassDrift && !isPrintMode.value && stepSwaps >= 2 && !sawAnimating) {
    warnedClassDrift = true
    console.warn('[InlineCompilerError] Magic Move steps changed but its animation classes were never observed — the private class names in MAGIC_MOVE_ANIMATING may have been renamed by a @shikijs/magic-move upgrade, which would let the message reveal mid-animation.')
  }

  const range = targetRange.value
  if (!visible.value || !range)
    return

  // getBoundingClientRect() uses visual (scaled) pixels, while an absolutely
  // positioned child uses the host's unscaled CSS coordinate space.
  const scale = $scale.value * $zoom.value || 1
  const hostBox = host.getBoundingClientRect()
  // Token spans can be wider than their text; the Range gives the exact
  // rendered edges, including offsets inside the first and last token. Its
  // client rects are unioned because Shiki may fragment one range by token.
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity
  for (const box of Array.from(range.getClientRects())) {
    if (!box.width)
      continue
    left = Math.min(left, box.left)
    right = Math.max(right, box.right)
    top = Math.min(top, box.top)
    bottom = Math.max(bottom, box.bottom)
  }
  if (right <= left)
    return

  // The squiggle follows only the exact offending text, but placing the
  // diagnostic immediately after that text would cover the remainder of its
  // source line. Anchor the message after the line's final non-whitespace
  // token instead. This preserves the old line-targeted placement while text
  // targeting narrows only the underline.
  let messageRight = right
  const code = findCodeHost(host)
  const line = code ? (props.line ?? rangeLine(code, range)) : undefined
  const lineRange = line === undefined ? null : rangeForElements(findLineTargets(host, line))
  if (lineRange) {
    for (const box of Array.from(lineRange.getClientRects())) {
      if (box.width)
        messageRight = Math.max(messageRight, box.right)
    }
  }

  // The slide clips at its own edge; wrap the message within the remaining
  // room instead of letting it run off the canvas.
  const slideBox = (host.closest('.slidev-layout') ?? host).getBoundingClientRect()
  // The diagnostic is a sibling of the code block, so it does not inherit
  // the code element's font size. Read the computed size from the actual
  // text node being annotated and expose it as a fallback for the message.
  // The public `--inline-compiler-error-message-size` variable remains an
  // explicit override when a deck wants a different diagnostic size.
  const targetElement = range.startContainer instanceof HTMLElement
    ? range.startContainer
    : range.startContainer.parentElement
  const targetSize = targetElement ? getComputedStyle(targetElement).fontSize : '12px'
  position.value = {
    left: `${(messageRight - hostBox.left) / scale + 10}px`,
    top: `${(top - hostBox.top + (bottom - top) / 2) / scale}px`,
    maxWidth: `${Math.max(60, (slideBox.right - messageRight) / scale - 34)}px`,
    '--inline-compiler-error-target-size': targetSize || '12px',
  }
  underline.value = {
    left: `${(left - hostBox.left) / scale}px`,
    top: `${(bottom - hostBox.top) / scale - 1}px`,
    width: `${(right - left) / scale}px`,
  }
}

// Coalesce observer bursts into one sync per frame: during a Magic Move
// transition every token flips classes.
let pendingSync: number | undefined
function scheduleSync() {
  pendingSync ??= requestAnimationFrame(() => {
    pendingSync = undefined
    sync()
  })
}

// The code lines do not exist until Shiki Magic Move renders its first step,
// and are replaced for every subsequent step. Class changes are observed too:
// Magic Move signals the end of a transition by removing its animation
// classes, without touching the DOM structure.
useMutationObserver(container, scheduleSync, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
// The getter re-observes automatically whenever the line or text is retargeted.
useResizeObserver(() => [container.value, ...targets.value], scheduleSync)

onMounted(async () => {
  await nextTick()
  sync()
  document.fonts?.ready.then(scheduleSync)
})

onBeforeUnmount(() => {
  if (pendingSync !== undefined)
    cancelAnimationFrame(pendingSync)
  clearTimeout(revealTimer)
  clearTimeout(missingTargetWarning)
})
watch([() => props.line, () => props.text, () => props.occurrence], sync)
watch(visible, sync)

let revealTimer: ReturnType<typeof setTimeout> | undefined
watch(canReveal, (can) => {
  clearTimeout(revealTimer)
  if (!can) {
    revealed.value = false
    return
  }
  const reveal = () => {
    revealed.value = true
    sync()
  }
  // Export captures the page as soon as it settles, so print mode reveals
  // synchronously instead of trailing by a beat.
  if (isPrintMode.value)
    reveal()
  else
    revealTimer = setTimeout(reveal, 100)
})

// A target that is absent from the current code step has nothing to anchor to,
// so the diagnostic stays hidden. Silent in production, but tell the slide
// author after the longest Magic Move transition has had time to finish.
let missingTargetWarning: ReturnType<typeof setTimeout> | undefined
watch([visible, hasTarget, () => props.line, () => props.text, () => props.occurrence, textMatches], ([isVisible, found]) => {
  clearTimeout(missingTargetWarning)
  if (import.meta.env.DEV && isVisible && !found) {
    missingTargetWarning = setTimeout(() => {
      if (props.text !== undefined) {
        const scope = props.line === undefined ? '' : ` on line ${props.line}`
        if (!props.text)
          console.warn(`[InlineCompilerError] \`text\` must be non-empty for "${props.message}" — the diagnostic is not shown.`)
        else if (props.line !== undefined && (!Number.isInteger(props.line) || props.line < 1))
          console.warn(`[InlineCompilerError] \`line\` must be a positive integer for "${props.message}" — the diagnostic is not shown.`)
        else if (textMatches.value > 0)
          console.warn(`[InlineCompilerError] Text "${props.text}" only matched ${textMatches.value} time${textMatches.value === 1 ? '' : 's'}${scope}, but \`occurrence\` asks for match ${requestedOccurrence()} — the diagnostic is not shown.`)
        else
          console.warn(`[InlineCompilerError] Text "${props.text}" was not found${scope} for "${props.message}" — it must match the rendered code exactly.`)
      }
      else if (props.line === undefined) {
        console.warn(`[InlineCompilerError] Give either \`line\` or \`text\` for "${props.message}" — the diagnostic is not shown.`)
      }
      else if (!Number.isInteger(props.line) || props.line < 1) {
        console.warn(`[InlineCompilerError] \`line\` must be a positive integer for "${props.message}" — the diagnostic is not shown.`)
      }
      else {
        console.warn(`[InlineCompilerError] No code tokens on line ${props.line} for "${props.message}" — the diagnostic is not shown. Empty lines cannot be annotated; check the \`line\` prop.`)
      }
    }, 1500)
  }
}, { immediate: true })
</script>

<template>
  <div ref="container" class="inline-compiler-error-host">
    <slot />
    <!-- Screen readers only announce a live region reliably when its content
         changes while it is already mounted, so this one exists permanently
         and only its text swaps on reveal. -->
    <span class="inline-compiler-error-status" role="status" aria-live="polite" aria-atomic="true">{{ revealed ? props.message : '' }}</span>
    <Transition name="compiler-error" :css="!isPrintMode">
      <span
        v-if="revealed"
        class="inline-compiler-error-underline"
        :style="underline"
        aria-hidden="true"
      />
    </Transition>
    <Transition name="compiler-error" :css="!isPrintMode">
      <span
        v-if="revealed"
        class="inline-compiler-error-message"
        :style="position"
        aria-hidden="true"
      ><i>●</i>{{ props.message }}</span>
    </Transition>
  </div>
</template>

<style scoped>
.inline-compiler-error-host { position: relative; }
.inline-compiler-error-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.inline-compiler-error-message { position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: .32em; color: #e95757; font-family: var(--slidev-font-sans); font-size: var(--inline-compiler-error-message-size, var(--inline-compiler-error-target-size, 12px)); font-weight: 700; line-height: 1.25; pointer-events: none; transform: translateY(-50%); }
.compiler-error-enter-active,
.compiler-error-leave-active { transition: opacity .18s ease; }
.compiler-error-enter-from,
.compiler-error-leave-to { opacity: 0; }
.inline-compiler-error-message i { color: #f05b5b; font-size: .55em; font-style: normal; }
.inline-compiler-error-underline {
  position: absolute;
  z-index: 2;
  height: 6px;
  pointer-events: none;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='6'%3E%3Cpath d='M0 3 Q3 1 6 3 T12 3' fill='none' stroke='%23f05b5b' stroke-width='1.5'/%3E%3C/svg%3E") repeat-x left top / 12px 6px;
}
</style>
