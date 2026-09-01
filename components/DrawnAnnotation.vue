<script lang="ts">
/**
 * Labels already placed on the current slide, in concrete-slide fractions,
 * shared by every annotation instance. Automatic placement treats the labels
 * of annotations that registered earlier (mount order, which follows document
 * order) as obstacles; an earlier label never reacts to a later one, so the
 * avoidance is deterministic and cannot oscillate.
 */
interface PlacedLabelRecord {
  order: number
  click: number
  root: HTMLElement
  box: { left: number, top: number, right: number, bottom: number }
  active: boolean
}
const placedLabelRegistry = new Map<symbol, PlacedLabelRecord>()
let nextPlacementOrder = 0
</script>

<script setup lang="ts">
import type { Options as RoughOptions } from 'roughjs/bin/core'
import type { ClicksContext } from '@slidev/types'
import type { ComputedRef, InjectionKey, Ref } from 'vue'
import { injectLocal } from '@vueuse/core'
import { useIsSlideActive, useSlideContext } from '@slidev/client'
// The explicit `.ts` extension is required: Slidev's client ships bare TypeScript
// sources, and the bundler resolves this subpath literally.
import { injectionClicksContext } from '@slidev/client/constants.ts'
import rough from 'roughjs'
import { findTextInSegments } from './code-text-match'
import type { TextSegment } from './code-text-match'
import { localLabelWidthToSlideFraction, localPointToSlideFraction, nudgeConnector, nudgeLabelWidth, slideFractionPointToLocal, translateConnector, validateDrawnAnnotationGeometry } from './drawn-annotation/geometry'
import type { DrawnAnnotationGeometry, PersistedAnnotationGeometry } from './drawn-annotation/geometry'
import { annotationDraftChange, annotationEditMode, annotationEditorStatus, annotationDrafts, annotationLabelLayoutChange, beginAnnotationDraftGesture, claimAnnotationSelection, clearAnnotationSelection, clearLabelDraft, endAnnotationDraftGesture, migrateAnnotationLocator, recordAnnotationUndo, recordAnnotationUndoOnce, registerAnnotationEditorActions, releaseAnnotationSelection, selectAnnotation, selectedAnnotationId, selectedAnnotationPart, setLabelDraft } from './drawn-annotation/editor-store'
import type { AnnotationUndoSession } from './drawn-annotation/editor-store'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, toRef, useSlots, watch, watchEffect } from 'vue'

// Slidev's build renderer can leave `import.meta.env.DEV` true. Restrict
// development-only editing to Vite's explicit serve mode so published decks
// never carry interactive controls or a browser write client.
const isAnnotationEditorDevelopment = import.meta.env.MODE === 'development'

// Do not let the optional browser writer become a production chunk. Vite
// serves this explicit TypeScript module during development; production cannot
// reach it because every caller is guarded by `isAnnotationEditorDevelopment`.
const writerClientModule = './drawn-annotation/writer-client.ts'
function loadWriterClient() {
  return import(/* @vite-ignore */ writerClientModule)
}

/**
 * Hand-drawn annotation for anything on a slide.
 *
 * It marks an element (or an exact piece of text inside it, which is the only
 * way to reach a token inside a Shiki code block) with a rough-notation style
 * circle, underline, box or strike-through, and optionally connects that mark
 * to a second element on the slide or to a text label.
 *
 * A label is placed out of the slide's normal flow: its position is searched at
 * runtime near its source — preferring downwards for marks in the upper half
 * of the slide and upwards for marks in the lower half — while staying clear
 * of the slide's laid-out content, of its own mark, of labels placed by
 * earlier annotations on the slide, and of anything matched by
 * `avoid-selector`, kept at `clearance` distance. Laid-out but still-hidden
 * v-click content counts too, so a label never sits where the slide is about
 * to grow; nothing is guessed, so placement stays deterministic.
 * Source-authored `geometry.label` gives authors the final say and is never
 * moved by obstacles.
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
  /** Source-authored normalized label and connector geometry. */
  geometry?: DrawnAnnotationGeometry
  /** Opaque, serve-only locator injected by the Vite source transform. */
  __drawnAnnotationLocator?: string
  /** Shape drawn on the source. Kept as the short form of `sourceType`. */
  type?: MarkType
  /** Shape drawn on the source. Overrides `type` when supplied. */
  sourceType?: MarkType
  /** Element to annotate, searched inside the default slot. */
  selector?: string
  /** Exact text to annotate inside the slot. Works inside Shiki and Magic Move. */
  text?: string
  /** Which occurrence of `text` to annotate, 1-based. Markdown attributes arrive as strings. */
  occurrence?: number | string
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
  /** Text label. Placed automatically unless geometry supplies a position. */
  label?: string
  /** Preferred side for automatic placement. `auto` picks by vertical position. */
  placement?: 'auto' | 'up' | 'down' | 'left' | 'right'
  /** Smallest distance between the mark and the label, in slide pixels. */
  gap?: number
  /** Space an automatically placed label keeps from its obstacles, in slide pixels. */
  clearance?: number
  /** Extra elements an automatically placed label must not cover. */
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
  sequential?: boolean | string
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
  geometry: undefined,
  __drawnAnnotationLocator: undefined,
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
  // Keep the hand-drawn stage aligned with Magic Move and page transitions.
  duration: 500,
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
// A source-only mark exposes no visual-editor operation. It remains valid:
// only labels and connectors have geometry that an editor can manipulate.
const editorRelevant = computed(() => hasLabel.value || (props.connect && hasTarget.value))

if (props.on !== undefined && (props.at !== undefined || props.until !== undefined))
  warn('`on` is `at` and `until` in one, so the separate `at` / `until` given here are ignored. Use either `on` alone, or `at` and `until`.')
if (props.labelAt !== undefined && props.label === undefined)
  warn('`label-at` names the click that writes the label, but no `label` was given.')

const container = ref<HTMLElement>()
const clickMarker = ref<HTMLElement>()
const labelMarker = ref<HTMLElement>()
const overlay = ref<SVGSVGElement>()
const labelEl = ref<HTMLElement>()

// Wrapped annotations only search their own slot. A self-closing annotation
// intentionally searches the remaining slide so it can point at following
// Markdown without adding a wrapper around it.
const slots = useSlots()
function searchRoot() {
  const root = container.value
  if (slots.default || !root)
    return root
  return root.closest<HTMLElement>('.slidev-layout') ?? root.parentElement ?? root
}
const searchScope = () => slots.default ? 'the slot' : 'the content below this annotation on the slide'
// The self-closing search root is the whole layout, so occurrence counting and
// selector matches are narrowed here to what actually follows the tag —
// content above it (a slide title, say) is outside the promised scope.
function followsAnnotation(node: Node) {
  const anchor = container.value
  if (slots.default || !anchor)
    return true
  return !!(anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) && !anchor.contains(node)
}

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
const slideContext = useSlideContext()
const $clicksContext = outerClicksContext ?? slideContext.$clicksContext
const $clicks = toRef($clicksContext, 'current')
// Slidev mounts the previous and next slides ahead of time. An annotation on
// one of those hidden slides must not paint before that slide becomes current,
// otherwise the view-transition snapshot captures the finished mark.
const isCurrentSlide = useIsSlideActive()
provide(realClicksKey, $clicksContext)
// An annotation without `at` or `on` belongs to the slide's initial state.
// It must not render a bare `v-click` marker: Slidev treats that as the next
// automatic click, adding a reveal the author did not ask for.
const hasExplicitStartClick = computed(() => props.at !== undefined || props.on !== undefined)
// Slidev's click ordering runs in the context the markers are rendered in, and
// that one is shifted here. So these annotations resolve and register their
// clicks themselves, from the numbers on the props.
// Slidev deliberately normalizes `v-click="0"` to click 1. Resolve an
// annotation on click 0 ourselves so it can be present before the first click.
const startsOnInitialSlide = computed(() => hasExplicitStartClick.value && Number(atClick.value) === 0)
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
const EXIT_FADE_DURATION = 300
let exitFadeTimer: ReturnType<typeof setTimeout> | undefined
watch(withinRange, (inside, wasInside) => {
  clearTimeout(exitFadeTimer)
  fadingOut.value = wasInside && !inside && geometryPainted.value
  if (fadingOut.value)
    exitFadeTimer = setTimeout(() => fadingOut.value = false, EXIT_FADE_DURATION)
})
const reached = (click: Ref<number>) => computed(() => isCurrentSlide.value
  && $clicks.value >= click.value
  && withinRange.value
  && painted.value)

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
  // Static HTML attributes are strings, so support both `sequential="false"`
  // and Vue's `:sequential="false"`.
  const sequential = props.sequential !== false && props.sequential !== 'false'
  if (!sequential || !outerSequence)
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
const LABEL_FADE_DURATION = 250

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
  /** Resolved leader endpoints, used to materialize automatic lines on first edit. */
  connectorStart: undefined as Point | undefined,
  connectorEnd: undefined as Point | undefined,
  ready: false,
})

/**
 * Replaces one of the path lists only when it actually changed. Geometry is
 * re-measured on animation frames, and an unconditional assignment would be a
 * new array every time — re-rendering and re-patching every <path> element
 * even in a frame where nothing moved.
 */
function assignPaths(key: 'mark' | 'leader' | 'arrow' | 'targetMark', next: string[]) {
  const previous = geometry[key]
  if (previous.length === next.length && previous.every((d, index) => d === next[index]))
    return
  geometry[key] = next
}

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
function textRange(root: HTMLElement, needle: string, occurrence: number | string): { range?: Range, matches: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement
      // Skip our own overlay, and the snapshot Magic Move is animating out, so
      // a match is never made against text that is on its way off the slide.
      if (!parent || parent.closest('svg, .annotation-ignore, .shiki-magic-move-leave, .shiki-magic-move-leave-to'))
        return NodeFilter.FILTER_REJECT
      // Only leaves are position-filtered: an element that merely precedes or
      // contains the annotation must still be descended into (FILTER_SKIP),
      // because content following the tag can live inside it.
      if (node.nodeType === Node.ELEMENT_NODE)
        return (node as HTMLElement).tagName === 'BR' && followsAnnotation(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      return followsAnnotation(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })

  // Magic Move renders line breaks as <br> instead of newline characters, so
  // they are folded back into the searched text to keep line-aware matches
  // working in both kinds of code block.
  const segments: TextSegment[] = []
  let node: Node | null
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    segments.push(node.nodeType === Node.TEXT_NODE
      ? { node: node as Text, text: (node as Text).data }
      : { text: '\n' })
  }

  const requestedOccurrence = Number(occurrence)
  const match = findTextInSegments(segments, needle, Number.isFinite(requestedOccurrence) ? requestedOccurrence : 1)
  return { range: match.range ?? undefined, matches: match.matches }
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
let unregisterEditorActions: (() => void) | undefined
// Fingerprint of the mark's last measured boxes. While the slide animates, a
// frame in which the mark has not moved recomputes nothing.
let lastMarkKey = ''
// Content boxes an automatic label avoids, in local SVG coordinates. The DOM
// scan is refreshed on discrete re-measures (click settles, resizes, prop or
// draft changes) and reused by the per-frame tracking passes, which must not
// re-walk and re-measure the whole slide.
let contentObstacleCache: Box[] | undefined
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

  // A view transition is owned by the document, not by the incoming slide's
  // slot. Its pseudo-elements therefore never appear in the annotation
  // container's subtree, even though they are exactly the animation we must
  // wait for before drawing on the new slide.
  const viewTransitionAnimations = typeof document !== 'undefined'
    ? document.getAnimations().filter((animation) => {
        const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement
        return typeof pseudo === 'string' && pseudo.startsWith('::view-transition-')
      })
    : []
  const animations = [...root.getAnimations({ subtree: true }), ...viewTransitionAnimations]

  return [...new Set(animations)].filter((animation) => {
    if (animation.playState !== 'running' && !animation.pending)
      return false
    const target = (animation.effect as KeyframeEffect | null)?.target
    const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement
    // Pseudo-elements belong to the page transition and are intentionally
    // included. For regular elements, never wait for our own strokes or label:
    // they only start after `settled` opens the annotation.
    const belongsToPageTransition = typeof pseudo === 'string' && pseudo.startsWith('::view-transition-')
    const belongsToSlot = target instanceof Element && !target.closest('.annotation-ignore')
    return (belongsToPageTransition || belongsToSlot)
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
const VIEW_TRANSITION_START_GRACE = 100

async function settleAfterAnimations(run: number, grace = 0) {
  // Slidev starts document.startViewTransition() after a short timeout. A
  // preloaded annotation can therefore observe the route change before the
  // browser has created the view-transition pseudo-elements. Give that start
  // callback time to run instead of concluding that there is nothing to wait
  // for.
  if (grace > 0)
    await new Promise<void>(resolve => setTimeout(resolve, grace))
  await nextTick()
  await nextFrame()
  while (mounted && run === settleRun) {
    const animations = relevantAnimations()
    if (!animations.length) {
      await nextFrame()
      if (mounted && run === settleRun && !relevantAnimations().length) {
        // Settle before measuring: the settled pass is the one full
        // recomputation per click that the animation-frame passes lean on.
        settled.value = true
        updateGeometry()
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
function unsettle(grace = 0) {
  const run = ++settleRun
  // A click can restyle the slide, so measured label sizes and content
  // obstacles go stale here — once per click, which leaves them shared by
  // every frame of the animation.
  labelSizeCache.clear()
  contentObstacleCache = undefined
  if (!props.wait || !props.track) {
    settled.value = true
    return
  }
  settled.value = false
  track(0)
  void settleAfterAnimations(run, grace)
}

function scheduleUpdate() {
  // Late asynchronous callers — a font that finishes loading, an image that
  // decodes — must not schedule work on an annotation that is already gone.
  if (!mounted)
    return
  // Discrete events land here (per-frame tracking calls updateGeometry
  // directly): the slide may have reflowed, so re-scan content obstacles.
  contentObstacleCache = undefined
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(updateGeometry)
}

/** Repaint one editing annotation without invalidating the slide obstacle scan. */
function scheduleDraftUpdate() {
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
  // A still-hidden (or already-ended) annotation has nothing on screen that
  // must glide with the animation. Its geometry is refreshed once per click by
  // the settled measurement instead of on every frame — including the strokes
  // other annotations route around while it waits for its click.
  if (!withinRange.value || $clicks.value < Math.min(resolvedClick.value, resolvedLabelClick.value))
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
  isCurrentSlide.value && settled.value && $clicks.value >= resolvedClick.value && withinRange.value)

/** Explains why nothing was drawn, once something should have been. */
function explainMissing(match?: { range?: Range, matches: number }) {
  if (everFound || !missingIsAnError.value)
    return
  if (!props.text)
    warn(`Selector "${props.selector}" matched nothing inside ${searchScope()}. Put the attribute on the element to annotate, or use \`text\` to mark code.`)
  else if (!match || match.matches === 0)
    warn(`Text "${props.text}" was not found in ${searchScope()}. It has to match the rendered text exactly — and inside a Magic Move block, be part of the step the annotation is drawn on.`)
  else if (match.matches < Math.max(1, Number(props.occurrence)))
    warn(`Text "${props.text}" ${match.matches === 1 ? 'matches only once' : `matches only ${match.matches} times`}, but \`occurrence\` asks for match ${props.occurrence}.`)
  else
    warn(`Text "${props.text}" was found, but has no size on screen right now, so there is nothing to draw around.`)
}

function updateGeometry() {
  const root = searchRoot()
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
  const source = props.text
    ? undefined
    : Array.from(root.querySelectorAll<HTMLElement>(props.selector)).find(followsAnnotation) ?? null
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

  // While the slide is still animating, a mark that has not moved since the
  // previous frame needs nothing recomputed: the paths, the leader and the
  // label placement all derive from it. The settled pass at the end of every
  // click always recomputes, because other content can have moved around a
  // stationary mark.
  const markKey = `${width}x${height}|${shapeBoxes.map(box => `${box.left.toFixed(2)},${box.top.toFixed(2)},${box.right.toFixed(2)},${box.bottom.toFixed(2)}`).join(';')}`
  if (!settled.value && geometry.ready && markKey === lastMarkKey)
    return
  lastMarkKey = markKey

  geometry.width = width
  geometry.height = height
  assignPaths('mark', shapeBoxes.flatMap(box => markPaths(box, sourceMarkType.value)))

  paintDestination(root, toLocal, marked)

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
) {
  geometry.connectorStart = undefined
  geometry.connectorEnd = undefined
  // Computed into locals first: the stable rough.js seed makes an unchanged
  // layout produce identical path strings, which assignPaths then drops
  // instead of re-patching the SVG.
  const paths = { leader: [] as string[], arrow: [] as string[], targetMark: [] as string[] }
  paintDestinationInto(paths, root, toLocal, marked)
  assignPaths('leader', paths.leader)
  assignPaths('arrow', paths.arrow)
  assignPaths('targetMark', paths.targetMark)
}

function paintDestinationInto(
  paths: { leader: string[], arrow: string[], targetMark: string[] },
  root: HTMLElement,
  toLocal: (rect: DOMRect) => Box,
  marked: Box,
) {
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
    paths.targetMark = markPaths(destination, targetMarkType.value, 0)
  }

  if (hasLabel.value) {
    // Start with the label's natural width, which is a single line. Only give
    // it a maximum width when that line cannot stay on the slide or cannot be
    // placed clear of the slide's content.
    // An annotation nested in a positioned component (for example
    // InlineCompilerError) has an SVG canvas limited to that component. The
    // label is allowed to leave that canvas, so constrain it to the slide,
    // expressed in the SVG's local coordinates, rather than to the canvas.
    const slide = slideRoot() ?? root
    const label = fitLabel(root, toLocal, destination ?? markBox, toLocal(slide.getBoundingClientRect()))
    geometry.labelLeft = label.box.cx
    geometry.labelTop = label.box.cy
    geometry.labelWidth = label.width
    geometry.labelPlaced = true
    publishPlacedLabel(label.box)
    if (!destination) {
      destination = label.box
      endPoint = undefined
    }
  }
  else {
    geometry.labelPlaced = false
    placedLabelRegistry.delete(placementToken)
  }

  if (!destination || !props.connect)
    return

  const savedConnector = manualConnector()
  let start: Point
  let end: Point
  let c2x: number
  let c2y: number
  if (savedConnector && overlay.value) {
    // Saved fractions always use the concrete slide root, even if this SVG is
    // nested in a positioned component.
    const slide = slideRoot()
    if (!slide)
      return
    const slideBox = slide.getBoundingClientRect()
    const overlayBox = overlay.value.getBoundingClientRect()
    start = slideFractionPointToLocal({ x: savedConnector.x1, y: savedConnector.y1 }, slideBox, overlayBox, geometry)
    end = slideFractionPointToLocal({ x: savedConnector.x2, y: savedConnector.y2 }, slideBox, overlayBox, geometry)
    if (savedConnector.cx !== undefined && savedConnector.cy !== undefined) {
      const control = slideFractionPointToLocal({ x: savedConnector.cx, y: savedConnector.cy }, slideBox, overlayBox, geometry)
      // The authored control point is a genuine quadratic Bézier control, not
      // merely legacy metadata. Rough.js retains the curve's hand-drawn look.
      c2x = control.x
      c2y = control.y
      paths.leader = toPaths(generator.path(`M ${start.x} ${start.y} Q ${control.x} ${control.y}, ${end.x} ${end.y}`, roughOptions()))
    }
    else {
      c2x = start.x
      c2y = start.y
      paths.leader = toPaths(generator.line(start.x, start.y, end.x, end.y, roughOptions()))
    }
  }
  else {
    const route = routeLeader(markBox, destination, endPoint)
    if (!route)
      return
    start = route.start
    end = route.end
    c2x = route.c2x
    c2y = route.c2y
    paths.leader = toPaths(generator.path(
      `M ${start.x} ${start.y} C ${route.c1x} ${route.c1y}, ${route.c2x} ${route.c2y}, ${end.x} ${end.y}`,
      roughOptions(),
    ))
  }
  geometry.connectorStart = start
  geometry.connectorEnd = end

  if (props.arrow) {
    // Aim the head along the tangent of the curve, not along the chord.
    const angle = Math.atan2(end.y - c2y, end.x - c2x)
    const size = 16 + props.strokeWidth * 2
    const wing = (spread: number) => [
      end.x - Math.cos(angle + spread) * size,
      end.y - Math.sin(angle + spread) * size,
    ] as [number, number]
    paths.arrow = [
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
 * Uses the shortest direct leader as the stable automatic fallback. Complex
 * routing is intentionally an editor operation: inspecting arbitrary future
 * slide content made an automatic line change as clicks progressed.
 */
function routeLeader(markBox: Box, destination: Box, endPoint?: Point): Curve | undefined {
  const start = edgePoint(markBox, destination.cx, destination.cy)
  const end = endPoint
    ? backOff(endPoint, start, targetMarkType.value !== 'none' ? destination.width / 2 : 6)
    : {
        x: clamp(start.x, destination.left, destination.right),
        y: clamp(start.y, destination.top, destination.bottom),
      }
  const chord = unitVector(end.x - start.x, end.y - start.y)
  if (!chord)
    return undefined
  const outward = unitVector(start.x - markBox.cx, start.y - markBox.cy) ?? chord
  const into = endPoint ? unitVector(endPoint.x - end.x, endPoint.y - end.y) ?? chord : chord
  return leaderCurve(start, end, 1, unitVector(outward.x + chord.x, outward.y + chord.y) ?? chord, into)
}

// Stands in for a label that cannot be measured yet, so placement still has a
// plausible box to work with on the very first frame.
const FALLBACK_LABEL_HEIGHT = 40

// The label never sits closer to a slide edge than this, in slide pixels.
const SLIDE_MARGIN = 24

// Measured label sizes per width cap. Writing a candidate max-width and
// reading the resulting box back forces a synchronous layout, and the answer
// only changes with the label's text or font — never from frame to frame while
// the slide animates. Sizes are in slide coordinates, so they survive window
// resizes too. Cleared on every click and whenever the props or fonts change.
const labelSizeCache = new Map<number | 'natural', { width: number, height: number }>()

// This instance's slot in the shared placed-label registry (module scope, see
// the plain `<script>` block above). Mount order approximates document order.
const placementToken = Symbol('drawn-annotation-label')
const placementOrder = nextPlacementOrder++

const locator = computed(() => props.__drawnAnnotationLocator)
if (isAnnotationEditorDevelopment) {
  // A save remounts the slide. The locator survives the writer's own edits,
  // so this instance can take over the selection the unmounting one released.
  if (locator.value)
    claimAnnotationSelection(locator.value)
  // A write elsewhere in the file can still move this tag to another line.
  // Should Vue patch the prop in place, the editor state keyed by the old
  // locator has to follow it.
  watch(locator, (next, previous) => {
    if (!previous)
      return
    if (next)
      migrateAnnotationLocator(previous, next)
    else
      clearAnnotationSelection(previous)
  })
}
/**
 * The `geometry` binding, checked once per change. A hand-edited binding in
 * the wrong unit (`{ x: 70, y: 18 }` in percent) would otherwise place the
 * label off the slide without a word; it is ignored with a warning instead.
 */
const sourceGeometry = computed<DrawnAnnotationGeometry | undefined>(() => {
  if (props.geometry === undefined)
    return undefined
  try {
    return validateDrawnAnnotationGeometry(props.geometry)
  }
  catch (error) {
    warn(`Ignoring \`geometry\`: ${error instanceof Error ? error.message : String(error)}. Every value is a fraction of the slide from 0 to 1, for example \`:geometry="{ label: { x: 0.7, y: 0.18 } }"\`.`)
    return undefined
  }
})
/** Source geometry is the persisted state; editor drafts remain visible through HMR. */
function persistedLabelGeometry(): PersistedAnnotationGeometry {
  const value = sourceGeometry.value
  return {
    x: value?.label?.x, y: value?.label?.y, width: value?.label?.width,
    x1: value?.connector?.start.x, y1: value?.connector?.start.y,
    x2: value?.connector?.end.x, y2: value?.connector?.end.y,
    cx: value?.connector?.control?.x, cy: value?.connector?.control?.y,
  }
}
function draftLabelGeometry() { return locator.value ? annotationDrafts.get(locator.value) : undefined }
function effectiveLabelX() { return draftLabelGeometry()?.x ?? persistedLabelGeometry().x }
function effectiveLabelY() { return draftLabelGeometry()?.y ?? persistedLabelGeometry().y }
function effectiveLabelWidth(bounds: Box) { const width = draftLabelGeometry()?.width ?? persistedLabelGeometry().width; return width === undefined ? undefined : bounds.width * width }
/** A connector becomes manual only once all four endpoints are present. */
function manualConnector() {
  const draft = draftLabelGeometry()
  const saved = persistedLabelGeometry()
  const x1 = draft?.x1 ?? saved.x1
  const y1 = draft?.y1 ?? saved.y1
  const x2 = draft?.x2 ?? saved.x2
  const y2 = draft?.y2 ?? saved.y2
  return x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined
    ? undefined
    : { x1, y1, x2, y2, cx: draft?.cx ?? saved.cx, cy: draft?.cy ?? saved.cy }
}

function measureLabel(toLocal: (rect: DOMRect) => Box, maxWidth?: number) {
  const cached = labelSizeCache.get(maxWidth ?? 'natural')
  if (cached)
    return cached

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

  // Only a real measurement is worth remembering; the fallbacks stand in for a
  // label that cannot be measured yet.
  if (!rect.width)
    return { width: maxWidth ?? 0, height: FALLBACK_LABEL_HEIGHT }
  const box = toLocal(rect)
  const size = { width: box.width, height: box.height }
  labelSizeCache.set(maxWidth ?? 'natural', size)
  return size
}

/**
 * Finds a bounded default label position. The unbounded measurement is always
 * tried first, so ordinary labels remain a single, readable line instead of
 * inheriting an arbitrary short line length. When the natural width cannot be
 * placed clear of the obstacles, narrower candidates let the label wrap into
 * the free space instead.
 */
function fitLabel(
  root: HTMLElement,
  toLocal: (rect: DOMRect) => Box,
  anchor: Box,
  bounds: Box,
): { box: Box, width: number | undefined } {
  // Collected once for every width candidate tried below: the obstacles do not
  // depend on how the label wraps. An explicitly positioned label ignores
  // obstacles entirely — authored geometry is the final say.
  const explicitX = effectiveLabelX()
  const explicitY = effectiveLabelY()
  const maximumWidth = effectiveLabelWidth(bounds)
  const obstacles = explicitX !== undefined || explicitY !== undefined ? [] : collectLabelObstacles(toLocal)
  const natural = measureLabel(toLocal)
  const unwrapped = placeLabel(anchor, natural, bounds, obstacles)
  const fitsSlide = natural.width <= bounds.width - SLIDE_MARGIN * 2 && natural.height <= bounds.height - SLIDE_MARGIN * 2
  const respectsExplicitMaximum = maximumWidth === undefined || natural.width <= maximumWidth

  if (fitsSlide && unwrapped.overlap === 0 && respectsExplicitMaximum)
    return { box: unwrapped.box, width: undefined }

  // An explicit normalized geometry width remains a useful author override.
  // Without one, the slide edges are the only width limit.
  const maximum = Math.min(natural.width, maximumWidth ?? natural.width, bounds.width - SLIDE_MARGIN * 2)
  const minimum = Math.min(maximum, 160)
  let best: { box: Box, width: number, overlap: number } | undefined

  // Work from wide to narrow: the first collision-free result has the fewest
  // line breaks. A modest step keeps the search cheap while the slide tracks
  // Magic Move animations.
  for (let cap = maximum; cap >= minimum; cap -= 48) {
    const size = measureLabel(toLocal, cap)
    const placed = placeLabel(anchor, size, bounds, obstacles)
    if (placed.overlap === 0)
      return { box: placed.box, width: cap }
    if (!best || placed.overlap < best.overlap)
      best = { box: placed.box, width: cap, overlap: placed.overlap }
  }

  // Include the lower bound when the step above did not land on it.
  if (!best || best.width !== minimum) {
    const size = measureLabel(toLocal, minimum)
    const placed = placeLabel(anchor, size, bounds, obstacles)
    if (placed.overlap === 0)
      return { box: placed.box, width: minimum }
    if (!best || placed.overlap < best.overlap)
      best = { box: placed.box, width: minimum, overlap: placed.overlap }
  }

  return best ? { box: best.box, width: best.width } : { box: unwrapped.box, width: undefined }
}

function placeLabel(
  anchor: Box,
  size: { width: number, height: number },
  bounds: Box,
  obstacles: Box[] = [],
): { box: Box, overlap: number } {
  const halfW = size.width / 2
  const halfH = size.height / 2
  const centred = (cx: number, cy: number) => makeBox(cx - halfW, cy - halfH, cx + halfW, cy + halfH)
  const explicitX = effectiveLabelX()
  const explicitY = effectiveLabelY()
  if (explicitX !== undefined || explicitY !== undefined) {
    // Authored geometry is the final say; it is never moved by obstacles.
    return { box: centred(
      explicitX !== undefined ? bounds.left + bounds.width * explicitX : anchor.cx,
      explicitY !== undefined ? bounds.top + bounds.height * explicitY : anchor.cy,
    ), overlap: 0 }
  }

  type Direction = 'up' | 'down' | 'left' | 'right'
  const preferred: Direction = resolvedPlacement.value === 'auto'
    ? (anchor.cy < bounds.cy ? 'down' : 'up')
    : resolvedPlacement.value
  // `auto` may fall back to the other sides. An explicit side is a contract:
  // the label wraps or stays put rather than drifting to another side.
  const directions: Direction[] = resolvedPlacement.value === 'auto'
    ? [preferred, preferred === 'down' ? 'up' : 'down', 'right', 'left']
    : [preferred]

  const candidate = (direction: Direction, shift: number, extra: number) => {
    const cx = direction === 'left' ? anchor.left - props.gap - extra - halfW
      : direction === 'right' ? anchor.right + props.gap + extra + halfW : anchor.cx + shift
    const cy = direction === 'up' ? anchor.top - props.gap - extra - halfH
      : direction === 'down' ? anchor.bottom + props.gap + extra + halfH : anchor.cy + shift
    const box = centred(
      clamp(cx, bounds.left + SLIDE_MARGIN + halfW, bounds.right - SLIDE_MARGIN - halfW),
      clamp(cy, bounds.top + SLIDE_MARGIN + halfH, bounds.bottom - SLIDE_MARGIN - halfH),
    )
    // The clearance keeps the label breathing: a label flush against the
    // bottom of a code block reads as part of it. The anchor is an obstacle
    // too, so a clamped candidate never covers its own mark unnoticed.
    const inflated = padBox(box, props.clearance)
    let overlap = overlapArea(inflated, anchor)
    for (const obstacle of obstacles)
      overlap += overlapArea(inflated, obstacle)
    return { box, overlap }
  }

  let best: { box: Box, overlap: number } | undefined
  for (const direction of directions) {
    // Nearest first: step further out along the side to clear an occupied
    // row, and slide along it to step out from under an obstacle — both
    // without leaving the requested side.
    const lateral = direction === 'up' || direction === 'down' ? halfW + props.gap : halfH + props.gap
    for (const extra of [0, 70, 150]) {
      for (const shift of [0, -lateral, lateral]) {
        const placed = candidate(direction, shift, extra)
        if (placed.overlap === 0)
          return placed
        if (!best || placed.overlap < best.overlap)
          best = placed
      }
    }
  }
  return best!
}

/** The intersection area of two boxes, 0 when they do not touch. */
function overlapArea(a: Box, b: Box) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return width > 0 && height > 0 ? width * height : 0
}

/**
 * Everything an automatically placed label must stay clear of, in local SVG
 * coordinates: the slide's laid-out content (text lines, images, code blocks
 * — including v-click content that is laid out but still hidden, so a label
 * never sits where the slide is about to grow), elements matched by
 * `avoid-selector`, and the labels that annotations on an earlier click (or
 * the same click and earlier in mount order) have placed on this slide. Only
 * what the browser has laid out is measured — deterministic by construction,
 * never guessed.
 */
function collectLabelObstacles(toLocal: (rect: DOMRect) => Box): Box[] {
  const obstacles: Box[] = []
  const slide = slideRoot()
  const svg = overlay.value
  if (!slide || !svg)
    return obstacles
  obstacles.push(...contentObstacles(slide, toLocal))
  if (props.avoidSelector) {
    for (const element of Array.from(slide.querySelectorAll<HTMLElement>(props.avoidSelector))) {
      if (element.closest('.annotation-ignore'))
        continue
      const rect = element.getBoundingClientRect()
      if (rect.width && rect.height)
        obstacles.push(toLocal(rect))
    }
  }
  const slideBox = slide.getBoundingClientRect()
  const overlayBox = svg.getBoundingClientRect()
  const ourClick = resolvedLabelClick.value
  for (const record of placedLabelRegistry.values()) {
    if (record.root !== slide || !record.active)
      continue
    // A later label avoids an earlier one, never the other way round, so two
    // labels can never chase each other. Earlier means an earlier click first
    // — a click-1 label is already on screen when a click-3 label is placed,
    // whatever their markup order — with mount order breaking the tie.
    if (!(record.click < ourClick || (record.click === ourClick && record.order < placementOrder)))
      continue
    const topLeft = slideFractionPointToLocal({ x: record.box.left, y: record.box.top }, slideBox, overlayBox, geometry)
    const bottomRight = slideFractionPointToLocal({ x: record.box.right, y: record.box.bottom }, slideBox, overlayBox, geometry)
    obstacles.push(makeBox(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y))
  }
  return obstacles
}

/** The slide's own laid-out content, scanned once per discrete re-measure. */
function contentObstacles(slide: HTMLElement, toLocal: (rect: DOMRect) => Box): Box[] {
  if (contentObstacleCache)
    return contentObstacleCache
  const boxes: Box[] = []
  for (const element of Array.from(slide.querySelectorAll<HTMLElement>('*'))) {
    if (element.closest('.annotation-ignore'))
      continue
    // A code block or an SVG drawing counts as one opaque box.
    const aggregate = element.closest('pre, svg')
    if (aggregate && aggregate !== element)
      continue
    const tag = element.tagName.toLowerCase()
    const isMedia = tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'svg' || tag === 'pre'
    // Only leaf-ish boxes obstruct: an element with text of its own keeps its
    // line, while pure layout containers leave their free space usable.
    if (!isMedia && !Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
      continue
    const rect = element.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2)
      continue
    boxes.push(toLocal(rect))
  }
  contentObstacleCache = boxes
  return boxes
}

/** Record this label's placed box for later annotations on the same slide. */
function publishPlacedLabel(box: Box) {
  const slide = slideRoot()
  const svg = overlay.value
  if (!slide || !svg)
    return
  const slideBox = slide.getBoundingClientRect()
  const overlayBox = svg.getBoundingClientRect()
  const topLeft = localPointToSlideFraction({ x: box.left, y: box.top }, slideBox, overlayBox, geometry)
  const bottomRight = localPointToSlideFraction({ x: box.right, y: box.bottom }, slideBox, overlayBox, geometry)
  placedLabelRegistry.set(placementToken, {
    order: placementOrder,
    click: resolvedLabelClick.value,
    root: slide,
    box: { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y },
    active: withinRange.value,
  })
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
  if (isAnnotationEditorDevelopment && editorRelevant.value && locator.value) {
    unregisterEditorActions = registerAnnotationEditorActions(locator.value, {
      isManualConnector: () => !!manualConnector(),
      toggleConnectorAttachment,
      persistedGeometry: persistedLabelGeometry,
    })
  }
  // Registered synchronously, while the clicks context still accepts it.
  if (manualClicks.value) {
    // No start prop means the annotation is already present at click 0, even
    // when an enclosing annotation makes its click handling manual.
    resolvedClick.value = hasExplicitStartClick.value
      ? manualClick(atClick.value, props.on !== undefined ? 'on' : 'at')
      : 0
    resolvedLabelClick.value = props.labelAt === undefined
      ? resolvedClick.value
      : manualClick(props.labelAt, 'label-at')
    $clicksContext.register(ownClicks, { delta: 0, max: Math.max(resolvedClick.value, resolvedLabelClick.value) })
  }
  await nextTick()
  if (!manualClicks.value) {
    // An unqualified annotation is initial content, not a bare `v-click`.
    // Explicit `at`/`on` values deliberately retain Slidev's native v-click
    // parsing and automatic-ordering semantics.
    resolvedClick.value = hasExplicitStartClick.value
      ? markerClick(clickMarker.value)
      : 0
    // A label without a click of its own follows the mark, rather than taking
    // the next click in the slide's automatic ordering.
    resolvedLabelClick.value = props.labelAt === undefined
      ? resolvedClick.value
      : markerClick(labelMarker.value)
  }
  // Navigating backwards remounts the slide. If this click was already reached,
  // render the final state instead of replaying the entrance animation.
  showImmediately.value = isCurrentSlide.value
    && $clicks.value >= resolvedClick.value
    && withinRange.value
  unsettle()
  scheduleUpdate()

  if (isCurrentSlide.value)
    connectObservers()

  document.fonts?.ready.then(() => {
    labelSizeCache.clear()
    scheduleUpdate()
  })
})

/**
 * The observers only run while this annotation's slide is current. Every
 * slide of the deck stays mounted, so without the gate a deck full of
 * annotations would keep reacting to layout changes on slides nobody is
 * looking at. Nothing goes stale from being disconnected: becoming current
 * re-measures everything anyway, in the `isCurrentSlide` watch below.
 */
let observersConnected = false

function connectObservers() {
  if (observersConnected || !mounted)
    return
  observersConnected = true

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

  window.addEventListener('resize', scheduleUpdate)
}

function disconnectObservers() {
  if (!observersConnected)
    return
  observersConnected = false
  resizeObserver?.disconnect()
  resizeObserver = undefined
  mutationObserver?.disconnect()
  mutationObserver = undefined
  for (const image of watchedImages.splice(0))
    image.removeEventListener('load', scheduleUpdate)
  window.removeEventListener('resize', scheduleUpdate)
}

onBeforeUnmount(() => {
  mounted = false
  unregisterEditorActions?.()
  unregisterEditorActions = undefined
  if (locator.value)
    releaseAnnotationSelection(locator.value)
  placedLabelRegistry.delete(placementToken)
  settleRun++
  clearTimeout(exitFadeTimer)
  $clicksContext.unregister(ownClicks)
  cancelAnimationFrame(frame)
  cancelAnimationFrame(paintFrame)
  cancelAnimationFrame(trackFrame)
  disconnectObservers()
})

// Magic Move and click transitions are driven by the click count, and both move
// the annotated element for a while after it changes.
watch($clicks, () => {
  // A hidden slide's clicks can move while it is preloaded. Nothing of it is
  // on screen, and becoming current re-measures everything in the
  // `isCurrentSlide` watch below, so skip the per-click measurement work.
  if (!isCurrentSlide.value)
    return
  unsettle()
  track(CLICK_TRACK_DURATION)
}, { flush: 'sync' })

// Preloaded slides can already contain their annotations before navigation
// starts, so mount-time detection alone is not enough. Watching this annotation's
// active-slide state also covers a preloaded component becoming visible inside
// document.startViewTransition(); the grace period lets the browser create the
// document-level pseudo-elements before the first animation scan.
watch(isCurrentSlide, (current) => {
  if (current) {
    connectObservers()
    unsettle(VIEW_TRANSITION_START_GRACE)
    track()
  }
  else {
    disconnectObservers()
    // Cancel in-flight measurement too: a settle pass or tracking loop begun
    // before navigating away would keep calling updateGeometry on a slide
    // that is no longer visible. During a transition the outgoing slide moves
    // (or is snapshotted) as a whole, so its frozen geometry stays correct.
    settleRun++
    trackUntil = 0
    cancelAnimationFrame(trackFrame)
    trackFrame = 0
    cancelAnimationFrame(frame)
  }
}, { flush: 'sync' })

// Any prop can change what is drawn or where the label may go, so re-measure
// on all of them instead of maintaining a list that can silently go stale.
// The caches assume unchanged props, so they are dropped along the way.
watch(props, () => {
  labelSizeCache.clear()
  lastMarkKey = ''
  scheduleUpdate()
})

// A draft is applied immediately instead of waiting for source HMR after save.
// Connector drags affect only their owning SVG. Label drags also affect labels
// that avoid one another, but their shared placement is published only at the
// start and end of the gesture rather than once per pointer frame.
watch(annotationDraftChange, (change) => {
  if (change?.locator !== locator.value)
    return
  if (change.kind === 'clear') {
    labelSizeCache.clear()
    lastMarkKey = ''
  }
  scheduleDraftUpdate()
})
watch(annotationLabelLayoutChange, (change) => {
  // The dragged label already has its exact on-screen geometry. Re-measuring it
  // on release would briefly reset it; only dependent labels need a full pass.
  if (change?.locator === locator.value) {
    scheduleDraftUpdate()
    return
  }
  labelSizeCache.clear()
  lastMarkKey = ''
  scheduleUpdate()
})

const editable = computed(() => isAnnotationEditorDevelopment && !!locator.value && hasLabel.value && labelActive.value && geometry.ready)
const connectorEditable = computed(() => isAnnotationEditorDevelopment && !!locator.value && connectsLine.value && active.value && !!geometry.connectorStart && !!geometry.connectorEnd)
const selectedForEditing = computed(() => (editable.value || connectorEditable.value) && annotationEditMode.value && selectedAnnotationId.value === locator.value)
interface DragSaveSession extends AnnotationUndoSession {
  /** The source geometry before this gesture's first autosave. */
  persistedCaptured: boolean
  persistedBefore?: PersistedAnnotationGeometry | null
}

let labelDrag: ({ pointerId: number, width: boolean, centerX: number, rightOffsetX: number, offsetX: number, offsetY: number, previous?: PersistedAnnotationGeometry } & DragSaveSession) | undefined

function fraction(value: number) {
  return Math.max(0, Math.min(1, value))
}

// Labels only suppress Slidev navigation while they are real editor controls.
// Outside edit mode they are presentation-only (`pointer-events: none`), but
// retaining that boundary here also keeps a transient/stale DOM state from
// swallowing an ordinary slide click.
function stopEditorClick(event: MouseEvent) {
  if (annotationEditMode.value && editable.value)
    event.stopPropagation()
}

function beginLabelDrag(event: PointerEvent, width = false) {
  if (!editable.value || !annotationEditMode.value || !locator.value)
    return
  event.preventDefault()
  event.stopPropagation()
  // Keep the selected control in sync with the gesture. In particular, a
  // width-handle drag must leave the width handle selected so follow-up arrow
  // presses resize instead of unexpectedly moving the label.
  selectAnnotation(locator.value, width ? 'width' : 'label')
  const slide = slideRoot()
  const label = labelEl.value
  if (!slide || !label)
    return
  const slideBox = slide.getBoundingClientRect()
  const labelBox = label.getBoundingClientRect()
  labelDrag = {
    pointerId: event.pointerId,
    width,
    // The label is centre-anchored and a width drag leaves x untouched, so
    // the centre is the fixed point a new width is measured from; the right
    // edge moves at half the width change.
    centerX: labelBox.left + labelBox.width / 2,
    rightOffsetX: event.clientX - labelBox.right,
    // Preserve the grab point rather than snapping the label centre to the
    // pointer on its first move.
    offsetX: event.clientX - (labelBox.left + labelBox.width / 2),
    offsetY: event.clientY - (labelBox.top + labelBox.height / 2),
    previous: annotationDrafts.get(locator.value) ? { ...annotationDrafts.get(locator.value) } : undefined,
    persistedCaptured: false,
  }
  beginAnnotationDraftGesture(locator.value, 'label')
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function moveLabelDrag(event: PointerEvent) {
  if (!labelDrag || labelDrag.pointerId !== event.pointerId || !locator.value)
    return
  event.preventDefault()
  event.stopPropagation()
  const slide = slideRoot()
  if (!slide)
    return
  const box = slide.getBoundingClientRect()
  if (labelDrag.width) {
    // Keep the handle under the pointer: the grabbed right edge follows the
    // cursor and the width doubles its distance from the fixed centre.
    const edge = event.clientX - labelDrag.rightOffsetX
    setLabelDraft(locator.value, { ...labelPositionSeed(), width: Math.max(.02, Math.min(1, 2 * (edge - labelDrag.centerX) / box.width)) })
  }
  else {
    setLabelDraft(locator.value, {
      x: fraction((event.clientX - labelDrag.offsetX - box.left) / box.width),
      y: fraction((event.clientY - labelDrag.offsetY - box.top) / box.height),
    })
  }
  scheduleDraftSave(labelDrag)
}

/** Source HMR updates `geometry`; drafts intentionally remain until the save response is reconciled. */

let draftSaveTimer: ReturnType<typeof setTimeout> | undefined
const savingDraftSignatures = new Set<string>()
/** Independent of key order, so a draft compares equal to the same geometry read back from the source. */
function draftSignature(geometry: PersistedAnnotationGeometry) {
  return JSON.stringify([geometry.x, geometry.y, geometry.width, geometry.x1, geometry.y1, geometry.x2, geometry.y2, geometry.cx, geometry.cy].map(value => value ?? null))
}

/** Save during a pause in a long drag as well as on pointer release. */
function scheduleDraftSave(session?: DragSaveSession) {
  clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => {
    if (locator.value)
      void saveDraft(locator.value, session)
  }, 350)
}

async function saveDraft(id: string, session?: DragSaveSession) {
  const draft = annotationDrafts.get(id)
  if (!draft)
    return
  // This import stays behind a compile-time development guard. Production
  // decks neither render controls nor include browser write-client code.
  if (!isAnnotationEditorDevelopment)
    return
  const { cachedAnnotationGeometry, saveLabelGeometry } = await loadWriterClient()
  // Undo must return to what the source holds now: the geometry this tab
  // last saved (HMR may not have delivered it as a prop yet), otherwise the
  // authored binding. Store it before replacing it with the new geometry.
  const previous = cachedAnnotationGeometry(id) ?? persistedLabelGeometry()
  // The writer replaces the whole binding with what it is sent. A first drag
  // drafts only the label, so complete it from the source baseline rather than
  // letting a label move erase the connector or width the source holds.
  const savedDraft = { ...previous, ...draft }
  const signature = draftSignature(savedDraft)
  // There is nothing to write when the source already holds this geometry:
  // after a completed save, or when a drag ends where it started. Comparing
  // with the source rather than with the last request keeps a position that
  // Undo or Reset removed from the source saveable again.
  if (signature === draftSignature(previous) || savingDraftSignatures.has(signature))
    return
  savingDraftSignatures.add(signature)
  annotationEditorStatus.value = 'Saving annotation…'
  try {
    // A long drag may autosave before the pointer is released. Remember the
    // pre-drag rule before that first request, so Escape can truly cancel the
    // whole gesture instead of merely hiding a value that HMR has saved.
    if (session && !session.persistedCaptured) {
      session.persistedBefore = previous
      session.persistedCaptured = true
    }
    const saved = await saveLabelGeometry(id, savedDraft)
    // A debounced save and the release save belong to the same pointer
    // gesture. Record the pre-gesture snapshot once, rather than making Undo
    // stop at every intermediate autosave position.
    if (session)
      recordAnnotationUndoOnce(session, id, session.persistedBefore ?? previous)
    else
      recordAnnotationUndo(id, previous)
    // The writer returns its fixed-four-decimal source snapshot. Keep that
    // draft visible until Slidev recompiles the rewritten Markdown.
    const persisted = saved.geometry[id]
    if (persisted) setLabelDraft(id, persisted)
    annotationEditorStatus.value = 'Annotation saved'
  }
  catch (error) {
    annotationEditorStatus.value = error instanceof Error ? error.message : 'Unable to save annotation geometry'
  }
  finally {
    savingDraftSignatures.delete(signature)
  }
}

/**
 * Switch explicitly between the attached route and a frozen two-endpoint
 * route. Unlike dragging, this makes the connector state discoverable from
 * the global toolbar without making the toolbar depend on annotation DOM.
 */
async function toggleConnectorAttachment() {
  if (!locator.value || !connectorEditable.value)
    return
  if (manualConnector()) {
    annotationEditorStatus.value = 'Restoring automatic connector…'
    try {
      const { cachedAnnotationGeometry, resetAnnotationGeometry } = await loadWriterClient()
      const previous = cachedAnnotationGeometry(locator.value) ?? persistedLabelGeometry()
      await resetAnnotationGeometry(locator.value, 'connector', previous)
      recordAnnotationUndo(locator.value, previous)
      clearLabelDraft(locator.value)
      annotationEditorStatus.value = 'Connector now follows its source and label'
    }
    catch (error) {
      annotationEditorStatus.value = error instanceof Error ? error.message : 'Unable to restore automatic connector'
    }
    return
  }

  const start = geometry.connectorStart && localConnectorFraction(geometry.connectorStart)
  const end = geometry.connectorEnd && localConnectorFraction(geometry.connectorEnd)
  if (!start || !end)
    return
  setLabelDraft(locator.value, { x1: start.x, y1: start.y, x2: end.x, y2: end.y })
  await saveDraft(locator.value)
}

async function endLabelDrag(event: PointerEvent) {
  if (!labelDrag || labelDrag.pointerId !== event.pointerId || !locator.value)
    return
  event.preventDefault()
  event.stopPropagation()
  const session = labelDrag
  labelDrag = undefined
  endAnnotationDraftGesture(locator.value, 'label')
  clearTimeout(draftSaveTimer)
  await saveDraft(locator.value, session)
}

// A pointer cancellation means the browser interrupted the gesture (for
// example, a window focus change), not that the author released it. Never turn
// that partial movement into a persisted edit.
function restoreCancelledDrag(id: string, previous: PersistedAnnotationGeometry | undefined, session: DragSaveSession) {
  if (previous)
    setLabelDraft(id, previous)
  else
    clearLabelDraft(id)
  // No request has started, so reverting the local preview is sufficient.
  if (!session.persistedCaptured) {
    annotationEditorStatus.value = 'Annotation drag cancelled'
    return
  }
  annotationEditorStatus.value = 'Cancelling annotation drag…'
  // Keep this dynamic import behind the explicit serve-mode boundary. Slidev's
  // build renderer can still set DEV, but a published deck must not ship a
  // browser client capable of reaching the local writer endpoint.
  if (!isAnnotationEditorDevelopment)
    return
  // Writer-client writes are serialized. This restore runs after any autosave
  // already in flight, preventing source HMR from resurrecting a cancelled drag.
  void loadWriterClient().then(({ restoreAnnotationGeometry }) =>
    restoreAnnotationGeometry(id, session.persistedBefore ?? null),
  ).then(() => {
    clearLabelDraft(id)
    annotationEditorStatus.value = 'Annotation drag cancelled'
  }).catch((error) => {
    annotationEditorStatus.value = error instanceof Error ? error.message : 'Unable to cancel saved annotation geometry'
  })
}

function cancelLabelDrag(event: PointerEvent) {
  if (!labelDrag || labelDrag.pointerId !== event.pointerId || !locator.value)
    return
  event.preventDefault()
  event.stopPropagation()
  const drag = labelDrag
  labelDrag = undefined
  endAnnotationDraftGesture(locator.value, 'label')
  clearTimeout(draftSaveTimer)
  restoreCancelledDrag(locator.value, drag.previous, drag)
}

type ConnectorDragKind = 'start' | 'end' | 'body'
let connectorDrag: ({ pointerId: number, kind: ConnectorDragKind, startX: number, startY: number, slideBox: DOMRect, connector: { x1: number, y1: number, x2: number, y2: number, cx?: number, cy?: number }, previous?: PersistedAnnotationGeometry } & DragSaveSession) | undefined

function localConnectorFraction(point: Point) {
  const slide = slideRoot()
  const svg = overlay.value
  if (!slide || !svg)
    return undefined
  const local = localPointToSlideFraction(point, slide.getBoundingClientRect(), svg.getBoundingClientRect(), geometry)
  return { x: fraction(local.x), y: fraction(local.y) }
}

/**
 * A width-only draft cannot be persisted: the writer's document shape stores
 * `width` inside `label`, which requires a position. When no position is
 * known yet, the first width edit materializes the label's current on-screen
 * position, so the edit survives the save instead of being silently dropped
 * and snapped back while the status still reports "Annotation saved".
 */
function labelPositionSeed(): PersistedAnnotationGeometry {
  const draft = draftLabelGeometry()
  const saved = persistedLabelGeometry()
  if ((draft?.x ?? saved.x) !== undefined && (draft?.y ?? saved.y) !== undefined)
    return {}
  const current = localConnectorFraction({ x: geometry.labelLeft, y: geometry.labelTop })
  return current ? { x: current.x, y: current.y } : {}
}

function beginConnectorDrag(event: PointerEvent, kind: ConnectorDragKind) {
  if (!connectorEditable.value || !annotationEditMode.value || !locator.value || !geometry.connectorStart || !geometry.connectorEnd)
    return
  const slide = slideRoot()
  const start = localConnectorFraction(geometry.connectorStart)
  const end = localConnectorFraction(geometry.connectorEnd)
  if (!slide || !start || !end)
    return
  event.preventDefault()
  event.stopPropagation()
  selectAnnotation(locator.value, kind)
  const saved = manualConnector()
  connectorDrag = { pointerId: event.pointerId, kind, startX: event.clientX, startY: event.clientY, slideBox: slide.getBoundingClientRect(), connector: { x1: start.x, y1: start.y, x2: end.x, y2: end.y, cx: saved?.cx, cy: saved?.cy }, previous: annotationDrafts.get(locator.value) ? { ...annotationDrafts.get(locator.value) } : undefined, persistedCaptured: false }
  beginAnnotationDraftGesture(locator.value, 'connector')
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
}

function moveConnectorDrag(event: PointerEvent) {
  if (!connectorDrag || connectorDrag.pointerId !== event.pointerId || !locator.value)
    return
  event.preventDefault()
  event.stopPropagation()
  const box = connectorDrag.slideBox
  const dx = (event.clientX - connectorDrag.startX) / box.width
  const dy = (event.clientY - connectorDrag.startY) / box.height
  const next = { ...connectorDrag.connector }
  if (connectorDrag.kind === 'start') {
    next.x1 = fraction(next.x1 + dx); next.y1 = fraction(next.y1 + dy)
  }
  else if (connectorDrag.kind === 'end') {
    next.x2 = fraction(next.x2 + dx); next.y2 = fraction(next.y2 + dy)
  }
  else {
    // Translate as one rigid line. Constrain the delta rather than its two
    // endpoints, otherwise a line against a slide edge would shrink as the
    // pointer kept moving.
    Object.assign(next, translateConnector(next, dx, dy))
  }
  setLabelDraft(locator.value, next)
  scheduleDraftSave(connectorDrag)
}

async function endConnectorDrag(event: PointerEvent) {
  if (!connectorDrag || connectorDrag.pointerId !== event.pointerId || !locator.value)
    return
  event.preventDefault()
  event.stopPropagation()
  const session = connectorDrag
  connectorDrag = undefined
  endAnnotationDraftGesture(locator.value, 'connector')
  clearTimeout(draftSaveTimer)
  await saveDraft(locator.value, session)
}

function cancelConnectorDrag(event: PointerEvent) {
  if (!connectorDrag || connectorDrag.pointerId !== event.pointerId || !locator.value)
    return
  event.preventDefault()
  event.stopPropagation()
  const drag = connectorDrag
  connectorDrag = undefined
  endAnnotationDraftGesture(locator.value, 'connector')
  clearTimeout(draftSaveTimer)
  restoreCancelledDrag(locator.value, drag.previous, drag)
}

let keyboardSaveTimer: ReturnType<typeof setTimeout> | undefined

/** Arrow keys nudge the selected label or connector in slide fractions. */
function nudgeSelectedAnnotation(event: KeyboardEvent) {
  if (!annotationEditMode.value || selectedAnnotationId.value !== locator.value || labelDrag || connectorDrag || !locator.value)
    return
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
    return
  // Do not steal arrow keys from toolbar controls or a deck's editable text.
  // The width handle is deliberately a real button for accessibility, but it
  // is also an annotation control: its focused arrow keys must resize rather
  // than being discarded by the generic form-control guard.
  const target = event.target instanceof Element ? event.target : undefined
  const annotationControl = target?.closest('.annotation-width-handle, .annotation-connector-handle')
  if (!annotationControl && target?.closest('button, input, textarea, select, [contenteditable="true"]'))
    return

  const step = event.shiftKey ? .01 : .002
  const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
  const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
  const part = selectedAnnotationPart.value

  if ((part === 'label' || part === 'width') && editable.value) {
    if (part === 'width') {
      // Width is a horizontal dimension. Do not make Up/Down silently resize
      // a label just because they have no horizontal delta.
      if (!dx) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const slide = slideRoot()
      const label = labelEl.value
      if (!slide || !label)
        return
      // An unbounded label has no saved maximum yet. Materialize the width it
      // occupies now, so the first key press changes the visible label rather
      // than jumping to an unrelated default cap.
      const slideWidth = slide.getBoundingClientRect().width
      const overlayWidth = overlay.value?.getBoundingClientRect().width
      if (!overlayWidth)
        return
      const currentFraction = geometry.labelWidth === undefined
        ? label.getBoundingClientRect().width / slideWidth
        : localLabelWidthToSlideFraction(geometry.labelWidth, geometry.width, overlayWidth, slideWidth)
      setLabelDraft(locator.value, { ...labelPositionSeed(), width: nudgeLabelWidth(currentFraction, dx) })
    }
    else {
      const current = localConnectorFraction({ x: geometry.labelLeft, y: geometry.labelTop })
      if (!current)
        return
      setLabelDraft(locator.value, { x: fraction(current.x + dx), y: fraction(current.y + dy) })
    }
  }
  else if ((part === 'start' || part === 'end' || part === 'body') && connectorEditable.value && geometry.connectorStart && geometry.connectorEnd) {
    const start = localConnectorFraction(geometry.connectorStart)
    const end = localConnectorFraction(geometry.connectorEnd)
    if (!start || !end)
      return
    // Keep arrow-key body movement identical to dragging the line itself:
    // translation is constrained as one rigid segment at slide edges.
    const saved = manualConnector()
    const base = {
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      ...(saved?.cx !== undefined && saved.cy !== undefined ? { cx: saved.cx, cy: saved.cy } : {}),
    }
    const translated = nudgeConnector(base, part, dx, dy)
    setLabelDraft(locator.value, { ...translated } satisfies PersistedAnnotationGeometry)
  }
  else {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  // One debounce is intentional. Reusing the pointer-drag timer here creates
  // two writes for one key press; after a 409 the second would adopt the
  // conflict response's revision and overwrite the other author's geometry.
  clearTimeout(keyboardSaveTimer)
  keyboardSaveTimer = setTimeout(() => void saveDraft(locator.value!), 250)
}

function cancelActiveDrag(event: KeyboardEvent) {
  if (event.key !== 'Escape' || (!labelDrag && !connectorDrag) || !locator.value)
    return
  event.preventDefault()
  event.stopPropagation()
  const drag = labelDrag ?? connectorDrag
  const dragKind = labelDrag ? 'label' as const : 'connector' as const
  labelDrag = undefined
  connectorDrag = undefined
  endAnnotationDraftGesture(locator.value, dragKind)
  clearTimeout(draftSaveTimer)
  restoreCancelledDrag(locator.value, drag?.previous, drag!)
}

onMounted(() => {
  window.addEventListener('keydown', cancelActiveDrag, true)
  window.addEventListener('keydown', nudgeSelectedAnnotation, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', cancelActiveDrag, true)
  window.removeEventListener('keydown', nudgeSelectedAnnotation, true)
  clearTimeout(keyboardSaveTimer)
  clearTimeout(draftSaveTimer)
})
</script>

<template>
  <div
    ref="container"
    class="drawn-annotation"
    :class="{ 'is-fading-out': fadingOut }"
      >
    <!-- The marker takes part in Slidev's click ordering while component state
         drives the drawing. This avoids a mount-time v-click class race. -->
    <span ref="clickMarker" v-click="manualClicks || !hasExplicitStartClick ? false : atClick" class="click-marker annotation-ignore" />
    <span v-if="props.labelAt !== undefined" ref="labelMarker" v-click="manualClicks ? false : props.labelAt" class="click-marker annotation-ignore" />
    <svg
      ref="overlay"
      class="annotation-overlay annotation-ignore"
      :viewBox="`0 0 ${geometry.width} ${geometry.height}`"
      preserveAspectRatio="none"
      :aria-hidden="!(connectorEditable && annotationEditMode)"
      :role="connectorEditable && annotationEditMode ? 'group' : undefined"
      :aria-label="connectorEditable && annotationEditMode ? `Connector editor for ${locator}` : undefined"
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
      <!-- Development-only hit targets deliberately live in the shared SVG
           canvas, so their coordinates match the persisted connector. -->
      <g
        v-if="connectorEditable && annotationEditMode && geometry.connectorStart && geometry.connectorEnd"
        class="annotation-connector-editor"
        @click.stop
      >
        <line
          class="annotation-connector-hit"
          :x1="geometry.connectorStart.x" :y1="geometry.connectorStart.y"
          :x2="geometry.connectorEnd.x" :y2="geometry.connectorEnd.y"
          role="button"
          tabindex="0"
          aria-label="Move connector"
          @focus="selectAnnotation(locator!, 'body')"
          @pointerdown="beginConnectorDrag($event, 'body')"
          @pointermove="moveConnectorDrag"
          @pointerup="endConnectorDrag"
          @pointercancel="cancelConnectorDrag"
        />
        <circle
          v-for="(point, index) in [geometry.connectorStart, geometry.connectorEnd]"
          :key="index"
          class="annotation-connector-handle"
          :cx="point.x" :cy="point.y" r="9"
          :aria-label="index ? 'Move connector end' : 'Move connector start'"
          role="button"
          tabindex="0"
          @focus="selectAnnotation(locator!, index ? 'end' : 'start')"
          @pointerdown.stop="beginConnectorDrag($event, index ? 'end' : 'start')"
          @pointermove="moveConnectorDrag"
          @pointerup="endConnectorDrag"
          @pointercancel="cancelConnectorDrag"
        />
      </g>
    </svg>
    <!-- In authoring mode the label itself is the keyboard target for moving
         it. It must not remain aria-hidden: otherwise the selected width
         handle nested below is invisible to assistive technology. Outside
         that development-only mode the positioned copy stays presentation
         only; the live region after the slot announces its text instead. -->
    <div
      v-if="hasLabel"
      ref="labelEl"
      class="annotation-label annotation-ignore"
      :class="{ 'is-active': labelActive && geometry.ready, 'is-placed': geometry.labelPlaced, 'is-editable': editable && annotationEditMode, 'is-selected-for-editing': selectedForEditing }"
      :data-click="resolvedLabelClick"
      @pointerdown="beginLabelDrag($event)"
      @pointermove="moveLabelDrag"
      @pointerup="endLabelDrag"
      @pointercancel="cancelLabelDrag"
      @click="stopEditorClick"
      :style="{
        '--annotation-color': props.color,
        '--label-delay': `${delays.label}ms`,
        '--label-fade': `${LABEL_FADE_DURATION}ms`,
        'left': `${geometry.labelLeft}px`,
        'top': `${geometry.labelTop}px`,
        'maxWidth': geometry.labelWidth === undefined ? undefined : `${geometry.labelWidth}px`,
      }"
      :tabindex="editable && annotationEditMode ? 0 : undefined"
      :aria-label="editable && annotationEditMode ? `Move annotation label ${locator}` : undefined"
      :aria-hidden="!(editable && annotationEditMode)"
      @focus="selectAnnotation(locator!, 'label')"
    >
      {{ props.label }}
      <button
        v-if="selectedForEditing"
        class="annotation-width-handle"
        type="button"
        aria-label="Resize annotation label"
        title="Drag to resize label"
        @pointerdown.stop="beginLabelDrag($event, true)"
        @pointermove="moveLabelDrag"
        @pointerup="endLabelDrag"
        @pointercancel="cancelLabelDrag"
        @focus.stop="selectAnnotation(locator!, 'width')"
      />
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
    stroke-dashoffset 1ms linear var(--exit-fade, 300ms),
    opacity var(--exit-fade, 300ms) ease-out;
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
  transition: opacity var(--label-fade, 250ms) ease-out;
}

/* Measured before it is placed, so keep it laid out but invisible until then. */
.annotation-label.is-placed { visibility: visible; }

.annotation-label.is-active {
  opacity: 1;
  transition-delay: var(--label-delay);
}

/* Enabled only in Vite development by Alt+Shift+A. */
.annotation-label.is-editable { pointer-events: auto; cursor: grab; }
.annotation-label.is-editable:active { cursor: grabbing; }
.annotation-label.is-selected-for-editing { outline: 1px dashed currentColor; outline-offset: 6px; }
.annotation-width-handle {
  position: absolute;
  right: -12px;
  top: 50%;
  width: 12px;
  height: 28px;
  transform: translateY(-50%);
  padding: 0;
  border: 2px solid currentColor;
  border-radius: 3px;
  background: Canvas;
  cursor: ew-resize;
}
.annotation-connector-editor { pointer-events: auto; }
.annotation-connector-hit {
  stroke: transparent;
  stroke-width: 24px;
  cursor: move;
}
.annotation-connector-handle {
  fill: Canvas;
  stroke: currentColor;
  stroke-width: 2px;
  cursor: crosshair;
}
@media print {
  .annotation-width-handle { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .annotation-stroke,
  .annotation-label {
    transition-duration: 1ms !important;
    transition-delay: 0ms !important;
  }
}
</style>
