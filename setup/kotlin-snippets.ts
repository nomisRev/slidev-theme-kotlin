/**
 * Compilable Kotlin sources from the deck's snippets.
 *
 * A Kotlin fence on a slide is a fragment: it carries its imports (see
 * `code-imports.ts`) but not a package, and it may mix declarations with
 * bare statements such as `Talks.selectAll()`. This module turns every such
 * fence into one Kotlin file, in the spirit of KotlinX Knit, so a Gradle
 * module can compile the deck's code against the real libraries and a stale
 * slide fails the build instead of the talk:
 *
 * - each file gets its own package (`<package>.<section>.slide<n>`), so
 *   the steps of a Magic Move chain can all declare `object Talks`;
 * - the imports written in the fence are kept, as is anything folded above
 *   a `// Example` marker, and the deck can add shared imports
 *   (`themeConfig.snippets.imports`) for tables and types the slides use
 *   without defining, kept in a hand-written support package;
 * - top-level declarations stay top-level and bare statements are wrapped
 *   in `suspend fun main()`, where a Kotlin file allows them.
 *
 * Fences with `no-compile` in their info (prose-like sketches, library
 * internals), `gradle` build-script fences, and fences an
 * `InlineCompilerError` wraps (shown broken on purpose) are skipped. The CLI in
 * `bin/kotlin-snippets.mjs` runs `collectSnippetFiles` over a deck and
 * `syncSnippetFiles` writes or checks the result.
 */
import type { SlideInfo } from '@slidev/types'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { NO_COMPILE_FLAG, splitImportBlock, splitLeadingImports } from './code-imports'
import { extractTopLevelFences } from './magic-move-between'
import type { ParsedFence } from './magic-move-between'
import { expandMagicMoveBlocks, plainTitle } from './static-content'

// ---------------------------------------------------------------------------
// Settings

export interface SnippetSettings {
  /** Output directory, relative to the deck root. */
  dir: string
  /** Base package; every file gets a sub-package of it. */
  package: string
  /** Import targets added to every file, e.g. `presentation.support.*`. */
  imports: string[]
}

const DEFAULT_SETTINGS: SnippetSettings = { dir: 'src/main/kotlin/snippets', package: 'snippets', imports: [] }

/**
 * `themeConfig.snippets`: `true` for the defaults, an object to override
 * `dir`, `package`, and `imports`, or unset to leave the feature off.
 */
export function resolveSnippetSettings(themeConfig: unknown): SnippetSettings | undefined {
  const raw = (themeConfig as { snippets?: unknown } | undefined)?.snippets
  if (!raw)
    return undefined
  if (raw === true)
    return { ...DEFAULT_SETTINGS }
  if (typeof raw !== 'object')
    return undefined
  const config = raw as Partial<Record<keyof SnippetSettings, unknown>>
  const imports = Array.isArray(config.imports)
    ? config.imports.map(String)
    : typeof config.imports === 'string' ? [config.imports] : []
  return {
    dir: (typeof config.dir === 'string' && config.dir.trim()) || DEFAULT_SETTINGS.dir,
    package: (typeof config.package === 'string' && config.package.trim()) || DEFAULT_SETTINGS.package,
    imports,
  }
}

// ---------------------------------------------------------------------------
// Kotlin scanning

interface ScannedLine {
  text: string
  /** The line with comments blanked out and the contents of string and char literals replaced by spaces. */
  masked: string
  /** Bracket depth (`{([`) at the start of the line. */
  depthAtStart: number
  /** Whether the line starts inside a block comment or a raw string. */
  insideAtStart: boolean
}

type Mode = 'code' | 'block' | 'string' | 'raw'

/**
 * Walk Kotlin source line by line, tracking bracket depth across block
 * comments, string literals (including `${}` templates), raw strings, and
 * char literals, so a caller can tell where top-level constructs begin.
 */
export function scanKotlin(code: string): ScannedLine[] {
  const result: ScannedLine[] = []
  let depth = 0
  let mode: Mode = 'code'
  let blockDepth = 0
  // A `${` template inside a string switches to code until the brace that
  // brings the depth back to where the template opened.
  const templates: { mode: Mode, depth: number }[] = []

  for (const text of code.split(/\r?\n/)) {
    const depthAtStart = depth
    const insideAtStart = mode !== 'code'
    let masked = ''
    let i = 0
    while (i < text.length) {
      const c = text[i]
      const two = text.slice(i, i + 2)
      if (mode === 'code') {
        if (two === '//')
          break
        if (two === '/*') {
          mode = 'block'
          blockDepth = 1
          masked += '  '
          i += 2
          continue
        }
        if (text.startsWith('"""', i)) {
          mode = 'raw'
          masked += '"""'
          i += 3
          continue
        }
        if (c === '"') {
          mode = 'string'
          masked += '"'
          i++
          continue
        }
        if (c === '\'') {
          const close = text.indexOf('\'', text[i + 1] === '\\' ? i + 3 : i + 2)
          const end = close < 0 ? text.length : close + 1
          masked += `'${' '.repeat(Math.max(end - i - 2, 0))}'`
          i = end
          continue
        }
        if (c === '{' || c === '(' || c === '[')
          depth++
        else if (c === '}' || c === ')' || c === ']')
          depth--
        masked += c
        i++
        if (c === '}' && templates.length && templates[templates.length - 1].depth === depth)
          mode = templates.pop()!.mode
        continue
      }
      if (mode === 'block') {
        if (two === '/*') {
          blockDepth++
          masked += '  '
          i += 2
        }
        else if (two === '*/') {
          blockDepth--
          masked += '  '
          i += 2
          if (blockDepth === 0)
            mode = 'code'
        }
        else {
          masked += ' '
          i++
        }
        continue
      }
      if (two === '${') {
        templates.push({ mode, depth })
        depth++
        mode = 'code'
        masked += '  '
        i += 2
        continue
      }
      if (mode === 'string') {
        if (c === '\\') {
          masked += '  '
          i += 2
        }
        else {
          if (c === '"')
            mode = 'code'
          masked += c === '"' ? '"' : ' '
          i++
        }
        continue
      }
      // raw string
      if (text.startsWith('"""', i)) {
        mode = 'code'
        masked += '"""'
        i += 3
      }
      else {
        masked += ' '
        i++
      }
    }
    result.push({ text, masked, depthAtStart, insideAtStart })
  }
  return result
}

// ---------------------------------------------------------------------------
// Top-level split

export interface TopLevelSplit {
  /** `@file:` annotations, which must precede the package line. */
  fileAnnotations: string[]
  /** Top-level declarations, as written. */
  declarations: string
  /** Bare statements and expressions, as written (not yet indented). */
  statements: string
}

const MODIFIERS = 'public|private|protected|internal|expect|actual|final|open|abstract|sealed|const|external|override|lateinit|tailrec|vararg|suspend|inner|enum|annotation|companion|inline|value|infix|operator|data|noinline|crossinline'
const DECLARATION = new RegExp(`^(?:@[\\w.]+(?:\\([^)]*\\))?\\s+)*(?:(?:${MODIFIERS})\\s+)*(?:fun|val|var|object|class|interface|typealias)\\b`)
const DECLARATION_PREFIX = /^(?:@[\w.]|context\s*\()/
// A non-indented line that can only continue the construct above it.
const CONTINUATION = /^(?:[.)\]}]|\?[.:]|&&|\|\||->|else\b|catch\b|finally\b)/
// A line after which the construct is still open.
const OPEN_ENDING = /(?:[=,:.]|->|&&|\|\||\?:|\belse|\btry|\bfinally)$/

/**
 * Separate a fragment into what a Kotlin file accepts at top level and what
 * it does not. A construct starts on a non-indented line at bracket depth
 * zero; it is a declaration when that line opens one (`fun`, `val`,
 * `object`, ... with optional annotations, modifiers, or a `context(...)`
 * line before it), and a statement otherwise. `package` lines are dropped:
 * the generated file owns its package.
 */
export function splitTopLevel(code: string): TopLevelSplit {
  const fileAnnotations: string[] = []
  const chunks: { kind: 'declaration' | 'statement', lines: string[] }[] = []
  let previousOpen = false
  for (const line of scanKotlin(code)) {
    const masked = line.masked.trim()
    const blank = line.text.trim() === ''
    const topLevel = line.depthAtStart === 0 && !line.insideAtStart && !/^\s/.test(line.text)
    if (topLevel && /^@file:/.test(line.text.trim())) {
      fileAnnotations.push(line.text.trim())
      continue
    }
    if (topLevel && /^package\s/.test(masked))
      continue
    const starts = topLevel && !blank && !previousOpen && !CONTINUATION.test(masked)
    if (starts || !chunks.length) {
      const kind = DECLARATION.test(masked) || DECLARATION_PREFIX.test(masked) ? 'declaration' : 'statement'
      // An annotation or `context(...)` line belongs with what follows it.
      const last = chunks[chunks.length - 1]
      if (starts && last && last.kind === 'declaration' && last.lines.every(l => DECLARATION_PREFIX.test(l.trim()) || !l.trim()))
        last.lines.push(line.text)
      else
        chunks.push({ kind, lines: [line.text] })
    }
    else {
      chunks[chunks.length - 1].lines.push(line.text)
    }
    if (!blank)
      previousOpen = OPEN_ENDING.test(masked)
  }
  const join = (kind: 'declaration' | 'statement') => chunks
    .filter(chunk => chunk.kind === kind)
    .map(chunk => chunk.lines.join('\n').replace(/\s+$/, ''))
    .filter(Boolean)
    .join('\n\n')
  return { fileAnnotations, declarations: join('declaration'), statements: join('statement') }
}

// ---------------------------------------------------------------------------
// Files

export interface SnippetSource {
  /** Source Markdown file, relative to the deck root. */
  file: string
  /** 1-based slide number as shown in the presentation. */
  slide: number
  title: string
}

export interface SnippetFile {
  /** Output path, relative to the deck root. */
  path: string
  package: string
  content: string
  source: SnippetSource
}

type SnippetSlide = Pick<SlideInfo, 'index' | 'title' | 'content'> & { source: Pick<SlideInfo['source'], 'filepath'> }

export const GENERATED_MARKER = '// Generated by slidev-theme-kotlin'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function identifier(slug: string): string {
  const id = slug.replace(/[^a-z0-9]/g, '')
  return /^\d/.test(id) ? `s${id}` : id
}

// Attribute lists may hold `>` inside quotes (`message="a > b"`), so a tag
// ends at the first `>` outside a quoted value.
const INLINE_COMPILER_ERROR = /<InlineCompilerError\b(?:"[^"]*"|'[^']*'|[^>"'])*(?<!\/)>[\s\S]*?<\/InlineCompilerError>/g

/**
 * Drop the fences an `InlineCompilerError` wraps: the slide shows the
 * diagnostic on purpose, so that code is meant not to compile.
 */
export function withoutCompilerErrorFences(content: string): string {
  return content.replace(INLINE_COMPILER_ERROR, '')
}

/** Whether a fence should become a Kotlin file. */
export function isCompilable(fence: ParsedFence): boolean {
  if (!['kotlin', 'kt'].includes(fence.lang))
    return false
  if (fence.flags.includes(NO_COMPILE_FLAG))
    return false
  return !fence.meta.split(/\s+/).includes('gradle')
}

function indentUnit(code: string): string {
  const match = code.match(/^( +)\S/m)
  return match ? match[1] : '    '
}

/** The Kotlin source for one fence. */
export function renderSnippetFile(fence: ParsedFence, pkg: string, source: SnippetSource, settings: SnippetSettings): string {
  // The file compiles the fence as written, marker line aside. A folded
  // `// Example` prefix goes back above the code; a `show-imports` fence
  // still carries its prefix (and marker) in `code`, so fold that here
  // and put it back the same way. Only the imports leave the body: they
  // move to the file header.
  const marked = fence.prefix === undefined ? splitLeadingImports(fence.code) : undefined
  const written = fence.prefix !== undefined
    ? `${fence.prefix}\n\n${fence.code}`
    : marked?.prefix !== undefined ? `${marked.prefix}\n\n${marked.body}` : fence.code
  const shown = splitImportBlock(written)
  const split = splitTopLevel(shown.body)
  const imports = [...new Set([...settings.imports, ...fence.imports, ...shown.imports])]
  const sections: string[] = [
    `${GENERATED_MARKER} from ${source.file}, slide ${source.slide} "${source.title.replace(/"/g, '\'')}".\n// Do not edit: change the slide and run \`slidev-kotlin-snippets\` again.`,
  ]
  if (split.fileAnnotations.length)
    sections.push(split.fileAnnotations.join('\n'))
  sections.push(`package ${pkg}`)
  if (imports.length)
    sections.push(imports.map(target => `import ${target}`).join('\n'))
  if (split.declarations)
    sections.push(split.declarations)
  if (split.statements) {
    const name = /\bfun\s+main\s*\(/.test(split.declarations) ? 'snippet' : 'main'
    const indent = indentUnit(shown.body)
    const body = split.statements.split('\n').map(line => (line ? indent + line : line)).join('\n')
    sections.push(`suspend fun ${name}() {\n${body}\n}`)
  }
  return `${sections.join('\n\n')}\n`
}

/**
 * One Kotlin file per compilable fence of the deck. Files are grouped by
 * source Markdown file and named after the slide; a slide with several
 * fences tells them apart by their first meta word (`jdbc`, `r2dbc`) or a
 * letter.
 */
export function collectSnippetFiles(slides: SnippetSlide[], userRoot: string, settings: SnippetSettings): SnippetFile[] {
  const files: SnippetFile[] = []
  const usedPaths = new Set<string>()
  for (const slide of slides) {
    const fences = extractTopLevelFences(expandMagicMoveBlocks(withoutCompilerErrorFences(slide.content)), { foldImports: true }).filter(isCompilable)
    if (!fences.length)
      continue
    const file = relative(userRoot, slide.source.filepath).split('\\').join('/')
    const section = slugify(basename(file, extname(file))) || 'slides'
    const no = slide.index + 1
    const title = plainTitle(slide.title) || `Slide ${no}`
    const source: SnippetSource = { file, slide: no, title }
    const labels = fences.map(fence => fence.meta.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || '')
    fences.forEach((fence, index) => {
      let suffix = ''
      if (fences.length > 1) {
        const label = labels[index]
        suffix = label && labels.indexOf(label) === index && labels.lastIndexOf(label) === index
          ? label
          : String.fromCharCode('a'.charCodeAt(0) + index)
      }
      const base = `${String(no).padStart(3, '0')}-${slugify(title) || 'slide'}${suffix ? `-${suffix}` : ''}`
      let path = `${settings.dir.replace(/\/+$/, '')}/${section}/${base}.kt`
      for (let n = 2; usedPaths.has(path); n++)
        path = `${settings.dir.replace(/\/+$/, '')}/${section}/${base}-${n}.kt`
      usedPaths.add(path)
      const pkg = `${settings.package}.${identifier(section)}.slide${no}${identifier(suffix)}`
      files.push({ path, package: pkg, content: renderSnippetFile(fence, pkg, source, settings), source })
    })
  }
  return files
}

// ---------------------------------------------------------------------------
// Writing

export interface SyncResult {
  /** Files whose content changed or that did not exist. */
  written: string[]
  /** Generated files no fence produces any more. */
  removed: string[]
  unchanged: string[]
}

function generatedFilesUnder(dir: string): string[] {
  if (!existsSync(dir))
    return []
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory())
      found.push(...generatedFilesUnder(path))
    else if (entry.endsWith('.kt') && readFileSync(path, 'utf-8').startsWith(GENERATED_MARKER))
      found.push(path)
  }
  return found
}

/**
 * Write the generated files under `root`, removing generated files that are
 * no longer produced. Hand-written `.kt` files in the directory are left
 * alone. With `check`, nothing is written: the result lists what a write
 * would change, so a CI job can fail on stale sources.
 */
export function syncSnippetFiles(root: string, settings: SnippetSettings, files: SnippetFile[], options: { check?: boolean } = {}): SyncResult {
  const result: SyncResult = { written: [], removed: [], unchanged: [] }
  const expected = new Map(files.map(file => [join(root, file.path), file.content]))
  for (const [path, content] of expected) {
    if (existsSync(path) && readFileSync(path, 'utf-8') === content) {
      result.unchanged.push(relative(root, path))
      continue
    }
    result.written.push(relative(root, path))
    if (!options.check) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf-8')
    }
  }
  for (const path of generatedFilesUnder(join(root, settings.dir))) {
    if (expected.has(path))
      continue
    result.removed.push(relative(root, path))
    if (!options.check)
      rmSync(path)
  }
  return result
}
