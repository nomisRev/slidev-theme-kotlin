<script setup lang="ts">
import NoSleep from 'nosleep.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { createClicksContextBase } from '@slidev/client/composables/useClicks.ts'
import { useNav } from '@slidev/client/composables/useNav.ts'
import NoteStatic from '@slidev/client/internals/NoteStatic.vue'
import SlideContainer from '@slidev/client/internals/SlideContainer.vue'
import SlideWrapper from '@slidev/client/internals/SlideWrapper.vue'
import { wakeLockEnabled } from '@slidev/client/state/storage.ts'
import { remoteConnection } from './connection'

const {
  clicksContext,
  currentSlideNo,
  currentSlideRoute,
  go,
  hasNext,
  nextRoute,
  nextSlide,
  prevSlide,
  slides,
} = useNav()

// A phone that locks mid-talk is a dead remote. The Wake Lock API needs a
// secure context, which `http://<lan address>` is not, so NoSleep falls back
// to a silent looping video there. Either way it has to start from a tap.
const noSleep = new NoSleep()
function keepAwake() {
  if (wakeLockEnabled.value && !noSleep.isEnabled)
    void noSleep.enable().catch(() => {})
}
onBeforeUnmount(() => noSleep.disable())

// A deck with `transition: view-transition` animates on this route too, and
// while a view transition runs the browser hit-tests every tap to the root
// element, past anything inside the page. So the taps are heard on the
// document, and the class below ends those transitions at once: on the phone
// they would only delay the next slide's preview.
onMounted(() => {
  document.addEventListener('click', navigate)
  document.documentElement.classList.add('remote-control-active')
})
onBeforeUnmount(() => {
  document.removeEventListener('click', navigate)
  document.documentElement.classList.remove('remote-control-active')
})

/** Wait until the slide that just became current has registered its clicks. */
async function clicksRegistered() {
  await currentSlideRoute.value.load?.()
  for (let attempt = 0; attempt < 80 && !clicksContext.value.isMounted; attempt++)
    await new Promise(resolve => setTimeout(resolve, 25))
}

const status = computed(() => {
  if (!remoteConnection.enabled)
    return undefined
  if (remoteConnection.rejected)
    return 'This remote link has expired. Scan the code again.'
  if (!remoteConnection.connected)
    return 'Reconnecting…'
  if (!remoteConnection.canWrite)
    return 'View only. Scan the code printed by the present command to drive the slides.'
  if (remoteConnection.displays === 0)
    return 'No display connected. Open the display link on the laptop.'
  return `Connected · ${remoteConnection.displays} display${remoteConnection.displays === 1 ? '' : 's'}`
})

const previewRoute = computed(() => {
  if (!hasNext.value)
    return undefined
  if (clicksContext.value.current < clicksContext.value.total)
    return currentSlideRoute.value
  return nextRoute.value
})

const previewClicks = computed(() => previewRoute.value === currentSlideRoute.value
  ? clicksContext.value.current + 1
  : previewRoute.value?.meta.slide?.frontmatter.clicksStart ?? 0)
const previewContext = computed(() => createClicksContextBase(
  previewClicks,
  previewRoute.value?.meta.slide?.frontmatter.clicksStart ?? 0,
  previewRoute.value?.meta.clicks,
))

// Load only the two slides used by the remote. SlidesShow mounts the whole deck.
watchEffect(() => {
  void currentSlideRoute.value.load()
  void previewRoute.value?.load()
})

const navigating = ref(false)
async function navigate(event: MouseEvent) {
  if ((event.target as Element | null)?.closest?.('a, button, input, textarea, select'))
    return

  keepAwake()
  if (navigating.value)
    return
  navigating.value = true
  try {
    if (event.clientX < window.innerWidth / 2) {
      if (clicksContext.value.current > clicksContext.value.clicksStart)
        await go(currentSlideNo.value, clicksContext.value.current - 1)
      else if (currentSlideNo.value > 1) {
        // Land on the previous slide's last click. Its total is only known
        // once it has mounted here, which after a reload it has not: ask for
        // the maximum, as Slidev's own `prev` does, and the slide clamps the
        // position when it mounts. The display shows the final state at once.
        await prevSlide(true)
        await clicksRegistered()
      }
    }
    else if (clicksContext.value.current < clicksContext.value.total) {
      await go(currentSlideNo.value, clicksContext.value.current + 1)
    }
    else {
      await nextSlide()
    }
    await nextTick()
  }
  finally {
    navigating.value = false
  }
}
</script>

<template>
  <main class="remote-control" aria-label="Tap the left half to go back and the right half to advance">
    <!-- Mount the current slide so Slidev registers its v-click steps. -->
    <SlideContainer class="current-clicks-context" aria-hidden="true">
      <SlideWrapper
        :key="currentSlideRoute.no"
        :route="currentSlideRoute"
        :clicks-context="clicksContext"
        render-context="presenter"
      />
    </SlideContainer>

    <section class="next-slide" aria-label="Upcoming slide preview">
      <SlideContainer v-if="previewRoute" class="preview">
        <SlideWrapper
          :key="`${previewRoute.no}-${previewClicks}`"
          :route="previewRoute"
          :clicks-context="previewContext"
          render-context="previewNext"
        />
      </SlideContainer>
      <div v-else class="end-of-deck">End of presentation</div>
    </section>

    <div class="slide-count" aria-live="polite">{{ currentSlideNo }} / {{ slides.length }}</div>

    <div v-if="status" class="connection-status" role="status">{{ status }}</div>

    <section class="speaker-notes" aria-label="Speaker notes">
      <NoteStatic :key="currentSlideNo" :no="currentSlideNo" :clicks-context="clicksContext" class="notes-content" />
    </section>
  </main>
</template>

<style scoped>
:global(html.dark) .remote-control {
  --remote-control-color: #e8e8e8;
  --remote-control-muted-color: #a0a0a0;
  --remote-control-background: #19191c;
  --remote-control-preview-background: #000;
  --remote-control-edge-color: #4a4a4f;
}

.remote-control {
  box-sizing: border-box;
  --remote-control-color: #1d1d1d;
  --remote-control-muted-color: #666;
  --remote-control-background: #f9fafb;
  --remote-control-preview-background: #fff;
  --remote-control-edge-color: #c9c9c9;
  min-height: 100dvh;
  color: var(--remote-control-color);
  background: var(--remote-control-background);
  /* Taps are the whole interface: no double-tap zoom, selection or callout. */
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  display: grid;
  grid-template-rows: minmax(14rem, 43dvh) minmax(0, 1fr);
  cursor: pointer;
  font-family: 'JetBrains Sans', system-ui, sans-serif;
}

.current-clicks-context {
  position: fixed;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
}

.next-slide {
  position: relative;
  min-height: 0;
  overflow: hidden;
  background: var(--remote-control-preview-background);
}

.preview {
  width: 100%;
  height: 100%;
}

.end-of-deck {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--remote-control-muted-color);
  font-size: 1.25rem;
}

.slide-count {
  position: fixed;
  z-index: 1;
  top: calc(43dvh - 1.15rem);
  left: 50%;
  transform: translateX(-50%);
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--remote-control-background) 88%, transparent);
  color: var(--remote-control-muted-color);
  font-size: 0.8rem;
  pointer-events: none;
}

.speaker-notes {
  min-height: 0;
  overflow: auto;
  touch-action: pan-y;
  padding: 1.25rem max(1.25rem, env(safe-area-inset-right)) calc(1.25rem + env(safe-area-inset-bottom)) max(1.25rem, env(safe-area-inset-left));
}

.connection-status {
  position: fixed;
  bottom: env(safe-area-inset-bottom, 0px);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100% - 2rem);
  padding: 0.4rem 0.7rem;
  border-radius: 0.5rem;
  background: var(--remote-control-background);
  color: var(--remote-control-muted-color);
  font-size: 0.8rem;
  text-align: center;
  pointer-events: none;
}

:deep(.notes-content) { font-size: 1rem; line-height: 1.45; }
:deep(.notes-content > :first-child) { margin-top: 0; }

@media (min-width: 700px) {
  .remote-control {
    max-width: 31rem;
    margin: 0 auto;
    border-inline: 2px dotted var(--remote-control-edge-color);
    box-shadow: 0 0 2rem rgb(0 0 0 / 12%);
  }
}
</style>

<style>
html.remote-control-active::view-transition-group(*),
html.remote-control-active::view-transition-old(*),
html.remote-control-active::view-transition-new(*) {
  animation: none !important;
}
</style>
