#!/usr/bin/env node
/**
 * Exercise the source-geometry annotation editor against a real Slidev/Vite
 * server with actual pointer and keyboard gestures.
 *
 * This is intentionally separate from `vitest`: the unit tests cover the tag
 * scanner and the writer, but only a browser can prove that a drag reaches
 * the writer through a working locator, that the rewritten Markdown comes
 * back through HMR without losing the selection, and that Undo and the 409
 * recovery path behave. The server runs against a throwaway copy of
 * `slides.md`, so the checked-in deck is never modified.
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
const FIXTURE_SLIDE = 27
const FIXTURE_LABEL = 'the entry point of every Kotlin program'
const FIXTURE_TAG_MARKER = 'text="fun main"'
const STEP_TIMEOUT = 15_000
const port = randomInt(31000, 39000)
const origin = `http://127.0.0.1:${port}`

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
      await page.getByRole('button', { name: 'Edit annotations' }).click()
      // Editable means the component received a locator from the Vite
      // transform; a missing or bound attribute leaves it presentation-only.
      await editableLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
        .catch(async () => fail(`The label never became editable after entering edit mode. Toolbar: ${JSON.stringify(await page.locator('.drawn-annotation-toolbar').textContent().catch(() => undefined))}`))
    }

    /**
     * Perform one edit and wait until it is fully persisted: the fixture tag
     * in the file changed, Slidev's HMR delivered the rewritten slide, and
     * the same label is selected again in the remounted component.
     */
    async function edit(description, action) {
      const before = await fixtureSource()
      const hotBefore = hotUpdates
      await action()
      const after = await waitFor(async () => { const now = await fixtureSource(); return now.tag === before.tag ? undefined : now })
      if (!after) fail(`${description} did not change the fixture tag in ${entry}. Toolbar status: ${JSON.stringify(await status.textContent().catch(() => undefined))}`)
      if (!await waitFor(async () => hotUpdates > hotBefore))
        fail(`${description} rewrote ${entry}, but Slidev never hot-updated the browser.`)
      // Without this the next gesture would hit a stale, unselected component
      // (issue 002 A: editor state must follow the locator through a save).
      await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }).catch(() => fail(`${description}: the label lost its selection after HMR.`))
      return after
    }

    await openFixture()
    const routeBeforeEditing = page.url()
    if ((await fixtureSource()).geometry !== undefined) fail('The fixture tag already carries a `:geometry` binding; the test expects an authored tag without one.')

    // 1. Label drag → `label: { x, y }` on this tag only.
    const afterLabel = await edit('Dragging the label', () => drag(page, label, 48, 24))
    if (typeof afterLabel.geometry?.label?.x !== 'number' || typeof afterLabel.geometry.label.y !== 'number' || afterLabel.geometry.label.width !== undefined || afterLabel.geometry.connector !== undefined)
      fail(`Dragging the label should persist only a label position; the tag holds ${JSON.stringify(afterLabel.geometry)}.`)
    if (!/:geometry="\{ label: \{ x: 0\.\d{4}, y: 0\.\d{4} \} \}"/.test(afterLabel.tag))
      fail(`The written binding is not the compact four-decimal literal the writer promises:\n${afterLabel.tag}`)

    // 2. Width handle → `width`. The handle only exists while the label is
    // selected, so this also proves the selection survived the first save.
    const afterWidth = await edit('Dragging the width handle', () => drag(page, annotation.locator('.annotation-width-handle'), 36, 0))
    if (typeof afterWidth.geometry?.label?.width !== 'number' || afterWidth.geometry.connector !== undefined)
      fail(`Dragging the width handle should add a label width; the tag holds ${JSON.stringify(afterWidth.geometry)}.`)

    // 3. Connector endpoint → `connector: { start, end }`.
    const handles = annotation.locator('.annotation-connector-handle')
    await handles.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    const afterConnector = await edit('Dragging a connector endpoint', () => drag(page, handles.first(), 18, 12))
    const connector = afterConnector.geometry?.connector
    if (!connector || [connector.start?.x, connector.start?.y, connector.end?.x, connector.end?.y].some(value => typeof value !== 'number'))
      fail(`Dragging a connector endpoint should persist both endpoints; the tag holds ${JSON.stringify(afterConnector.geometry)}.`)
    if (!same(afterConnector.geometry.label, afterWidth.geometry.label))
      fail('Dragging a connector endpoint changed the label geometry.')

    // 4. Three saves and HMR cycles later the label is still the selection,
    // and a further drag keeps working (issue 002 A).
    const afterSecondDrag = await edit('Dragging the label again after HMR', () => drag(page, selectedLabel, -30, 20))
    if (same(afterSecondDrag.geometry.label, afterConnector.geometry.label))
      fail('The second label drag did not move the label.')

    // 5. Undo restores the geometry from before the last drag (issue 002 B).
    const undoModifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta' : 'Control')
    const afterUndo = await edit('Cmd/Ctrl+Z', () => page.keyboard.press(`${undoModifier}+z`))
    if (!same(afterUndo.geometry, afterConnector.geometry))
      fail(`Undo did not restore the geometry from before the last drag.\nExpected ${JSON.stringify(afterConnector.geometry)}\nReceived ${JSON.stringify(afterUndo.geometry)}`)

    // The same guarantee for a fresh session: with nothing cached from this
    // tab's own writes, the undo baseline must be the authored binding, not
    // an empty one.
    await page.reload({ waitUntil: 'networkidle' })
    await openFixture()
    const authored = await fixtureSource()
    await edit('Dragging the label in a fresh session', () => drag(page, label, 20, -16))
    const afterFreshUndo = await edit('Cmd/Ctrl+Z in a fresh session', () => page.keyboard.press(`${undoModifier}+z`))
    if (!same(afterFreshUndo.geometry, authored.geometry))
      fail(`Undo in a fresh session did not restore the authored geometry.\nExpected ${JSON.stringify(authored.geometry)}\nReceived ${JSON.stringify(afterFreshUndo.geometry)}`)

    // 6. An external edit makes this tab's revision stale: the next save must
    // be refused with the recovery hint, and reloading must unblock editing.
    const beforeConflict = await fixtureSource()
    await writeFile(copy, `${await readFile(copy, 'utf8')}\n<!-- edited outside the annotation editor -->\n`)
    await drag(page, selectedLabel, 24, 10)
    if (!await waitFor(async () => /reload before saving/i.test(await status.textContent() ?? '')))
      fail(`A stale save was not reported as a conflict. Toolbar status: ${JSON.stringify(await status.textContent())}`)
    if ((await fixtureSource()).tag !== beforeConflict.tag)
      fail('A stale save overwrote the source another author had changed.')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Reload saved geometry' }).click()
    await status.filter({ hasText: 'Saved annotation geometry reloaded' }).waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    const afterRecovery = await edit('Dragging the label after reloading saved geometry', () => drag(page, selectedLabel, 24, 10))
    if (same(afterRecovery.geometry.label, beforeConflict.geometry.label))
      fail('The drag after conflict recovery did not move the label.')

    // 7. Keyboard path: reach the label with Tab, nudge it with ArrowRight.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
    let focused = false
    for (let presses = 0; presses < 40 && !focused; presses++) {
      await page.keyboard.press('Tab')
      focused = await label.evaluate(element => element === document.activeElement)
    }
    if (!focused) fail('Tab never reached the annotation label.')
    await selectedLabel.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }).catch(() => fail('Focusing the label with the keyboard did not select it.'))
    const afterNudge = await edit('ArrowRight on the focused label', () => page.keyboard.press('ArrowRight'))
    if (!(afterNudge.geometry.label.x > afterRecovery.geometry.label.x) || afterNudge.geometry.label.y !== afterRecovery.geometry.label.y)
      fail(`ArrowRight should move the label right only. Before ${JSON.stringify(afterRecovery.geometry.label)}, after ${JSON.stringify(afterNudge.geometry.label)}.`)

    if (page.url() !== routeBeforeEditing)
      fail(`Editing changed the active Slidev route from ${routeBeforeEditing} to ${page.url()}.`)
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
