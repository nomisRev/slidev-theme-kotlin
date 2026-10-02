/**
 * Preload this hook into Slidev's CLI exporter. Its page-level network wait
 * happens before screenshot scrolling, which can start viewport-triggered
 * reveals. Wait on the actual slide after scrolling and before every PNG.
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// Use the same Playwright installation the exporter resolves from the deck.
const require = createRequire(resolve('package.json'))
const playwright = await import(require.resolve('playwright-chromium'))
const { chromium } = playwright.default ?? playwright

async function settleSlide(slide, timeout = 30_000) {
  await slide.scrollIntoViewIfNeeded()
  await slide.evaluate(async (root, timeout) => {
    await document.fonts.ready
    const deadline = performance.now() + timeout
    let previous
    let stableSince = performance.now()
    // CSS/Web Animations expose their lifetime, while Motion's spring-based
    // reveals update styles. Check both, including late-starting effects.
    while (performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50))
      const animations = root.getAnimations({ subtree: true })
      const running = animations.some(animation =>
        (animation.playState === 'running' || animation.pending)
        && animation.effect?.getComputedTiming().iterations !== Infinity,
      )
      const looping = new Set(animations
        .filter(animation => animation.effect?.getComputedTiming().iterations === Infinity)
        .map(animation => animation.effect?.target))
      const elements = [root, ...root.querySelectorAll('*')]
      const current = JSON.stringify(elements.filter(element => !looping.has(element)).map(element => {
        const style = getComputedStyle(element)
        return [style.opacity, style.transform, element.getAttribute('style'), element.getAttribute('class')]
      }))
      if (running || current !== previous)
        stableSince = performance.now()
      previous = current
      if (!running && performance.now() - stableSince >= 250)
        return
    }
    throw new Error(`Slide ${root.id} did not settle within ${timeout}ms`)
  }, timeout)
}

const launch = chromium.launch.bind(chromium)
let patched = false
chromium.launch = async (...args) => {
  const browser = await launch(...args)
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (options = {}) => {
    const viewport = options.viewport
    const context = await newContext(viewport ? {
      ...options,
      viewport: { ...viewport, height: Math.min(viewport.height, viewport.width * 2) },
    } : options)
    const newPage = context.newPage.bind(context)
    context.newPage = async (...args) => {
      const page = await newPage(...args)
      if (!patched) {
        const prototype = Object.getPrototypeOf(page.locator('body'))
        const screenshot = prototype.screenshot
        prototype.screenshot = async function (options) {
          // The one-piece exporter uses a viewport as tall as the whole deck.
          // Chromium can return blank/clipped layers at that size. Slidev's
          // print containers keep their own canvas dimensions; only their
          // viewport needs to fit a single slide before scrolling/capture.
          const page = this.page()
          const box = await this.boundingBox()
          const viewport = page.viewportSize()
          if (box && viewport && viewport.height > Math.ceil(box.height))
            await page.setViewportSize({ width: viewport.width, height: Math.ceil(box.height) })
          await settleSlide(this)
          return screenshot.call(this, options)
        }
        patched = true
      }
      return page
    }
    return context
  }
  return browser
}
