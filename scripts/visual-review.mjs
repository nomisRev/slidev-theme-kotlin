#!/usr/bin/env node
/**
 * Render every Slidev slide/click state at two revisions for the theme deck and
 * its local consumer deck, then make a local visual-review bundle. Unlike a
 * checked-in screenshot baseline, the baseline is rendered from a Git ref, so
 * it cannot get stale and no PNGs need to live
 * in the repository. Review `.visual/review/index.html` and accept an intended
 * change by committing it; the next comparison uses that commit as its base.
 *
 * Usage:
 *   node scripts/visual-review.mjs [--base <git-ref>] [--check]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Kotlin Fundamentals exercises the theme more extensively than the bundled
// example deck. Keep it optional so the theme repository still works elsewhere.
const consumerProjectRoot = resolve(homedir(), 'Developer/kotlin-fundamentals')
const reviewConsumer = existsSync(join(consumerProjectRoot, 'slides.md'))
const outputRoot = resolve(projectRoot, '.visual')
const currentDir = join(outputRoot, 'current')
const baselineDir = join(outputRoot, 'baseline')
const reviewDir = join(outputRoot, 'review')
const args = process.argv.slice(2)
const check = args.includes('--check')
const baseIndex = args.indexOf('--base')
const base = baseIndex === -1 ? 'HEAD' : args[baseIndex + 1]

if (baseIndex !== -1 && !base)
  throw new Error('`--base` needs a Git revision, for example `--base origin/main`.')

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: projectRoot, stdio: 'inherit', ...options })
  if (result.status !== 0)
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}.`)
}

function empty(dir) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

function listPngs(dir) {
  const files = []
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory())
        visit(path)
      else if (entry.isFile() && extname(entry.name) === '.png')
        files.push(relative(dir, path))
    }
  }
  if (existsSync(dir))
    visit(dir)
  return files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

function capture(cwd, destination) {
  empty(destination)
  // Slidev's exporter uses Playwright and its `--with-clicks` option captures
  // the initial state plus every settled click state for each slide.
  run(process.execPath, [
    resolve(projectRoot, 'node_modules/@slidev/cli/bin/slidev.mjs'),
    'export',
    'slides.md',
    '--format', 'png',
    '--with-clicks',
    '--output', destination,
    '--wait', '1200',
    '--wait-until', 'networkidle',
  ], { cwd })
}

function linkDependencies(source, destination) {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'slidev-theme-kotlin')
      continue
    symlinkSync(join(source, entry.name), join(destination, entry.name), entry.isDirectory() ? 'dir' : 'file')
  }
}

function withConsumerProject(themeRoot, callback) {
  const worktree = mkdtempSync(join(tmpdir(), 'slidev-visual-consumer-'))
  try {
    // Keep the consumer's source and assets intact, but give it a private
    // node_modules directory so its theme package can point at the revision
    // being reviewed without changing the consumer's working tree.
    cpSync(consumerProjectRoot, worktree, {
      recursive: true,
      filter: (path) => {
        const pathFromRoot = relative(consumerProjectRoot, path)
        return ![
          'node_modules',
          '.git',
          'dist',
        ].some((excluded) => pathFromRoot === excluded || pathFromRoot.startsWith(`${excluded}${sep}`))
      },
    })
    linkDependencies(join(consumerProjectRoot, 'node_modules'), join(worktree, 'node_modules'))
    symlinkSync(themeRoot, join(worktree, 'node_modules/slidev-theme-kotlin'), 'dir')
    return callback(worktree)
  }
  finally {
    rmSync(worktree, { recursive: true, force: true })
  }
}

function exportRevision(ref) {
  const worktree = mkdtempSync(join(tmpdir(), 'slidev-visual-'))
  try {
    // `git archive` gives us exactly the selected revision, including its
    // components and theme styles. Reusing the current dependency tree avoids
    // a second npm install while still rendering the old source faithfully.
    const archive = execFileSync('git', ['archive', '--format=tar', ref], { cwd: projectRoot })
    const unpacked = spawnSync('tar', ['-xf', '-'], { cwd: worktree, input: archive })
    if (unpacked.status !== 0)
      throw new Error(`Could not unpack Git revision ${ref}.`)
    symlinkSync(join(projectRoot, 'node_modules'), join(worktree, 'node_modules'), 'dir')
    capture(worktree, baselineDir)

    if (reviewConsumer) {
      withConsumerProject(worktree, (consumerWorktree) => {
        capture(consumerWorktree, join(baselineDir, 'kotlin-fundamentals'))
      })
    }
  }
  finally {
    rmSync(worktree, { recursive: true, force: true })
  }
}

function copyImage(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
}

function diffImages(file) {
  const beforePath = join(baselineDir, file)
  const afterPath = join(currentDir, file)
  if (!existsSync(beforePath) || !existsSync(afterPath))
    return { status: existsSync(afterPath) ? 'added' : 'removed', pixels: 0 }

  const before = PNG.sync.read(readFileSync(beforePath))
  const after = PNG.sync.read(readFileSync(afterPath))
  if (before.width !== after.width || before.height !== after.height)
    return { status: 'resized', pixels: 0 }

  const diff = new PNG({ width: before.width, height: before.height })
  const pixels = pixelmatch(before.data, after.data, diff.data, before.width, before.height, {
    threshold: 0.1,
    includeAA: false,
    diffColor: [255, 54, 54],
    diffColorAlt: [54, 144, 255],
  })
  if (!pixels)
    return { status: 'same', pixels }

  const diffPath = join(reviewDir, file)
  mkdirSync(dirname(diffPath), { recursive: true })
  writeFileSync(diffPath, PNG.sync.write(diff))
  return { status: 'changed', pixels }
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function imagePath(folder, file) {
  return `../${folder}/${file.split('/').map(encodeURIComponent).join('/')}`
}

function writeReview(results) {
  empty(reviewDir)
  // `diffImages` writes files after this directory is made. It is deliberately
  // called from here so stale diff PNGs can never appear in a new review.
  for (const result of results)
    result.diff = diffImages(result.file)

  const changed = results.filter(result => result.diff.status !== 'same')
  const cards = changed.map(({ file, diff }) => {
    const title = escapeHtml(file)
    const before = existsSync(join(baselineDir, file))
      ? `<figure><figcaption>Base: ${title}</figcaption><img src="${imagePath('baseline', file)}" alt="Base screenshot for ${title}"></figure>`
      : '<figure><figcaption>No base screenshot (new state)</figcaption></figure>'
    const after = existsSync(join(currentDir, file))
      ? `<figure><figcaption>Current: ${title}</figcaption><img src="${imagePath('current', file)}" alt="Current screenshot for ${title}"></figure>`
      : '<figure><figcaption>No current screenshot (removed state)</figcaption></figure>'
    const diffImage = diff.status === 'changed'
      ? `<figure><figcaption>Pixel diff: ${diff.pixels.toLocaleString()} changed pixels</figcaption><img src="${file.split('/').map(encodeURIComponent).join('/')}" alt="Pixel diff for ${title}"></figure>`
      : `<p class="note">${escapeHtml(diff.status)}</p>`
    return `<article><h2>${title}</h2><div class="images">${before}${after}${diffImage}</div></article>`
  }).join('\n') || '<p class="success">No visual differences.</p>'

  writeFileSync(join(reviewDir, 'index.html'), `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Slidev visual review</title>
<style>
body { margin: 0 auto; max-width: 1800px; padding: 24px; background: #17151d; color: #f4efff; font: 16px/1.45 system-ui, sans-serif; }
h1 { margin-bottom: 0; } .summary, .note { color: #c8bedc; } .success { color: #8ce0a1; font-weight: 700; }
article { margin: 36px 0; padding-top: 12px; border-top: 1px solid #4b435a; } h2 { font-size: 18px; }
.images { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
figure { margin: 0; min-width: 0; } figcaption { margin-bottom: 6px; color: #c8bedc; font-size: 14px; }
img { display: block; width: 100%; height: auto; background: #fff; } @media (max-width: 1000px) { .images { grid-template-columns: 1fr; } }
</style>
<h1>Slidev visual review</h1>
<p class="summary">Base <code>${escapeHtml(base)}</code> → working tree. ${changed.length} of ${results.length} captured states differ. Red and blue pixels in a diff indicate changed image data.</p>
${cards}
</html>`)
  return changed
}

if (!existsSync(join(projectRoot, '.git')))
  throw new Error('Visual comparison needs a Git checkout so it can render a base revision.')

empty(outputRoot)
if (reviewConsumer)
  console.log(`Including consumer deck: ${consumerProjectRoot}`)
else
  console.log(`Consumer deck not found at ${consumerProjectRoot}; reviewing the theme deck only.`)
console.log(`\nCapturing base revision ${base}…`)
exportRevision(base)
console.log('\nCapturing the working tree…')
capture(projectRoot, currentDir)
if (reviewConsumer) {
  capture(consumerProjectRoot, join(currentDir, 'kotlin-fundamentals'))
}

const names = [...new Set([...listPngs(baselineDir), ...listPngs(currentDir)])]
const results = names.map(file => ({ file }))
const changed = writeReview(results)
const review = join(reviewDir, 'index.html')
console.log(`\nVisual review: file://${review}`)
console.log(`${changed.length} of ${names.length} screenshot states changed.`)
if (check && changed.length)
  process.exitCode = 1
