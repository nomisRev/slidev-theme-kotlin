#!/usr/bin/env node
/**
 * Records every Magic Move transition of a fixture deck frame by frame and
 * reports each code annotation that stays where it is but still changes on
 * screen while the code around it moves: a blink.
 *
 * An annotation "stays" when its box is the same on the settled slide before
 * the transition and on the settled slide after it. Before the transition
 * starts, the deck is painted once with every annotation hidden: the pixels
 * that changes are the annotation. Every frame the browser paints during the
 * transition is then checked at exactly those pixels, and one that looks more
 * like the picture without the annotation than like the one with it is
 * missing there. A frame missing more than a quarter of an annotation is a
 * blink, and the report says how much and when.
 *
 * Usage:
 *   node scripts/transition-blink.mjs [--transition fade|view-transition|none]
 *        [--only <page>] [--backward] [--frames] [--check]
 *
 * `--frames` keeps the worst frame of every blink in `.visual/transition-blink`.
 * `--strip 0,200,600` keeps the whole frame at those moments of every step.
 * `--check` exits non-zero when anything blinks.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-chromium'
import { PNG } from 'pngjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const slidevCli = join(projectRoot, 'node_modules/@slidev/cli/bin/slidev.mjs')
const fixture = join(projectRoot, 'scripts/transition-blink.fixture.md')

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}
const transition = option('--transition', 'fade')
const only = option('--only')
const backward = args.includes('--backward')
const keepFrames = args.includes('--frames')
const check = args.includes('--check')
const verbose = args.includes('--verbose')
const strip = option('--strip')
const entryPath = option('--entry')
const outDir = join(projectRoot, '.visual/transition-blink', `${transition}${backward ? '-backward' : ''}`)

// Share of an annotation's pixels that may be missing before it is a blink.
const BLINK_RATIO = 0.25
// How far (summed over the channels) hiding an annotation has to move a pixel
// for that pixel to count as part of it.
const INK_CONTRAST = 36
// A pixel of the annotation is missing once it has lost this much of the way
// from its settled colour to the colour without the annotation.
const MISSING_AT = 0.6

/** Takes every annotation off the picture without moving anything else. */
const HIDE_ANNOTATIONS = `
#slideshow :is(.suspend-gutter-marker, .type-hint, .smart-cast-message, .warning-message, .inline-value,
  .inline-compiler-error-underline, .inline-compiler-error-message, .annotation-overlay, .annotation-label) {
  visibility: hidden !important;
}
#slideshow :is(.smart-cast-token, .warning-token) { background: transparent !important; transition: none !important; }
#slideshow [data-code-inlay]::after { visibility: hidden !important; }
`

/** What each annotation draws, by the element that carries it. */
const ANNOTATIONS = {
  'suspend gutter': '.suspend-gutter-marker',
  'type hint inlay': '[data-code-inlay]',
  'type hint pill': '.type-hint',
  'smart cast': '.smart-cast-token',
  'smart cast message': '.smart-cast-message',
  'warning': '.warning-token',
  'warning message': '.warning-message',
  'inline value': '.inline-value',
  'error squiggle': '.inline-compiler-error-underline',
  'error message': '.inline-compiler-error-message',
  'drawn mark': '.annotation-mark',
  'drawn connector': '.annotation-leader',
  'drawn label': '.annotation-label',
}

/** The steps to record: `[page, kind]`, where kind is a slide change or a click. */
function transitionsOf(source) {
  const lines = source.split(/\r?\n/)
  const steps = []
  let page = 0
  let inFence
  let classic = false
  for (let i = 0; i < lines.length; i++) {
    const fence = /^(`{3,})/.exec(lines[i])?.[1]
    if (fence) {
      if (!inFence) {
        inFence = fence
        if (fence.length > 3 && /magic-move/.test(lines[i]))
          classic = true
      }
      else if (fence === inFence) {
        inFence = undefined
      }
      continue
    }
    if (inFence || lines[i].trim() !== '---')
      continue
    // A separator: either a bare `---` or the opening of a frontmatter block.
    const close = lines.findIndex((line, j) => j > i && line.trim() === '---')
    const block = close > i && lines.slice(i + 1, close).every(line => /^[\w-]+(?::.*)?$|^\s+\S|^$/.test(line)) && lines.slice(i + 1, close).some(line => line.trim())
    if (classic)
      steps.push({ page, kind: 'click' })
    classic = false
    page++
    if (block) {
      if (lines.slice(i + 1, close).some(line => line.trim() === 'magic-move'))
        steps.push({ page: page - 1, kind: 'slide' })
      i = close
    }
  }
  return steps
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

async function waitForServer(url, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok)
        return
    }
    catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`Slidev did not answer on ${url}`)
}

/** Resolves once the page has painted nothing new for a while. */
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    let quietSince = performance.now()
    const deadline = quietSince + 8000
    while (performance.now() < deadline) {
      await new Promise(r => setTimeout(r, 50))
      const running = document.getAnimations().some(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity)
      if (running)
        quietSince = performance.now()
      if (performance.now() - quietSince > 700)
        return
    }
  })
}

/** The box of every annotation the visible slide draws, in viewport pixels. */
function annotationBoxes(page) {
  return page.evaluate((annotations) => {
    const boxes = []
    for (const [kind, selector] of Object.entries(annotations)) {
      for (const el of document.querySelectorAll(`#slideshow ${selector}`)) {
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
          continue
        if (el.closest('.shiki-magic-move-leave-active'))
          continue
        const rect = el.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1)
          continue
        boxes.push({
          kind,
          text: (el.getAttribute('data-code-inlay') ?? el.textContent ?? '').trim().slice(0, 40),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        })
      }
    }
    return boxes
  }, ANNOTATIONS)
}

function crop(png, box, pad = 2) {
  const x0 = Math.max(0, Math.floor(box.x - pad))
  const y0 = Math.max(0, Math.floor(box.y - pad))
  const x1 = Math.min(png.width, Math.ceil(box.x + box.width + pad))
  const y1 = Math.min(png.height, Math.ceil(box.y + box.height + pad))
  return { x0, y0, x1, y1 }
}

function distance(a, i, b, j) {
  return Math.abs(a.data[i] - b.data[j]) + Math.abs(a.data[i + 1] - b.data[j + 1]) + Math.abs(a.data[i + 2] - b.data[j + 2])
}

/** The pixels of `area` that hiding the annotations changes: the annotation itself. */
function inkPixels(withInk, withoutInk, area) {
  const pixels = []
  for (let y = area.y0; y < area.y1; y++) {
    for (let x = area.x0; x < area.x1; x++) {
      const i = (y * withInk.width + x) * 4
      const contrast = distance(withInk, i, withoutInk, i)
      if (contrast > INK_CONTRAST)
        pixels.push({ x, y, i, contrast })
    }
  }
  return pixels
}

/**
 * Share of an annotation's pixels that `frame` does not show. A view
 * transition paints the code window from a snapshot, which the browser
 * rasterises a touch softer than the live page and may place a pixel off;
 * neither is a blink, so a pixel is there when any pixel right next to it
 * still carries most of the annotation's colour.
 */
function missing(frame, withInk, pixels) {
  let gone = 0
  for (const { x, y, i, contrast } of pixels) {
    let closest = Number.POSITIVE_INFINITY
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = x + dx
        const py = y + dy
        if (px >= 0 && py >= 0 && px < frame.width && py < frame.height)
          closest = Math.min(closest, distance(withInk, i, frame, (py * frame.width + px) * 4))
      }
    }
    if (closest > contrast * MISSING_AT)
      gone++
  }
  return gone / Math.max(1, pixels.length)
}

function writeCrop(png, area, file, scale = 3) {
  const width = area.x1 - area.x0
  const height = area.y1 - area.y0
  const out = new PNG({ width: width * scale, height: height * scale })
  for (let y = 0; y < height * scale; y++) {
    for (let x = 0; x < width * scale; x++) {
      const from = ((area.y0 + Math.floor(y / scale)) * png.width + area.x0 + Math.floor(x / scale)) * 4
      png.data.copy(out.data, (y * out.width + x) * 4, from, from + 4)
    }
  }
  writeFileSync(file, PNG.sync.write(out))
}

const source = entryPath
  ? readFileSync(resolve(process.cwd(), entryPath), 'utf8')
  : readFileSync(fixture, 'utf8').replace('__TRANSITION__', transition)
const entry = entryPath ? resolve(process.cwd(), entryPath) : join(projectRoot, 'slides.transition-blink.md')
if (!entryPath && !option('--server'))
  writeFileSync(entry, source)
const steps = transitionsOf(source).filter(step => !only || String(step.page) === only)

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// `--server <url>` records against a deck that is already being served.
const running = option('--server')
const port = running ? undefined : await freePort()
const server = running
  ? undefined
  : spawn(process.execPath, [slidevCli, entry, '--port', String(port)], { cwd: dirname(entry), stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server?.stdout.on('data', chunk => serverLog += chunk)
server?.stderr.on('data', chunk => serverLog += chunk)

let blinks = 0
const browser = await chromium.launch()
try {
  const base = running ?? `http://localhost:${port}`
  await waitForServer(base)
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  // Warm the deck up: Slidev loads slides lazily and a first visit is slower.
  await page.goto(`${base}/1`)
  await settle(page)

  for (const step of steps) {
    const fromPage = step.kind === 'slide' && backward ? step.page + 1 : step.page
    const key = backward ? 'ArrowLeft' : 'ArrowRight'
    // Visit the destination first so its component instances are mounted, as
    // they are for a presenter moving through the deck, then start from a
    // freshly loaded origin.
    if (step.kind === 'slide') {
      await page.goto(`${base}/${backward ? step.page : step.page + 1}`)
      await settle(page)
    }
    await page.goto(`${base}/${fromPage}${step.kind === 'click' && backward ? '?clicks=1' : ''}`)
    await settle(page)
    if (step.kind === 'slide') {
      // Walk there and back once: a presenter never arrives by a page load.
      await page.keyboard.press(key)
      await settle(page)
      await page.keyboard.press(backward ? 'ArrowRight' : 'ArrowLeft')
      await settle(page)
    }

    const boxesBefore = await annotationBoxes(page)

    const frames = []
    const onFrame = async ({ data, metadata, sessionId }) => {
      frames.push({ at: metadata.timestamp, data })
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    }
    cdp.on('Page.screencastFrame', onFrame)
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    // Paint the settled slide once without its annotations, then with them
    // again: the difference between the two frames is the annotations.
    await page.waitForTimeout(150)
    // The screencast only delivers a frame when the picture changes.
    const nextFrame = async () => {
      const seen = frames.length
      for (let waited = 0; frames.length === seen && waited < 1500; waited += 25)
        await page.waitForTimeout(25)
      await page.waitForTimeout(250)
    }
    const hidden = await page.addStyleTag({ content: HIDE_ANNOTATIONS })
    await nextFrame()
    const withoutInkFrame = frames.at(-1)
    await hidden.evaluate(style => style.remove())
    await nextFrame()
    const pressed = await page.evaluate(() => performance.timeOrigin + performance.now()) / 1000
    await page.keyboard.press(key)
    await page.waitForTimeout(1200)
    await settle(page)
    await cdp.send('Page.stopScreencast')
    cdp.off('Page.screencastFrame', onFrame)

    const boxesAfter = await annotationBoxes(page)
    // Judge frames against frames: the screencast and a screenshot do not
    // rasterise text identically, which would read as a blink of its own.
    for (const frame of frames)
      frame.png = PNG.sync.read(Buffer.from(frame.data, 'base64'))
    const before = frames.findLast(frame => frame.at < pressed)?.png
    const after = frames.at(-1)?.png
    const withoutInk = withoutInkFrame?.png
    if (!before || !after || !withoutInk || after === before || withoutInk === before) {
      console.log(`\n${step.page}: the screencast delivered no usable frames, skipped (${frames.length} frames, ${frames.filter(frame => frame.at < pressed).length} before the key press)`)
      continue
    }

    const label = step.kind === 'slide'
      ? `${fromPage} → ${backward ? step.page : step.page + 1}`
      : `${step.page} click`
    console.log(`\n${label}  (${frames.length} frames)`)

    if (strip) {
      // Whole frames at the requested moments, to look at a transition.
      const slug = label.replace(/[^\w]+/g, '-')
      const moving = frames.filter(frame => frame.at >= pressed)
      for (const ms of strip.split(',').map(Number)) {
        const frame = moving.find(candidate => (candidate.at - pressed) * 1000 >= ms) ?? moving.at(-1)
        if (frame)
          writeFileSync(join(outDir, `${slug}-at-${ms}ms.png`), PNG.sync.write(frame.png))
      }
    }

    for (const box of boxesBefore) {
      const twin = boxesAfter.find(other => other.kind === box.kind && other.text === box.text
        && Math.abs(other.x - box.x) < 1 && Math.abs(other.y - box.y) < 1
        && Math.abs(other.width - box.width) < 1 && Math.abs(other.height - box.height) < 1)
      const name = `${box.kind}${box.text ? ` "${box.text}"` : ''}`
      if (!twin) {
        const moved = boxesAfter.find(other => other.kind === box.kind && other.text === box.text)
        const round = b => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}×${Math.round(b.height)}`
        console.log(`  ·  ${name}: ${moved ? `moves (${round(box)} → ${round(moved)})` : 'leaves'}, not judged`)
        continue
      }
      const area = crop(before, box)
      const pixels = inkPixels(before, withoutInk, area)
      if (pixels.length < 6) {
        console.log(`  ·  ${name}: too faint to judge`)
        continue
      }
      if (missing(after, before, pixels) > BLINK_RATIO) {
        console.log(`  ·  ${name}: same box but drawn differently after the transition, not judged`)
        continue
      }
      let worst = { ratio: 0, index: -1 }
      const timeline = []
      frames.forEach((frame, index) => {
        if (frame.at < pressed)
          return
        const png = frame.png
        if (png.width !== before.width || png.height !== before.height)
          return
        const ratio = missing(png, before, pixels)
        timeline.push({ ms: Math.round((frame.at - pressed) * 1000), ratio })
        if (ratio > worst.ratio)
          worst = { ratio, index }
      })
      const blinking = timeline.filter(point => point.ratio > BLINK_RATIO)
      if (!blinking.length) {
        console.log(`  ✓  ${name}`)
        continue
      }
      blinks++
      const from = blinking[0].ms
      const to = blinking.at(-1).ms
      console.log(`  ✗  ${name}: blinks from ${from} ms to ${to} ms, up to ${Math.round(worst.ratio * 100)}% of it missing`)
      if (verbose)
        console.log(`       ${timeline.map(point => `${point.ms}:${Math.round(point.ratio * 100)}`).join(' ')}`)
      if (keepFrames) {
        const slug = `${label.replace(/[^\w]+/g, '-')}-${box.kind.replace(/\s+/g, '-')}-${Math.round(box.x)}-${Math.round(box.y)}`
        const wide = crop(before, box, 40)
        writeCrop(before, wide, join(outDir, `${slug}-settled.png`))
        writeCrop(frames[worst.index].png, wide, join(outDir, `${slug}-worst.png`))
        // The worst frame is often the very first one; the middle of the
        // blink shows what the audience actually sits through.
        const middle = blinking[Math.floor(blinking.length / 2)]
        writeCrop(frames.find(frame => Math.round((frame.at - pressed) * 1000) === middle.ms).png, wide, join(outDir, `${slug}-middle.png`))
      }
    }
  }
}
catch (error) {
  console.error(serverLog)
  throw error
}
finally {
  await browser.close()
  server?.kill()
  if (!entryPath && !running)
    rmSync(entry, { force: true })
}

console.log(`\n${blinks ? `${blinks} annotation${blinks === 1 ? '' : 's'} blinked` : 'Nothing blinked'} (${transition}${backward ? ', backward' : ''}).`)
if (check && blinks)
  process.exit(1)
