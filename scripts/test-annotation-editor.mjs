#!/usr/bin/env node
/**
 * Exercise the visual annotation editor against a real Slidev/Vite server.
 *
 * This is intentionally separate from `vitest`: it starts a development deck,
 * performs actual pointer gestures, verifies the writer endpoint and CSS HMR,
 * and restores the generated stylesheet byte-for-byte afterwards.
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { randomInt } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-chromium'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const output = resolve(root, 'styles/drawn-annotations.generated.css')
const port = randomInt(31000, 39000)
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [
  'node_modules/@slidev/cli/bin/slidev.mjs', 'slides.md', '--port', String(port),
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })

let serverOutput = ''
server.stdout.on('data', data => serverOutput += data)
server.stderr.on('data', data => serverOutput += data)

function fail(message) {
  throw new Error(`${message}\n\nSlidev output:\n${serverOutput}`)
}

async function waitForServer() {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      fail(`Slidev development server exited with ${server.exitCode}.`)
    try {
      const response = await fetch(`${origin}/__drawn-annotations`)
      if (response.ok)
        return
    }
    catch {
      // Vite has not begun listening yet.
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  fail('Timed out waiting for the DrawnAnnotation writer endpoint.')
}

async function geometry() {
  const response = await fetch(`${origin}/__drawn-annotations`)
  if (!response.ok)
    fail(`Writer endpoint returned ${response.status}.`)
  return response.json()
}

async function drag(page, locator, dx, dy) {
  const box = await locator.boundingBox()
  if (!box)
    throw new Error(`Could not measure ${await locator.getAttribute('class') ?? 'editor control'}.`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 4 })
  await page.mouse.up()
}

async function run() {
  await waitForServer()
  const initialGeometry = await geometry()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    // Slide 27 is the compact editor fixture. Advance through Slidev itself
    // rather than assuming a query-string click encoding, which has changed
    // between Slidev releases.
    await page.goto(`${origin}/27`, { waitUntil: 'networkidle' })
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)

    const annotation = page.locator('[data-drawn-annotation-id="kotlin-main-entry-label"]')
    const label = annotation.locator('.annotation-label')
    await label.waitFor({ state: 'visible' })
    const routeBeforeEditing = page.url()
    await page.getByRole('button', { name: 'Edit annotations' }).click()
    await drag(page, label, 48, 24)
    await page.waitForTimeout(500)
    const afterLabel = await geometry()
    const labelGeometry = afterLabel.geometry['kotlin-main-entry-label']
    if (afterLabel.revision === initialGeometry.revision || !labelGeometry || labelGeometry.x === undefined || labelGeometry.y === undefined)
      fail('Dragging a label did not persist a new normalized label position.')

    // Width is an independently selected pointer control; this catches a
    // regression where the nested button advances Slidev instead of resizing.
    await drag(page, annotation.locator('.annotation-width-handle'), 36, 0)
    await page.waitForTimeout(500)
    const afterWidth = await geometry()
    if (afterWidth.revision === afterLabel.revision || afterWidth.geometry['kotlin-main-entry-label']?.width === undefined)
      fail('Dragging the label width handle did not persist a new normalized width.')

    const handles = annotation.locator('.annotation-connector-handle')
    await handles.first().waitFor({ state: 'visible' })
    await drag(page, handles.first(), 18, 12)
    await page.waitForTimeout(500)
    const afterEndpoint = await geometry()
    const endpointGeometry = afterEndpoint.geometry['kotlin-main-entry-label']
    if (afterEndpoint.revision === afterWidth.revision || endpointGeometry?.x1 === undefined || endpointGeometry?.y1 === undefined || endpointGeometry.x2 === undefined || endpointGeometry.y2 === undefined)
      fail('Dragging a connector endpoint did not persist a new pair of manual endpoints.')

    await drag(page, annotation.locator('.annotation-connector-hit'), -12, 10)
    await page.waitForTimeout(500)
    const afterBody = await geometry()
    if (afterBody.revision === afterEndpoint.revision)
      fail('Dragging the connector body did not save a new geometry revision.')

    // Keyboard changes are intentionally persisted through the same writer as
    // pointer gestures. Exercise both a nudge and its Cmd/Ctrl+Z recovery,
    // rather than only checking the in-memory preview.
    await label.click()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(500)
    const afterNudge = await geometry()
    if (afterNudge.revision === afterBody.revision || afterNudge.geometry['kotlin-main-entry-label']?.x === afterBody.geometry['kotlin-main-entry-label']?.x)
      fail('Arrow-key label movement did not persist a new geometry revision.')

    const undoModifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta' : 'Control')
    await page.keyboard.press(`${undoModifier}+z`)
    await page.waitForTimeout(500)
    const afterUndo = await geometry()
    if (JSON.stringify(afterUndo.geometry['kotlin-main-entry-label']) !== JSON.stringify(afterBody.geometry['kotlin-main-entry-label']))
      fail(`Cmd/Ctrl+Z did not restore the geometry from before the keyboard nudge. Expected ${JSON.stringify(afterBody.geometry['kotlin-main-entry-label'])}; received ${JSON.stringify(afterUndo.geometry['kotlin-main-entry-label'])}.`)

    // Simulate a second author writing after this page has loaded. The next
    // nudge must be rejected rather than overwriting that newer revision, and
    // the explicit reload action must recover the current saved document.
    const externallySaved = await page.evaluate(async ({ expectedRevision, current }) => {
      const response = await fetch('/__drawn-annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          expectedRevision,
          annotations: {
            'kotlin-main-entry-label': { ...current, x: .3333 },
          },
        }),
      })
      return { status: response.status, body: await response.json() }
    }, { expectedRevision: afterUndo.revision, current: afterUndo.geometry['kotlin-main-entry-label'] })
    if (externallySaved.status !== 200)
      fail(`Simulated concurrent annotation save returned ${externallySaved.status}.`)

    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(500)
    const afterConflict = await geometry()
    if (afterConflict.revision !== externallySaved.body.revision || afterConflict.geometry['kotlin-main-entry-label']?.x !== .3333)
      fail(`A stale keyboard save overwrote geometry written by another author. Expected revision ${externallySaved.body.revision} and x .3333; received revision ${afterConflict.revision} and x ${afterConflict.geometry['kotlin-main-entry-label']?.x}.`)
    await page.getByRole('status').filter({ hasText: /geometry changed|stale|revision|conflict/i }).waitFor({ state: 'visible' })

    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Reload saved geometry' }).click()
    await page.getByRole('status').filter({ hasText: 'Saved annotation geometry reloaded' }).waitFor({ state: 'visible' })

    // Reload proves that the generated CSS, not just Vue draft state, owns the
    // final geometry. The values are read through CSS after Vite's HMR update.
    await page.reload({ waitUntil: 'networkidle' })
    await label.waitFor({ state: 'visible' })
    const css = await annotation.evaluate((element) => {
      const style = getComputedStyle(element)
      return ['--da-label-x', '--da-label-y', '--da-label-width', '--da-connector-x1', '--da-connector-y1', '--da-connector-x2', '--da-connector-y2']
        .map(name => [name, style.getPropertyValue(name).trim()])
    })
    const persisted = afterConflict.geometry['kotlin-main-entry-label']
    const fields = [['--da-label-x', 'x'], ['--da-label-y', 'y'], ['--da-label-width', 'width'], ['--da-connector-x1', 'x1'], ['--da-connector-y1', 'y1'], ['--da-connector-x2', 'x2'], ['--da-connector-y2', 'y2']]
    for (const [property, field] of fields) {
      const value = css.find(([name]) => name === property)?.[1]
      if (value !== String(persisted[field]))
        fail(`Reloaded CSS ${property} (${value}) did not match persisted ${field} (${persisted[field]}).`)
    }
    if (page.url() !== routeBeforeEditing)
      fail(`Editing changed the active Slidev route from ${routeBeforeEditing} to ${page.url()}.`)
  }
  finally {
    await browser.close()
  }
}

const originalOutput = await readFile(output)
try {
  await run()
  console.log('DrawnAnnotation browser editor interactions passed.')
}
finally {
  // The test deliberately writes through the real plugin. Never leave a
  // developer's generated geometry changed, including when an assertion fails.
  await writeFile(output, originalOutput)
  // Register before signalling: a fast Vite shutdown can otherwise emit exit
  // between kill() and once(), leaving top-level await pending forever.
  if (server.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        server.kill('SIGKILL')
        resolve(undefined)
      }, 5_000)
      server.once('exit', () => {
        clearTimeout(timer)
        resolve(undefined)
      })
      server.kill('SIGTERM')
    })
  }
}
