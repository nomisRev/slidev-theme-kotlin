#!/usr/bin/env node
/**
 * Lint a Slidev deck for issues that fail silently at build time:
 *
 * 1. Frontmatter that leaked into slide content — the typical symptom of an
 *    auto-formatter (e.g. IntelliJ) mangling the `---` blocks between slides.
 *    Slidev then renders the YAML as visible text or drops it entirely.
 * 2. Invalid `kodee` configuration (unknown variant, size, or position),
 *    which the theme silently ignores or renders with a broken image.
 *
 * Usage: node scripts/lint-slides.mjs [slides.md ...]
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { load } from '@slidev/parser/fs'

const themeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const KODEE_VARIANTS = readdirSync(resolve(themeRoot, 'assets'))
  .filter(f => f.startsWith('kodee-') && f.endsWith('.svg'))
  .map(f => f.slice('kodee-'.length, -'.svg'.length))
const KODEE_SIZES = ['small', 'medium', 'large']
const KODEE_POSITIONS = ['corner', 'featured', 'custom']

// Frontmatter keys we ever expect on a slide; seeing one of these at the very
// top of a slide's *content* almost certainly means a broken `---` block.
const FRONTMATTER_KEY_RE = /^(layout|kodee|transition|class|clicks|disabled|hide|hideInToc|level|preload|routeAlias|src|title|zoom|background|theme|themeConfig|highlighter|drawings|mdc|fonts|defaults|addons|info|author|keywords|colorSchema|aspectRatio|canvasWidth|selectable|download|exportFilename|lineNumbers|monaco|remoteAssets|record|presenter|browserExporter|htmlAttrs|seoMeta):(\s|$)/

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['slides.md']
let errors = 0
let warnings = 0

function error(file, slide, msg) {
  errors++
  console.error(`✖ ${file} [slide ${slide.index + 1}${slide.title ? ` "${slide.title}"` : ''}]: ${msg}`)
}

function warn(file, slide, msg) {
  warnings++
  console.warn(`⚠ ${file} [slide ${slide.index + 1}${slide.title ? ` "${slide.title}"` : ''}]: ${msg}`)
}

function lintKodee(file, slide, kodee, source) {
  if (kodee === true || kodee === false || kodee === null || kodee === undefined)
    return
  const config = typeof kodee === 'string' ? { variant: kodee } : kodee
  if (typeof config !== 'object') {
    error(file, slide, `${source}: \`kodee\` must be a boolean, variant name, or object, got ${JSON.stringify(kodee)}`)
    return
  }
  const { variant, size, position, x, y } = config
  if (variant !== undefined) {
    const name = String(variant).replace(/^kodee-/, '')
    if (!KODEE_VARIANTS.includes(name))
      error(file, slide, `${source}: unknown kodee variant "${variant}". Available: ${KODEE_VARIANTS.join(', ')}`)
  }
  if (size !== undefined && !KODEE_SIZES.includes(size))
    error(file, slide, `${source}: unknown kodee size "${size}". Available: ${KODEE_SIZES.join(', ')}`)
  if (position !== undefined && !KODEE_POSITIONS.includes(position))
    error(file, slide, `${source}: unknown kodee position "${position}". Available: ${KODEE_POSITIONS.join(', ')}`)
  if (position === 'custom' && (x === undefined || y === undefined))
    error(file, slide, `${source}: kodee position "custom" requires both \`x\` and \`y\``)
  for (const key of Object.keys(config)) {
    if (!['variant', 'size', 'position', 'x', 'y', 'scale'].includes(key))
      warn(file, slide, `${source}: unknown kodee option \`${key}\` is ignored`)
  }
}

function lintLeakedFrontmatter(file, slide) {
  // Only inspect lines before the first blank line / heading / fence — leaked
  // YAML always sits at the very top of the slide content.
  for (const line of slide.content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```') || trimmed.startsWith('<'))
      break
    if (FRONTMATTER_KEY_RE.test(trimmed)) {
      error(file, slide, `content starts with "${trimmed}" — this looks like frontmatter that leaked out of a broken \`---\` block (auto-formatter damage?)`)
      break
    }
  }
}

for (const file of files) {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) {
    console.error(`✖ ${file}: file not found`)
    errors++
    continue
  }
  const data = await load(process.cwd(), path)

  const themeConfigKodee = data.headmatter?.themeConfig?.kodee
  if (themeConfigKodee !== undefined)
    lintKodee(file, data.slides[0], themeConfigKodee, 'themeConfig')

  for (const slide of data.slides) {
    lintLeakedFrontmatter(file, slide)
    if ('kodee' in slide.frontmatter)
      lintKodee(file, slide, slide.frontmatter.kodee, 'frontmatter')
  }
}

if (errors) {
  console.error(`\n${errors} error(s), ${warnings} warning(s)`)
  process.exit(1)
}
console.log(`✔ ${files.join(', ')}: no issues (${warnings} warning(s))`)
