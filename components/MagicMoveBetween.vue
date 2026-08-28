<script setup lang="ts">
import type { KeyedTokensInfo } from '@shikijs/magic-move/types'
import type { PropType } from 'vue'
import { ShikiMagicMovePrecompiled } from '@shikijs/magic-move/vue'
import { useNav, useSlideContext } from '@slidev/client'
import { CLICKS_MAX } from '@slidev/client/constants.ts'
import { configs } from '@slidev/client/env.ts'
import TitleIcon from '@slidev/client/internals/TitleIcon.vue'
import { makeId, updateCodeHighlightRange } from '@slidev/client/logic/utils.ts'
import { useClipboard, useStyleTag } from '@vueuse/core'
import lz from 'lz-string'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

// Cross-slide Magic Move. The codeblock transformer in `setup/transformers.ts`
// emits one instance per code window on every slide of a `magic-move` chain,
// with `steps` holding the code of the whole chain and `step` pinned to this
// slide's position in it. Navigating between two chained slides animates the
// tokens from the neighbour's step to ours, like a classic Magic Move block
// does on clicks.
const props = defineProps({
  stepsLz: {
    type: String,
    required: true,
  },
  /** This slide's position in the chain of code snippets. */
  step: {
    type: Number,
    required: true,
  },
  /**
   * Identifier shared by the whole chain. Used as `view-transition-name` so
   * decks with `transition: view-transition` pair the code windows of both
   * slides instead of cross-fading them with the rest of the page.
   */
  navKey: {
    type: String,
    required: true,
  },
  title: {
    type: String,
    default: '',
  },
  duration: {
    type: Number,
    default: configs.magicMoveDuration,
  },
  /**
   * `{1|2-3}` highlight ranges of this slide's fence. Extra ranges register
   * as clicks on this slide, exactly like one step of a classic magic-move
   * block steps through its ranges.
   */
  stepRanges: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  /** Click at which the first extra highlight range activates. */
  at: {
    type: [String, Number],
    default: '+1',
  },
  /** Line numbers are baked into the precompiled steps; declared so the fence option doesn't land on the DOM. */
  lines: {
    type: Boolean,
    default: configs.lineNumbers,
  },
})

const steps = JSON.parse(lz.decompressFromBase64(props.stepsLz)) as KeyedTokensInfo[]
const { $page, $scale: scale, $zoom: zoom, $frontmatter, $clicksContext: clicks } = useSlideContext()
const { currentSlideNo, isPrintMode } = useNav()
const container = ref<HTMLElement>()

const stepIndex = ref(props.step)
// The animation duration is 0 until we are deliberately moving between steps,
// so re-renders (theme switch, HMR) never replay the transition.
const animated = ref(false)

watch(currentSlideNo, async (to, from) => {
  if (isPrintMode.value)
    return
  if (to !== $page.value) {
    // Reset silently while hidden so a revisit starts from a clean state.
    animated.value = false
    stepIndex.value = props.step
    return
  }
  const fromStep = from === $page.value - 1
    ? props.step - 1
    : from === $page.value + 1
      ? props.step + 1
      : null
  if (fromStep === null || fromStep < 0 || fromStep >= steps.length)
    return
  // First render the neighbour's code without animation, wait for the slide
  // to become visible (the renderer measures real token positions), then move
  // to our own step with the animation enabled.
  animated.value = false
  stepIndex.value = fromStep
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(resolve))
  animated.value = true
  stepIndex.value = props.step
  // The animation rebuilt the token elements; re-apply the highlight range.
  await nextTick()
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
const viewTransitionName = computed(() =>
  !isPrintMode.value && currentSlideNo.value === $page.value ? props.navKey : 'none',
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
    return stepIndex.value === steps.length - 1
  return false
})
const { copied, copy } = useClipboard()

function copyCode() {
  const currentStep = steps[stepIndex.value]
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
      class="slidev-code relative shiki overflow-visible"
      :steps="steps"
      :step="stepIndex"
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

<style>
.magic-move-between .shiki-magic-move-enter-from,
.magic-move-between .shiki-magic-move-leave-to {
  opacity: 0;
}
</style>
