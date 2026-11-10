#!/usr/bin/env node
/**
 * Exercise the source-geometry annotation editor against a real Slidev/Vite
 * server with actual pointer and keyboard gestures.
 *
 * This is intentionally separate from `vitest`: the unit tests cover the tag
 * scanner, the writer and the draft store, but only a browser can prove the
 * frozen edit session end to end — that dragging and arrow-key nudging change
 * only the local draft (no source write, no HMR) while Slidev navigation
 * stays locked, that "Done editing annotations" commits every change of the
 * session in one write phase, that a conflicting commit and an Escape cancel
 * behave, and that the immediate-write toolbar actions (connector toggle,
 * resets) rewrite exactly the fixture tag. The server runs against a
 * throwaway copy of `slides.md`, so the checked-in deck is never modified.
 */
import { spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from '@slidev/parser'
import { chromium } from 'playwright-chromium'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
// The copy must sit next to `slides.md`: its `theme: ./` and public assets
// resolve relative to the entry file.
const entry = 'slides.annotation-editor-test.md'
const copy = resolve(root, entry)
const FIXTURE_LABEL = 'the entry point of every Kotlin program'
const FIXTURE_TAG_MARKER = 'text="fun main"'
// The fixture is the deck slide carrying that label. Its page number is
// looked up rather than written here, because a slide added above it in
// `slides.md` moved it more than once and each time the test pointed at the
// wrong page.
const FIXTURE_SLIDE = fixtureSlide()
const STEP_TIMEOUT = 15_000
// How long to wait before concluding that a gesture wrote nothing. The old
// editor autosaved after a 350 ms drag pause; well past that proves a draft.
const NO_WRITE_GRACE = 900
const port = randomInt(31000, 39000)
const origin = `http://localhost:${port}`

function fixtureSlide() {
  const slides = parseSync(readFileSync(resolve(root, 'slides.md'), 'utf8'), 'slides.md').slides
  const index = slides.findIndex(slide => slide.content.includes(FIXTURE_LABEL))
  if (index < 0) throw new Error(`No slide of slides.md carries the fixture label "${FIXTURE_LABEL}".`)
  return index + 1
}

const showcase = await readFile(resolve(root, 'slides.md'), 'utf8')
const labelFreeSlide = parseSync(showcase, 'slides.md').slides.length + 1
await writeFile(copy, showcase + `

---
layout: default
---

# Text connectors without labels

<DrawnAnnotation text="body" :connect="true" />
<DrawnAnnotation text="fail" label="" :connect="true" />
<DrawnAnnotation text="plain" />
<DrawnAnnotation text="hidden" :connect="false" />

<div style="margin-top: 100px; display: flex; gap: 100px">
<span>body</span><span>fail</span><span>plain</span><span>hidden</span>
</div>
`)
const server = spawn(process.execPath, [
  'node_modules/@slidev/cli/bin/slidev.mjs', entry, '--port', String(port),
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let serverOutput = ''
server.stdout.on('data', data => serverOutput += data)
server.stderr.on('data', data => serverOutput += data)

function fail(message) { throw new Error(`${message}\n\nSlidev output:\n${serverOutput}`) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForServer() {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) fail(`Slidev development server exited with ${server.exitCode}.`)
    try {
      if ((await fetch(`${origin}/__drawn-annotation-source`)).ok) return
    }
    catch {}
    await sleep(200)
  }
  fail('Timed out waiting for the DrawnAnnotation source writer endpoint.')
}

/**
 * The fixture tag as the writer left it in the Markdown copy. Geometry is
 * read back from the file rather than from the writer response: the file is
 * what an author commits.
 */
async function fixtureSource() {
  const source = await readFile(copy, 'utf8')
  const tags = [...source.matchAll(/<DrawnAnnotation\b[^>]*>/g)].map(match => match[0])
  const fixtures = tags.filter(tag => tag.includes(FIXTURE_TAG_MARKER))
  if (fixtures.length !== 1) fail(`Expected exactly one fixture tag containing ${FIXTURE_TAG_MARKER}; found ${fixtures.length}.`)
  const [tag] = fixtures
  const bindings = tags.filter(tag => /:geometry=/.test(tag))
  if (bindings.some(bound => bound !== tag)) fail(`A \`:geometry\` binding was written to a tag other than the fixture:\n${bindings.filter(bound => bound !== tag).join('\n')}`)
  const binding = /:geometry="([^"]*)"/.exec(tag)
  // The writer serializes a plain object literal; evaluate it the way Vue would.
  const geometry = binding ? new Function(`return (${binding[1]})`)() : undefined
  const connect = /:connect="(true|false)"/.exec(tag)
  // The deck authors `:connect="false"` elsewhere; the toggle must never touch those.
  const otherConnectBindings = tags.filter(other => other !== tag && /:connect=/.test(other)).length
  return { tag, geometry, connect: connect ? connect[1] === 'true' : undefined, otherConnectBindings }
}

async function waitFor(condition) {
  const deadline = Date.now() + STEP_TIMEOUT
  while (Date.now() < deadline) {
    const value = await condition()
    if (value) return value
    await sleep(100)
  }
  return undefined
}

async function drag(page, locator, dx, dy) {
  const box = await locator.boundingBox()
  if (!box) fail(`Could not measure ${await locator.getAttribute('class') ?? 'editor control'}.`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 4 })
  await page.mouse.up()
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function run() {
  await waitForServer()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const vueWarnings = []
    const pageErrors = []
    let hotUpdates = 0
    page.on('console', (message) => {
      const text = message.text()
      // Vite's client announces every applied module update. Only the
      // fixture slide's module counts: UnoCSS hot-updates its stylesheets
      // continuously, and a write invalidates the frontmatter module too.
      if (text.includes(`[vite] hot updated: /${entry}__slidev_${FIXTURE_SLIDE}.md`)) hotUpdates++
      if (/\[Vue warn\]/.test(text)) vueWarnings.push(text)
    })
    // Headless Chromium denies Slidev's screen wake lock; that rejection is
    // Slidev's, not the editor's.
    page.on('pageerror', (error) => { if (!/wake lock/i.test(error.message)) pageErrors.push(error.message) })
    const status = page.locator('.drawn-annotation-toolbar__status')
    const doneButton = page.getByRole('button', { name: 'Done editing annotations' })

    const label = page.locator('.annotation-label', { hasText: FIXTURE_LABEL })
    // Before its click the label is mounted but transparent, which Playwright
    // still reports as visible; the active class is the real signal.
    const activeLabel = page.locator('.annotation-label.is-active', { hasText: FIXTURE_LABEL })
    const annotation = page.locator('.drawn-annotation').filter({ has: label })
    const editableLabel = page.locator('.annotation-label.is-editable', { hasText: FIXTURE_LABEL })
    const selectedLabel = page.locator('.annotation-label.is-selected-for-editing', { hasText: FIXTURE_LABEL })

    /** Load the fixture slide at its first click, where the label is visible. */
    async function openFixture() {
      if (!page.url().startsWith(`${origin}/${FIXTURE_SLIDE}`))
        await page.goto(`${origin}/${FIXTURE_SLIDE}`, { waitUntil: 'networkidle' })
      // Advance through Slidev itself rather than assuming a query-string
      // click encoding, which has changed between Slidev releases.
      if (!await activeLabel.count()) await page.keyboard.press('ArrowRight')
      await activeLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
      await enterEditMode()
    }

    async function enterEditMode() {
      await page.getByRole('button', { name: 'Edit annotations' }).click()
      // Editable means the component received a locator from the Vite
      // transform; a missing or bound attribute leaves it presentation-only.
      await editableLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
        .catch(async () => fail(`The label never became editable after entering edit mode. Toolbar: ${JSON.stringify(await page.locator('.drawn-annotation-toolbar').textContent().catch(() => undefined))}`))
      await doneButton.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    }

    /**
     * Assert that a session gesture stayed a local draft: the fixture tag in
     * the file did not change and no HMR update reached the browser, well
     * past the old editor's 350 ms autosave pause.
     */
    async function assertNoWrite(description, before, hotBefore) {
      await sleep(NO_WRITE_GRACE)
      const now = await fixtureSource()
      if (now.tag !== before.tag)
        fail(`${description} wrote the Markdown source during the edit session:\nbefore ${before.tag}\nafter  ${now.tag}`)
      if (hotUpdates !== hotBefore)
        fail(`${description} triggered an HMR update during the edit session.`)
    }

    /** Assert the frozen slide/click state: same route, label still active. */
    async function assertStateFrozen(description, route) {
      if (page.url() !== route)
        fail(`${description} changed the Slidev route from ${route} to ${page.url()}.`)
      if (!await activeLabel.count())
        fail(`${description} changed the click state: the fixture label is no longer active.`)
    }

    /**
     * Press "Done editing annotations" and wait for the commit phase: the
     * fixture tag changes, Slidev hot-updates, and the session exits.
     */
    async function commitSession(description) {
      const before = await fixtureSource()
      const hotBefore = hotUpdates
      await doneButton.click()
      const after = await waitFor(async () => { const now = await fixtureSource(); return now.tag === before.tag ? undefined : now })
      if (!after) fail(`${description}: Done did not commit the session's drafts to ${entry}. Toolbar status: ${JSON.stringify(await status.textContent().catch(() => undefined))}`)
      if (!await waitFor(async () => hotUpdates > hotBefore))
        fail(`${description}: the commit rewrote ${entry}, but Slidev never hot-updated the browser.`)
      await doneButton.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT })
        .catch(() => fail(`${description}: the editor did not exit after a successful commit.`))
      return after
    }

    await openFixture()
    const routeBeforeEditing = page.url()
    if ((await fixtureSource()).geometry !== undefined) fail('The fixture tag already carries a `:geometry` binding; the test expects an authored tag without one.')
    if (!await page.locator('.drawn-annotation.is-edit-frozen').count())
      fail('Entering edit mode did not freeze annotation rendering (missing .is-edit-frozen).')

    const sessionStart = await fixtureSource()
    const sessionHot = hotUpdates

    // 1. A label drag updates only the local draft: visible immediately, no
    // source write, no HMR remount.
    const labelBoxBefore = await label.boundingBox()
    await drag(page, label, 48, 24)
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    const labelBoxDragged = await waitFor(async () => {
      const box = await label.boundingBox()
      return box && Math.abs(box.x - labelBoxBefore.x - 48) < 8 && Math.abs(box.y - labelBoxBefore.y - 24) < 8 ? box : undefined
    })
    if (!labelBoxDragged) fail(`Dragging the label did not move the visible draft. Before ${JSON.stringify(labelBoxBefore)}, after ${JSON.stringify(await label.boundingBox())}.`)
    await assertNoWrite('Dragging the label', sessionStart, sessionHot)
    await assertStateFrozen('Dragging the label', routeBeforeEditing)

    // 2. Arrow keys nudge the selected control and never navigate: previously
    // Slidev's magicKeys observed the event first and changed click or slide.
    await page.keyboard.press('ArrowRight')
    const nudged = await waitFor(async () => {
      const box = await label.boundingBox()
      return box && box.x > labelBoxDragged.x + 1 ? box : undefined
    })
    if (!nudged) fail('ArrowRight did not nudge the selected label.')
    if (Math.abs(nudged.y - labelBoxDragged.y) > 1) fail('ArrowRight moved the label vertically.')
    await page.keyboard.press('Shift+ArrowDown')
    const shiftNudged = await waitFor(async () => {
      const box = await label.boundingBox()
      // Shift is the larger step: 1% of the slide height, several times the
      // plain 0.2% nudge.
      return box && box.y > nudged.y + 4 ? box : undefined
    })
    if (!shiftNudged) fail('Shift+ArrowDown did not apply the larger nudge to the selected label.')
    await assertStateFrozen('Arrow-key nudging', routeBeforeEditing)
    await assertNoWrite('Arrow-key nudging', sessionStart, sessionHot)

    // 3. Click-to-navigate is blocked while editing. This click lands on the
    // slide container's left half, which outside the session goes back one
    // click and would hide the label.
    await page.mouse.click(720, 20)
    await assertStateFrozen('Clicking the slide canvas', routeBeforeEditing)
    // The click still clears the selection, which is an editor concern.
    if (await selectedLabel.count()) fail('Clicking outside the annotation did not clear the selection.')

    // 4. Arrow keys without a selected control must not navigate either.
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await sleep(200)
    await assertStateFrozen('Arrow keys with no selection', routeBeforeEditing)

    // 5. More session edits before the single commit: width and connector.
    // The first connector drag materializes the automatic (cubic) route as a
    // quadratic draft — endpoints plus the curve-preserving control point
    // (issue 001) — so the control handle appears without any write.
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await drag(page, annotation.locator('.annotation-width-handle'), 36, 0)
    const handles = annotation.locator('.annotation-connector-handle')
    await handles.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await drag(page, handles.first(), 18, 12)
    await assertNoWrite('Width and connector drags', sessionStart, sessionHot)

    // 5b. The control handle exists as a draft and drags, moving only the
    // control point: the endpoint handles stay where the drag left them.
    const controlHandle = annotation.locator('.annotation-connector-control-handle')
    const endpointHandles = annotation.locator('.annotation-connector-handle:not(.annotation-connector-control-handle)')
    await controlHandle.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
      .catch(() => fail('The first connector drag did not materialize the automatic curve as a draggable control point.'))
    const endpointBoxesBefore = [await endpointHandles.nth(0).boundingBox(), await endpointHandles.nth(1).boundingBox()]
    const controlBoxBefore = await controlHandle.boundingBox()
    await drag(page, controlHandle, 26, -18)
    const controlBoxDragged = await waitFor(async () => {
      const box = await controlHandle.boundingBox()
      return box && Math.abs(box.x - controlBoxBefore.x - 26) < 8 && Math.abs(box.y - controlBoxBefore.y + 18) < 8 ? box : undefined
    })
    if (!controlBoxDragged) fail(`Dragging the control handle did not move the control point. Before ${JSON.stringify(controlBoxBefore)}, after ${JSON.stringify(await controlHandle.boundingBox())}.`)
    for (const [index, before] of endpointBoxesBefore.entries()) {
      const box = await endpointHandles.nth(index).boundingBox()
      if (Math.abs(box.x - before.x) > 1 || Math.abs(box.y - before.y) > 1)
        fail(`Dragging the control handle moved connector endpoint ${index}.`)
    }
    await assertNoWrite('Dragging the control handle', sessionStart, sessionHot)

    // 5c. The control handle is keyboard-editable: focus, then ArrowRight
    // moves the control point right only — still a draft.
    await controlHandle.evaluate(element => element.focus())
    await page.keyboard.press('ArrowRight')
    const controlNudged = await waitFor(async () => {
      const box = await controlHandle.boundingBox()
      return box && box.x > controlBoxDragged.x + 1 ? box : undefined
    })
    if (!controlNudged) fail('ArrowRight did not nudge the focused control handle.')
    if (Math.abs(controlNudged.y - controlBoxDragged.y) > 1) fail('ArrowRight moved the control point vertically.')
    await assertNoWrite('Nudging the control handle', sessionStart, sessionHot)

    // 5d. A body nudge translates start, control and end as one rigid polygon.
    const rigidBefore = [await endpointHandles.nth(0).boundingBox(), await endpointHandles.nth(1).boundingBox(), await controlHandle.boundingBox()]
    await annotation.locator('.annotation-connector-hit').evaluate(element => element.focus())
    await page.keyboard.press('Shift+ArrowDown')
    const rigidMoved = await waitFor(async () => {
      const box = await controlHandle.boundingBox()
      // Shift is the larger step: 1% of the slide height.
      return box && box.y > rigidBefore[2].y + 4 ? box : undefined
    })
    if (!rigidMoved) fail('Shift+ArrowDown on the connector body did not move the control point with it.')
    const rigidAfter = [await endpointHandles.nth(0).boundingBox(), await endpointHandles.nth(1).boundingBox(), await controlHandle.boundingBox()]
    for (const [index, before] of rigidBefore.entries()) {
      const after = rigidAfter[index]
      const dy = after.y - before.y
      if (Math.abs(after.x - before.x) > 1 || Math.abs(dy - (rigidAfter[2].y - rigidBefore[2].y)) > 1)
        fail(`A body nudge must translate the whole control polygon rigidly; handle ${index} moved by (${after.x - before.x}, ${dy}).`)
    }
    await assertNoWrite('Body-nudging the curved connector', sessionStart, sessionHot)

    // 6. One commit persists the whole session: label position, width and the
    // quadratic connector land in a single write phase on this tag only. The
    // materialized route keeps its curve: the committed connector carries the
    // control point, not a collapsed straight segment (issue 001).
    const committed = await commitSession('Committing the session')
    if (typeof committed.geometry?.label?.x !== 'number' || typeof committed.geometry.label.y !== 'number' || typeof committed.geometry.label.width !== 'number')
      fail(`The commit should persist the dragged and nudged label with its width; the tag holds ${JSON.stringify(committed.geometry)}.`)
    const connector = committed.geometry?.connector
    if (!connector || [connector.start?.x, connector.start?.y, connector.end?.x, connector.end?.y].some(value => typeof value !== 'number'))
      fail(`The commit should persist both connector endpoints; the tag holds ${JSON.stringify(committed.geometry)}.`)
    if ([connector.control?.x, connector.control?.y].some(value => typeof value !== 'number') || !/type: 'quadratic'/.test(committed.tag))
      fail(`Materializing the automatic route should preserve its curve as a quadratic control point; the tag holds ${committed.tag}.`)
    if (!/:geometry="\{ label: \{ x: 0\.\d{4}, y: 0\.\d{4}, width: 0\.\d{4} \}, connector: \{ type: 'quadratic', start: \{ x: 0\.\d{4}, y: 0\.\d{4} \}, control: \{ x: 0\.\d{4}, y: 0\.\d{4} \}, end: \{ x: 0\.\d{4}, y: 0\.\d{4} \} \} \}"/.test(committed.tag))
      fail(`The written binding is not the compact four-decimal literal the writer promises:\n${committed.tag}`)

    // 6b. The toolbar's single connector state control (issue 003): switching
    // back to automatic removes saved endpoints, which a draft cannot express,
    // so it is one of the documented immediate-write exceptions. It removes
    // the whole connector object — not individual fields — while the label
    // geometry stays untouched, and the control flips to its other state.
    await enterEditMode()
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    const hotBeforeAutomatic = hotUpdates
    await page.getByRole('button', { name: 'Use automatic connector' }).click()
    const afterAutomatic = await waitFor(async () => { const now = await fixtureSource(); return now.tag === committed.tag ? undefined : now })
    if (!afterAutomatic)
      fail(`Switching to the automatic connector did not write the source. Toolbar status: ${JSON.stringify(await status.textContent().catch(() => undefined))}`)
    // Let the write's own HMR update land before any later no-write check.
    if (!await waitFor(async () => hotUpdates > hotBeforeAutomatic))
      fail('The automatic switch rewrote the source, but Slidev never hot-updated the browser.')
    if (afterAutomatic.geometry?.connector !== undefined)
      fail(`Switching to the automatic connector should remove the whole connector object; the tag holds ${JSON.stringify(afterAutomatic.geometry)}.`)
    if (!same(afterAutomatic.geometry?.label, committed.geometry.label))
      fail('Switching to the automatic connector changed the label geometry.')
    await page.getByRole('button', { name: 'Make connector manual' }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
      .catch(() => fail('The connector state control did not offer "Make connector manual" after switching to automatic.'))

    // 6c. "Make connector manual" materializes the automatic route again, curve
    // included, as an ordinary draft: nothing is written until Done commits it.
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    const hotBeforeManual = hotUpdates
    await page.getByRole('button', { name: 'Make connector manual' }).click()
    await controlHandle.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
      .catch(() => fail('Making the connector manual did not show the control handle.'))
    await assertNoWrite('Making the connector manual', afterAutomatic, hotBeforeManual)
    const restored = await commitSession('Committing the manual connector')
    if (typeof restored.geometry?.connector?.control?.x !== 'number' || !same(restored.geometry.label, committed.geometry.label))
      fail(`Making the connector manual should persist a quadratic connector next to the untouched label; the tag holds ${JSON.stringify(restored.geometry)}.`)

    // 6d. Straightening a saved curve (issue 001): the source's control point
    // cannot be removed by a draft either, so "Straighten connector" is the
    // same kind of immediate-write exception. Only the control point goes:
    // endpoints and label survive it untouched.
    await enterEditMode()
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    const hotBeforeStraighten = hotUpdates
    await page.getByRole('button', { name: 'Straighten connector' }).click()
    const afterStraighten = await waitFor(async () => { const now = await fixtureSource(); return now.tag === restored.tag ? undefined : now })
    if (!afterStraighten)
      fail(`Straightening the connector did not write the source. Toolbar status: ${JSON.stringify(await status.textContent().catch(() => undefined))}`)
    // Let the write's own HMR update land before any later no-write check.
    if (!await waitFor(async () => hotUpdates > hotBeforeStraighten))
      fail('Straightening rewrote the source, but Slidev never hot-updated the browser.')
    if (afterStraighten.geometry?.connector?.control !== undefined || /quadratic/.test(afterStraighten.tag))
      fail(`Straightening should remove the control point; the tag holds ${afterStraighten.tag}.`)
    if (!same(afterStraighten.geometry?.connector?.start, restored.geometry.connector.start) || !same(afterStraighten.geometry?.connector?.end, restored.geometry.connector.end))
      fail('Straightening moved the connector endpoints.')
    if (!same(afterStraighten.geometry?.label, restored.geometry.label))
      fail('Straightening changed the label geometry.')

    // 6e. "Curve connector" adds a chord-midpoint control point back, so the
    // rendered route does not jump when the handle appears — an ordinary
    // draft, committed with the session like any other geometry edit.
    const hotBeforeCurve = hotUpdates
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await page.getByRole('button', { name: 'Curve connector' }).click()
    await controlHandle.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
      .catch(() => fail('Curving the connector did not show the control handle.'))
    await assertNoWrite('Curving the connector', afterStraighten, hotBeforeCurve)
    const curveCommitted = await commitSession('Committing the curved connector')
    const curved = curveCommitted.geometry?.connector
    if (typeof curved?.control?.x !== 'number' || typeof curved.control?.y !== 'number')
      fail(`Curving should add a control point; the tag holds ${JSON.stringify(curveCommitted.geometry)}.`)
    if (Math.abs(curved.control.x - (curved.start.x + curved.end.x) / 2) > 5e-3 || Math.abs(curved.control.y - (curved.start.y + curved.end.y) / 2) > 5e-3)
      fail(`A straightened connector's new control point should sit on its chord midpoint; the tag holds ${JSON.stringify(curved)}.`)

    // 7. A conflicting commit fails without losing drafts: the session stays
    // open, the file keeps the other author's revision, and "Reload saved
    // geometry" is the documented recovery.
    await enterEditMode()
    await drag(page, label, 24, 10)
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    const draggedBeforeConflict = await label.boundingBox()
    await writeFile(copy, `${await readFile(copy, 'utf8')}\n<!-- edited outside the annotation editor -->\n`)
    await doneButton.click()
    if (!await waitFor(async () => /reload before saving/i.test(await status.textContent() ?? '')))
      fail(`A conflicting commit was not reported with its recovery path. Toolbar status: ${JSON.stringify(await status.textContent())}`)
    if ((await fixtureSource()).tag !== curveCommitted.tag)
      fail('A conflicting commit overwrote the source another author had changed.')
    if (!await doneButton.count())
      fail('A failed commit exited the edit session instead of keeping the drafts editable.')
    const boxAfterConflict = await label.boundingBox()
    if (Math.abs(boxAfterConflict.x - draggedBeforeConflict.x) > 1 || Math.abs(boxAfterConflict.y - draggedBeforeConflict.y) > 1)
      fail('A failed commit moved the drafted label; drafts must stay intact for inspection.')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Reload saved geometry' }).click()
    await status.filter({ hasText: 'Saved annotation geometry reloaded' }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await drag(page, label, 24, 10)
    const afterRecovery = await commitSession('Committing after conflict recovery')
    if (same(afterRecovery.geometry.label, curveCommitted.geometry.label))
      fail('The commit after conflict recovery did not move the label.')

    // 8. Escape cancels the session: the first press clears the selection,
    // the second asks for confirmation and discards the session's drafts.
    await enterEditMode()
    await drag(page, label, 40, 0)
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await page.keyboard.press('Escape')
    if (await waitFor(async () => !(await selectedLabel.count())) === undefined)
      fail('The first Escape did not clear the selection.')
    page.once('dialog', dialog => dialog.accept())
    await page.keyboard.press('Escape')
    await doneButton.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT })
      .catch(() => fail('Escape did not cancel the edit session.'))
    if ((await fixtureSource()).tag !== afterRecovery.tag)
      fail('Cancelling with Escape wrote the discarded drafts to the source.')
    const cancelled = await waitFor(async () => {
      const box = await label.boundingBox()
      // The discarded drag snaps the label back to its committed position,
      // which is where the re-applied (24, 10) drag left it before Done.
      return box && Math.abs(box.x - draggedBeforeConflict.x) < 8 ? box : undefined
    })
    if (!cancelled) fail('Escape did not discard the session drafts; the label kept its cancelled position.')

    // 9. Hiding the connector is a prop, not geometry, so it writes at once:
    // `:connect="false"` lands on the fixture tag only, the geometry stays,
    // the connector controls disappear, and Show removes the binding again.
    await enterEditMode()
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    const hotBeforeHide = hotUpdates
    await page.getByRole('button', { name: 'Hide connector' }).click()
    const hidden = await waitFor(async () => { const now = await fixtureSource(); return now.tag === afterRecovery.tag ? undefined : now })
    if (!hidden)
      fail(`Hiding the connector did not write the source. Toolbar status: ${JSON.stringify(await status.textContent().catch(() => undefined))}`)
    if (hidden.connect !== false || !hidden.tag.endsWith(' :connect="false">'))
      fail(`Hiding the connector should append :connect="false" to the tag; it holds ${hidden.tag}.`)
    if (!same(hidden.geometry, afterRecovery.geometry))
      fail('Hiding the connector changed the geometry binding.')
    if (hidden.otherConnectBindings !== sessionStart.otherConnectBindings)
      fail('Hiding the connector touched a `:connect` binding on another tag.')
    if (!await waitFor(async () => hotUpdates > hotBeforeHide))
      fail('Hiding the connector rewrote the source, but Slidev never hot-updated the browser.')
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    if (await annotation.locator('.annotation-connector-editor').count())
      fail('A hidden connector still shows its editing controls.')
    const routing = page.getByRole('button', { name: /Use automatic connector|Make connector manual/ })
    if (!await routing.isDisabled())
      fail('The connector routing control stayed enabled while the connector is hidden.')
    await page.getByRole('button', { name: 'Show connector' }).click()
    const shown = await waitFor(async () => { const now = await fixtureSource(); return now.tag === hidden.tag ? undefined : now })
    if (!shown || shown.tag !== afterRecovery.tag)
      fail(`Showing the connector should restore the tag exactly; it holds ${shown?.tag}.`)
    await doneButton.click()
    await doneButton.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT })

    // 10. "Reset annotation" removes the whole binding at once.
    await enterEditMode()
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await page.getByRole('button', { name: 'Reset annotation' }).click()
    const reset = await waitFor(async () => { const now = await fixtureSource(); return now.geometry === undefined ? now : undefined })
    if (!reset)
      fail(`Reset annotation did not remove the geometry binding. Toolbar status: ${JSON.stringify(await status.textContent().catch(() => undefined))}`)
    if (/:geometry=/.test(reset.tag) || reset.tag !== sessionStart.tag)
      fail(`Reset annotation should restore the authored tag exactly; it holds ${reset.tag}.`)
    await doneButton.click()
    await doneButton.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT })

    // 11. "Reset slide" does the same for every annotation on the slide, after
    // a confirmation, and skips tags that hold no geometry.
    await enterEditMode()
    await drag(page, label, 30, 12)
    const beforeSlideReset = await commitSession('Committing a drag before resetting the slide')
    if (beforeSlideReset.geometry === undefined) fail('The drag before the slide reset did not persist.')
    await enterEditMode()
    let confirmation
    page.once('dialog', (dialog) => { confirmation = dialog.message(); dialog.accept() })
    await page.getByRole('button', { name: 'Reset slide' }).click()
    const slideReset = await waitFor(async () => { const now = await fixtureSource(); return now.geometry === undefined ? now : undefined })
    if (!slideReset)
      fail(`Reset slide did not remove the geometry binding. Toolbar status: ${JSON.stringify(await status.textContent().catch(() => undefined))}`)
    if (!/^Remove the saved geometry of all \d+ annotations on this slide\?$/.test(confirmation ?? ''))
      fail(`Reset slide should ask for confirmation naming the annotation count; it asked ${JSON.stringify(confirmation)}.`)
    if (slideReset.tag !== sessionStart.tag)
      fail(`Reset slide should restore the authored tag exactly; it holds ${slideReset.tag}.`)
    await doneButton.click()
    await doneButton.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT })

    // 12. Navigation works again once the session is over.
    await page.keyboard.press('ArrowLeft')
    if (await waitFor(async () => !(await activeLabel.count())) === undefined)
      fail('Arrow-key navigation did not come back after leaving the edit session.')
    await page.keyboard.press('ArrowRight')
    await activeLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })

    // Explicit connectors need neither a label nor pre-authored geometry.
    await page.goto(`${origin}/${labelFreeSlide}`)
    const labelFree = page.locator(`.slidev-page-${labelFreeSlide} .drawn-annotation`)
    await labelFree.nth(0).locator('.annotation-leader').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await labelFree.nth(1).locator('.annotation-leader').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    if (await labelFree.locator('.annotation-label').count()) fail('Label-free connectors rendered a label.')
    for (const index of [2, 3]) {
      if (await labelFree.nth(index).locator('.annotation-leader').count()) fail('A mark-only annotation gained a connector.')
    }
    await sleep(1000)
    await page.screenshot({ path: '/tmp/text-connectors-without-labels.png' })
    await page.getByRole('button', { name: 'Edit annotations', exact: true }).click()
    const endpoint = labelFree.nth(0).locator('.annotation-connector-editor circle').first()
    await endpoint.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await drag(page, endpoint, 40, 20)
    await doneButton.click()
    await doneButton.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT })
    const savedTextConnector = await waitFor(async () => {
      const source = await readFile(copy, 'utf8')
      const tag = source.match(/<DrawnAnnotation text="body"[^>]*>/)?.[0]
      return tag?.includes('connector:') ? tag : undefined
    })
    if (!savedTextConnector || /label[=:]/.test(savedTextConnector)) fail('The label-free connector did not save its endpoints independently.')
    await page.reload()
    await labelFree.nth(0).locator('.annotation-leader').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT })

    const renderWarnings = vueWarnings.filter(warning => /was accessed during render but is not defined/.test(warning))
    if (renderWarnings.length)
      fail(`Vue reported undefined template references:\n${renderWarnings.join('\n')}`)
    if (pageErrors.length)
      fail(`Uncaught browser errors while editing:\n${pageErrors.join('\n')}`)
    if (vueWarnings.length)
      console.warn(`Vue warnings during the run (not failing):\n${vueWarnings.join('\n')}`)
  }
  finally {
    await browser.close()
  }
}

try {
  await run()
  console.log('DrawnAnnotation source-geometry editor browser test passed.')
}
finally {
  // Register before signalling: a fast Vite shutdown can otherwise emit exit
  // between kill() and once(), leaving top-level await pending forever.
  if (server.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => { server.kill('SIGKILL'); resolve() }, 5_000)
      server.once('exit', () => { clearTimeout(timer); resolve() })
      server.kill('SIGTERM')
    })
  }
  // Only the copy was ever edited; `slides.md` stays exactly as checked in.
  await rm(copy, { force: true })
}
