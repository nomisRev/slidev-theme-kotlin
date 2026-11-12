/**
 * Paints an IntelliJ-style background behind an exact piece of code inside a
 * fenced block, with an optional message after the line the match starts on.
 * The mechanism behind `SmartCast` and `Warning`: the two differ only in
 * colour and name, so each component is a thin wrapper that hands its props,
 * its host element, and its identity to `useCodeHighlight` and renders the
 * message it returns. `TypeHint` uses the same match and message placement
 * without painting anything: its inlay is the message. Its `type` hint is
 * instead drawn inside the line, after the match (see `inlay`).
 */
import type { ClicksInfo } from '@slidev/types'
import type { Ref } from 'vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { useIsSlideActive, useNav, useSlideContext } from '@slidev/client'
import { useMutationObserver, useResizeObserver } from '@vueuse/core'
import { codeTextSegments, findTextInSegments, mergeVisualLines, trimmedLineRange } from './code-text-match'
import { normalizeAnnotationLineBreaks } from './annotation-line-breaks'
import { renderAnnotationLabel } from './annotation-label-markdown'
import { clearAnnotationAuthoringProblems, reportAnnotationAuthoringProblem } from './drawn-annotation/editor-store'
import { useCarriedLayer } from './carried-layer'
import { handOverTransitionInk, takeTransitionInk } from './transition-ink'
import type { TransitionInkBox } from './transition-ink'

// Slidev's build renderer can leave `import.meta.env.DEV` true. Authoring
// warnings belong to Vite's explicit serve mode only, the same boundary
// DrawnAnnotation's and InlineCompilerError's editors use.
const isDevelopment = import.meta.env.MODE === 'development'

/** The props every code highlight component declares. */
export interface CodeHighlightProps {
  /** One-based source line number inside the single fenced code block this component wraps; narrows the `text` search to that line (the first line of a multi-line match). */
  line?: number
  /** Exact rendered code text to paint, e.g. `"nullable.length"`. `\\n` (or a literal newline in a bound string) continues the match on the next line. */
  text?: string
  /** Which occurrence of `text` to paint, 1-based. */
  occurrence?: number | string
  /**
   * Text shown after the end of the line the match starts on, as IntelliJ
   * places its inline diagnostics. `\\n` (or a literal newline in a bound
   * string) breaks the line. Omit it for a bare highlight.
   */
  message?: string
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
}

export interface CodeHighlightOptions {
  /** The component's name, for console warnings and the authoring-problem list. */
  component: 'SmartCast' | 'Warning' | 'TypeHint' | 'InlineValue'
  /**
   * The class painted onto the matched token elements; its colour lives in the
   * component's own unscoped style. Omit it for a component whose only
   * visible part is the message: the match is then located but left untouched.
   */
  highlightClass?: string
  /**
   * Text of an inline inlay drawn right after the match, inside the code line,
   * so the rest of the line moves right as it does in the IDE. It is set as
   * `data-code-inlay` on the last painted element and rendered by the
   * component's CSS as `::after` content, which keeps it out of the text every
   * other component searches. Needs `highlightClass` to paint the match.
   * `endsLine` tells whether the match is the last code on its line, for a
   * component that only draws inside the line when code follows the match.
   */
  inlay?: (match: { endsLine: boolean }) => string | undefined
}

// Classes Shiki Magic Move keeps on its elements only while a step transition
// is playing. A message that is not on screen yet waits for the tokens to
// settle; one that is stays, and follows its line frame by frame.
const MAGIC_MOVE_ANIMATING = [
  '.shiki-magic-move-enter-active',
  '.shiki-magic-move-leave-active',
  '.shiki-magic-move-move',
  '.shiki-magic-move-container-resize',
  '.shiki-magic-move-container-restyle',
].join(', ')

/** Inline style of the message: where it sits in the host's coordinate space and how wide it may grow. */
export interface CodeHighlightMessageStyle {
  left: string
  top: string
  maxWidth: string
  /** The annotated token's computed font size, the message's size unless the component's own variable overrides it. */
  '--code-highlight-target-size': string
}

// Slidev reserves click 0 for the pre-click state and warns when anything
// registers at 0, so `at` values <= 0 mean "visible from the start".
function isFromStart(at?: number | string) {
  if (at === undefined)
    return true
  if (typeof at === 'string' && '+-'.includes(at[0]))
    return false
  return +at <= 0
}

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

/**
 * Wires a highlight component: resolves its click range, finds `text` in the
 * wrapped fence, paints the match, and keeps it painted across Magic Move
 * steps. `container` is the component's host element around the slot.
 */
export function useCodeHighlight(props: CodeHighlightProps, container: Ref<HTMLElement | null>, options: CodeHighlightOptions) {
  const { component, highlightClass, inlay } = options

  // Markdown attributes cannot conveniently contain a literal line break, so
  // accept both a real newline (from a bound Vue string) and the `\\n` escape.
  const text = computed(() => props.text === undefined ? undefined : normalizeAnnotationLineBreaks(props.text))
  const message = computed(() => props.message ? normalizeAnnotationLineBreaks(props.message) : undefined)
  // An authored message is the same safe Markdown as a `DrawnAnnotation`
  // label, so backticks render a type name as inline code.
  const messageHtml = computed(() => props.message ? renderAnnotationLabel(props.message) : '')

  const slideContext = useSlideContext()
  const { $clicksContext, $clicks, $scale, $zoom } = slideContext
  const { isPrintMode } = useNav()
  const isCurrentSlide = useIsSlideActive()
  const id = useId()

  // The Shiki/Magic Move token elements the current match touches. Painting the
  // highlight directly onto these — rather than an absolutely positioned overlay,
  // as InlineCompilerError draws its squiggle — puts the highlight behind their
  // own text automatically (a same-element background always paints behind that
  // element's own content) and lets it travel with Magic Move for free, since
  // it is the moving element's own style rather than a box tracking it.
  const targets = shallowRef<HTMLElement[]>([])
  // Whether the current match exists at all, independent of painting.
  const matched = ref(false)
  const textMatches = ref(0)
  const hasTarget = computed(() => matched.value)
  // True while Shiki Magic Move is transitioning between steps.
  const animating = ref(false)
  // Whether the current match is the last code on its line; see `inlay`.
  const matchEndsLine = ref(true)
  // Whether the inlay is drawn right now, in place of any message.
  const inlaid = ref(false)
  const messageStyle = ref<CodeHighlightMessageStyle>({ left: '0px', top: '0px', maxWidth: 'none', '--code-highlight-target-size': '12px' })

  if (isDevelopment && props.on !== undefined && (props.at !== undefined || props.until !== undefined))
    console.warn(`[${component}] \`on\` is \`at\` and \`until\` in one, so the separate \`at\` / \`until\` given here are ignored. Use either \`on\` alone, or \`at\` and \`until\`.`)
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
  // A new message must not appear on top of code that is still moving. Once
  // it is shown, however, it stays through later Magic Move steps: taking it
  // away for every step makes the message of a line that never moved blink.
  const revealed = ref(false)
  // The message was on screen on the neighbouring Magic Move slide: it is
  // shown complete from the first frame, without its entrance fade.
  const carried = ref(false)
  const messageShown = computed(() => revealed.value && !!message.value)
  // Each slide of a cross-slide Magic Move chain has its own instance of this
  // component. A message on screen when its slide is left is handed to the
  // equivalent instance on the neighbouring slide (see transition-ink.ts).
  const transitionInkIdentity = computed(() => JSON.stringify([component, props.line, text.value, props.occurrence, message.value]))
  let lastTransitionBox: TransitionInkBox | undefined
  // Set on arrival from a neighbouring slide, until the message is revealed.
  let carryPending = false
  // The window of a chain slide starts its move a frame after the slide is
  // entered. Until it had the time to, only a carried message is shown: one
  // that is new here waits for the move, like on any other step.
  let arrivalHold: ReturnType<typeof setTimeout> | undefined
  // Only the entrance is skipped: a message that goes fades out as usual.
  watch(revealed, (isRevealed) => {
    if (!isRevealed)
      carried.value = false
  }, { flush: 'sync' })

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

  function requestedOccurrence() {
    const occurrence = Math.trunc(Number(props.occurrence ?? 1))
    return Number.isFinite(occurrence) && occurrence > 0 ? occurrence : 1
  }

  interface Target {
    range: Range | null
    matches: number
    /** The code of the line the match starts on: the message sits after it. */
    lineRange: Range | null
    /** Whether the match ends where the code of its first line ends. */
    endsLine: boolean
  }
  const NO_TARGET: Target = { range: null, matches: 0, lineRange: null, endsLine: true }

  /** Finds the exact text even when Shiki split it across token spans or lines. */
  function findTarget(host: HTMLElement): Target {
    const code = findCodeHost(host)
    const needle = text.value
    if (!code || !needle)
      return NO_TARGET
    if (props.line !== undefined && (!Number.isInteger(props.line) || props.line < 1))
      return NO_TARGET
    const segments = codeTextSegments(code, isMagicMove)
    const match = findTextInSegments(segments, needle, requestedOccurrence(), props.line)
    // Placing the message right after the matched text would cover the rest
    // of its source line, so it is anchored after the line's last token
    // instead, on the line the match starts.
    const startLine = match.line ?? props.line
    const lineRange = match.range && startLine !== undefined ? trimmedLineRange(segments, startLine).range : null
    const endsLine = !match.range || !lineRange || match.range.compareBoundaryPoints(Range.END_TO_END, lineRange) >= 0
    return { range: match.range, matches: match.matches, lineRange, endsLine }
  }

  /** Places the message after the end of the match's first line, vertically centred on it. */
  function placeMessage(host: HTMLElement, target: Target) {
    const range = target.range
    if (!range || !message.value)
      return
    // getBoundingClientRect() uses visual (scaled) pixels, while an absolutely
    // positioned child uses the host's unscaled CSS coordinate space.
    const scale = $scale.value * $zoom.value || 1
    const hostBox = host.getBoundingClientRect()
    const lines = mergeVisualLines(range.getClientRects())
    if (!lines.length)
      return
    const first = lines[0]
    let messageRight = first.right
    for (const box of Array.from(target.lineRange?.getClientRects() ?? [])) {
      if (box.width)
        messageRight = Math.max(messageRight, box.right)
    }
    // The slide clips at its own edge; wrap the message within the remaining
    // room instead of letting it run off the canvas.
    const slideBox = (host.closest('.slidev-layout') ?? host).getBoundingClientRect()
    // The message is a sibling of the code block, so it does not inherit the
    // code's font size; read it from the annotated text instead.
    const targetElement = range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement
    lastTransitionBox = slideBox.width && slideBox.height
      ? {
          left: (first.left - slideBox.left) / slideBox.width,
          top: (first.top - slideBox.top) / slideBox.height,
          right: (messageRight - slideBox.left) / slideBox.width,
          bottom: (first.bottom - slideBox.top) / slideBox.height,
        }
      : undefined
    messageStyle.value = {
      left: `${(messageRight - hostBox.left) / scale + 10}px`,
      top: `${(first.top - hostBox.top + (first.bottom - first.top) / 2) / scale}px`,
      maxWidth: `${Math.max(60, (slideBox.right - messageRight) / scale - 34)}px`,
      '--code-highlight-target-size': (targetElement && getComputedStyle(targetElement).fontSize) || '12px',
    }
  }

  // Elements this component created by splitting a Shiki token's text node (see
  // paintRange below), as opposed to an existing token element it only added
  // the highlight class to. Only the former need undoing — the DOM surgery
  // reversed — when they stop being the match; the latter just lose the class.
  const createdWrappers = new Set<HTMLElement>()

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

  // classList.add/remove always re-sets the attribute, even when the class is
  // already (ab)sent, which fires this component's own `attributeFilter:
  // ['class']` mutation observer again. Guarding on `contains` first keeps a
  // steady-state sync a no-op instead of retriggering itself forever.
  function paint(range: Range | null) {
    matched.value = !!range
    if (!highlightClass)
      return
    const nextTargets = range ? paintRange(range) : []
    // The inlay belongs after the match, so only its last element carries it.
    // A data attribute is outside the class observer's filter, so writing it
    // never retriggers a sync; it is written before the class below, whose
    // mutation lets the other marks on this fence re-measure the moved line.
    const inlayText = range ? inlay?.({ endsLine: matchEndsLine.value }) : undefined
    inlaid.value = !!inlayText
    const inlayTarget = inlayText ? nextTargets.at(-1) : undefined
    for (const el of targets.value) {
      if (el !== inlayTarget && el.hasAttribute('data-code-inlay'))
        el.removeAttribute('data-code-inlay')
    }
    if (inlayTarget && inlayTarget.getAttribute('data-code-inlay') !== inlayText)
      inlayTarget.setAttribute('data-code-inlay', inlayText!)
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
      else if (el.classList.contains(highlightClass)) {
        el.classList.remove(highlightClass)
      }
    }
    for (const el of nextTargets) {
      if (!el.classList.contains(highlightClass))
        el.classList.add(highlightClass)
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
      revealed.value = false
      return
    }
    const target = findTarget(host)
    textMatches.value = target.matches
    matchEndsLine.value = target.endsLine
    paint(target.range)
    // Magic Move ends a transition by removing its animation classes, which
    // the class observer below turns into one more sync: the settled edge.
    const wasAnimating = animating.value
    animating.value = !!host.querySelector(MAGIC_MOVE_ANIMATING)
    placeMessage(host, target)
    // Carried only for the move it arrived with; see carried-layer.ts.
    if (wasAnimating && !animating.value)
      carried.value = false
    if (!message.value)
      return
    if (!matched.value) {
      // Magic Move can leave a retained target briefly unmatched while it
      // swaps its DOM; only a settled step without the target hides it.
      if (!animating.value)
        revealed.value = false
    }
    else if (!revealed.value) {
      if (carryPending && lastTransitionBox && takeTransitionInk(transitionInkIdentity.value, slideContext.$page.value, lastTransitionBox))
        carried.value = true
      if (carried.value || (!animating.value && arrivalHold === undefined))
        revealed.value = true
    }
    if (revealed.value)
      carryPending = false
    trackMessage()
  }

  // CSS transforms move the tokens without a mutation to observe, so a
  // message on screen is placed again every frame of a Magic Move step.
  let trackFrame: number | undefined
  function trackMessage() {
    if (!animating.value || !revealed.value || trackFrame !== undefined)
      return
    trackFrame = requestAnimationFrame(() => {
      trackFrame = undefined
      sync()
    })
  }

  function isCrossSlideMagicMove() {
    const host = container.value
    return !!host && !!(host.closest('.slidev-layout') ?? host).querySelector('.magic-move-between')
  }

  // Observer bursts are coalesced into one sync per frame: a Magic Move step
  // flips classes on every token in several batches, and each sync walks the
  // block, writes classes and then forces a layout for the message.
  let pendingSync: number | undefined
  function scheduleSync() {
    pendingSync ??= requestAnimationFrame(() => {
      pendingSync = undefined
      sync()
    })
  }

  // The code lines do not exist until Shiki Magic Move renders its first step,
  // and are replaced for every subsequent step; re-painting on every mutation
  // keeps the highlight on the current step's tokens instead of stale ones.
  // Two changes cannot wait for the next frame, or the frame in between is
  // painted without the highlight: Magic Move resetting the text of a token
  // this component had split (which drops the painted wrapper), and a step
  // starting to move, which is when a message on screen has to follow.
  useMutationObserver(container, () => {
    const host = container.value
    if (host && visible.value
      && (targets.value.some(el => !el.isConnected) || (!animating.value && host.querySelector(MAGIC_MOVE_ANIMATING))))
      sync()
    else
      scheduleSync()
  }, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  // A resize moves the tokens, never the text: repaint is a no-op, the message moves.
  useResizeObserver(container, scheduleSync)

  onMounted(async () => {
    await nextTick()
    sync()
    document.fonts?.ready.then(scheduleSync)
  })

  onBeforeUnmount(() => {
    clear()
    $clicksContext?.unregister(id)
    if (pendingSync !== undefined)
      cancelAnimationFrame(pendingSync)
    if (trackFrame !== undefined)
      cancelAnimationFrame(trackFrame)
    clearTimeout(missingTargetWarning)
    clearTimeout(arrivalHold)
    if (isDevelopment)
      clearAnnotationAuthoringProblems(id)
  })
  watch([() => props.line, text, () => props.occurrence, message, () => inlay?.({ endsLine: matchEndsLine.value })], sync)
  watch(visible, sync)
  watch(isCurrentSlide, sync)
  // The hand-off between the slides of a chain. Synchronous, so the slide
  // being left has recorded its message before the `sync` above, which runs
  // with the next render, lets the slide being entered look for it.
  watch(isCurrentSlide, (current) => {
    const host = container.value
    if (current) {
      carried.value = false
      carryPending = isCrossSlideMagicMove()
      host?.removeAttribute('data-magic-move-handed-over')
      clearTimeout(arrivalHold)
      arrivalHold = carryPending
        ? setTimeout(() => {
            arrivalHold = undefined
            sync()
          }, 100)
        : undefined
    }
    else if (revealed.value && lastTransitionBox && isCrossSlideMagicMove()) {
      // Once the neighbouring slide shows the message, the copy left here
      // goes at once instead of fading out beneath it (see layout.css).
      handOverTransitionInk(transitionInkIdentity.value, slideContext.$page.value, lastTransitionBox, () => {
        host?.setAttribute('data-magic-move-handed-over', '')
      })
    }
  }, { flush: 'sync' })

  // A target that is absent from the current code step has nothing to paint, so
  // the highlight stays off. Silent in production, but tell the slide author
  // after Magic Move has had time to settle.
  let missingTargetWarning: ReturnType<typeof setTimeout> | undefined
  function warnMissingTarget(message: string) {
    console.warn(`[${component}] ${message}`)
    reportAnnotationAuthoringProblem(id, { component, message, page: slideContext.$page.value })
  }
  watch([visible, hasTarget, () => props.line, text, () => props.occurrence, textMatches], ([isVisible, found]) => {
    clearTimeout(missingTargetWarning)
    if (!isDevelopment)
      return
    clearAnnotationAuthoringProblems(id)
    if (isVisible && !found) {
      missingTargetWarning = setTimeout(() => {
        const scope = props.line === undefined ? '' : ` on line ${props.line}`
        if (!text.value)
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

  const carriedLayer = useCarriedLayer(carried)
  const placedMessageStyle = computed(() => ({ ...messageStyle.value, ...carriedLayer.value }))
  return { message, messageHtml, messageShown, messageStyle: placedMessageStyle, messageCarried: carried, inlaid }
}
