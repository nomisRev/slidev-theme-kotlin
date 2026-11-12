// End-to-end check of `slidev-kotlin-present` and the phone remote against a
// built deck, in separate browser contexts so nothing can pass through
// BroadcastChannel. It does not replace a run on a physical phone.
//
//   npx slidev build slides.md && node scripts/test-remote.mjs
//   node scripts/test-remote.mjs --dist ../some-deck/dist --port 4190
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-chromium'

const { values: flags } = parseArgs({ options: { dist: { type: 'string' }, port: { type: 'string' } } })
const dist = resolve(flags.dist ?? 'dist')
const port = flags.port ?? '4188'
const bin = fileURLToPath(new URL('../bin/present.mjs', import.meta.url))
// The server keeps its write secret under the working directory: a scratch
// one keeps this test away from the secret of a real presentation.
const cwd = await mkdtemp(join(tmpdir(), 'slidev-kotlin-present-'))
const secretFile = join(cwd, 'node_modules/.cache/slidev-kotlin-present/secret')

let server
let output = ''
async function start(...args) {
  output = ''
  server = spawn(process.execPath, [bin, dist, '--port', port, ...args], { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
  server.stdout.on('data', chunk => output += chunk)
  await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(() => { throw new Error('The present server failed to start') }),
  ])
}
async function stop() {
  const stopped = once(server, 'exit')
  server.kill('SIGTERM')
  await stopped
}

const sleep = ms => new Promise(done => setTimeout(done, ms))
async function eventually(check, message, timeout = 8000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      last = await check()
      if (last)
        return last
    }
    catch (error) {
      last = error
    }
    await sleep(50)
  }
  throw new Error(`${message}${last instanceof Error ? `: ${last.message}` : ''}`)
}

const browser = await chromium.launch()
const runtimeErrors = []
const passed = []
try {
  await start()
  const origin = `http://localhost:${port}`
  const base = /Display {2}http:\/\/localhost:\d+(\S*)/.exec(output)[1]
  const secret = (await readFile(secretFile, 'utf8')).trim()
  const api = name => `${origin}${base}__remote/${name}`
  const post = (state, bearer) => fetch(api('state'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(state),
  })

  assert(output.includes(`?k=${secret}`) || output.includes('No network address'), 'The remote link is not printed')
  if (output.includes(`?k=${secret}`))
    assert(/[█▀▄]/.test(output), 'No QR code is printed with the remote link')

  // --- The write secret never leaves the server except in the printed link.
  const session = await (await fetch(api('session'))).json()
  assert.deepEqual(Object.keys(session).sort(), ['instance', 'state'])
  assert(!(await (await fetch(`${origin}${base}`)).text()).includes(secret), 'index.html leaks the secret')
  assert.equal((await post({ page: 2, clicks: 0 })).status, 403)
  assert.equal((await post({ page: 2, clicks: 0 }, 'x'.repeat(secret.length))).status, 403)
  assert.equal((await post({ page: 0, clicks: 0 }, secret)).status, 400)
  assert.equal((await fetch(api('session'))).status, 200)
  assert.equal((await (await fetch(api('session'))).json()).state, null, 'A rejected write changed the state')
  passed.push('writes need the secret')

  const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
  async function open(options = {}, { wakeLock = false } = {}) {
    const context = await browser.newContext(options)
    // Headless tabs cannot hold a screen wake lock; one context below checks
    // that the remote asks for it.
    await context.addInitScript((enabled) => {
      localStorage.setItem('slidev-wake-lock', String(enabled))
      window.__wakeLocks = 0
      if (navigator.wakeLock) {
        navigator.wakeLock.request = async () => {
          window.__wakeLocks++
          return { released: false, release: async () => {}, addEventListener() {}, removeEventListener() {} }
        }
      }
    }, wakeLock)
    const page = await context.newPage()
    page.on('pageerror', error => runtimeErrors.push(String(error)))
    return { context, page }
  }

  const { context: displayContext, page: display } = await open()
  await display.goto(`${origin}${base}`)
  await display.locator('[data-slidev-no]').first().waitFor()
  const hashMode = new URL(display.url()).hash.startsWith('#/')
  /** Where a page is, whichever router mode the deck was built with. */
  function where(page) {
    const url = new URL(page.url())
    const route = hashMode
      ? new URL(url.hash.slice(1) || '/', 'http://route')
      : new URL(`/${url.pathname.slice(base.length)}${url.search}`, 'http://route')
    return {
      presenter: route.pathname.startsWith('/presenter/'),
      page: Number(route.pathname.split('/').at(-1)),
      clicks: Number(route.searchParams.get('clicks') || 0),
    }
  }
  const position = page => ({ page: where(page).page, clicks: where(page).clicks })
  const link = (path, query = '') => hashMode ? `${origin}${base}#${path}${query}` : `${origin}${base}${path.slice(1)}${query}`
  const entry = `${origin}${base}?k=${secret}`
  const status = (page, text) => page.getByRole('status').filter({ hasText: text }).waitFor()
  async function tap(page, x = 350) {
    await page.touchscreen.tap(x, 420)
    await sleep(160)
  }
  async function synchronized(remote, follower = display) {
    const target = position(remote)
    await eventually(() => {
      const now = position(follower)
      return now.page === target.page && now.clicks === target.clicks
    }, `The follower is at ${JSON.stringify(position(follower))}, the remote at ${JSON.stringify(target)}`)
    await follower.waitForFunction((no) => {
      const slide = document.querySelector(`[data-slidev-no="${no}"]`)
      return slide && slide.getBoundingClientRect().width > 0 && slide.textContent.trim().length > 0
    }, target.page)
  }

  // --- The printed link opens the remote, connected and able to write.
  const { context: phoneContext, page: phone } = await open(mobile)
  await phone.goto(entry)
  await phone.locator('.slide-count').waitFor()
  await status(phone, 'Connected · 1 display')
  assert.deepEqual(where(phone), { presenter: true, page: 1, clicks: 0 })
  const total = Number((await phone.locator('.slide-count').innerText()).split('/')[1])
  passed.push('the remote link connects')

  // --- Walk the whole deck: every tap is one step, and the display follows.
  const notesAtStart = await phone.locator('.speaker-notes').innerText()
  const lastClicks = new Map()
  let notesChanged = false
  let previous = position(phone)
  for (let step = 0; previous.page < total && step < total * 12; step++) {
    await tap(phone)
    const current = position(phone)
    assert(current.page === previous.page + 1
      || (current.page === previous.page && current.clicks === previous.clicks + 1), `Navigation stalled or reversed: ${JSON.stringify({ previous, current })}`)
    if (current.clicks > 0)
      lastClicks.set(current.page, current.clicks)
    notesChanged ||= await phone.locator('.speaker-notes').innerText() !== notesAtStart
    previous = current
    await synchronized(phone)
  }
  assert.equal(previous.page, total, 'The walk did not reach the last slide')
  // A deck without any speaker notes shows the same placeholder throughout.
  if (!notesChanged)
    console.log('Note: the speaker notes never changed during the walk (a deck without notes?).')
  assert(await phone.locator('[data-slidev-no]').count() <= 2, 'The remote mounts more than the current and next slide')
  await tap(phone)
  assert.equal(position(phone).page, total)
  passed.push(`${total} slides in step`)

  // --- Going back onto a slide with reveals lands on its last click, also
  // --- when the remote was just reloaded and has never mounted that slide.
  const revealed = [...lastClicks.keys()].find(page => page < total)
  assert(revealed, 'The deck has no slide with clicks to test back navigation with')
  await phone.goto(link(`/presenter/${revealed + 1}`, `?k=${secret}`))
  await phone.locator('.slide-count').waitFor()
  await status(phone, 'Connected · 1 display')
  await synchronized(phone)
  await tap(phone, 30)
  const end = { page: revealed, clicks: lastClicks.get(revealed) }
  await eventually(() => position(phone).page === end.page && position(phone).clicks === end.clicks, `Cold back navigation ended at ${JSON.stringify(position(phone))}, expected ${JSON.stringify(end)}`)
  await synchronized(phone)
  await display.reload()
  await synchronized(phone)
  await tap(phone, 30)
  assert.deepEqual(position(phone), { page: revealed, clicks: end.clicks - 1 })
  await synchronized(phone)
  passed.push('cold back navigation')

  // --- A page number past the end of the deck is ignored by the display.
  const before = position(display)
  assert.equal((await post({ page: total + 500, clicks: 0 }, secret)).status, 204)
  await sleep(400)
  assert.deepEqual(position(display), before)
  await tap(phone)
  await synchronized(phone)

  // --- Scanning the code again mid-talk joins at the current slide.
  const talkAt = position(phone)
  const { context: secondContext, page: second } = await open(mobile)
  await second.goto(entry)
  await second.locator('.slide-count').waitFor()
  await eventually(() => where(second).presenter && where(second).page === talkAt.page, `A second remote opened at ${JSON.stringify(where(second))}`)
  await sleep(400)
  assert.deepEqual(position(display), talkAt, 'A joining remote moved the display')
  await secondContext.close()
  passed.push('joining mid-talk')

  // --- Without the secret the presenter route only watches.
  const { context: guestContext, page: guest } = await open(mobile)
  await guest.goto(link('/presenter/1'))
  await status(guest, 'View only')
  await synchronized(phone, guest)
  await tap(guest)
  await sleep(300)
  assert.deepEqual(position(display), talkAt, 'A page without the secret moved the display')
  await guestContext.close()
  passed.push('view-only guests')

  // --- The remote asks to keep the screen awake on the first tap.
  const { context: awakeContext, page: awake } = await open(mobile, { wakeLock: true })
  await awake.goto(link(`/presenter/${talkAt.page}`, `?k=${secret}`))
  await awake.locator('.slide-count').waitFor()
  assert.equal(await awake.evaluate(() => window.__wakeLocks), 0)
  await tap(awake, 30)
  await eventually(() => awake.evaluate(() => window.__wakeLocks > 0), 'The remote never requested a wake lock')
  await awakeContext.close()
  passed.push('wake lock')

  // --- A laptop keeps Slidev's presenter console, and can drive too.
  const { context: deskContext, page: desk } = await open()
  await desk.goto(link('/presenter/1', `?k=${secret}`))
  await desk.locator('#slide-container, .slidev-presenter, [data-slidev-no]').first().waitFor()
  assert.equal(await desk.locator('.remote-control').count(), 0, 'A laptop got the phone remote')
  await sleep(500)
  await desk.keyboard.press('ArrowRight')
  await eventually(() => position(desk).page === 2 || position(desk).clicks === 1, 'The keyboard does not drive the presenter console')
  await synchronized(desk)
  await deskContext.close()
  passed.push('desktop presenter console')

  // --- The display catches up after its connection is interrupted.
  await phone.goto(link('/presenter/1', `?k=${secret}`))
  await phone.locator('.slide-count').waitFor()
  await status(phone, 'Connected · 1 display')
  await synchronized(phone)
  await displayContext.setOffline(true)
  await tap(phone)
  await tap(phone)
  await displayContext.setOffline(false)
  await synchronized(phone)
  passed.push('display reconnect')

  // --- A restarted server keeps the secret: nobody reloads, the phone drives on.
  await stop()
  await status(phone, 'Reconnecting')
  await start()
  assert.notEqual((await (await fetch(api('session'))).json()).instance, session.instance)
  await status(phone, 'Connected · 1 display')
  await synchronized(phone)
  await tap(phone)
  await synchronized(phone)
  await display.close()
  await status(phone, 'No display connected')
  const display2 = await displayContext.newPage()
  await display2.goto(`${origin}${base}`)
  await synchronized(phone, display2)
  await status(phone, 'Connected · 1 display')
  passed.push('server restart')

  // --- A rotated secret kills the old link instead of retrying forever.
  const held = position(display2)
  await stop()
  await start('--new-secret')
  assert.notEqual((await readFile(secretFile, 'utf8')).trim(), secret)
  // The phone offers its position again on reconnecting, and is refused.
  await status(phone, 'expired')
  await tap(phone)
  await sleep(300)
  assert.deepEqual(position(display2), held, 'A rotated secret still moved the display')
  await phoneContext.close()
  passed.push('secret rotation')

  assert.deepEqual(runtimeErrors, [])
  console.log(`Passed (${hashMode ? 'hash' : 'history'} router, base ${base}): ${passed.join(', ')}.`)
}
finally {
  await browser.close()
  if (server && server.exitCode === null)
    await stop()
  await rm(cwd, { recursive: true, force: true })
}
