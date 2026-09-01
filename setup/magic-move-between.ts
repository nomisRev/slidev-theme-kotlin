/**
 * Shared logic for cross-slide Magic Move.
 *
 * Consecutive slides are linked into a "chain" by putting `magic-move` in the
 * separator between them:
 *
 * ```md
 * ---
 * magic-move
 * ---
 * ```
 *
 * The preparser rewrites that bare marker into `magicMove: true` so the YAML
 * frontmatter stays an object, and the codeblock transformer in
 * `transformers.ts` replaces every top-level code fence of a chained slide
 * with a `<MagicMoveBetween>` component that animates between the fences at
 * the same position on the neighbouring slides.
 */

export interface ParsedFence {
  /** The Shiki language, i.e. the first word of the fence info. */
  lang: string
  /** Everything after the language, with the `magic-move` flag, `[title]`, and brace groups removed. */
  meta: string
  /** The full fence info line as written (trimmed). */
  info: string
  /** `[title]` extracted from the meta, if any. */
  title?: string
  /** Explicit `lines: true/false` option from the meta, if any. */
  lines?: boolean
  /** Click-based highlight ranges from a `{1|2-3}` group, one entry per click state. */
  ranges: string[]
  /** A `{...}` options object literal from the meta (e.g. `{lines:true, at:2}`), if any. */
  optionsRaw?: string
  /** The fenced code with the trailing newline removed. */
  code: string
}

const SEPARATOR = /^---+$/
const FENCE_OPEN = /^ {0,3}(`{3,})\s*([^\r\n`]*)$/
// Added only by setup/transformers.ts between its markdown and codeblock
// passes. Keep it out of ParsedFence so it cannot affect titles, options,
// icon lookup, or Shiki inputs.
const FENCE_ORDINAL_MARKER = /(?:^|\s)__slidev_magic_move_ordinal__=\d+(?=\s|$)/g

function findBalancedBraceGroup(input: string): { start: number, end: number } | undefined {
  const start = input.indexOf('{')
  if (start < 0)
    return undefined

  let depth = 0
  let quote: string | undefined
  let escaped = false
  for (let index = start; index < input.length; index++) {
    const char = input[index]
    if (quote) {
      if (escaped)
        escaped = false
      else if (char === '\\')
        escaped = true
      else if (char === quote)
        quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{')
      depth++
    else if (char === '}' && --depth === 0)
      return { start, end: index + 1 }
  }
}

/** Whether a slide's frontmatter marks it as magic-moved from its predecessor. */
export function isLinkedToPrevious(frontmatter: unknown): boolean {
  if (!frontmatter || typeof frontmatter !== 'object')
    return false
  const fm = frontmatter as Record<string, unknown>
  return Boolean(fm.magicMove ?? fm['magic-move'])
}

/**
 * Rewrite bare `magic-move` slide separators into `magicMove: true` in place,
 * so the frontmatter parses as a YAML object. Keeps the line count intact to
 * preserve source locations.
 */
export function normalizeMagicMoveSeparators(lines: string[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    if (line.trimStart().startsWith('```')) {
      // Skip fenced code, mirroring @slidev/parser's slicing logic.
      const level = line.match(/^\s*`{3,}/)![0].trimStart()
      let j = i + 1
      for (; j < lines.length; j++) {
        if (lines[j].startsWith(level))
          break
      }
      if (j !== lines.length)
        i = j
      continue
    }
    if (
      SEPARATOR.test(line)
      && lines[i + 1]?.trim() === 'magic-move'
      && SEPARATOR.test(lines[i + 2]?.trimEnd() ?? '')
    ) {
      lines[i + 1] = 'magicMove: true'
      i += 2
    }
  }
}

/**
 * The index range of the magic-move chain containing `index`, or `undefined`
 * when the slide is not part of one. `slides` only needs `frontmatter`.
 */
export function resolveChain(
  slides: { frontmatter: Record<string, unknown> }[],
  index: number,
): { start: number, end: number } | undefined {
  const linked = (i: number) => i > 0 && i < slides.length && isLinkedToPrevious(slides[i]?.frontmatter)
  if (!linked(index) && !linked(index + 1))
    return undefined
  let start = index
  while (linked(start))
    start--
  let end = index
  while (linked(end + 1))
    end++
  return { start, end }
}

/** Parse the info line of a fence (```kotlin foo [Main.kt] {1|2-3} {lines:true}). */
export function parseFenceInfo(rawInfo: string, code: string): ParsedFence {
  const info = rawInfo.replace(FENCE_ORDINAL_MARKER, ' ').trim()
  const spaceIndex = info.search(/\s/)
  const lang = spaceIndex < 0 ? info : info.slice(0, spaceIndex)
  let rest = spaceIndex < 0 ? '' : info.slice(spaceIndex + 1)

  let title: string | undefined
  const titleMatch = rest.match(/\[([^\]]*)\]/)
  if (titleMatch) {
    title = titleMatch[1].trim() || undefined
    rest = rest.slice(0, titleMatch.index) + rest.slice(titleMatch.index! + titleMatch[0].length)
  }

  // Highlight ranges use Slidev's charset (`{1|2-3}`, `{all}`), which never
  // contains a colon — that distinguishes them from an options object.
  let ranges: string[] = []
  const rangesMatch = rest.match(/\{([\w*,|-]+)\}/)
  if (rangesMatch) {
    ranges = rangesMatch[1].split('|').map(r => r.trim()).filter(Boolean)
    rest = rest.slice(0, rangesMatch.index) + rest.slice(rangesMatch.index! + rangesMatch[0].length)
  }

  let optionsRaw: string | undefined
  const optionsGroup = findBalancedBraceGroup(rest)
  if (optionsGroup) {
    optionsRaw = rest.slice(optionsGroup.start, optionsGroup.end)
    rest = rest.slice(0, optionsGroup.start) + rest.slice(optionsGroup.end)
  }

  const meta = rest.split(/\s+/).filter(word => word && word !== 'magic-move').join(' ')
  const lines = /\blines: *true\b/.test(optionsRaw ?? '')
    ? true
    : /\blines: *false\b/.test(optionsRaw ?? '') ? false : undefined
  return { lang, meta, info, title, lines, ranges, optionsRaw, code: code.replace(/\r?\n$/, '') }
}

/**
 * Every top-level three-backtick fence of a slide, in order. Fences opened
 * with four or more backticks (e.g. classic `md magic-move` blocks) are
 * skipped along with their contents.
 */
export function extractTopLevelFences(content: string): ParsedFence[] {
  const lines = content.split(/\r?\n/)
  const fences: ParsedFence[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    const open = line.match(FENCE_OPEN)
    if (!open)
      continue
    const backticks = open[1]
    let j = i + 1
    for (; j < lines.length; j++) {
      if (!/^ {4}/.test(lines[j]) && lines[j].trimStart().startsWith(backticks))
        break
    }
    if (j === lines.length) {
      // Unclosed fence: nothing more to extract.
      break
    }
    if (backticks.length === 3 && open[2]?.trim())
      fences.push(parseFenceInfo(open[2], lines.slice(i + 1, j).join('\n')))
    i = j
  }
  return fences
}
