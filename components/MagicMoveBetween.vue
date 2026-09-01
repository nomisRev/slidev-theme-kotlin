<script setup lang="ts">
import type { KeyedTokensInfo } from '@shikijs/magic-move/types'
import { ShikiMagicMovePrecompiled } from '@shikijs/magic-move/vue'
import { useIsSlideActive, useNav, useSlideContext } from '@slidev/client'
import { CLICKS_MAX } from '@slidev/client/constants.ts'
import { configs } from '@slidev/client/env.ts'
import TitleIcon from '@slidev/client/internals/TitleIcon.vue'
import { makeId, updateCodeHighlightRange } from '@slidev/client/logic/utils.ts'
import { useClipboard, useStyleTag } from '@vueuse/core'
import lz from 'lz-string'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

// Cross-slide Magic Move. The codeblock transformer in `setup/transformers.ts`
// emits one instance per code window on every slide of a `magic-move` chain,
// with `steps` holding the code of the whole chain and `step` pinned to this
// slide's position in it. Navigating between two chained slides animates the
// tokens from the neighbour's step to ours, like a classic Magic Move block
// does on clicks.
const props = withDefaults(defineProps<{
  stepsLz: string
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

// The transformer emits `steps-lz` as a static attribute, so this computes
// once per payload — but a corrupt payload must not take the whole slide down
// with it, and an HMR edit can hand the same instance a new payload.
const steps = computed<KeyedTokensInfo[]>(() => {
  try {
    const decompressed = lz.decompressFromBase64(props.stepsLz)
    const parsed = decompressed ? JSON.parse(decompressed) : null
    if (Array.isArray(parsed) && parsed.length)
      return parsed
    console.error('[MagicMoveBetween] The precompiled steps decoded to nothing — the code window is not rendered.')
  }
  catch (error) {
    console.error('[MagicMoveBetween] Could not parse the precompiled steps — the code window is not rendered.', error)
  }
  return []
})
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

// Guards the awaits in the watcher below: rapid navigation re-enters it, and
// a stale continuation resuming after its awaits must not replay the animation
// or overwrite the step a newer navigation already settled on.
let navigationEpoch = 0

// HMR patches this existing component instance rather than remounting it. Pin
// it to the new payload's declared step and invalidate a navigation watcher
// continuation that may otherwise restore the previous payload's step.
watch([() => props.stepsLz, () => props.step], () => {
  navigationEpoch++
  animated.value = false
  stepIndex.value = props.step
  void nextTick(applyHighlight)
})

watch(currentSlideNo, async (to, from) => {
  if (isPrintMode.value)
    return
  const epoch = ++navigationEpoch
  if (to !== $page.value) {
    // Reset silently while hidden so a revisit starts from a clean state.
    animated.value = false
    stepIndex.value = props.step
    return
  }
  // The transformer supplies the page-to-step map with every payload it
  // compiles. A map that does not place this step on this page means payload
  // and slide are out of sync (mid-HMR, say): skip the animation over guessing.
  const pages = props.stepPages
  if (pages.length !== steps.value.length || pages[props.step] !== $page.value)
    return
  const fromStep = pages.indexOf(from)
  if (fromStep < 0 || fromStep === props.step)
    return
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
useStyleTag(`
::view-transition-old(${props.navKey}) { display: none; }
::view-transition-new(${props.navKey}) { animation: none; mix-blend-mode: normal; }
::view-transition-group(${props.navKey}) {
  animation-duration: 0.5s;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
`)

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
    :style="{ 'view-transition-name': viewTransitionName }"
  >
    <div v-if="title" class="slidev-code-block-title">
      <TitleIcon :title="title" />
      <div class="leading-1em">
        {{ title.replace(/~([^~]+)~/g, '').trim() }}
      </div>
    </div>
    <ShikiMagicMovePrecompiled
      v-if="steps.length"
      class="slidev-code relative shiki overflow-visible"
      :steps="steps"
      :step="renderedStep"
      :animate="!isPrintMode"
      :options="{
        globalScale: scale * zoom,
        duration: animated ? duration : 0,
        stagger: 1,
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

<style scoped>
/* The classes live on tokens the Magic Move renderer creates inside the child
   component, so they need :deep() to be reached from scoped CSS. */
:deep(.shiki-magic-move-enter-from),
:deep(.shiki-magic-move-leave-to) {
  opacity: 0;
}
</style>
