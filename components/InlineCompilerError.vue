<script setup lang="ts">
import type { ClicksInfo } from '@slidev/types'
import type { TextMatch } from './code-text-match'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useIsSlideActive, useNav, useSlideContext } from '@slidev/client'
import { useMutationObserver, useResizeObserver } from '@vueuse/core'
import { codeTextSegments, findTextInSegments, mergeVisualLines, trimmedLineRange } from './code-text-match'
import { normalizeAnnotationLineBreaks } from './annotation-line-breaks'
import { annotationLabelText, renderAnnotationLabel } from './annotation-label-markdown'
import { rememberTransitionInk, takeTransitionInk } from './transition-ink'
import type { TransitionInkBox } from './transition-ink'
import { clearAnnotationAuthoringProblems, reportAnnotationAuthoringProblem } from './drawn-annotation/editor-store'

// Slidev's build renderer can leave `import.meta.env.DEV` true. Authoring
// warnings and the on-slide chips that repeat them belong to Vite's explicit
// serve mode only, the same boundary DrawnAnnotation's editor uses.
const isDevelopment = import.meta.env.MODE === 'development'

const props = defineProps<{
  /**
   * One-based source line number inside the single fenced code block this
   * component wraps. Alone, it underlines that line's code. With `text`, it
   * narrows the search to that line — the first line of the match when `text`
   * spans several.
   */
  line?: number
  /**
   * Exact rendered code text to underline. `\\n` (or a literal newline in a
   * bound string) continues the match on the next source line; every line the
   * match covers gets its own squiggle.
   */
  text?: string
  /** Which occurrence of `text` to underline, 1-based. */
  occurrence?: number | string
  /** Diagnostic text. Use `\\n` (or a literal newline in a bound string) for a line break. */
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

// Markdown attributes cannot conveniently contain a literal line break, so
// accept both a real newline (including one from a bound Vue string) and the
// explicit `\\n` escape, in the diagnostic and in the text it underlines.
// The diagnostic is the same safe Markdown as a `DrawnAnnotation` label, so
// backticks render a type name as inline code; the live region gets its text.
const messageHtml = computed(() => renderAnnotationLabel(props.message))
const messageText = computed(() => annotationLabelText(props.message))
const text = computed(() => props.text === undefined ? undefined : normalizeAnnotationLineBreaks(props.text))

const slideContext = useSlideContext()
const { $clicksContext, $clicks, $scale, $zoom } = slideContext
const { isPrintMode } = useNav()
const isCurrentSlide = useIsSlideActive()
const id = useId()
const container = useTemplateRef<HTMLElement>('container')
const position = ref({
  left: '0px',
  top: '0px',
  maxWidth: 'none',
  '--inline-compiler-error-target-size': '12px',
})
// The wavy underline is one absolutely positioned element per visual line of
// the offending expression: per-token `text-decoration: underline wavy`
// restarts the wave's phase at every Shiki span boundary, breaking the
// squiggle, and a match over several lines gets one squiggle per line.
const underlines = ref<{ left: string, top: string, width: string }[]>([])
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
const skipEntranceAnimation = ref(false)
const transitionInkIdentity = computed(() => JSON.stringify([
  props.line, props.text, props.occurrence, props.message,
]))
let lastTargetTransitionBox: TransitionInkBox | undefined
let lastVisibleTargetTransitionBox: TransitionInkBox | undefined

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
// Deliberately read once, not reactively: the clicks register at mount, like
// Slidev's own components, so changing these props requires a remount.
if (isDevelopment && props.on !== undefined && (props.at !== undefined || props.until !== undefined))
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
const visible = computed(() => {
  if (!isCurrentSlide.value)
    return false
  const info = clickInfo.value
  if (!info)
    return true
  return fromStart ? $clicks.value < info.end : info.isActive.value
})

// A new diagnostic must not appear while Magic Move is still animating: a
// click can reveal it a few frames before the step transition it also triggers
// begins. Once it is visible, however, it remains visible through later Magic
// Move steps. Removing it during each swap makes a diagnostic on a retained
// token fade out and redraw instead of travelling with that token.
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
// CSS transforms do not trigger ResizeObserver. Measure once per animation
// frame while Magic Move moves retained tokens, so an already-visible
// diagnostic stays attached to its target rather than waiting for the final
// mutation at the end of the transition.
let magicMoveFrame: number | undefined

// The wrapped code block renders in one of two shapes, discovered lazily
// because Magic Move only renders after mount. The <pre>/<code> element
// itself survives step changes, so it is cached across syncs.
let codeHost: HTMLElement | null = null
let isMagicMove = false

function isCrossSlideMagicMove(host: HTMLElement) {
  return !!(host.closest('.slidev-layout') ?? host).querySelector('.magic-move-between')
}

function transitionInkBox(left: number, top: number, right: number, bottom: number, slide: DOMRect): TransitionInkBox | undefined {
  if (!slide.width || !slide.height)
    return undefined
  return {
    left: (left - slide.left) / slide.width,
    top: (top - slide.top) / slide.height,
    right: (right - slide.left) / slide.width,
    bottom: (bottom - slide.top) / slide.height,
  }
}

function relevantMagicMoveAnimations(host: HTMLElement) {
  const root = host.closest<HTMLElement>('.slidev-layout') ?? host
  const pageAnimations = document.getAnimations().filter((animation) => {
    const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement
    return typeof pseudo === 'string' && pseudo.startsWith('::view-transition-')
  })
  const animations = [...root.getAnimations({ subtree: true }), ...pageAnimations]
  return [...new Set(animations)].filter((animation) => {
    if (animation.playState !== 'running' && !animation.pending)
      return false
    const effect = animation.effect as KeyframeEffect | null
    const target = effect?.target
    const pseudo = effect?.pseudoElement
    return (typeof pseudo === 'string' && pseudo.startsWith('::view-transition-'))
      || (target instanceof Element && !!target.closest('.magic-move-between, .slidev-code-magic-move, .shiki-magic-move-container'))
  }).filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
}

function isMagicMoveAnimating(host: HTMLElement) {
  return !!host.querySelector(MAGIC_MOVE_ANIMATING) || relevantMagicMoveAnimations(host).length > 0
}

function inheritTransitionInk(host: HTMLElement) {
  if (!visible.value || !lastTargetTransitionBox || !isCrossSlideMagicMove(host))
    return
  skipEntranceAnimation.value = takeTransitionInk(transitionInkIdentity.value, slideContext.$page.value, lastTargetTransitionBox)
}

/**
 * Slidev sometimes unmounts and remounts the slide it is showing: its
 * slideshow container changes shape on the first click after a view
 * transition, and every slide inside it is rebuilt. The previous instance
 * hands its visible diagnostic over on unmount (see onBeforeUnmount); the
 * one that replaces it takes it back on its first measurement that finds the
 * target while the diagnostic is due, and reveals at once instead of fading
 * in after the usual delay. A diagnostic that was not on screen before has
 * nothing to take and animates in as usual.
 *
 * The first measurement runs right after mount, still inside the same render
 * pass, so that nothing is missing from the frame that follows. Slidev's
 * click count reads as 0 until the slide's `v-click` elements have
 * registered again, so a click-gated diagnostic may only become due a tick
 * later; `sync` keeps the hand-off pending until then.
 */
let restorePending = false
function restoreTransitionInk() {
  // A failed take keeps the hand-off pending: the target may have been
  // measured against a layout that is still filling in (a Magic Move block
  // paints its tokens one tick after mounting). The `revealed` watch ends it
  // once the diagnostic has been revealed normally.
  if (!restorePending || !lastTargetTransitionBox
    || !takeTransitionInk(transitionInkIdentity.value, slideContext.$page.value, lastTargetTransitionBox))
    return
  restorePending = false
  clearTimeout(revealTimer)
  skipEntranceAnimation.value = true
  revealed.value = true
}

function findCodeHost(host: HTMLElement): HTMLElement | null {
  if (!codeHost?.isConnected) {
    // Shiki Magic Move v2 renders tokens directly in a <pre>, separated by
    // <br> elements; a static block renders `.line` spans inside <code>.
    codeHost = host.querySelector<HTMLElement>('pre.shiki-magic-move-container')
    isMagicMove = !!codeHost
    if (!codeHost)
      codeHost = host.querySelector<HTMLElement>('.slidev-code code')
    invalidateTarget()
  }
  return codeHost
}

function requestedOccurrence() {
  const occurrence = Math.trunc(props.occurrence ?? 1)
  return Number.isFinite(occurrence) && occurrence > 0 ? occurrence : 1
}

/**
 * The target is resolved once per DOM state, not once per animation frame. A
 * Range is live: while Magic Move moves retained tokens with CSS transforms
 * nothing in the DOM changes, so the Range found before the step still marks
 * the same text and only its client rects need re-reading each frame. A
 * resize or a font load moves boxes too, never text, so they reuse it as
 * well. It is dropped where the text can change: when the code block's
 * children or text mutate, when the props change, and when the code element
 * itself is replaced. A Range whose boundaries the browser has moved — a
 * replaced token detaches its text node and shifts the boundary to the
 * container — is never trusted either way.
 */
interface ResolvedTarget extends TextMatch {
  /** The code of the line the match starts on: the message sits after it. */
  lineRange: Range | null
  startNode?: Node
  endNode?: Node
}
const NO_TARGET: ResolvedTarget = { range: null, elements: [], matches: 0, lineRange: null }
let resolvedTarget: ResolvedTarget | undefined

function invalidateTarget() {
  resolvedTarget = undefined
}

function targetIntact(target: ResolvedTarget) {
  const range = target.range
  // An unmatched target can only turn up through a mutation, which
  // invalidates; until then the miss is as final as a hit.
  if (!range)
    return true
  return range.startContainer === target.startNode
    && range.endContainer === target.endNode
    && !!target.startNode?.isConnected
    && !range.collapsed
    && (!target.lineRange || !target.lineRange.collapsed)
}

function resolveTarget(host: HTMLElement): ResolvedTarget {
  const code = findCodeHost(host)
  if (resolvedTarget && targetIntact(resolvedTarget))
    return resolvedTarget
  resolvedTarget = code ? searchTarget(code) : NO_TARGET
  return resolvedTarget
}

function searchTarget(code: HTMLElement): ResolvedTarget {
  const line = props.line
  if (line !== undefined && (!Number.isInteger(line) || line < 1))
    return NO_TARGET
  const needle = text.value
  if (needle === '' || (needle === undefined && line === undefined))
    return NO_TARGET

  const segments = codeTextSegments(code, isMagicMove)
  const match: TextMatch = needle === undefined
    ? { ...trimmedLineRange(segments, line!), matches: 0, line }
    : findTextInSegments(segments, needle, requestedOccurrence(), line)
  if (!match.range)
    return { ...match, lineRange: null }

  // The squiggle follows only the exact offending text, but placing the
  // diagnostic immediately after that text would cover the remainder of its
  // source line. The message is anchored after the line's final
  // non-whitespace token instead, on the line the match starts.
  const startLine = match.line ?? line
  const lineRange = startLine === undefined ? null : trimmedLineRange(segments, startLine).range
  return { ...match, lineRange, startNode: match.range.startContainer, endNode: match.range.endContainer }
}

function sync() {
  const host = container.value
  if (!host)
    return

  const nextTarget = resolveTarget(host)
  const nextTargets = nextTarget.elements
  textMatches.value = nextTarget.matches
  targetRange.value = nextTarget.range
  const targetsChanged = targets.value.length !== nextTargets.length
    || targets.value.some((el, index) => el !== nextTargets[index])
  if (targetsChanged) {
    // Magic Move replaces its rendered code after this component has mounted.
    if (isDevelopment && isMagicMove && targets.value.length)
      stepSwaps++
    targets.value = nextTargets
  }

  const wasAnimating = animating.value
  animating.value = isMagicMoveAnimating(host)
  if (wasAnimating && !animating.value) {
    inheritTransitionInk(host)
    // A preloaded page's visibility watcher can run before Slidev commits the
    // incoming route, then be invalidated by that commit. This is the actual
    // settled edge, so open explicitly rather than depending on that earlier
    // watcher to fire a second time. The hand-off class makes unchanged ink
    // instantaneous; moved ink still uses the normal Transition entrance.
    if (visible.value && hasTarget.value) {
      clearTimeout(revealTimer)
      revealed.value = true
    }
  }
  if (animating.value)
    sawAnimating = true
  if (isDevelopment && !warnedClassDrift && !isPrintMode.value && stepSwaps >= 2 && !sawAnimating) {
    warnedClassDrift = true
    console.warn('[InlineCompilerError] Magic Move steps changed but its animation classes were never observed — the private class names in MAGIC_MOVE_ANIMATING may have been renamed by a @shikijs/magic-move upgrade, which would let the message reveal mid-animation.')
  }
  trackMagicMove()

  const range = targetRange.value
  if (!visible.value || !range)
    return

  // getBoundingClientRect() uses visual (scaled) pixels, while an absolutely
  // positioned child uses the host's unscaled CSS coordinate space.
  const scale = $scale.value * $zoom.value || 1
  const hostBox = host.getBoundingClientRect()
  // Token spans can be wider than their text; the Range gives the exact
  // rendered edges, including offsets inside the first and last token. Its
  // client rects are merged per visual line because Shiki fragments one
  // range by token, and a match can continue on the next line.
  const lines = mergeVisualLines(range.getClientRects())
  if (!lines.length)
    return
  const first = lines[0]

  // The message goes after the end of the line the match starts on, like
  // IntelliJ's inline diagnostics, so the rest of that line stays readable.
  let messageRight = first.right
  if (nextTarget.lineRange) {
    for (const box of Array.from(nextTarget.lineRange.getClientRects())) {
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
    top: `${(first.top - hostBox.top + (first.bottom - first.top) / 2) / scale}px`,
    maxWidth: `${Math.max(60, (slideBox.right - messageRight) / scale - 34)}px`,
    '--inline-compiler-error-target-size': targetSize || '12px',
  }
  underlines.value = lines.map(line => ({
    left: `${(line.left - hostBox.left) / scale}px`,
    top: `${(line.bottom - hostBox.top) / scale - 1}px`,
    width: `${(line.right - line.left) / scale}px`,
  }))
  lastTargetTransitionBox = transitionInkBox(
    Math.min(...lines.map(line => line.left)),
    first.top,
    Math.max(...lines.map(line => line.right)),
    lines[lines.length - 1].bottom,
    slideBox,
  )
  restoreTransitionInk()
  if (revealed.value)
    lastVisibleTargetTransitionBox = lastTargetTransitionBox
}

// Coalesce observer bursts into one sync per frame: during a Magic Move
// transition every token flips classes.
let pendingSync: number | undefined

function trackMagicMove() {
  if (!animating.value || magicMoveFrame !== undefined)
    return
  magicMoveFrame = requestAnimationFrame(() => {
    magicMoveFrame = undefined
    sync()
  })
}
function scheduleSync() {
  pendingSync ??= requestAnimationFrame(() => {
    pendingSync = undefined
    sync()
  })
}

// The code lines do not exist until Shiki Magic Move renders its first step,
// and are replaced for every subsequent step. Class changes are observed too:
// Magic Move signals the end of a transition by removing its animation
// classes, without touching the DOM structure — and a class flip alone never
// changes the text, so only replaced children or edited text drop the
// resolved target.
useMutationObserver(container, (records) => {
  if (records.some(record => record.type !== 'attributes'))
    invalidateTarget()
  scheduleSync()
}, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] })
// The getter re-observes automatically whenever the line or text is retargeted.
useResizeObserver(() => [container.value, ...targets.value], scheduleSync)

onMounted(async () => {
  await nextTick()
  restorePending = isCurrentSlide.value
  sync()
  document.fonts?.ready.then(scheduleSync)
})

onBeforeUnmount(() => {
  // A remount of the current slide (see restoreTransitionInk) must not read
  // as a redraw: leave the visible diagnostic for the instance that takes
  // over. Leaving the slide is not this case; the `isCurrentSlide` watch has
  // already handed it to the neighbouring page and hidden it by then.
  if (isCurrentSlide.value && revealed.value && lastTargetTransitionBox)
    rememberTransitionInk(transitionInkIdentity.value, slideContext.$page.value, lastTargetTransitionBox)
  $clicksContext?.unregister(id)
  if (pendingSync !== undefined)
    cancelAnimationFrame(pendingSync)
  if (magicMoveFrame !== undefined)
    cancelAnimationFrame(magicMoveFrame)
  clearTimeout(revealTimer)
  clearTimeout(missingTargetWarning)
  if (isDevelopment)
    clearAnnotationAuthoringProblems(id)
})
watch([() => props.line, text, () => props.occurrence], () => {
  invalidateTarget()
  sync()
})
watch(visible, sync)

let revealTimer: ReturnType<typeof setTimeout> | undefined
watch([visible, hasTarget, animating], ([isVisible, targetPresent, isAnimating]) => {
  clearTimeout(revealTimer)
  // A click range always wins: a diagnostic explicitly taken away must not
  // linger just because the same click also begins a Magic Move transition.
  if (!isVisible) {
    revealed.value = false
    return
  }
  // A retained target can be briefly absent while Magic Move replaces its DOM
  // snapshot. Preserve an already-visible diagnostic over that gap; once the
  // step has settled, a genuinely absent target hides it as usual.
  if (!targetPresent) {
    if (!isAnimating)
      revealed.value = false
    return
  }
  // Only an initial reveal waits for the transition. Existing ink stays in
  // place and is continuously remeasured by trackMagicMove().
  if (isAnimating)
    return
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

watch(revealed, (isRevealed) => {
  if (isRevealed)
    restorePending = false
  if (isRevealed && lastTargetTransitionBox)
    lastVisibleTargetTransitionBox = lastTargetTransitionBox
  else if (isCurrentSlide.value)
    lastVisibleTargetTransitionBox = undefined
  // Handed-over ink skips its entrance only. Once that reveal has rendered,
  // the transitions come back for whatever happens next, the exit included.
  if (isRevealed && skipEntranceAnimation.value)
    nextTick(() => skipEntranceAnimation.value = false)
})

watch(isCurrentSlide, (current) => {
  if (current) {
    lastVisibleTargetTransitionBox = undefined
    skipEntranceAnimation.value = false
    scheduleSync()
    return
  }
  const host = container.value
  if (host && lastVisibleTargetTransitionBox && isCrossSlideMagicMove(host))
    rememberTransitionInk(transitionInkIdentity.value, slideContext.$page.value, lastVisibleTargetTransitionBox)
  lastVisibleTargetTransitionBox = undefined
  revealed.value = false
}, { flush: 'sync' })

// A target that is absent from the current code step has nothing to anchor to,
// so the diagnostic stays hidden. Silent in production, but tell the slide
// author after the longest Magic Move transition has had time to finish.
let missingTargetWarning: ReturnType<typeof setTimeout> | undefined
// The warning is also shown as a chip on the slide while serving (see
// DrawnAnnotationProblems.vue) and, unlike the console line, withdrawn as soon
// as the target turns up or the props change.
function warnMissingTarget(message: string) {
  console.warn(`[InlineCompilerError] ${message}`)
  reportAnnotationAuthoringProblem(id, { component: 'InlineCompilerError', message, page: slideContext.$page.value })
}
watch([visible, hasTarget, () => props.line, text, () => props.occurrence, textMatches], ([isVisible, found]) => {
  clearTimeout(missingTargetWarning)
  if (!isDevelopment)
    return
  clearAnnotationAuthoringProblems(id)
  if (isVisible && !found) {
    missingTargetWarning = setTimeout(() => {
      const needle = text.value
      if (needle !== undefined) {
        const scope = props.line === undefined ? '' : ` on line ${props.line}`
        if (!needle)
          warnMissingTarget(`\`text\` must be non-empty for "${props.message}" — the diagnostic is not shown.`)
        else if (props.line !== undefined && (!Number.isInteger(props.line) || props.line < 1))
          warnMissingTarget(`\`line\` must be a positive integer for "${props.message}" — the diagnostic is not shown.`)
        else if (textMatches.value > 0)
          warnMissingTarget(`Text "${props.text}" only matched ${textMatches.value} time${textMatches.value === 1 ? '' : 's'}${scope}, but \`occurrence\` asks for match ${requestedOccurrence()} — the diagnostic is not shown.`)
        else
          warnMissingTarget(`Text "${props.text}" was not found${scope} for "${props.message}" — it must match the rendered code exactly${needle.includes('\n') ? ', line breaks and indentation included' : ''}.`)
      }
      else if (props.line === undefined) {
        warnMissingTarget(`Give either \`line\` or \`text\` for "${props.message}" — the diagnostic is not shown.`)
      }
      else if (!Number.isInteger(props.line) || props.line < 1) {
        warnMissingTarget(`\`line\` must be a positive integer for "${props.message}" — the diagnostic is not shown.`)
      }
      else {
        warnMissingTarget(`No code tokens on line ${props.line} for "${props.message}" — the diagnostic is not shown. Empty lines cannot be annotated; check the \`line\` prop.`)
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
    <span class="inline-compiler-error-status" role="status" aria-live="polite" aria-atomic="true">{{ revealed ? messageText : '' }}</span>
    <!-- Handed-over ink (see restoreTransitionInk and inheritTransitionInk)
         must appear complete in its first frame; a zero-length transition
         would still show Vue's enter-from frame, so it is left out entirely. -->
    <Transition name="compiler-error" :css="!isPrintMode && !skipEntranceAnimation">
      <span
        v-if="revealed"
        class="inline-compiler-error-underlines"
        aria-hidden="true"
      >
        <span
          v-for="(underline, index) in underlines"
          :key="index"
          class="inline-compiler-error-underline"
          :style="underline"
        />
      </span>
    </Transition>
    <Transition name="compiler-error" :css="!isPrintMode && !skipEntranceAnimation">
      <span
        v-if="revealed"
        class="inline-compiler-error-message"
        :style="position"
        aria-hidden="true"
      ><i>●</i><span class="annotation-label-content" v-html="messageHtml" /></span>
    </Transition>
  </div>
</template>

<style scoped>
.inline-compiler-error-host { position: relative; }
.inline-compiler-error-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
/* Themeable like the other annotation colours: a deck recolours the whole
   diagnostic by defining `--inline-compiler-error-color`, at :root or any
   narrower scope; the fallbacks are IntelliJ's error reds. */
.inline-compiler-error-message { position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: .32em; color: var(--inline-compiler-error-color, #e95757); font-family: var(--slidev-font-sans); font-size: var(--inline-compiler-error-message-size, var(--inline-compiler-error-target-size, 12px)); font-weight: 700; line-height: 1.25; pointer-events: none; transform: translateY(-50%); }
.compiler-error-enter-active,
.compiler-error-leave-active { transition: opacity .18s ease; }
.compiler-error-enter-from,
.compiler-error-leave-to { opacity: 0; }
.inline-compiler-error-message i { color: var(--inline-compiler-error-color, #f05b5b); font-size: .55em; font-style: normal; }
/* One squiggle per visual line, all fading together. The wrapper covers the
   host exactly, so its children keep the host's coordinate space. */
.inline-compiler-error-underlines { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.inline-compiler-error-underline {
  position: absolute;
  height: 6px;
  /* The squiggle is an SVG mask over a plain background colour, so it follows
     the theme variable; only the mask's alpha matters, not its stroke colour. */
  background-color: var(--inline-compiler-error-color, #f05b5b);
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='6'%3E%3Cpath d='M0 3 Q3 1 6 3 T12 3' fill='none' stroke='black' stroke-width='1.5'/%3E%3C/svg%3E") repeat-x left top / 12px 6px;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='6'%3E%3Cpath d='M0 3 Q3 1 6 3 T12 3' fill='none' stroke='black' stroke-width='1.5'/%3E%3C/svg%3E") repeat-x left top / 12px 6px;
}
</style>
