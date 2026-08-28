#!/usr/bin/env node
/**
 * Boot the real Slidev development server and assert that the source-geometry
 * editor is available without any generated stylesheet or annotation IDs.
 * Source mutation semantics are covered in the plugin unit tests; this smoke
 * test deliberately leaves the checked-out Markdown untouched.
 */
import { spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-chromium'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const port = randomInt(31000, 39000)
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [
  'node_modules/@slidev/cli/bin/slidev.mjs', 'slides.md', '--port', String(port),
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
server.stdout.on('data', data => output += data)
server.stderr.on('data', data => output += data)

function fail(message) { throw new Error(`${message}\n\nSlidev output:\n${output}`) }
async function waitForServer() {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) fail(`Slidev development server exited with ${server.exitCode}.`)
    try {
      if ((await fetch(`${origin}/__drawn-annotation-source`)).ok) return
    }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  fail('Timed out waiting for the DrawnAnnotation source writer endpoint.')
}

try {
  await waitForServer()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`${origin}/8`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Edit annotations' }).click()
    await page.getByRole('button', { name: 'Done editing annotations' }).waitFor({ state: 'visible' })
    if (await page.locator('[data-drawn-annotation-id]').count())
      fail('Development DOM still contains legacy annotation ID attributes.')
  }
  finally { await browser.close() }
  console.log('DrawnAnnotation source-geometry editor smoke test passed.')
}
finally {
  if (server.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => { server.kill('SIGKILL'); resolve() }, 5_000)
      server.once('exit', () => { clearTimeout(timer); resolve() })
      server.kill('SIGTERM')
    })
  }
}
