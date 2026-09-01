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
 * session in one write phase, and that a conflicting commit and an Escape
 * cancel behave. The server runs against a throwaway copy of `slides.md`, so
 * the checked-in deck is never modified.
 */
import { spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-chromium'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
// The copy must sit next to `slides.md`: its `theme: ./` and public assets
// resolve relative to the entry file.
const entry = 'slides.annotation-editor-test.md'
const copy = resolve(root, entry)
const FIXTURE_SLIDE = 32
const FIXTURE_LABEL = 'the entry point of every Kotlin program'
const FIXTURE_TAG_MARKER = 'text="fun main"'
const STEP_TIMEOUT = 15_000
// How long to wait before concluding that a gesture wrote nothing. The old
// editor autosaved after a 350 ms drag pause; well past that proves a draft.
const NO_WRITE_GRACE = 900
const port = randomInt(31000, 39000)
const origin = `http://localhost:${port}`

await copyFile(resolve(root, 'slides.md'), copy)
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
  return { tag, geometry }
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
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await drag(page, annotation.locator('.annotation-width-handle'), 36, 0)
    const handles = annotation.locator('.annotation-connector-handle')
    await handles.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await drag(page, handles.first(), 18, 12)
    await assertNoWrite('Width and connector drags', sessionStart, sessionHot)

    // 6. Undo is local too: it restores the pre-gesture draft without a write.
    const undoModifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta' : 'Control')
    await page.keyboard.press(`${undoModifier}+z`)
    if (!await waitFor(async () => /undone/i.test(await status.textContent() ?? '')))
      fail(`Cmd/Ctrl+Z did not undo locally. Toolbar status: ${JSON.stringify(await status.textContent())}`)
    await assertNoWrite('Undo', sessionStart, sessionHot)
    // Redo the connector edit so the commit below carries every change kind.
    await drag(page, handles.first(), 18, 12)

    // 7. One commit persists the whole session: label position, width and
    // connector endpoints land in a single write phase on this tag only.
    const committed = await commitSession('Committing the session')
    if (typeof committed.geometry?.label?.x !== 'number' || typeof committed.geometry.label.y !== 'number' || typeof committed.geometry.label.width !== 'number')
      fail(`The commit should persist the dragged and nudged label with its width; the tag holds ${JSON.stringify(committed.geometry)}.`)
    const connector = committed.geometry?.connector
    if (!connector || [connector.start?.x, connector.start?.y, connector.end?.x, connector.end?.y].some(value => typeof value !== 'number'))
      fail(`The commit should persist both connector endpoints; the tag holds ${JSON.stringify(committed.geometry)}.`)
    if (!/:geometry="\{ label: \{ x: 0\.\d{4}, y: 0\.\d{4}, width: 0\.\d{4} \}, connector: \{ start: \{ x: 0\.\d{4}, y: 0\.\d{4} \}, end: \{ x: 0\.\d{4}, y: 0\.\d{4} \} \} \}"/.test(committed.tag))
      fail(`The written binding is not the compact four-decimal literal the writer promises:\n${committed.tag}`)

    // 7b. The toolbar's single connector state control (issue 003): switching
    // back to automatic removes saved endpoints, which a draft cannot express,
    // so it is one of the documented immediate-write exceptions. It removes
    // the whole connector object — not individual fields — while the label
    // geometry stays untouched, and the control flips to its other state.
    await enterEditMode()
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    await page.getByRole('button', { name: 'Use automatic connector' }).click()
    const afterAutomatic = await waitFor(async () => { const now = await fixtureSource(); return now.tag === committed.tag ? undefined : now })
    if (!afterAutomatic)
      fail(`Switching to the automatic connector did not write the source. Toolbar status: ${JSON.stringify(await status.textContent().catch(() => undefined))}`)
    if (afterAutomatic.geometry?.connector !== undefined)
      fail(`Switching to the automatic connector should remove the whole connector object; the tag holds ${JSON.stringify(afterAutomatic.geometry)}.`)
    if (!same(afterAutomatic.geometry?.label, committed.geometry.label))
      fail('Switching to the automatic connector changed the label geometry.')
    await page.getByRole('button', { name: 'Make connector manual' }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
      .catch(() => fail('The connector state control did not offer "Make connector manual" after switching to automatic.'))

    // 7c. Undo restores the manual connector the switch removed — as an
    // ordinary uncommitted draft, so nothing is written until Done commits it.
    await label.click()
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    const hotBeforeAutomaticUndo = hotUpdates
    await page.keyboard.press(`${undoModifier}+z`)
    if (!await waitFor(async () => /undone/i.test(await status.textContent() ?? '')))
      fail(`Cmd/Ctrl+Z after switching to automatic did not undo locally. Toolbar status: ${JSON.stringify(await status.textContent())}`)
    await assertNoWrite('Cmd/Ctrl+Z after switching to automatic', afterAutomatic, hotBeforeAutomaticUndo)
    const restored = await commitSession('Committing the undone automatic switch')
    if (!same(restored.geometry, committed.geometry))
      fail(`Undo did not restore the manual connector the automatic switch removed.\nExpected ${JSON.stringify(committed.geometry)}\nReceived ${JSON.stringify(restored.geometry)}`)

    // 8. A conflicting commit fails without losing drafts: the session stays
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
    if ((await fixtureSource()).tag !== committed.tag)
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
    if (same(afterRecovery.geometry.label, committed.geometry.label))
      fail('The commit after conflict recovery did not move the label.')

    // 9. Escape cancels the session: the first press clears the selection,
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

    // 10. Navigation works again once the session is over.
    await page.keyboard.press('ArrowLeft')
    if (await waitFor(async () => !(await activeLabel.count())) === undefined)
      fail('Arrow-key navigation did not come back after leaving the edit session.')
    await page.keyboard.press('ArrowRight')
    await activeLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })

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
