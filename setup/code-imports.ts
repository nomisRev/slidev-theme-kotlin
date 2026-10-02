/**
 * Folded imports.
 *
 * A snippet reads best on a slide without its import lines, but a snippet
 * that carries them is complete: it compiles as written, a snippet checker
 * such as Knit can verify it, and a reader of the deck's handout (or a coding
 * agent reading `llms-full.txt`) learns which package every symbol comes
 * from. This module lets a fence keep its imports in the Markdown source
 * while the rendered slide simply leaves them out.
 *
 * The markdown transformer in `transformers.ts` applies `foldImportEdits` to
 * each slide before Slidev parses it: the import lines leave the fence, and
 * nothing else about the code window changes, so line numbers, `{1|2-3}`
 * highlight ranges, and annotation targets all count from the first line of
 * real code. The slide shows no trace of the fold; the handout, `llms-full.txt`,
 * and the generated Kotlin sources keep the fence complete.
 *
 * A fence can fold more than its imports. A `// Example` comment line marks
 * where the example starts: everything above it — imports, but also the
 * helper declarations the example relies on — leaves the slide along with
 * the marker line. The comment is valid Kotlin, so the fence still compiles
 * as written; the handout prints it in full.
 *
 * A `// Solution` marker folds the same way but is for code the audience must
 * not read: the solution of an exercise slide that shows only the assertions.
 * The generated Kotlin sources keep it, so the assertions on the slide are
 * compiled against it, while the handout and `llms-full.txt` print the fence
 * without it (its import lines aside, so the symbols still resolve for a
 * reader). Nothing on the slide can reveal it.
 *
 * Add `show-imports` to the fence info to keep the imports visible on a slide
 * that is about them, or set `themeConfig.foldImports: false` to turn the
 * feature off for a whole deck.
 */

/** Languages whose leading `import` statements are folded. */
export const FOLDABLE_LANGS = new Set(['kotlin', 'kt', 'kts', 'java', 'scala'])

/** Fence info flag that keeps the imports of one fence visible. */
export const SHOW_IMPORTS_FLAG = 'show-imports'

/** Fence info flag that keeps a fence out of the generated Kotlin sources (see `kotlin-snippets.ts`). */
export const NO_COMPILE_FLAG = 'no-compile'

/**
 * Flags the theme reads off a fence's info line and removes before Slidev
 * or Shiki see it, so they never shadow the first word of the meta (which
 * `code-window-icon.ts` reads as the code window's identity).
 */
export const THEME_FENCE_FLAGS = [SHOW_IMPORTS_FLAG, NO_COMPILE_FLAG]

const IMPORT_LINE = /^import[ \t]+(\S.*?)[ \t]*;?[ \t]*$/
/**
 * The comment that marks where the example starts: `// Example`, optionally
 * followed by a colon and a description. Only the first one in a fence
 * counts, and only when there is code above it.
 */
export const EXAMPLE_MARKER = /^[ \t]*\/\/[ \t]*[Ee]xample(?:[ \t]*:.*)?[ \t]*$/
/**
 * The comment that marks where an exercise starts and its solution ends:
 * `// Solution`, with the same optional description. It folds like
 * `// Example`, but the folded region is kept out of the handout.
 */
export const SOLUTION_MARKER = /^[ \t]*\/\/[ \t]*[Ss]olution(?:[ \t]*:.*)?[ \t]*$/
const PRELUDE_LINE = /^(?:package[ \t]+\S|@file:)/
const SHOW_IMPORTS = /(?:^|\s)show-imports(?=\s|$)/
const THEME_FLAGS = new RegExp(`(?:^|\\s)(?:${THEME_FENCE_FLAGS.join('|')})(?=\\s|$)`, 'g')

export interface SplitImports {
  /** Import targets in the folded region, in source order, without the `import` keyword or `;`. */
  imports: string[]
  /** The code with the folded region (and the blank lines after it) removed. */
  body: string
  /**
   * The code above a `// Example` marker, when the fence has one: the whole
   * folded region, imports included, without the marker line.
   */
  prefix?: string
  /** `true` when `prefix` sits above a `// Solution` marker: compiled, never printed. */
  solution?: boolean
  /** Zero-based index of the first folded line, when something folds. */
  foldStartLine?: number
  /** Zero-based index of the first line kept after the folded region. */
  bodyStartLine?: number
}

/**
 * Split the folded region off a snippet: everything above a `// Example` or
 * `// Solution` marker when the snippet has one (the first of either kind
 * counts), otherwise its leading import block.
 *
 * Without a marker, a `package` line or `@file:` annotation before the
 * imports stays in the body. Blank lines are allowed between imports; the
 * blank lines that separate the last import from the code are removed along
 * with the block. With a marker, the prelude folds too.
 */
export function splitLeadingImports(code: string): SplitImports {
  const lines = code.split(/\r?\n/)
  return splitAtMarker(lines) ?? splitImportBlock(code, lines)
}

/**
 * The fence as the handout and `llms-full.txt` print it: a fence with a
 * `// Solution` marker loses the solution and the marker, keeping only the
 * solution's import lines above the code. Any other fence is returned as is,
 * `// Example` prefix included.
 */
export function withoutSolution(code: string): string {
  const split = splitAtMarker(code.split(/\r?\n/))
  if (!split?.solution)
    return code
  const imports = split.imports.map(target => `import ${target}`)
  return imports.length ? `${imports.join('\n')}\n\n${split.body}` : split.body
}

/** The marker split, or `undefined` when there is no marker or nothing above it. */
function splitAtMarker(lines: string[]): SplitImports | undefined {
  const marker = lines.findIndex(line => EXAMPLE_MARKER.test(line) || SOLUTION_MARKER.test(line))
  if (marker < 0)
    return undefined
  const solution = SOLUTION_MARKER.test(lines[marker])
  const above = lines.slice(0, marker)
  const first = above.findIndex(line => line.trim() !== '')
  // A marker with nothing above it is an ordinary comment.
  if (first < 0)
    return undefined
  let last = marker - 1
  while (last > first && above[last].trim() === '')
    last--
  let end = marker + 1
  while (end < lines.length && lines[end].trim() === '')
    end++
  const prefix = lines.slice(first, last + 1)
  const imports = prefix.flatMap((line) => {
    const match = line.match(IMPORT_LINE)
    return match ? [match[1]] : []
  })
  return {
    imports,
    body: lines.slice(end).join('\n'),
    prefix: prefix.join('\n'),
    ...(solution && { solution }),
    foldStartLine: 0,
    bodyStartLine: end,
  }
}

/** Split only the leading import block off a snippet, ignoring any `// Example` or `// Solution` marker. */
export function splitImportBlock(code: string, lines: string[] = code.split(/\r?\n/)): SplitImports {
  let start = 0
  while (start < lines.length && (lines[start].trim() === '' || PRELUDE_LINE.test(lines[start])))
    start++

  const imports: string[] = []
  let end = start
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim() === '')
      continue
    const match = lines[i].match(IMPORT_LINE)
    if (!match)
      break
    imports.push(match[1])
    end = i + 1
  }
  if (!imports.length)
    return { imports, body: code }

  while (end < lines.length && lines[end].trim() === '')
    end++
  // Only a real prelude is worth keeping; blank lines before the imports are
  // not.
  const prelude = lines.slice(0, start)
  const preludeStart = prelude.findIndex(line => line.trim() !== '')
  const kept = preludeStart < 0 ? [] : prelude.slice(preludeStart)
  return {
    imports,
    body: [...kept, ...lines.slice(end)].join('\n'),
    foldStartLine: start,
    bodyStartLine: end,
  }
}

/** Whether a fence should fold its imports, given its info line. */
export function shouldFoldImports(info: string): boolean {
  // The language ends where Slidev's does: at whitespace or a `{`/`[` group
  // (`kotlin{1,5-9}` is a Kotlin fence with a highlight range).
  const lang = info.trim().match(/^[\w'-]+/)?.[0] ?? ''
  return FOLDABLE_LANGS.has(lang) && !SHOW_IMPORTS.test(info)
}

/** Split the theme's flags off a fence info line: the flags found, and the line without them. */
export function takeThemeFlags(info: string): { info: string, flags: string[] } {
  const flags = [...info.matchAll(THEME_FLAGS)].map(match => match[0].trim())
  return { info: info.replace(THEME_FLAGS, ' ').replace(/\s{2,}/g, ' ').trim(), flags }
}

/** Remove the theme's flags (`show-imports`, `no-compile`) from a fence info line. */
export function stripThemeFlags(info: string): string {
  return takeThemeFlags(info).info
}

/** A source edit: replace `[start, end)` with `text` (empty text removes). */
export interface SourceEdit {
  start: number
  end: number
  text: string
}

interface Line {
  /** Offset of the line's first character. */
  start: number
  /** Offset just past the line's last character, before its terminator. */
  end: number
  /** Offset of the next line (past the terminator). */
  next: number
  text: string
}

function scanLines(source: string): Line[] {
  const lines: Line[] = []
  const parts = source.split(/(\r?\n)/)
  let offset = 0
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i]
    const terminator = parts[i + 1] ?? ''
    lines.push({ start: offset, end: offset + text.length, next: offset + text.length + terminator.length, text })
    offset += text.length + terminator.length
  }
  return lines
}

const BACKTICK_FENCE = /^ {0,3}(`{3,})\s*([^\r\n`]*)$/
const TILDE_FENCE = /^ {0,3}(~{3,})(.*)$/
const MAGIC_MOVE_BLOCK = /^(?:md|markdown)\s+magic-move(?:\s|$)/

/** Index of the line closing the fence opened at `open`, or -1. */
function findFenceClose(lines: Line[], open: number, marker: string): number {
  for (let i = open + 1; i < lines.length; i++) {
    const text = lines[i].text
    if (!/^ {4}/.test(text) && text.trimStart().startsWith(marker))
      return i
  }
  return -1
}

/**
 * Edits for one fence: drop the theme's flags and, with `fold`, strip its
 * folded region. Returns whether anything folded.
 */
function foldFence(lines: Line[], open: number, close: number, info: string, edits: SourceEdit[], fold: boolean): boolean {
  const stripped = stripThemeFlags(info)
  if (stripped !== info) {
    // The flags are the theme's, not Slidev's: take them out of the info line.
    const line = lines[open]
    const infoStart = line.start + line.text.indexOf(info)
    edits.push({ start: infoStart, end: infoStart + info.length, text: stripped })
  }
  if (!fold || !shouldFoldImports(info) || close <= open + 1)
    return false

  const body = lines.slice(open + 1, close)
  const split = splitLeadingImports(body.map(line => line.text).join('\n'))
  if (split.foldStartLine === undefined)
    return false

  const removeFrom = body[split.foldStartLine].start
  const removeTo = split.bodyStartLine! < body.length ? body[split.bodyStartLine!].start : lines[close].start
  edits.push({ start: removeFrom, end: removeTo, text: '' })
  return true
}

export interface FoldOptions {
  /**
   * Fold the imports (or the `// Example` / `// Solution` prefix) of each fence. `false`
   * (`themeConfig.foldImports: false`) leaves the code as written; the
   * theme's flags still leave the info line, since Slidev must never see them.
   */
  fold?: boolean
}

/**
 * Compute the edits that strip the theme's flags from, and fold the imports
 * (or the `// Example` / `// Solution` prefix) of, every code fence in a slide's Markdown:
 * top-level three-backtick fences and the steps of a classic
 * ````md magic-move```` block. Fences nested in any other four-plus-backtick
 * or tilde block are left alone.
 *
 * Edits never overlap and are returned in source order, so they can be
 * applied to a MagicString alongside the theme's other slide edits.
 */
export function foldImportEdits(source: string, options: FoldOptions = {}): SourceEdit[] {
  const fold = options.fold !== false
  const lines = scanLines(source)
  const edits: SourceEdit[] = []
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text
    const open = text.match(BACKTICK_FENCE) ?? text.match(TILDE_FENCE)
    if (!open)
      continue
    const marker = open[1]
    const info = open[2].trim()
    const close = findFenceClose(lines, i, marker)
    if (close < 0)
      break

    if (marker === '```' && info) {
      foldFence(lines, i, close, info, edits, fold)
    }
    else if (marker.startsWith('````') && MAGIC_MOVE_BLOCK.test(info)) {
      for (let j = i + 1; j < close; j++) {
        const inner = lines[j].text.match(BACKTICK_FENCE)
        if (!inner || inner[1] !== '```' || !inner[2].trim())
          continue
        const innerClose = findFenceClose(lines, j, '```')
        if (innerClose < 0 || innerClose >= close)
          break
        foldFence(lines, j, innerClose, inner[2].trim(), edits, fold)
        j = innerClose
      }
    }
    i = close
  }
  return edits.sort((a, b) => a.start - b.start || a.end - b.end)
}

/** Apply edits (from `foldImportEdits`) to a plain string. */
export function applyEdits(source: string, edits: SourceEdit[]): string {
  let result = ''
  let cursor = 0
  for (const edit of edits) {
    result += source.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return result + source.slice(cursor)
}
