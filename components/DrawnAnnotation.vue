<script setup lang="ts">
import type { Options as RoughOptions } from 'roughjs/bin/core'
import type { ClicksContext } from '@slidev/types'
import type { ComputedRef, InjectionKey, Ref } from 'vue'
import { injectLocal } from '@vueuse/core'
import { useSlideContext } from '@slidev/client'
// The explicit `.ts` extension is required: Slidev's client ships bare TypeScript
// sources, and the bundler resolves this subpath literally.
import { injectionClicksContext } from '@slidev/client/constants.ts'
import rough from 'roughjs'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, toRef, watch, watchEffect } from 'vue'

/**
 * Hand-drawn annotation for anything on a slide.
 *
 * It marks an element (or an exact piece of text inside it, which is the only
 * way to reach a token inside a Shiki code block) with a rough-notation style
 * circle, underline, box or strike-through, and optionally connects that mark
 * to a second element on the slide or to a text label.
 *
 * A label is placed out of the slide's normal flow: its position is searched at
 * runtime so it never overlaps other content — nor the labels other annotations
 * wrote on earlier clicks — preferring downwards for marks in the upper half of
 * the slide and upwards for marks in the lower half. Pass
 * `label-x` / `label-y` (percentages of the slide) to place it by hand instead.
 *
 * Annotations nest, and two that share a click draw one after the other: the
 * inner one starts when the one around it has finished, so "point at it, then
 * circle it" is a single reveal rather than two clicks. Pass `:sequential="false"`
 * to draw them at the same time instead.
 *
 * Everything is measured in the slide's own coordinate system, so annotations
 * keep their proportions in the presenter view, in exports and at any window
 * size. Geometry is re-measured while Shiki Magic Move animates, which makes
 * the mark follow the token it belongs to.
 *
 * Mistakes in the markup — text that never appears, a selector or target that
 * matches nothing, a click that cannot be read — are reported on the browser
 * console, once per annotation.
 */
type MarkType = 'circle' | 'underline' | 'box' | 'strike-through' | 'none'

const props = withDefaults(defineProps<{
  /** Shape drawn on the source. Kept as the short form of `sourceType`. */
  type?: MarkType
  /** Shape drawn on the source. Overrides `type` when supplied. */
  sourceType?: MarkType
  /** Element to annotate, searched inside the default slot. */
  selector?: string
  /** Exact text to annotate inside the slot. Works inside Shiki and Magic Move. */
  text?: string
  /** Which occurrence of `text` to annotate, 1-based. */
  occurrence?: number
  /** Mark every visual line of a wrapped or multi-line match. */
  multiline?: boolean
  /** Extra space between the annotated box and the mark, in slide pixels. */
  padding?: number
  /** Connect the mark to this element instead of to a label. */
  target?: string
  /** Point inside the target, as a percentage of its box. */
  targetX?: number
  targetY?: number
  /** Radius of the mark drawn at the target point, as a percentage of its width. */
  targetRadius?: number
  /** Shape drawn at the target point. Defaults to `circle`. */
  targetType?: MarkType
  /** Show the default target circle when `targetType` is omitted. */
  targetMark?: boolean
  /** Text label. Placed automatically unless `labelX` / `labelY` are given. */
  label?: string
  /** Label centre, as a percentage of the slide. Disables automatic placement. */
  labelX?: number
  labelY?: number
  /** Optional maximum label width in slide pixels, before it wraps. */
  labelWidth?: number
  /** Preferred side for automatic placement. `auto` picks by vertical position. */
  placement?: 'auto' | 'up' | 'down' | 'left' | 'right'
  /** Smallest distance between the mark and the label, in slide pixels. */
  gap?: number
  /** Space the label keeps from everything else on the slide. */
  clearance?: number
  /** Extra elements the label must not cover. */
  avoidSelector?: string
  /** Draw the leader line between the mark and the label or target. */
  connect?: boolean
  /** Arrow head at the end of the leader line. */
  arrow?: boolean
  /** Sideways bow of the leader line, as a fraction of its length (capped at 40 slide pixels). */
  curve?: number
  /**
   * Passed straight to rough.js, which draws every stroke, so everything it
   * understands works here: `roughness`, `bowing`, `disableMultiStroke`,
   * `curveFitting`, `seed`, … Colour and stroke width are the exception: they
   * come from `color` and `strokeWidth`, exactly as in Rough Notation, because
   * they are applied in CSS, which is what animates the drawing.
   */
  options?: RoughOptions
  /** How many times each shape is drawn over itself — the sketchy redraw. */
  iterations?: number
  /**
   * Stroke and label colour. The default reads the `--drawn-annotation-color`
   * CSS variable, so a theme recolours every annotation by defining it — at
   * `:root` or any narrower scope. Where nobody defines it, the strokes
   * follow the surrounding text, which is Rough Notation's own default.
   */
  color?: string
  /** Stroke width, in slide pixels. */
  strokeWidth?: number
  /** How long drawing one stage takes, in milliseconds. */
  duration?: number
  at?: number | string
  /**
   * Start drawing only once the annotation this one sits inside has finished,
   * when the two share a click. That is what turns "point at it, then circle
   * it" into a single reveal instead of two clicks, without anyone having to
   * time it by hand. Turn off to draw both at once.
   */
  sequential?: boolean
  /**
   * Click that takes the annotation away again, so it only belongs to the
   * steps it describes. Exclusive, like the end of a `v-click` range: with
   * `:at="1" :until="2"` the annotation is on screen for click 1 only.
   */
  until?: number | string
  /**
   * `at` and `until` in one, for the common case of an annotation that belongs
   * to a single click: `:on="1"` is `:at="1" :until="2"`. The end counts from
   * the label's click when a later `labelAt` pushes it past the mark, so a
   * label is never taken away before it has been read. Give `at` and `until`
   * separately for an annotation that stays on screen for several clicks.
   */
  on?: number | string
  /**
   * Take `at` as a step of its own inside the slot's Magic Move block, instead
   * of sharing a click with one of its code steps. Every step from `at` onwards
   * is pushed one click later, which leaves a click that only draws the
   * annotation, on a code block that stays still. Annotations keep counting in
   * the slide's own clicks, so `at` is always the click in the URL, but inside
   * such a block they have to be given as plain numbers.
   */
  insert?: boolean
  /**
   * Wait for the annotated element to stop moving before drawing. A Magic Move
   * step or a slide transition keeps it travelling for a while, and a mark
   * drawn on top of that reads as an error. Turn off to draw right away.
   */
  wait?: boolean
  /** Click that writes the label. Defaults to `at`. */
  labelAt?: number | string
  /** Follow the annotated element while Magic Move or a transition animates it. */
  track?: boolean
}>(), {
  type: 'underline',
  sourceType: undefined,
  selector: '[data-annotate]',
  text: undefined,
  occurrence: 1,
  multiline: undefined,
  padding: 4,
  target: undefined,
  targetX: 50,
  targetY: 50,
  targetRadius: 3,
  targetType: undefined,
  targetMark: true,
  label: undefined,
  labelX: undefined,
  labelY: undefined,
  labelWidth: undefined,
  placement: 'auto',
  gap: 28,
  clearance: 16,
  avoidSelector: undefined,
  connect: true,
  arrow: false,
  curve: 0.12,
  options: undefined,
  iterations: 2,
  // A CSS expression, not a colour value: it only ever lands in style
  // bindings. Anything that needs an actual colour cannot read this raw.
  color: 'var(--drawn-annotation-color, currentColor)',
  strokeWidth: 2,
  duration: 800,
  sequential: true,
  at: undefined,
  until: undefined,
  on: undefined,
  insert: false,
  wait: true,
  labelAt: undefined,
  track: true,
})

// Carries the unshifted clicks context past an annotation that inserts a click.
// A string key, because `<script setup>` runs per component: a Symbol created
// here would be a different one in every annotation, and never match.
const realClicksKey = '$$drawn-annotation-clicks' as unknown as InjectionKey<ClicksContext>
/**
 * What an annotation tells the ones nested inside it: the click it is drawn on,
 * and the moment after that click at which it has finished drawing. A nested
 * annotation on the same click starts there, so the two read as one sequence.
 */
interface SequenceContext {
  click: ComputedRef<number> | Ref<number>
  end: ComputedRef<number>
}
const sequenceKey = '$$drawn-annotation-sequence' as unknown as InjectionKey<SequenceContext>

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  cx: number
  cy: number
}

// `on` is `at` and `until` in one, so everything that resolves a click reads it
// through here rather than the raw prop. Named apart from the `at` prop so the
// two can never be confused, in the script or in the template.
const atClick = computed(() => props.on ?? props.at)

// Warnings deduplicate: geometry is re-measured on every animation frame while
// something on the slide moves, and a mistake in the markup should read as one
// clear message, not a stream of identical ones.
const warned = new Set<string>()
function warn(message: string) {
  if (warned.has(message))
    return
  warned.add(message)
  console.warn(`[DrawnAnnotation] ${message}`)
}

// The types arrive from Markdown, so a typo is a string TypeScript never saw.
const MARK_TYPES = ['underline', 'circle', 'box', 'strike-through', 'none'] as const
function resolveMarkType(value: unknown, prop: string, fallback: MarkType): MarkType {
  if ((MARK_TYPES as readonly unknown[]).includes(value))
    return value as MarkType
  warn(`Unknown ${prop} "${value}". Use one of ${MARK_TYPES.join(', ')}; drawing ${fallback} instead.`)
  return fallback
}

// `type` remains the concise, backwards-compatible source shape. The explicit
// endpoint props make connectors readable when their two marks differ.
const sourceMarkType = computed(() => resolveMarkType(
  props.sourceType ?? props.type,
  props.sourceType === undefined ? 'type' : 'source-type',
  'underline',
))
const targetMarkType = computed(() => props.targetType === undefined
  ? (props.targetMark ? 'circle' : 'none')
  : resolveMarkType(props.targetType, 'target-type', 'circle'))

const PLACEMENTS = ['auto', 'up', 'down', 'left', 'right'] as const
const resolvedPlacement = computed(() => {
  if ((PLACEMENTS as readonly string[]).includes(props.placement))
    return props.placement
  warn(`Unknown placement "${props.placement}". Use one of ${PLACEMENTS.join(', ')}; placing the label automatically instead.`)
  return 'auto'
})

// The label and the target each drive several stages, so their presence is
// decided once, and an empty string counts as absent everywhere.
const hasLabel = computed(() => !!props.label)
const hasTarget = computed(() => !!props.target)

if (props.on !== undefined && (props.at !== undefined || props.until !== undefined))
  warn('`on` is `at` and `until` in one, so the separate `at` / `until` given here are ignored. Use either `on` alone, or `at` and `until`.')
if (props.labelAt !== undefined && props.label === undefined)
  warn('`label-at` names the click that writes the label, but no `label` was given.')

const container = ref<HTMLElement>()
const clickMarker = ref<HTMLElement>()
const labelMarker = ref<HTMLElement>()
const overlay = ref<SVGSVGElement>()
const labelEl = ref<HTMLElement>()

// The mark and the label can share one click or be spread over two, which is
// what makes "mark it, then name it" possible from Markdown.
const resolvedClick = ref(Number.POSITIVE_INFINITY)
const resolvedLabelClick = ref(Number.POSITIVE_INFINITY)
const geometryPainted = ref(false)
const showImmediately = ref(false)
// The real, unshifted clicks context. An annotation that inserts a click hands
// its slot a shifted one, so a nested annotation would otherwise count in the
// shifted clicks and land a click late. Passing the real context down keeps
// every `at` in the slide's own clicks, which is what the URL shows.
// `injectLocal`, not `inject`: slot content resolves what the component that
// renders the slot provided, which plain `inject` walks straight past. Slidev's
// own clicks context reaches nested components the same way.
const outerClicksContext = injectLocal(realClicksKey, null)
const $clicksContext = outerClicksContext ?? useSlideContext().$clicksContext
const $clicks = toRef($clicksContext, 'current')
provide(realClicksKey, $clicksContext)
// Slidev's click ordering runs in the context the markers are rendered in, and
// that one is shifted here. So these annotations resolve and register their
// clicks themselves, from the numbers on the props.
// Slidev deliberately normalizes `v-click="0"` to click 1. Resolve an
// annotation on click 0 ourselves so it can be present before the first click.
const startsOnInitialSlide = computed(() => Number(atClick.value) === 0)
const manualClicks = computed(() => props.insert || !!outerClicksContext || startsOnInitialSlide.value)
const painted = computed(() => geometryPainted.value || showImmediately.value)
// True once the animations triggered by the current click have finished.
// Drawing is held back until then, so a mark never appears on top of a Magic
// Move step or a slide transition that is still travelling.
const settled = ref(!props.wait)
// An annotation with `until` is only shown while the thing it points at is on
// screen: past that click every stage hides again, in one step.
// `on` is the same thing derived from the resolved clicks, so the shorthand
// keeps working under `insert`, where the number given is not the click it ends
// up on.
const rangeEnd = computed(() => {
  if (props.on !== undefined) {
    const last = Math.max(resolvedClick.value, resolvedLabelClick.value)
    return Number.isFinite(last) ? last + 1 : Number.POSITIVE_INFINITY
  }
  if (props.until === undefined)
    return Number.POSITIVE_INFINITY
  const until = Number(props.until)
  if (Number.isFinite(until))
    return until
  warn(`\`until\` must be a plain click number, but got ${JSON.stringify(props.until)}. Ignoring it, so the annotation stays on screen.`)
  return Number.POSITIVE_INFINITY
})
const withinRange = computed(() => $clicks.value < rangeEnd.value)
// Expose the short exit window to the slide so content revealed by this same
// click can wait until the annotation is gone. The flag is temporary rather
// than derived directly from rangeEnd: otherwise every later reveal on the
// slide would inherit the delay too.
const fadingOut = ref(false)
/** How long the strokes' exit fade takes, mirrored into CSS as `--exit-fade`. */
const EXIT_FADE_DURATION = 280
let exitFadeTimer: ReturnType<typeof setTimeout> | undefined
watch(withinRange, (inside, wasInside) => {
  clearTimeout(exitFadeTimer)
  fadingOut.value = wasInside && !inside && geometryPainted.value
  if (fadingOut.value)
    exitFadeTimer = setTimeout(() => fadingOut.value = false, EXIT_FADE_DURATION)
})
const reached = (click: Ref<number>) => computed(() => $clicks.value >= click.value && withinRange.value && painted.value)

/**
 * Holds a stage back until everything has stopped moving, and then keeps it
 * open. Only the entrance waits: a stage that is already drawn stays drawn
 * through the next Magic Move step instead of blinking off and on again.
 */
function entrance(isReached: ComputedRef<boolean>) {
  const opened = ref(false)
  watchEffect(() => {
    if (!isReached.value)
      opened.value = false
    else if (settled.value)
      opened.value = true
  })
  return computed(() => isReached.value && opened.value)
}

const active = entrance(reached(resolvedClick))
const labelActive = entrance(reached(resolvedLabelClick))

// `insert` gives the annotation a click inside the slot's Magic Move block. The
// block keeps its own registration, but reads a click count that stands still
// on the annotation's click, so its later steps move one click along with it.
// Provided after `useSlideContext()` above, which must still see the real one.
const insertAt = computed(() => {
  const click = Number(atClick.value)
  return Number.isFinite(click) ? click : resolvedClick.value
})
if (props.insert) {
  const shifted = new Proxy($clicksContext, {
    get(target, key, receiver) {
      if (key === 'current')
        return target.current - (target.current >= insertAt.value ? 1 : 0)
      // Anything reading the shifted count needs one more real click to reach
      // its last step, so the slide is told about that click here. `delta` goes
      // with it, to keep automatic click ordering after the block in step.
      if (key === 'register') {
        return (element: unknown, info: { delta: number, max: number } | null) => {
          const shift = info && info.max >= insertAt.value ? 1 : 0
          target.register(element as never, info && {
            // An element placed by hand contributes nothing to that ordering.
            delta: info.delta ? info.delta + shift : 0,
            max: info.max + shift,
          })
        }
      }
      const value = Reflect.get(target, key, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  provide(injectionClicksContext, shallowRef(shifted))
}

// The enclosing annotation, if this one is nested inside another. Annotations
// that share a click then draw one after the other rather than all at once.
const outerSequence = injectLocal(sequenceKey, null)
// Where this annotation's reveal starts, counted from its own click. Only an
// annotation sharing the enclosing one's click waits for it: one that has a
// click of its own is already a step later, and starts straight away.
const sequenceStart = computed(() => {
  if (!props.sequential || !outerSequence)
    return 0
  return outerSequence.click.value === resolvedClick.value ? outerSequence.end.value : 0
})

// Stage lengths, as fractions of `duration`. Shared by the delay computation,
// the sequence bookkeeping and the CSS custom properties in the template, so
// the timings cannot drift apart.
const LEADER_FRACTION = 0.5
const ARROW_FRACTION = 0.2
const TARGET_FRACTION = 0.5
const LABEL_HEAD_START = 0.1
/** How long the label's opacity fade takes, mirrored into CSS as `--label-fade`. */
const LABEL_FADE_DURATION = 240

// Whether a leader line is drawn at all: it needs somewhere to go.
const connectsLine = computed(() => props.connect && (hasTarget.value || hasLabel.value))
const hasTargetStage = computed(() => hasTarget.value && targetMarkType.value !== 'none')

// A label that waits for a click of its own starts writing straight away. One
// that shares the mark's click keeps the staggered timing of a single reveal.
// A connector is deliberately three distinct stages: source mark, leader,
// target mark. An arrow belongs to the leader stage, and a same-click label
// waits until every visible stroke has landed.
const delays = computed(() => {
  const start = sequenceStart.value
  const sourceEnd = start + (sourceMarkType.value === 'none' ? 0 : props.duration)
  const leaderEnd = sourceEnd + (connectsLine.value ? props.duration * LEADER_FRACTION : 0)
  const arrowEnd = leaderEnd + (connectsLine.value && props.arrow ? props.duration * ARROW_FRACTION : 0)
  const targetEnd = arrowEnd + (hasTargetStage.value ? props.duration * TARGET_FRACTION : 0)
  return {
    mark: start,
    leader: sourceEnd,
    arrow: leaderEnd,
    target: arrowEnd,
    label: start + (resolvedLabelClick.value > resolvedClick.value
      ? props.duration * LABEL_HEAD_START
      : targetEnd - start),
  }
})

// When the last stroke that belongs to this click has landed. Read from the
// props rather than from the measured geometry, so a nested annotation knows
// where to start before anything has been drawn.
const sequenceEnd = computed(() => {
  const { duration } = props
  const stages = [sequenceStart.value]
  if (sourceMarkType.value !== 'none')
    stages.push(delays.value.mark + duration)
  if (connectsLine.value) {
    stages.push(delays.value.leader + duration * LEADER_FRACTION)
    if (props.arrow)
      stages.push(delays.value.arrow + duration * ARROW_FRACTION)
  }
  if (hasTargetStage.value)
    stages.push(delays.value.target + duration * TARGET_FRACTION)
  if (hasLabel.value && resolvedLabelClick.value <= resolvedClick.value)
    stages.push(delays.value.label + LABEL_FADE_DURATION)
  return Math.max(...stages)
})
provide(sequenceKey, { click: resolvedClick, end: sequenceEnd })

const geometry = reactive({
  width: 1440,
  height: 810,
  mark: [] as string[],
  targetMark: [] as string[],
  leader: [] as string[],
  arrow: [] as string[],
  labelLeft: 0,
  labelTop: 0,
  // Undefined leaves the label at its natural, single-line width. A width is
  // assigned only when fitting it on the slide requires wrapping.
  labelWidth: undefined as number | undefined,
  labelPlaced: false,
  ready: false,
})

// Identity of this annotation's own clicks in the slide's click count, used
// when it resolves them itself instead of leaving that to the `v-click` marker.
const ownClicks = Symbol('drawn-annotation-clicks') as unknown as HTMLElement

/** Reads a click straight off a prop, for the stages that skip the marker. */
function manualClick(value: number | string | undefined, prop: string) {
  const click = Number(value)
  if (Number.isFinite(click) && click >= 0)
    return click
  warn(`\`${prop}\` must be a non-negative plain click number on an annotation that resolves clicks itself — one on click 0, with \`insert\`, or nested inside one. Got ${JSON.stringify(value)}; falling back to click 1.`)
  return 1
}

/** The click Slidev resolved onto a marker, once its directive has run. */
function markerClick(marker: HTMLElement | undefined) {
  const click = Number(marker?.dataset.slidevClicksStart ?? Number.NaN)
  if (Number.isFinite(click))
    return click
  warn('Slidev resolved no click for this annotation, so it is never drawn. It has to be rendered on a slide for `at` to take part in click ordering.')
  return Number.POSITIVE_INFINITY
}

const generator = rough.generator()

// A stable seed keeps the wobble identical across re-measurements, so the mark
// glides with a Magic Move transition instead of re-drawing itself every frame.
const seed = computed(() => hashSeed(`${sourceMarkType.value}:${targetMarkType.value}:${props.text ?? props.selector}:${props.label ?? props.target ?? ''}`))

function hashSeed(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  // Never zero: rough.js reads a zero seed as "roll a random one", which would
  // re-randomise the wobble on every re-measurement.
  return Math.abs(hash) % 2147483646 + 1
}

// Rough Notation's exact stroke recipe, so a mark looks like Slidev's own
// `v-mark` out of the box: roughness 1.5, single strokes redrawn `iterations`
// times, except the circle's ellipse, which is the one true multi-stroke
// shape. Only the seed is ours — Rough Notation rolls a random one, but a
// stable seed is what lets the mark glide with a Magic Move transition
// instead of re-drawing itself every frame. `options` overrides any of it.
function roughOptions(variant: 'single' | 'double' = 'single'): RoughOptions {
  return {
    roughness: 1.5,
    bowing: 1,
    maxRandomnessOffset: 2,
    disableMultiStroke: variant !== 'double',
    seed: seed.value,
    ...props.options,
  }
}

function toPaths(drawable: ReturnType<typeof generator.line>) {
  return generator.toPaths(drawable).map(path => path.d)
}

function makeBox(left: number, top: number, right: number, bottom: number): Box {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  }
}

function unionBox(boxes: Box[]) {
  return makeBox(
    Math.min(...boxes.map(box => box.left)),
    Math.min(...boxes.map(box => box.top)),
    Math.max(...boxes.map(box => box.right)),
    Math.max(...boxes.map(box => box.bottom)),
  )
}

/**
 * A Range reports one client rect for each rendered inline fragment. Shiki
 * makes those fragments syntax-token spans, so one continuous selected line
 * such as `package org.jetbrains.example` commonly has several rects. Combine
 * only fragments from this one range that share a visual line; separate lines
 * stay separate for the `multiline` option.
 */
function mergeVisualLineBoxes(boxes: Box[]): Box[] {
  const lines: Box[] = []
  const sorted = [...boxes].sort((a, b) => a.cy - b.cy || a.left - b.left)

  for (const box of sorted) {
    const line = lines.find((candidate) => {
      // Text in one line can have slightly different bounds for, for example,
      // superscripted or differently-sized inline text. A quarter of the
      // smaller fragment's height accepts that while keeping adjacent lines
      // distinct, even when their line boxes touch.
      const tolerance = Math.max(1, Math.min(candidate.height, box.height) / 4)
      return Math.abs(candidate.cy - box.cy) <= tolerance
    })
    if (line)
      Object.assign(line, unionBox([line, box]))
    else
      lines.push(box)
  }

  return lines
}

function padBox(box: Box, padding: number) {
  return makeBox(box.left - padding, box.top - padding, box.right + padding, box.bottom + padding)
}

/**
 * Finds the requested occurrence of `needle` across the slot's text nodes. Text
 * inside a code block is split over one span per token, so the match regularly
 * starts and ends in different nodes. The number of matches is reported either
 * way, so a miss can be explained rather than silently swallowed.
 */
function textRange(root: HTMLElement, needle: string, occurrence: number): { range?: Range, matches: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement
      // Skip our own overlay, and the snapshot Magic Move is animating out, so
      // a match is never made against text that is on its way off the slide.
      if (!parent || parent.closest('svg, .annotation-ignore, .shiki-magic-move-leave, .shiki-magic-move-leave-to'))
        return NodeFilter.FILTER_REJECT
      if (node.nodeType === Node.ELEMENT_NODE)
        return (node as HTMLElement).tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      return NodeFilter.FILTER_ACCEPT
    },
  })

  // Magic Move renders line breaks as <br> instead of newline characters, so
  // they are folded back into the searched text to keep line-aware matches
  // working in both kinds of code block.
  const segments: { node?: Text, text: string }[] = []
  let value = ''
  let node: Node | null
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    const segment = node.nodeType === Node.TEXT_NODE
      ? { node: node as Text, text: (node as Text).data }
      : { text: '\n' }
    segments.push(segment)
    value += segment.text
  }

  const starts: number[] = []
  for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + 1))
    starts.push(index)
  const start = starts[Math.max(1, occurrence) - 1]
  if (start === undefined)
    return { matches: starts.length }

  const end = start + needle.length
  let offset = 0
  let startNode: Text | undefined
  let endNode: Text | undefined
  let startOffset = 0
  let endOffset = 0
  for (const segment of segments) {
    const next = offset + segment.text.length
    if (segment.node) {
      if (!startNode && start >= offset && start < next) {
        startNode = segment.node
        startOffset = start - offset
      }
      if (startNode && end > offset && end <= next) {
        endNode = segment.node
        endOffset = end - offset
        break
      }
      // A match that ends on a line break ends inside a <br>, which cannot hold
      // a range boundary. Trail the last real node the match covered instead.
      if (startNode && end > next) {
        endNode = segment.node
        endOffset = segment.text.length
      }
    }
    offset = next
  }
  if (!startNode || !endNode)
    return { matches: starts.length }

  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return { range, matches: starts.length }
}

function slideRoot() {
  return overlay.value?.closest<HTMLElement>('.slidev-layout') ?? overlay.value?.parentElement ?? undefined
}

let resizeObserver: ResizeObserver | undefined
let mutationObserver: MutationObserver | undefined
let frame = 0
let paintFrame = 0
let trackFrame = 0
let trackUntil = 0
let mounted = false
// The images whose load re-measures geometry, kept so unmount removes exactly
// the listeners that were added.
const watchedImages: HTMLImageElement[] = []
// Each wait gets an identity so a completion from the previous click cannot
// release the next one. The Web Animations API covers CSS transitions, CSS
// animations and Magic Move's generated animations with the same `finished`
// promise, including their real delay and duration.
let settleRun = 0

function relevantAnimations() {
  const root = container.value
  if (!root?.getAnimations)
    return []
  return root.getAnimations({ subtree: true }).filter((animation) => {
    if (animation.playState !== 'running' && !animation.pending)
      return false
    const target = (animation.effect as KeyframeEffect | null)?.target
    // Pseudo-element and infinite animations cannot describe geometry we can
    // measure to begin with. Most importantly, never wait for our own strokes:
    // they only start after `settled` opens the annotation.
    return target instanceof Element
      && !target.closest('.annotation-ignore')
      && Number.isFinite(animation.effect?.getComputedTiming().endTime)
  })
}

function nextFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
}

/**
 * Release the entrance when the animations that actually started for this
 * click finish. Re-check after each batch because Magic Move can create the
 * next transition while completing the previous one. A final frame lets the
 * browser commit the finished layout before it is measured for drawing.
 */
async function settleAfterAnimations(run: number) {
  await nextTick()
  await nextFrame()
  while (mounted && run === settleRun) {
    const animations = relevantAnimations()
    if (!animations.length) {
      await nextFrame()
      if (mounted && run === settleRun && !relevantAnimations().length) {
        updateGeometry()
        settled.value = true
      }
      return
    }
    await Promise.allSettled(animations.map(animation => animation.finished))
    await nextFrame()
  }
}

/**
 * Marks the annotation as moving again and keeps measuring until it stops.
 * Called on every click, because that is what starts a Magic Move step.
 */
function unsettle() {
  const run = ++settleRun
  if (!props.wait || !props.track) {
    settled.value = true
    return
  }
  settled.value = false
  track(0)
  void settleAfterAnimations(run)
}

function scheduleUpdate() {
  // Late asynchronous callers — a font that finishes loading, an image that
  // decodes — must not schedule work on an annotation that is already gone.
  if (!mounted)
    return
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(updateGeometry)
}

/**
 * Keeps re-measuring while an animation moves the annotated content. The
 * animation's `finished` promise controls the entrance; this loop only keeps
 * the geometry attached to the moving element until then.
 */
// A plain click has no moving geometry. Keep a short tracking window for Vue to
// apply that click, while mutations from Magic Move retain the longer window.
const CLICK_TRACK_DURATION = 120

function track(duration = 700) {
  if (!props.track)
    return
  trackUntil = Math.max(trackUntil, performance.now() + duration)
  if (trackFrame)
    return
  const step = () => {
    updateGeometry()
    if (mounted && (performance.now() < trackUntil || !settled.value)) {
      trackFrame = requestAnimationFrame(step)
    }
    else {
      trackFrame = 0
      // One last pass once everything has settled.
      scheduleUpdate()
    }
  }
  trackFrame = requestAnimationFrame(step)
}

// Whether the annotated element or text has been seen at least once. An
// annotation whose text belongs to one Magic Move step legitimately spends the
// other steps unmatched, so only a match that never existed is worth a warning.
let everFound = false

// A missing element only counts as an authoring mistake once the annotation's
// click has been reached and the slide has stopped moving; before that, it may
// simply not have arrived yet.
const missingIsAnError = computed(() =>
  settled.value && $clicks.value >= resolvedClick.value && withinRange.value)

/** Explains why nothing was drawn, once something should have been. */
function explainMissing(match?: { range?: Range, matches: number }) {
  if (everFound || !missingIsAnError.value)
    return
  if (!props.text)
    warn(`Selector "${props.selector}" matched nothing inside the slot. Put the attribute on the element to annotate, or use \`text\` to mark code.`)
  else if (!match || match.matches === 0)
    warn(`Text "${props.text}" was not found in the slot. It has to match the rendered text exactly — and inside a Magic Move block, be part of the step the annotation is drawn on.`)
  else if (match.matches < Math.max(1, props.occurrence))
    warn(`Text "${props.text}" ${match.matches === 1 ? 'matches only once' : `matches only ${match.matches} times`}, but \`occurrence\` asks for match ${props.occurrence}.`)
  else
    warn(`Text "${props.text}" was found, but has no size on screen right now, so there is nothing to draw around.`)
}

function updateGeometry() {
  const root = container.value
  const svg = overlay.value
  if (!root || !svg)
    return

  // Freeze the final on-screen geometry during the exit. The click that ends
  // this annotation may simultaneously unhide new v-click content; measuring
  // that content as a fresh obstacle would make the label or leader jump just
  // before it starts fading.
  if (fadingOut.value)
    return

  const overlayBox = svg.getBoundingClientRect()
  const width = svg.clientWidth
  const height = svg.clientHeight
  if (!overlayBox.width || !overlayBox.height || !width || !height)
    return

  // DOMRects carry Slidev's presentation scale. Convert them back into the
  // slide's own coordinate system so strokes and offsets scale with the slide.
  const scaleX = width / overlayBox.width
  const scaleY = height / overlayBox.height
  const toLocal = (rect: DOMRect): Box => makeBox(
    (rect.left - overlayBox.left) * scaleX,
    (rect.top - overlayBox.top) * scaleY,
    (rect.right - overlayBox.left) * scaleX,
    (rect.bottom - overlayBox.top) * scaleY,
  )

  const match = props.text ? textRange(root, props.text, props.occurrence) : undefined
  const source = props.text ? undefined : root.querySelector<HTMLElement>(props.selector)
  const rects = match?.range
    ? Array.from(match.range.getClientRects()).filter(rect => rect.width > 0.5 && rect.height > 0.5)
    : source
      ? [source.getBoundingClientRect()]
      : []

  if (!rects.length) {
    // The text is not on the slide right now — a Magic Move step that does not
    // contain it, for instance. While the annotation still belongs to the
    // current click, leave it out rather than guessing. Once its range has
    // ended, however, retain the last geometry long enough for the strokes to
    // fade; clearing it here would remove the SVG paths in a single frame.
    if (withinRange.value)
      geometry.ready = false
    explainMissing(match)
    return
  }
  everFound = true

  // A text Range is frequently fragmented by Shiki token spans. Treat only
  // fragments of this requested range on the same visual line as one box before
  // `multiline` decides whether to draw one shape per line or one around the
  // complete match. Selector annotations keep their element's single box.
  const rawBoxes = rects.map(toLocal)
  const boxes = match?.range ? mergeVisualLineBoxes(rawBoxes) : rawBoxes
  const marked = unionBox(boxes)
  const multiline = props.multiline ?? (sourceMarkType.value === 'underline' || sourceMarkType.value === 'strike-through')
  const shapeBoxes = multiline ? boxes : [marked]

  geometry.width = width
  geometry.height = height
  geometry.mark = shapeBoxes.flatMap(box => markPaths(box, sourceMarkType.value))

  paintDestination(root, toLocal, marked, width, height)

  const firstMeasurement = !geometry.ready
  geometry.ready = true
  if (firstMeasurement) {
    // Hold the active class back until the freshly inserted paths have been
    // painted once in their hidden state, otherwise opening a URL that already
    // carries ?clicks=N shows them without an entrance animation.
    nextTick(() => {
      if (mounted)
        paintFrame = requestAnimationFrame(() => geometryPainted.value = true)
    })
  }
}

// The shapes mirror Rough Notation's renderer: lines and boxes are redrawn
// `iterations` times, lines alternating direction, and a circle is one
// multi-stroke ellipse per pair of iterations, sized to the padded box.
function markPaths(box: Box, type: MarkType, padding = props.padding): string[] {
  const iterations = Math.max(1, Math.round(props.iterations))
  const paths: string[] = []
  switch (type) {
    case 'none':
      return []
    case 'underline':
    case 'strike-through': {
      const y = type === 'underline' ? box.bottom + padding : box.cy
      for (let i = 0; i < iterations; i++) {
        paths.push(...toPaths(i % 2
          ? generator.line(box.right, y, box.left, y, roughOptions())
          : generator.line(box.left, y, box.right, y, roughOptions())))
      }
      return paths
    }
    case 'box': {
      const outer = padBox(box, padding)
      for (let i = 0; i < iterations; i++)
        paths.push(...toPaths(generator.rectangle(outer.left, outer.top, outer.width, outer.height, roughOptions())))
      return paths
    }
    case 'circle':
    default: {
      const outer = padBox(box, padding)
      const doubles = Math.floor(iterations / 2)
      for (let i = 0; i < doubles; i++)
        paths.push(...toPaths(generator.ellipse(outer.cx, outer.cy, outer.width, outer.height, roughOptions('double'))))
      for (let i = 0; i < iterations - doubles * 2; i++)
        paths.push(...toPaths(generator.ellipse(outer.cx, outer.cy, outer.width, outer.height, roughOptions())))
      return paths
    }
  }
}

/** Draws the leader and positions the label. */
function paintDestination(
  root: HTMLElement,
  toLocal: (rect: DOMRect) => Box,
  marked: Box,
  width: number,
  height: number,
) {
  geometry.leader = []
  geometry.arrow = []
  geometry.targetMark = []

  const markBox = padBox(marked, sourceMarkType.value === 'none' ? 4 : props.padding + 6)
  const targetEl = props.target ? (root.querySelector<HTMLElement>(props.target) ?? document.querySelector<HTMLElement>(props.target)) : undefined
  if (props.target && !targetEl && missingIsAnError.value)
    warn(`Target "${props.target}" matched nothing on the slide, so there is no element to connect to.`)
  const targetBox = targetEl ? toLocal(targetEl.getBoundingClientRect()) : undefined

  let destination: Box | undefined
  let endPoint: { x: number, y: number } | undefined

  if (targetBox) {
    const x = targetBox.left + targetBox.width * props.targetX / 100
    const y = targetBox.top + targetBox.height * props.targetY / 100
    const radius = Math.max(6, targetBox.width * props.targetRadius / 100)
    destination = makeBox(x - radius, y - radius, x + radius, y + radius)
    endPoint = { x, y }
    // The target is its own stage after the connection. A zero padding keeps
    // target-radius the exact outer size authors position over screenshots.
    geometry.targetMark = markPaths(destination, targetMarkType.value, 0)
  }

  if (hasLabel.value) {
    // Start with the label's natural width, which is a single line. Only give
    // it a maximum width when that line cannot stay on the slide or cannot be
    // placed clear of the slide's content.
    const label = fitLabel(root, toLocal, destination ?? markBox, width, height)
    geometry.labelLeft = label.box.cx
    geometry.labelTop = label.box.cy
    geometry.labelWidth = label.width
    geometry.labelPlaced = true
    if (!destination) {
      destination = label.box
      endPoint = undefined
    }
  }
  else {
    geometry.labelPlaced = false
  }

  if (!destination || !props.connect)
    return

  const route = routeLeader(root, toLocal, markBox, destination, endPoint)
  if (!route)
    return
  const { start, end, c1x, c1y, c2x, c2y } = route
  geometry.leader = toPaths(generator.path(
    `M ${start.x} ${start.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${end.x} ${end.y}`,
    roughOptions(),
  ))

  if (props.arrow) {
    // Aim the head along the tangent of the curve, not along the chord.
    const angle = Math.atan2(end.y - c2y, end.x - c2x)
    const size = 16 + props.strokeWidth * 2
    const wing = (spread: number) => [
      end.x - Math.cos(angle + spread) * size,
      end.y - Math.sin(angle + spread) * size,
    ] as [number, number]
    geometry.arrow = [
      ...toPaths(generator.linearPath([wing(0.42), [end.x, end.y]], roughOptions())),
      ...toPaths(generator.linearPath([wing(-0.42), [end.x, end.y]], roughOptions())),
    ]
  }
}

interface Point { x: number, y: number }

function unitVector(x: number, y: number): Point | undefined {
  const length = Math.hypot(x, y)
  return length > 0.001 ? { x: x / length, y: y / length } : undefined
}

// The bow of a leader is capped in slide pixels: proportional to length alone,
// a long leader turns into a swooping gesture instead of a connection.
const LEADER_MAX_BOW = 40

/**
 * The leader's bezier between two points. `out` is the direction the line
 * leaves the mark and `into` the direction it arrives at its destination; the
 * curve turns smoothly from one to the other, and `side` adds a gentle bow.
 * The arrival tangent stays aimed at the destination — that is what makes the
 * line read as pointing at the label rather than curling flat and sweeping
 * past it.
 */
function leaderCurve(start: Point, end: Point, side: 1 | -1, out?: Point, into?: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy)
  const along = unitVector(dx, dy) ?? { x: 1, y: 0 }
  const bend = Math.min(distance * props.curve, LEADER_MAX_BOW) * side
  const perpX = -along.y * bend
  const perpY = along.x * bend
  const reach = distance * 0.38
  const outDir = out ?? along
  const inDir = into ?? along
  return {
    start,
    end,
    distance,
    c1x: start.x + outDir.x * reach + perpX,
    c1y: start.y + outDir.y * reach + perpY,
    // Most of the bow sits near the exit; the arrival keeps pointing where it
    // is going, so the line lands on the label instead of flattening out.
    c2x: end.x - inDir.x * reach + perpX * 0.35,
    c2y: end.y - inDir.y * reach + perpY * 0.35,
  }
}

type Curve = ReturnType<typeof leaderCurve>

/**
 * How much of the curve runs through the given boxes, and how much ink it
 * spends overall, both in slide pixels and both sampled from the same points.
 * The arc length is what prices a detour: a route that dodges text is only
 * worth taking when it saves more crossing than the extra line it draws.
 */
function measureCurve(curve: Curve, obstacles: Box[]) {
  const samples = 24
  let inside = 0
  let length = 0
  let px = 0
  let py = 0
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const u = 1 - t
    const x = u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.c1x + 3 * u * t ** 2 * curve.c2x + t ** 3 * curve.end.x
    const y = u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.c1y + 3 * u * t ** 2 * curve.c2y + t ** 3 * curve.end.y
    if (obstacles.some(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom))
      inside++
    if (i)
      length += Math.hypot(x - px, y - py)
    px = x
    py = y
  }
  return { crossing: inside / (samples + 1) * curve.distance, length }
}

/**
 * Chooses where the leader leaves the mark and which way it bows. The obvious
 * straight exit towards the destination regularly runs through the rest of the
 * sentence the mark sits in, which reads as a strike-through of text the
 * annotation has nothing to do with. So candidate exits along the mark's
 * border are tried, bowing to either side, against the rendered text of the
 * slide — with the extra ink of a detour priced in, so a route that dodges
 * text is only chosen when it saves more crossing than the line it adds. The
 * straight exit is also only given up when another exit saves a substantial
 * amount of crossing: brushing past a neighbouring line is part of the
 * hand-drawn look, and a leader that trades it for a wide swing reads as
 * starting from the wrong place.
 */
function routeLeader(root: HTMLElement, toLocal: (rect: DOMRect) => Box, markBox: Box, destination: Box, endPoint?: Point): Curve | undefined {
  const contains = (box: Box, x: number, y: number) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
  // Only text near the line's own neighbourhood matters, and never the words
  // being marked or the destination itself.
  const region = padBox(unionBox([markBox, destination]), 120)
  const obstacles = collectTextObstacles(root, toLocal).filter(box =>
    overlapArea(box, region) > 0
    && !contains(markBox, box.cx, box.cy)
    && !contains(destination, box.cx, box.cy))

  const defaultStart = edgePoint(markBox, destination.cx, destination.cy)
  const exits: Point[] = [
    { x: markBox.cx, y: markBox.top },
    { x: markBox.cx, y: markBox.bottom },
    { x: markBox.left, y: markBox.cy },
    { x: markBox.right, y: markBox.cy },
    { x: markBox.left, y: markBox.top },
    { x: markBox.right, y: markBox.top },
    { x: markBox.left, y: markBox.bottom },
    { x: markBox.right, y: markBox.bottom },
  ].sort((a, b) =>
    Math.hypot(a.x - defaultStart.x, a.y - defaultStart.y)
    - Math.hypot(b.x - defaultStart.x, b.y - defaultStart.y))

  // Where a route from `start` ends, and the direction it arrives in. A target
  // is met at the given point; a label is met at its nearest edge — a drawn
  // leader stops at the edge of the words it points at, it does not travel on
  // towards their centre.
  const endFor = (start: Point) => {
    if (endPoint) {
      const end = backOff(endPoint, start, targetMarkType.value !== 'none' ? destination.width / 2 : 6)
      return { end, into: unitVector(endPoint.x - end.x, endPoint.y - end.y) }
    }
    const nearest = {
      x: clamp(start.x, destination.left, destination.right),
      y: clamp(start.y, destination.top, destination.bottom),
    }
    const into = unitVector(nearest.x - start.x, nearest.y - start.y)
    const end = into ? { x: nearest.x - into.x * 6, y: nearest.y - into.y * 6 } : nearest
    return { end, into }
  }

  let straight: { curve: Curve, crossing: number, cost: number } | undefined
  let best: { curve: Curve, crossing: number, cost: number } | undefined
  // What the shortest reasonable route spends; anything beyond it is detour.
  const defaultEnd = endFor(defaultStart).end
  const directLength = Math.hypot(defaultEnd.x - defaultStart.x, defaultEnd.y - defaultStart.y)
  for (const [index, start] of [defaultStart, ...exits].entries()) {
    const { end, into: arrival } = endFor(start)
    const chord = unitVector(end.x - start.x, end.y - start.y)
    if (!chord)
      continue
    // Leave the mark outward through the chosen exit, leaning toward the
    // destination so the curve can never double back around the mark, and
    // arrive pointing into the destination.
    const outward = unitVector(start.x - markBox.cx, start.y - markBox.cy) ?? chord
    const out = unitVector(outward.x + chord.x, outward.y + chord.y) ?? chord
    const into = arrival ?? chord
    for (const side of [1, -1] as const) {
      const curve = leaderCurve(start, end, side, out, into)
      if (curve.distance < 4)
        continue
      // Crossing text costs its length, a detour costs part of the extra ink
      // it spends; the small terms only break ties.
      const { crossing, length } = measureCurve(curve, obstacles)
      const detour = Math.max(0, length - directLength)
      const cost = crossing + detour * 0.4 + index * 2 + (side < 0 ? 1 : 0)
      if (index === 0 && (!straight || cost < straight.cost))
        straight = { curve, crossing, cost }
      if (!best || cost < best.cost)
        best = { curve, crossing, cost }
    }
  }
  if (!straight)
    return best?.curve
  if (best && best.crossing < straight.crossing * 0.5 && straight.crossing - best.crossing > 24)
    return best.curve
  return straight.curve
}

// Elements considered while measuring obstacles, capped: the collectors run on
// animation frames while the slide moves, and a slide with more elements than
// this has no room for an automatic label anyway.
const OBSTACLE_ELEMENT_CAP = 600
const MEDIA_TAGS = ['IMG', 'VIDEO', 'CANVAS', 'SVG']

function isMedia(element: HTMLElement) {
  return MEDIA_TAGS.includes(element.tagName.toUpperCase())
}

/**
 * The slide elements obstacle collection looks at. Excludes this component's
 * own strokes and labels, content still hidden behind a later click, and the
 * internals of inline SVGs — parts of an illustration do not count on their
 * own; the whole graphic does.
 */
function obstacleCandidates(slide: HTMLElement): HTMLElement[] {
  return Array.from(slide.querySelectorAll<HTMLElement>('*'))
    .slice(0, OBSTACLE_ELEMENT_CAP)
    .filter(element => !element.closest('.annotation-ignore, .slidev-vclick-hidden')
      && !element.parentElement?.closest('svg'))
}

/**
 * The slide's text and media, as the tight boxes of the rendered lines rather
 * than the elements around them. This is what a leader line must not strike
 * through: crossing a card's padding looks deliberate, crossing its words
 * reads as marking text the annotation has nothing to do with.
 */
function collectTextObstacles(root: HTMLElement, toLocal: (rect: DOMRect) => Box): Box[] {
  const slide = slideRoot() ?? root
  const boxes: Box[] = []
  for (const element of obstacleCandidates(slide)) {
    if (isMedia(element)) {
      const rect = element.getBoundingClientRect()
      if (rect.width >= 6 && rect.height >= 6)
        boxes.push(toLocal(rect))
      continue
    }
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue?.trim())
        continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width >= 4 && rect.height >= 4)
          boxes.push(toLocal(rect))
      }
    }
  }
  // The marks and labels of the other annotations on the slide. A leader that
  // dives through a circled word or a written label reads as marking it. Their
  // paths are in the DOM from the first measurement — merely hidden until
  // their click — so routing around them is stable rather than a jump on the
  // click that reveals them.
  for (const svg of Array.from(slide.querySelectorAll<SVGSVGElement>('svg.annotation-overlay'))) {
    if (svg === overlay.value)
      continue
    for (const path of Array.from(svg.querySelectorAll<SVGPathElement>('.annotation-mark, .annotation-target'))) {
      const rect = path.getBoundingClientRect()
      if (rect.width >= 4 || rect.height >= 4)
        boxes.push(toLocal(rect))
    }
  }
  for (const label of Array.from(slide.querySelectorAll<HTMLElement>('.annotation-label.is-placed'))) {
    if (label === labelEl.value)
      continue
    const rect = label.getBoundingClientRect()
    if (rect.width >= 6 && rect.height >= 6)
      boxes.push(toLocal(rect))
  }
  return boxes
}

// Stands in for a label that cannot be measured yet, so placement still has a
// plausible box to work with on the very first frame.
const FALLBACK_LABEL_HEIGHT = 40

// The label never sits closer to a slide edge than this, in slide pixels.
const SLIDE_MARGIN = 24

// Sideways nudges tried for each gap while placing the label, nearest first.
const LATERAL_OFFSETS = (() => {
  const offsets = [0]
  for (let step = 40; step <= 400; step += 40)
    offsets.push(step, -step)
  return offsets
})()

function measureLabel(toLocal: (rect: DOMRect) => Box, maxWidth?: number) {
  const label = labelEl.value
  if (!label)
    return { width: maxWidth ?? 0, height: FALLBACK_LABEL_HEIGHT }

  // Measuring each candidate directly lets placement try a single line first
  // without committing that temporary width to the rendered label.
  const previousMaxWidth = label.style.maxWidth
  if (maxWidth === undefined)
    label.style.removeProperty('max-width')
  else
    label.style.maxWidth = `${maxWidth}px`
  const rect = label.getBoundingClientRect()
  label.style.maxWidth = previousMaxWidth

  if (!rect.width)
    return { width: maxWidth ?? 0, height: FALLBACK_LABEL_HEIGHT }
  const box = toLocal(rect)
  return { width: box.width, height: box.height }
}

/**
 * Finds the widest label that can stay inside the slide and clear its
 * obstacles. The unbounded measurement is always tried first, so ordinary
 * labels remain a single, readable line instead of inheriting an arbitrary
 * short line length.
 */
function fitLabel(
  root: HTMLElement,
  toLocal: (rect: DOMRect) => Box,
  anchor: Box,
  width: number,
  height: number,
): { box: Box, width: number | undefined } {
  const natural = measureLabel(toLocal)
  const unwrapped = placeLabel(root, toLocal, anchor, natural, width, height)
  const fitsSlide = natural.width <= width - SLIDE_MARGIN * 2 && natural.height <= height - SLIDE_MARGIN * 2
  const respectsExplicitMaximum = props.labelWidth === undefined || natural.width <= props.labelWidth

  if (fitsSlide && unwrapped.overlap === 0 && respectsExplicitMaximum)
    return { box: unwrapped.box, width: undefined }

  // An explicit `label-width` remains a useful author override. Without one,
  // the slide edges are the only width limit.
  const maximum = Math.min(natural.width, props.labelWidth ?? natural.width, width - SLIDE_MARGIN * 2)
  const minimum = Math.min(maximum, 160)
  let best: { box: Box, width: number, overlap: number } | undefined

  // Work from wide to narrow: the first collision-free result has the fewest
  // line breaks. A modest step keeps the search cheap while the slide tracks
  // Magic Move animations.
  for (let cap = maximum; cap >= minimum; cap -= 48) {
    const size = measureLabel(toLocal, cap)
    const placed = placeLabel(root, toLocal, anchor, size, width, height)
    if (placed.overlap === 0)
      return { box: placed.box, width: cap }
    if (!best || placed.overlap < best.overlap)
      best = { box: placed.box, width: cap, overlap: placed.overlap }
  }

  // Include the lower bound when the step above did not land on it.
  if (!best || best.width !== minimum) {
    const size = measureLabel(toLocal, minimum)
    const placed = placeLabel(root, toLocal, anchor, size, width, height)
    if (placed.overlap === 0)
      return { box: placed.box, width: minimum }
    if (!best || placed.overlap < best.overlap)
      best = { box: placed.box, width: minimum, overlap: placed.overlap }
  }

  return best ? { box: best.box, width: best.width } : { box: unwrapped.box, width: undefined }
}

function placeLabel(
  root: HTMLElement,
  toLocal: (rect: DOMRect) => Box,
  anchor: Box,
  size: { width: number, height: number },
  width: number,
  height: number,
): { box: Box, overlap: number } {
  const halfW = size.width / 2
  const halfH = size.height / 2
  const centred = (cx: number, cy: number) => makeBox(cx - halfW, cy - halfH, cx + halfW, cy + halfH)

  if (props.labelX !== undefined || props.labelY !== undefined) {
    return {
      box: centred(
        props.labelX !== undefined ? width * props.labelX / 100 : anchor.cx,
        props.labelY !== undefined ? height * props.labelY / 100 : anchor.cy,
      ),
      overlap: 0,
    }
  }

  // Obstacles are inflated so the label breathes: a label that ends up flush
  // against the bottom of a code block reads as part of it.
  const obstacles = collectObstacles(root, toLocal)
    .map(box => padBox(box, props.clearance))
    .concat(padBox(anchor, 8))
  const placement = resolvedPlacement.value
  const preferred = placement === 'auto'
    ? (anchor.cy < height / 2 ? 'down' : 'up')
    : placement
  const directions = placement === 'auto'
    ? [preferred, preferred === 'down' ? 'up' : 'down', 'right', 'left'] as const
    : [preferred] as const

  let best: { box: Box, overlap: number, score: number } | undefined

  for (const [order, direction] of directions.entries()) {
    for (let gap = props.gap; gap <= props.gap + 260; gap += 20) {
      for (const lateral of LATERAL_OFFSETS) {
        const vertical = direction === 'up' || direction === 'down'
        const cx = vertical
          ? anchor.cx + lateral
          : direction === 'right' ? anchor.right + gap + halfW : anchor.left - gap - halfW
        const cy = vertical
          ? (direction === 'down' ? anchor.bottom + gap + halfH : anchor.top - gap - halfH)
          : anchor.cy + lateral

        const box = centred(
          clamp(cx, SLIDE_MARGIN + halfW, width - SLIDE_MARGIN - halfW),
          clamp(cy, SLIDE_MARGIN + halfH, height - SLIDE_MARGIN - halfH),
        )
        const overlap = obstacles.reduce((total, obstacle) => total + overlapArea(box, obstacle), 0)
        const score = overlap * 6 + gap + Math.abs(lateral) * 0.6 + order * 400
        // A clear spot always beats an overlapping one, and among clear spots
        // the best-scoring one wins: taking the first found would let a small
        // gap with a long drift along the mark beat a slightly larger gap that
        // stays level with it, which reads as belonging to something else.
        const better = !best
          || (overlap === 0 && best.overlap > 0)
          || ((overlap === 0) === (best.overlap === 0) && score < best.score)
        if (better)
          best = { box, overlap, score }
      }
    }
  }

  // The loops above always run at least once, so `best` is always set; the
  // fallback only satisfies the types.
  return best ?? { box: centred(anchor.cx, anchor.cy), overlap: Number.POSITIVE_INFINITY }
}

/**
 * Everything the label has to stay clear of: every rendered text fragment and
 * image on the slide, plus whole boxes for content whose padding also matters
 * and anything the slide opted in through `avoid-selector`. Text nodes must be
 * measured directly: prose such as `before <b>marked</b> after` belongs to a
 * non-leaf element, so collecting only leaf elements loses both surrounding
 * fragments and lets a label land on top of them.
 * `.card` and `.kodee-character` are the Kotlin theme's callouts and mascot.
 */
const BLOCK_OBSTACLES = 'pre, .slidev-code, .slidev-code-wrapper, .card, table, blockquote, .kodee-character'

function collectObstacles(root: HTMLElement, toLocal: (rect: DOMRect) => Box): Box[] {
  const slide = slideRoot() ?? root
  const boxes: Box[] = []
  for (const element of obstacleCandidates(slide)) {
    // Blocks are added whole, so a label never lands in the padding of a code
    // block or a card, which their text fragments alone would leave free.
    if (element.matches(BLOCK_OBSTACLES) || isMedia(element)) {
      const rect = element.getBoundingClientRect()
      if (rect.width >= 6 && rect.height >= 6)
        boxes.push(toLocal(rect))
    }

    // Read direct text nodes from every element rather than only using leaf
    // element boxes. A list item commonly contains both plain text and a <b>
    // target; its plain text otherwise disappears from the obstacle map.
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue?.trim())
        continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width >= 4 && rect.height >= 4)
          boxes.push(toLocal(rect))
      }
    }
  }
  if (props.avoidSelector) {
    for (const element of Array.from(slide.querySelectorAll<HTMLElement>(props.avoidSelector)))
      boxes.push(toLocal(element.getBoundingClientRect()))
  }
  // The labels other annotations have already written. Only the ones from an
  // earlier click count — a later label avoids an earlier one, never the other
  // way round — so two labels can never chase each other across the slide.
  const ourLabel = labelEl.value
  for (const other of Array.from(slide.querySelectorAll<HTMLElement>('.annotation-label.is-placed'))) {
    if (other === ourLabel)
      continue
    const click = Number(other.dataset.click ?? Number.NaN)
    if (!Number.isFinite(click))
      continue
    const ours = resolvedLabelClick.value
    const earlier = click < ours
      || (click === ours && !!ourLabel && !!(other.compareDocumentPosition(ourLabel) & Node.DOCUMENT_POSITION_FOLLOWING))
    if (!earlier)
      continue
    const rect = other.getBoundingClientRect()
    if (rect.width >= 6 && rect.height >= 6)
      boxes.push(toLocal(rect))
  }
  return boxes
}

function overlapArea(a: Box, b: Box) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** Where a ray leaving the centre of `box` towards a point crosses its border. */
function edgePoint(box: Box, towardX: number, towardY: number, extra = 0) {
  const dx = towardX - box.cx
  const dy = towardY - box.cy
  if (!dx && !dy)
    return { x: box.cx, y: box.cy }
  const scale = Math.min(
    dx ? (box.width / 2) / Math.abs(dx) : Number.POSITIVE_INFINITY,
    dy ? (box.height / 2) / Math.abs(dy) : Number.POSITIVE_INFINITY,
  )
  const length = Math.hypot(dx, dy)
  const reach = scale + extra / length
  return { x: box.cx + dx * reach, y: box.cy + dy * reach }
}

function backOff(point: { x: number, y: number }, from: { x: number, y: number }, distance: number) {
  const dx = point.x - from.x
  const dy = point.y - from.y
  const length = Math.hypot(dx, dy) || 1
  return { x: point.x - dx / length * distance, y: point.y - dy / length * distance }
}

onMounted(async () => {
  mounted = true
  // Registered synchronously, while the clicks context still accepts it.
  if (manualClicks.value) {
    resolvedClick.value = manualClick(atClick.value, props.on !== undefined ? 'on' : 'at')
    resolvedLabelClick.value = props.labelAt === undefined
      ? resolvedClick.value
      : manualClick(props.labelAt, 'label-at')
    $clicksContext.register(ownClicks, { delta: 0, max: Math.max(resolvedClick.value, resolvedLabelClick.value) })
  }
  await nextTick()
  if (!manualClicks.value) {
    // Slidev resolves automatic click ordering in the directive and stores the
    // result on the marker. Reading it here keeps the first painted state
    // unambiguously hidden, unlike styling a v-click element directly.
    resolvedClick.value = markerClick(clickMarker.value)
    // A label without a click of its own follows the mark, rather than taking
    // the next click in the slide's automatic ordering.
    resolvedLabelClick.value = props.labelAt === undefined
      ? resolvedClick.value
      : markerClick(labelMarker.value)
  }
  // Navigating backwards remounts the slide. If this click was already reached,
  // render the final state instead of replaying the entrance animation.
  showImmediately.value = $clicks.value >= resolvedClick.value && withinRange.value
  unsettle()
  scheduleUpdate()

  resizeObserver = new ResizeObserver(scheduleUpdate)
  if (container.value)
    resizeObserver.observe(container.value)
  if (overlay.value)
    resizeObserver.observe(overlay.value)
  const source = container.value?.querySelector(props.selector)
  if (source)
    resizeObserver.observe(source)
  for (const image of Array.from(container.value?.querySelectorAll('img') ?? [])) {
    image.addEventListener('load', scheduleUpdate)
    watchedImages.push(image)
  }

  // Watch the code blocks only. Observing the whole slot would pick up our own
  // paths and spin the tracking loop forever.
  const animated = container.value?.querySelectorAll('.slidev-code, .slidev-code-magic-move, pre.shiki')
  if (animated?.length) {
    mutationObserver = new MutationObserver(() => track())
    for (const element of Array.from(animated))
      mutationObserver.observe(element, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] })
  }

  document.fonts?.ready.then(scheduleUpdate)
  window.addEventListener('resize', scheduleUpdate)
})

onBeforeUnmount(() => {
  mounted = false
  settleRun++
  clearTimeout(exitFadeTimer)
  $clicksContext.unregister(ownClicks)
  cancelAnimationFrame(frame)
  cancelAnimationFrame(paintFrame)
  cancelAnimationFrame(trackFrame)
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  for (const image of watchedImages.splice(0))
    image.removeEventListener('load', scheduleUpdate)
  window.removeEventListener('resize', scheduleUpdate)
})

// Magic Move and click transitions are driven by the click count, and both move
// the annotated element for a while after it changes.
watch($clicks, () => {
  unsettle()
  track(CLICK_TRACK_DURATION)
}, { flush: 'sync' })

// Any prop can change what is drawn or where the label may go, so re-measure
// on all of them instead of maintaining a list that can silently go stale.
watch(props, scheduleUpdate)
</script>

<template>
  <div ref="container" class="drawn-annotation" :class="{ 'is-fading-out': fadingOut }">
    <!-- The marker takes part in Slidev's click ordering while component state
         drives the drawing. This avoids a mount-time v-click class race. -->
    <span ref="clickMarker" v-click="manualClicks ? false : atClick" class="click-marker annotation-ignore" />
    <span v-if="props.labelAt !== undefined" ref="labelMarker" v-click="manualClicks ? false : props.labelAt" class="click-marker annotation-ignore" />
    <svg
      ref="overlay"
      class="annotation-overlay annotation-ignore"
      :viewBox="`0 0 ${geometry.width} ${geometry.height}`"
      preserveAspectRatio="none"
      aria-hidden="true"
      :style="{
        '--annotation-color': props.color,
        '--annotation-width': `${props.strokeWidth}px`,
        '--leader-delay': `${delays.leader}ms`,
        '--leader-duration': `${duration * LEADER_FRACTION}ms`,
        '--arrow-delay': `${delays.arrow}ms`,
        '--arrow-duration': `${duration * ARROW_FRACTION}ms`,
        '--exit-fade': `${EXIT_FADE_DURATION}ms`,
      }"
    >
      <template v-if="geometry.ready">
        <g :class="{ 'is-active': active }">
          <!-- The duration is split over the strokes and they draw one after
               another, which is Rough Notation's sketchy redraw. -->
          <path
            v-for="(d, index) in geometry.mark"
            :key="`mark-${index}`"
            class="annotation-stroke annotation-mark"
            pathLength="1"
            :style="{
              '--path-duration': `${duration / geometry.mark.length}ms`,
              '--path-delay': `${delays.mark + index * duration / geometry.mark.length}ms`,
            }"
            :d="d"
          />
          <path
            v-for="(d, index) in geometry.leader"
            :key="`leader-${index}`"
            class="annotation-stroke annotation-leader"
            pathLength="1"
            :d="d"
          />
          <path
            v-for="(d, index) in geometry.targetMark"
            :key="`target-${index}`"
            class="annotation-stroke annotation-target"
            pathLength="1"
            :style="{
              '--path-duration': `${duration * TARGET_FRACTION / geometry.targetMark.length}ms`,
              '--path-delay': `${delays.target + index * duration * TARGET_FRACTION / geometry.targetMark.length}ms`,
            }"
            :d="d"
          />
          <path
            v-for="(d, index) in geometry.arrow"
            :key="`arrow-${index}`"
            class="annotation-stroke annotation-arrow"
            pathLength="1"
            :d="d"
          />
        </g>
      </template>
    </svg>
    <div
      v-if="hasLabel"
      ref="labelEl"
      class="annotation-label annotation-ignore"
      :class="{ 'is-active': labelActive && geometry.ready, 'is-placed': geometry.labelPlaced }"
      :data-click="resolvedLabelClick"
      :style="{
        '--annotation-color': props.color,
        '--label-delay': `${delays.label}ms`,
        '--label-fade': `${LABEL_FADE_DURATION}ms`,
        'left': `${geometry.labelLeft}px`,
        'top': `${geometry.labelTop}px`,
        'maxWidth': geometry.labelWidth === undefined ? undefined : `${geometry.labelWidth}px`,
      }"
      aria-hidden="true"
    >
      {{ props.label }}
    </div>
    <slot />
    <!-- Keep the live region mounted so screen readers announce the label when
         its click is reached. The positioned copy is presentation-only. -->
    <span
      class="annotation-label-status annotation-ignore"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >{{ labelActive && geometry.ready ? props.label : '' }}</span>
  </div>
</template>

<style scoped>
/* display: contents keeps the wrapped Markdown in exactly the layout it had
   before being annotated. The absolute overlay uses the slide as its canvas. */
.drawn-annotation { display: contents; }
/* A `v-click` around an annotation lands its hidden class on this element, and
   `display: contents` generates no box for `opacity: 0` to act on, so the
   wrapped Markdown would stay on screen. `visibility` is inherited by the
   children instead, which hides them and keeps the space they take, exactly as
   Slidev hides them when no annotation is in the way. */
.drawn-annotation.slidev-vclick-hidden { visibility: hidden; }
.click-marker { position: absolute; width: 0; height: 0; overflow: hidden; }
.annotation-label-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.annotation-overlay {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.annotation-stroke {
  fill: none;
  stroke: var(--annotation-color);
  stroke-width: var(--annotation-width);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  opacity: 0;
  /* Entering durations are applied below. On exit, keep the completed path in
     place while its opacity eases away, then reset it after the fade. This is
     especially important for click-ranged annotations: an instant dash reset
     made them disappear much more harshly than the content around them.
     `--exit-fade` mirrors the EXIT_FADE_DURATION constant in the script. */
  transition:
    stroke-dashoffset 1ms linear var(--exit-fade, 280ms),
    opacity var(--exit-fade, 280ms) ease-out;
}

.is-active .annotation-mark {
  stroke-dashoffset: 0;
  opacity: 1;
  transition-duration: var(--path-duration), 1ms;
  transition-delay: var(--path-delay), var(--path-delay);
}

.is-active .annotation-leader {
  stroke-dashoffset: 0;
  opacity: 1;
  transition-duration: var(--leader-duration), 1ms;
  transition-delay: var(--leader-delay), var(--leader-delay);
}

.is-active .annotation-target {
  stroke-dashoffset: 0;
  opacity: 1;
  transition-duration: var(--path-duration), 1ms;
  transition-delay: var(--path-delay), var(--path-delay);
}

.is-active .annotation-arrow {
  stroke-dashoffset: 0;
  opacity: 1;
  transition-duration: var(--arrow-duration), 1ms;
  transition-delay: var(--arrow-delay), var(--arrow-delay);
}

.annotation-label {
  position: absolute;
  z-index: 5;
  transform: translate(-50%, -50%);
  color: var(--annotation-color);
  /* Themeable, like `--drawn-annotation-color`: a theme restyles every label
     by defining these variables, at :root or any narrower scope. */
  font-family: var(--drawn-annotation-label-font, 'JetBrains Sans', var(--slidev-font-sans), sans-serif);
  font-size: var(--drawn-annotation-label-size, 28px);
  font-weight: var(--drawn-annotation-label-weight, 800);
  line-height: 1.2;
  text-align: center;
  text-wrap: balance;
  width: max-content;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--label-fade, 240ms) ease-out;
}

/* Measured before it is placed, so keep it laid out but invisible until then. */
.annotation-label.is-placed { visibility: visible; }

.annotation-label.is-active {
  opacity: 1;
  transition-delay: var(--label-delay);
}

@media (prefers-reduced-motion: reduce) {
  .annotation-stroke,
  .annotation-label {
    transition-duration: 1ms !important;
    transition-delay: 0ms !important;
  }
}
</style>
