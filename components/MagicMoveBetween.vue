<script lang="ts">
import type { KeyedTokensInfo } from '@shikijs/magic-move/types'

/**
 * The transformer in `setup/transformers.ts` emits the chain's precompiled
 * steps as one JSON attribute. A corrupt payload must not take the whole
 * slide down with it, so a parse failure renders no code window and says so.
 * Each instance parses its own copy: `syncTokenKeys` rewrites token keys in
 * place while animating, so sharing parsed steps between the windows of a
 * chain would let one window's pairing leak into another's.
 */
function parseSteps(stepsJson: string): KeyedTokensInfo[] {
  try {
    const decoded = JSON.parse(stepsJson)
    if (Array.isArray(decoded) && decoded.length)
      return decoded
    console.error('[MagicMoveBetween] The precompiled steps decoded to nothing — the code window is not rendered.')
  }
  catch (error) {
    console.error('[MagicMoveBetween] Could not parse the precompiled steps — the code window is not rendered.', error)
  }
  return []
}
</script>

<script setup lang="ts">
import { useIsSlideActive, useNav, useSlideContext } from '@slidev/client'
import { CLICKS_MAX } from '@slidev/client/constants.ts'
import { configs } from '@slidev/client/env.ts'
import TitleIcon from '@slidev/client/internals/TitleIcon.vue'
import { makeId, updateCodeHighlightRange } from '@slidev/client/logic/utils.ts'
import { useClipboard, useStyleTag } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { MagicMovePrecompiled } from './magic-move/batched-renderer'

// Cross-slide Magic Move. The codeblock transformer in `setup/transformers.ts`
// emits one instance per code window on every slide of a `magic-move` chain,
// with `steps` holding the code of the whole chain and `step` pinned to this
// slide's position in it. Navigating between two chained slides animates the
// tokens from the neighbour's step to ours, like a classic Magic Move block
// does on clicks.
const props = withDefaults(defineProps<{
  /** Every step of the chain, precompiled by the transformer, as JSON. */
  stepsJson: string
  /** This slide's position in the chain of code snippets. */
  step: number
  /**
   * 1-based page numbers of the chain slides contributing each step, one per
   * step. A chain slide without a fence at this position contributes no step,
   * so page adjacency alone would morph from the wrong (non-adjacent) step —
   * the map is required, and a map that does not match the payload disables
   * the animation rather than guessing.
   */
  stepPages: number[]
  /**
   * Identifier shared by the whole chain. Used as `view-transition-name` so
   * decks with `transition: view-transition` pair the code windows of both
   * slides instead of cross-fading them with the rest of the page.
   */
  navKey: string
  title?: string
  duration?: number
  /**
   * `{1|2-3}` highlight ranges of this slide's fence. Extra ranges register
   * as clicks on this slide, exactly like one step of a classic magic-move
   * block steps through its ranges.
   */
  stepRanges?: string[]
  /** Click at which the first extra highlight range activates. */
  at?: string | number
  /** Line numbers are baked into the precompiled steps; declared so the fence option doesn't land on the DOM. */
  lines?: boolean
}>(), {
  title: '',
  duration: configs.magicMoveDuration,
  stepRanges: () => [],
  at: '+1',
  lines: configs.lineNumbers,
})

// The transformer emits `steps-json` as a static attribute, so this computes
// once per payload; an HMR edit can hand the same instance a new one.
const steps = computed<KeyedTokensInfo[]>(() => parseSteps(props.stepsJson))
const { $page, $scale: scale, $zoom: zoom, $frontmatter, $clicksContext: clicks } = useSlideContext()
const { currentSlideNo, isPrintMode } = useNav()
const container = useTemplateRef<HTMLElement>('container')

const stepIndex = ref(props.step)
// Keep rendering in bounds even for a transient HMR prop patch where the
// payload has changed before its synchronizing watcher has run.
const renderedStep = computed(() =>
  Math.max(0, Math.min(stepIndex.value, steps.value.length - 1)),
)
// The animation duration is 0 until we are deliberately moving between steps,
// so re-renders (theme switch, HMR) never replay the transition.
const animated = ref(false)

// A slide transition such as `fade` keeps the old slide on screen while the
// new one fades in. The neighbour's window is morphing this window's code by
// then, so the old copy is hidden for the fade instead of ghosting over it.
// (With `transition: view-transition` the same job is done by hiding the
// window's old snapshot, see the style tag below.)
const departing = ref(false)
// Its counterpart on the arriving slide: this window is morphing from the
// neighbour's code, so the fade must leave it at full opacity and fade only
// the content around it (see the unscoped style block below).
const arriving = ref(false)

// Guards the awaits in the watcher below: rapid navigation re-enters it, and
// a stale continuation resuming after its awaits must not replay the animation
// or overwrite the step a newer navigation already settled on.
let navigationEpoch = 0

// HMR patches this existing component instance rather than remounting it. Pin
// it to the new payload's declared step and invalidate a navigation watcher
// continuation that may otherwise restore the previous payload's step.
watch([() => props.stepsJson, () => props.step], () => {
  navigationEpoch++
  animated.value = false
  stepIndex.value = props.step
  void nextTick(applyHighlight)
})

watch(currentSlideNo, async (to, from) => {
  if (isPrintMode.value)
    return
  const epoch = ++navigationEpoch
  const pages = props.stepPages
  if (to !== $page.value) {
    // Hide only when the neighbour takes over this window's code.
    if (from === $page.value)
      departing.value = pages.includes(to)
    // Reset silently while hidden so a revisit starts from a clean state.
    arriving.value = false
    animated.value = false
    stepIndex.value = props.step
    return
  }
  departing.value = false
  // The transformer supplies the page-to-step map with every payload it
  // compiles. A map that does not place this step on this page means payload
  // and slide are out of sync (mid-HMR, say): skip the animation over guessing.
  if (pages.length !== steps.value.length || pages[props.step] !== $page.value)
    return
  const fromStep = pages.indexOf(from)
  if (fromStep < 0 || fromStep === props.step)
    return
  // Set before the render that applies the slide transition's classes, so the
  // slide never paints a transparent root first.
  arriving.value = true
  // First render the neighbour's code without animation, wait for the slide
  // to become visible (the renderer measures real token positions), then move
  // to our own step with the animation enabled.
  animated.value = false
  stepIndex.value = fromStep
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(resolve))
  if (epoch !== navigationEpoch)
    return
  animated.value = true
  stepIndex.value = props.step
  // The animation rebuilt the token elements; re-apply the highlight range.
  await nextTick()
  if (epoch !== navigationEpoch)
    return
  applyHighlight()
})

// Click-based line highlighting, mirroring one step of Slidev's builtin
// ShikiMagicMove component.
const ranges = computed(() => props.stepRanges.length ? props.stepRanges : ['all'])
const currentRange = ref('all')
const id = makeId()
let highlightEpoch = 0

async function applyHighlight() {
  const epoch = ++highlightEpoch
  // Let the renderer patch the DOM first (same tick-skip as the builtin).
  await new Promise(resolve => setTimeout(resolve, 0))
  if (epoch !== highlightEpoch)
    return
  const pre = container.value?.querySelector('.shiki') as HTMLElement | null
  if (!pre)
    return
  const children = (Array.from(pre.children) as HTMLElement[])
    .slice(1) // Remove the first anchor
    .filter(i => !i.className.includes('shiki-magic-move-leave'))
  // Group to lines between `<br>`
  const lines = children.reduce((acc, el) => {
    if (el.tagName === 'BR')
      acc.push([])
    else
      acc[acc.length - 1].push(el)
    return acc
  }, [[]] as HTMLElement[][])
  updateCodeHighlightRange(currentRange.value, lines.length, 1, no => lines[no])
}

onUnmounted(() => {
  clicks?.unregister(id)
})

onMounted(() => {
  if (!clicks)
    return
  const clickInfo = clicks.calculateSince(props.at, ranges.value.length - 1)
  clicks.register(id, clickInfo)

  watch(
    () => clicks.current,
    () => {
      const clickCount = clickInfo ? clicks.current - clickInfo.start : CLICKS_MAX
      currentRange.value = clickCount < ranges.value.length - 1
        ? ranges.value[Math.max(clickCount + 1, 0)]
        : 'all'
      applyHighlight()
    },
    { immediate: true },
  )
})

// Only the visible slide may claim the view-transition name: all slides of
// the deck stay mounted, and duplicate names would cancel the transition.
const isSlideActive = useIsSlideActive()
const viewTransitionName = computed(() =>
  !isPrintMode.value && isSlideActive.value ? props.navKey : 'none',
)

// The View Transitions API would cross-fade a snapshot of the old code window
// on top of the live token animation. Hide the old snapshot and show the new
// (live) one immediately; the group animation still moves the window itself.
// The rules only depend on the chain, so every window of a chain shares one
// style element (vueuse reference-counts it by id) instead of each adding its
// own copy of three `::view-transition-*` rules to the document.
useStyleTag(`
::view-transition-old(${props.navKey}) { display: none; }
::view-transition-new(${props.navKey}) { animation: none; mix-blend-mode: normal; }
::view-transition-group(${props.navKey}) {
  animation-duration: 0.5s;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
`, { id: `${props.navKey}-style` })

const showCopyButton = computed(() => {
  const codeCopy = $frontmatter?.codeCopy ?? configs.codeCopy
  if (!codeCopy)
    return false
  const magicCopy = $frontmatter?.magicMoveCopy ?? configs.magicMoveCopy
  if (!magicCopy)
    return false
  if (magicCopy === true || magicCopy === 'always')
    return true
  if (magicCopy === 'final')
    return stepIndex.value === steps.value.length - 1
  return false
})
const { copied, copy } = useClipboard()

function copyCode() {
  const currentStep = steps.value[stepIndex.value]
  if (currentStep?.code)
    copy(currentStep.code.trim())
}
</script>

<template>
  <div
    ref="container"
    class="slidev-code-wrapper slidev-code-magic-move magic-move-between relative group"
    :class="{ 'magic-move-between--departing': departing, 'magic-move-between--arriving': arriving }"
    :style="{ 'view-transition-name': viewTransitionName }"
  >
    <div v-if="title" class="slidev-code-block-title">
      <TitleIcon :title="title" />
      <div class="leading-1em">
        {{ title.replace(/~([^~]+)~/g, '').trim() }}
      </div>
    </div>
    <MagicMovePrecompiled
      v-if="steps.length"
      class="slidev-code relative shiki overflow-visible"
      :steps="steps"
      :step="renderedStep"
      :animate="!isPrintMode"
      :options="{
        globalScale: scale * zoom,
        duration: animated ? duration : 0,
        stagger: 1,
        // The window grows or shrinks from the first frame, alongside the
        // slide transition, instead of after Shiki's default 40% delay.
        delayContainer: 0,
      }"
    />
    <button
      v-if="showCopyButton"
      class="slidev-code-copy absolute right-0 transition opacity-0 group-hover:opacity-20 hover:!opacity-100"
      :class="title ? 'top-10' : 'top-0'"
      :title="copied ? 'Copied' : 'Copy'" @click="copyCode()"
    >
      <ph-check-circle v-if="copied" class="p-2 w-8 h-8" />
      <ph-clipboard v-else class="p-2 w-8 h-8" />
    </button>
  </div>
</template>

<style>
/* Slidev's `fade` transitions the opacity of the whole slide root. On a chain
   slide that fades the morphing code window along with everything else: the
   departing copy is hidden at once and the arriving copy starts transparent,
   so the window blinks out and fades back in halfway through its own
   animation. Keep the root of a morphing slide opaque and fade the content
   around the window instead: every element that neither is nor contains a
   morphing window, at the topmost level where that holds, so nested opacities
   never compound. The root keeps Slidev's own `transition` declaration, which
   is where Vue reads the transition's duration from. These rules target the
   slide root, an ancestor of this component, so they cannot be scoped. */
.slidev-page.fade-enter-from:has(.magic-move-between--arriving),
.slidev-page.fade-leave-to:has(.magic-move-between--departing) {
  opacity: 1;
}

:is(.slidev-page.fade-enter-active, .slidev-page.fade-enter-active *):has(.magic-move-between--arriving)
  > :not(.magic-move-between--arriving, :has(.magic-move-between--arriving)),
:is(.slidev-page.fade-leave-active, .slidev-page.fade-leave-active *):has(.magic-move-between--departing)
  > :not(.magic-move-between--departing, :has(.magic-move-between--departing)) {
  transition: opacity var(--slidev-transition-duration) ease;
}

:is(.slidev-page.fade-enter-from, .slidev-page.fade-enter-from *):has(.magic-move-between--arriving)
  > :not(.magic-move-between--arriving, :has(.magic-move-between--arriving)),
:is(.slidev-page.fade-leave-to, .slidev-page.fade-leave-to *):has(.magic-move-between--departing)
  > :not(.magic-move-between--departing, :has(.magic-move-between--departing)) {
  opacity: 0;
}
</style>

<style scoped>
/* The slide this window belongs to is fading out while its neighbour morphs
   the same code: only the neighbour's copy may be visible. */
.magic-move-between--departing {
  visibility: hidden;
}

/* The classes live on tokens the Magic Move renderer creates inside the child
   component, so they need :deep() to be reached from scoped CSS. */
:deep(.shiki-magic-move-enter-from),
:deep(.shiki-magic-move-leave-to) {
  opacity: 0;
}
</style>
