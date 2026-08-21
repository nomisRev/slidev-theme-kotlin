#!/usr/bin/env node
/**
 * Export one Slidev slide, optionally at an exact click state, as a PNG.
 *
 * Usage:
 *   node scripts/export-slide.mjs --slide 7
 *   node scripts/export-slide.mjs --slide 7 --click 2 --output artifacts/slide-7-click-2.png
 *   node scripts/export-slide.mjs --entry talk.md --slide 7 --click 0
 *
 * Click numbers are zero-based: click 0 is the slide's initial state. This is
 * intentionally different from Slidev's PNG names, whose click suffix is
 * one-based (for example, Slidev's `007-03.png` is --click 2).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const slidevCli = join(projectRoot, 'node_modules/@slidev/cli/bin/slidev.mjs')

function usage(exitCode = 0) {
  const stream = exitCode ? console.error : console.log
  stream(`Export a single Slidev slide as PNG.

Usage:
  node scripts/export-slide.mjs --slide <number> [options]

Options:
  --slide <number>       Required one-based Slidev slide number.
  --click <number>       Optional zero-based click state (0 = initial state).
  --entry <path>         Slidev entry file (default: slides.md).
  --output <path>        Destination PNG (default: .slidev/exports/slide-<n>[-click-<n>].png).
  --dark                 Export using the dark color scheme.
  --wait <milliseconds>  Wait before capture.
  --timeout <milliseconds>  Render timeout (default: 30000).
  --help                 Show this help.

Examples:
  npm run export:slide -- --slide 12
  npm run export:slide -- --slide 12 --click 3 --output artifacts/slide-12.png`)
  process.exit(exitCode)
}

function integer(value, option) {
  if (!/^\d+$/.test(value ?? '')) {
    console.error(`${option} must be a non-negative integer, received ${JSON.stringify(value)}.`)
    process.exit(2)
  }
  return Number(value)
}

const args = process.argv.slice(2)
const options = { entry: 'slides.md', timeout: '30000' }
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--help' || arg === '-h') usage()
  if (arg === '--dark') {
    options.dark = true
    continue
  }
  if (!['--slide', '--click', '--entry', '--output', '--wait', '--timeout'].includes(arg)) {
    console.error(`Unknown option: ${arg}`)
    usage(2)
  }
  const value = args[++i]
  if (!value || value.startsWith('--')) {
    console.error(`${arg} requires a value.`)
    usage(2)
  }
  options[arg.slice(2)] = value
}

if (options.slide === undefined) {
  console.error('--slide is required.')
  usage(2)
}
const slide = integer(options.slide, '--slide')
if (slide < 1) {
  console.error('--slide must be at least 1.')
  process.exit(2)
}
const click = options.click === undefined ? undefined : integer(options.click, '--click')
const timeout = integer(options.timeout, '--timeout')
const wait = options.wait === undefined ? undefined : integer(options.wait, '--wait')
const entry = resolve(process.cwd(), options.entry)
if (!existsSync(entry)) {
  console.error(`Slide entry not found: ${entry}`)
  process.exit(2)
}
if (!existsSync(slidevCli)) {
  console.error(`Slidev CLI not found: ${slidevCli}. Run npm install first.`)
  process.exit(2)
}

const defaultName = `slide-${slide}${click === undefined ? '' : `-click-${click}`}.png`
const output = resolve(process.cwd(), options.output ?? join('.slidev', 'exports', defaultName))
if (!output.endsWith('.png')) {
  console.error(`--output must name a PNG file, received: ${output}`)
  process.exit(2)
}
mkdirSync(dirname(output), { recursive: true })

// Slidev writes PNG exports into a directory. Export only the requested slide
// to a temporary directory, then retain just the requested click image.
const temporaryOutput = mkdtempSync(join(tmpdir(), 'slidev-export-slide-'))
try {
  const command = [
    slidevCli,
    'export',
    entry,
    '--format', 'png',
    '--range', String(slide),
    '--output', temporaryOutput,
    '--timeout', String(timeout),
  ]
  if (click !== undefined) command.push('--with-clicks')
  if (wait !== undefined) command.push('--wait', String(wait))
  if (options.dark) command.push('--dark')

  const exported = spawnSync(process.execPath, command, { cwd: process.cwd(), stdio: 'inherit' })
  if (exported.error) throw exported.error
  if (exported.status !== 0)
    throw new Error(`Slidev export failed with exit code ${exported.status}.`)

  // --with-clicks names states as 001-01, 001-02, ...; the suffix is one-based.
  const sourceName = click === undefined
    ? `${slide}.png`
    : `${String(slide).padStart(3, '0')}-${String(click + 1).padStart(2, '0')}.png`
  const source = join(temporaryOutput, sourceName)
  if (!existsSync(source)) {
    const available = readdirSync(temporaryOutput).filter(file => file.endsWith('.png')).sort()
    const state = click === undefined ? 'the default state' : `click ${click}`
    throw new Error(`Slide ${slide} does not have ${state}. Available exported states: ${available.join(', ') || 'none'}.`)
  }
  copyFileSync(source, output)
  console.log(`Exported slide ${slide}${click === undefined ? '' : `, click ${click}`} to ${output}`)
}
finally {
  rmSync(temporaryOutput, { recursive: true, force: true })
}
