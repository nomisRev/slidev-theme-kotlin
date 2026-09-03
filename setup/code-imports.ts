/**
 * Folded imports.
 *
 * A snippet reads best on a slide without its import lines, but a snippet
 * that carries them is complete: it compiles as written, a snippet checker
 * such as Knit can verify it, and a reader of the deck's handout (or a coding
 * agent reading `llms-full.txt`) learns which package every symbol comes
 * from. This module lets a fence keep its imports in the Markdown source
 * while the rendered slide hides them behind a small toggle.
 *
 * The markdown transformer in `transformers.ts` applies `foldImportEdits` to
 * each slide before Slidev parses it: the import lines leave the fence, and a
 * `<CodeImports>` component carrying them is inserted right before it. The
 * component keeps the imports in the DOM, collapsed, so nothing about the
 * code window changes: line numbers, `{1|2-3}` highlight ranges, and
 * annotation targets all count from the first line of real code.
 *
 * Add `show-imports` to the fence info to keep the imports visible on a slide
 * that is about them, or set `themeConfig.foldImports: false` to turn the
 * feature off for a whole deck.
 */

/** Languages whose leading `import` statements are folded. */
export const FOLDABLE_LANGS = new Set(['kotlin', 'kt', 'kts', 'java', 'scala'])

/** Fence info flag that keeps the imports of one fence visible. */
export const SHOW_IMPORTS_FLAG = 'show-imports'

const IMPORT_LINE = /^import[ \t]+(\S.*?)[ \t]*;?[ \t]*$/
const PRELUDE_LINE = /^(?:package[ \t]+\S|@file:)/
const SHOW_IMPORTS = /(?:^|\s)show-imports(?=\s|$)/

export interface SplitImports {
  /** Import targets in source order, without the `import` keyword or `;`. */
  imports: string[]
  /** The code with the import block (and the blank lines after it) removed. */
  body: string
  /** Zero-based index of the first import line, when there are imports. */
  importStartLine?: number
  /** Zero-based index of the first line kept after the import block. */
  bodyStartLine?: number
}

/**
 * Split a leading import block off a snippet. A `package` line or `@file:`
 * annotation before the imports stays in the body. Blank lines are allowed
 * between imports; the blank lines that separate the last import from the
 * code are removed along with the block.
 */
export function splitLeadingImports(code: string): SplitImports {
  const lines = code.split(/\r?\n/)
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
    importStartLine: start,
    bodyStartLine: end,
  }
}

/** Whether a fence should fold its imports, given its info line. */
export function shouldFoldImports(info: string): boolean {
  const lang = info.trim().split(/\s/, 1)[0]
  return FOLDABLE_LANGS.has(lang) && !SHOW_IMPORTS.test(info)
}

/** Remove the `show-imports` flag from a fence info line. */
export function stripShowImportsFlag(info: string): string {
  return info.replace(SHOW_IMPORTS, ' ').replace(/\s{2,}/g, ' ').trim()
}

/**
 * Escape a value for a single-quoted HTML attribute. Vue's template compiler
 * decodes entities in attribute values, so the JSON survives intact.
 */
function attributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/'/g, '&#39;')
}

/** The component markup that carries a fence's folded imports. */
export function codeImportsMarkup(imports: string[]): string {
  return `<CodeImports :imports='${attributeValue(JSON.stringify(imports))}' />`
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
 * Edits for one fence: strip its import lines, drop a `show-imports` flag,
 * and report the imports so the caller can place a `<CodeImports>`.
 */
function foldFence(lines: Line[], open: number, close: number, info: string, edits: SourceEdit[]): string[] {
  const flagged = SHOW_IMPORTS.test(info)
  if (flagged) {
    // The flag is the theme's, not Slidev's: take it out of the info line.
    const line = lines[open]
    const infoStart = line.start + line.text.indexOf(info)
    edits.push({ start: infoStart, end: infoStart + info.length, text: stripShowImportsFlag(info) })
  }
  if (!shouldFoldImports(info) || close <= open + 1)
    return []

  const body = lines.slice(open + 1, close)
  const split = splitLeadingImports(body.map(line => line.text).join('\n'))
  if (!split.imports.length)
    return []

  const removeFrom = body[split.importStartLine!].start
  const removeTo = split.bodyStartLine! < body.length ? body[split.bodyStartLine!].start : lines[close].start
  edits.push({ start: removeFrom, end: removeTo, text: '' })
  return split.imports
}

/**
 * Compute the edits that fold the imports of every code fence in a slide's
 * Markdown. Top-level three-backtick fences each get their own
 * `<CodeImports>`; the steps of a classic ````md magic-move```` block share
 * one, placed before the block, listing the union of their imports. Fences
 * nested in any other four-plus-backtick or tilde block are left alone.
 *
 * Edits never overlap and are returned in source order, so they can be
 * applied to a MagicString alongside the theme's other slide edits.
 */
export function foldImportEdits(source: string): SourceEdit[] {
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
      const imports = foldFence(lines, i, close, info, edits)
      if (imports.length)
        edits.push({ start: lines[i].start, end: lines[i].start, text: `\n${codeImportsMarkup(imports)}\n\n` })
    }
    else if (marker.startsWith('````') && MAGIC_MOVE_BLOCK.test(info)) {
      const imports = new Set<string>()
      for (let j = i + 1; j < close; j++) {
        const inner = lines[j].text.match(BACKTICK_FENCE)
        if (!inner || inner[1] !== '```' || !inner[2].trim())
          continue
        const innerClose = findFenceClose(lines, j, '```')
        if (innerClose < 0 || innerClose >= close)
          break
        for (const target of foldFence(lines, j, innerClose, inner[2].trim(), edits))
          imports.add(target)
        j = innerClose
      }
      if (imports.size)
        edits.push({ start: lines[i].start, end: lines[i].start, text: `\n${codeImportsMarkup([...imports])}\n\n` })
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
