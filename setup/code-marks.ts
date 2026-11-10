/**
 * Code marks: IDE decorations written inside the fence.
 *
 * A trailing `// [!kind …]` comment asks for one of the theme's IDE
 * components on that line, without wrapping the fence by hand:
 *
 * ```kotlin
 * fun Application.users() = routing { // [!this Routing]
 *   when (val result = insertUser(body)) {
 *     is Success -> respond(result.user) // [!smartcast result]
 *     AlreadyExists -> fail(UserAlreadyExists)
 *   }
 * }
 * ```
 *
 * The comment leaves the code before Shiki, the handout, or the Kotlin
 * compiler see it, and the markdown transformer (`transformers.ts`) wraps
 * the fence in the components the marks ask for, with `:line` (and
 * `:occurrence`) computed from where the comment sits. A mark therefore
 * moves with its line through a Magic Move chain, and the author never
 * counts lines, escapes quotes, or closes tags in reverse order. A comment
 * line holding nothing but marks applies to the next code line and leaves
 * the slide entirely, for a diagnostic too long to sit after the code.
 *
 * Kinds, with the component each one becomes:
 *
 * - `[!smartcast TEXT]`: `SmartCast` on every occurrence of `TEXT` on the line.
 * - `[!warning TEXT MESSAGE]`: `Warning` on the first occurrence, with the message.
 * - `[!error TEXT MESSAGE]`: `InlineCompilerError`; the fence stays out of the
 *   generated Kotlin sources, like a fence the component wraps by hand.
 * - `[!this TYPE]` / `[!context TYPE]`: `TypeHint` after the line's last `{`.
 * - `[!type NAME TYPE]`: `TypeHint` with the inferred type after `NAME`.
 * - `[!value TEXT VALUE]`: `InlineValue` after the line.
 * - `[!suspend]`: a line of `SuspendGutter`, collected over the fence.
 *
 * `key=value` options right after the kind pass through as attributes
 * (`[!smartcast on=1 result]`, `[!this occurrence=1 Routing]`,
 * `[!error text=body Missing validation]`). The first argument is a bare
 * word, or quoted with `"…"` or `` `…` `` when it holds spaces; the last
 * argument runs to the end of the mark, so a message needs no quotes. Several
 * marks share one comment: `// [!this Routing] [!suspend]`.
 */
import type { Line, SourceEdit } from './code-imports'
import { scanLines, shouldFoldImports, splitLeadingImports } from './code-imports'

export interface CodeMark {
  /** The kind as written, lower-cased, without hyphens. */
  kind: string
  /** One-based line in the displayed code. */
  line: number
  /** Positional arguments, as written. */
  args: string[]
  /** `key=value` options, as written. */
  options: Record<string, string>
  /** The code on the mark's line, without the comment. */
  code: string
}

interface MarkKind {
  component: string
  /** Prop names the positional arguments fill, in order. The last one absorbs the rest of the mark. */
  slots: string[]
  /** `text` when the kind marks a token the author does not name. */
  text?: string
  /** Which occurrences of `text` on the line get a component when no `occurrence` option is given. */
  occurrence: 'first' | 'all' | 'last'
  /** Collect every marked line into one component with a `:lines` array instead. */
  lines?: boolean
}

export const CODE_MARK_KINDS: Record<string, MarkKind> = {
  smartcast: { component: 'SmartCast', slots: ['text', 'message'], occurrence: 'all' },
  warning: { component: 'Warning', slots: ['text', 'message'], occurrence: 'first' },
  error: { component: 'InlineCompilerError', slots: ['text', 'message'], occurrence: 'first' },
  this: { component: 'TypeHint', slots: ['receiver'], text: '{', occurrence: 'last' },
  context: { component: 'TypeHint', slots: ['context'], text: '{', occurrence: 'last' },
  type: { component: 'TypeHint', slots: ['text', 'type'], occurrence: 'first' },
  value: { component: 'InlineValue', slots: ['text', 'value'], occurrence: 'first' },
  suspend: { component: 'SuspendGutter', slots: [], occurrence: 'first', lines: true },
}

/** The kind a mark names, with `smart-cast`, `SmartCast` and `smartcast` all the same. */
export function normalizeMarkKind(kind: string): string {
  return kind.toLowerCase().replace(/-/g, '')
}

/** Whether a fence carrying these marks is shown broken on purpose. */
export function hasCompilerErrorMark(marks: CodeMark[]): boolean {
  return marks.some(mark => mark.kind === 'error')
}

// ---------------------------------------------------------------------------
// Parsing one comment

interface RawMark {
  kind: string
  args: string[]
  options: Record<string, string>
}

const QUOTES = new Set(['"', '`'])
const OPTION = /^([A-Za-z][\w-]*)=(.*)$/s

/** Index just past the quote that closes the one at `start`, or -1. `"` may be escaped with a backslash. */
function skipQuoted(text: string, start: number): number {
  const quote = text[start]
  for (let i = start + 1; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') {
      i++
      continue
    }
    if (text[i] === quote)
      return i + 1
  }
  return -1
}

function unescape(quoted: string): string {
  const quote = quoted[0]
  const inner = quoted.slice(1, -1)
  return quote === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner
}

/**
 * Index of the `]` closing the mark whose body starts at `start`: brackets
 * balance, and quoted text is skipped, so `` `[]` `` and `List<[A]>` are
 * arguments rather than the end of the mark. -1 when it never closes.
 */
function findMarkEnd(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (QUOTES.has(c)) {
      const end = skipQuoted(text, i)
      if (end < 0)
        return -1
      i = end - 1
      continue
    }
    if (c === '[') {
      depth++
    }
    else if (c === ']') {
      if (depth === 0)
        return i
      depth--
    }
  }
  return -1
}

/** One whitespace-delimited argument starting at `start` (no leading whitespace), quoted or bare with balanced brackets. */
function readArgument(text: string, start: number, end: number): { value: string, next: number } {
  if (QUOTES.has(text[start])) {
    const close = skipQuoted(text, start)
    if (close > 0 && close <= end)
      return { value: unescape(text.slice(start, close)), next: close }
  }
  let depth = 0
  let i = start
  for (; i < end; i++) {
    const c = text[i]
    if (/\s/.test(c) && depth === 0)
      break
    if (c === '[')
      depth++
    else if (c === ']')
      depth--
  }
  return { value: text.slice(start, i), next: i }
}

function skipSpaces(text: string, i: number): number {
  while (i < text.length && /[ \t]/.test(text[i]))
    i++
  return i
}

/**
 * Parse the marks of a comment body (`[!kind …] [!kind …]`), or `undefined`
 * when the body is not made of marks only — then it is an ordinary comment
 * and stays in the code.
 */
export function parseMarkComment(body: string): RawMark[] | undefined {
  const marks: RawMark[] = []
  let i = skipSpaces(body, 0)
  while (i < body.length) {
    if (!body.startsWith('[!', i))
      return undefined
    const open = i
    i += 2
    const kind = /^[A-Za-z][\w-]*/.exec(body.slice(i))?.[0]
    if (!kind)
      return undefined
    i += kind.length
    const end = findMarkEnd(body, open + 2)
    if (end < 0 || (i < end && !/[\s\]]/.test(body[i])))
      return undefined
    const spec = CODE_MARK_KINDS[normalizeMarkKind(kind)]

    const options: Record<string, string> = {}
    const args: string[] = []
    i = skipSpaces(body, i)
    // Options come first; the first word that is not `key=value` starts the arguments.
    while (i < end) {
      const bare = /^[A-Za-z][\w-]*=/.exec(body.slice(i, end))
      if (!bare)
        break
      const valueStart = i + bare[0].length
      const { value, next } = valueStart < end
        ? readArgument(body, valueStart, end)
        : { value: '', next: valueStart }
      options[bare[0].slice(0, -1)] = value
      i = skipSpaces(body, next)
    }
    const slots = spec?.slots.length ?? 2
    for (let slot = 0; slot < slots && i < end; slot++) {
      if (slot === slots - 1) {
        // The last argument runs to the end of the mark; one quoted value
        // loses its quotes, anything else is taken as written.
        const rest = body.slice(i, end).trim()
        if (rest) {
          const quoted = QUOTES.has(rest[0]) && skipQuoted(rest, 0) === rest.length
          args.push(quoted ? unescape(rest) : rest)
        }
        i = end
        break
      }
      const { value, next } = readArgument(body, i, end)
      args.push(value)
      i = skipSpaces(body, next)
    }
    if (body.slice(i, end).trim())
      return undefined
    marks.push({ kind, args, options })
    i = skipSpaces(body, end + 1)
  }
  return marks
}

// ---------------------------------------------------------------------------
// Scanning a fence

export interface MarkLine {
  /** Zero-based index of the line in the scanned code. */
  index: number
  /** Column where the comment starts, including the whitespace before it. */
  from: number
  /** The whole line is marks: it leaves the code. */
  removeLine: boolean
}

export interface ScannedMarks {
  marks: CodeMark[]
  /** Lines to strip, in order. */
  lines: MarkLine[]
  /** Marks that could not be placed, for the author. */
  problems: string[]
}

const COMMENT_CANDIDATE = /\/\/[ \t]*(?=\[!)/g
const MARK_KIND = /^\[!([A-Za-z][\w-]*)/

/** Whether a comment body opens with a kind the theme knows, so a parse failure is worth a warning. */
function looksLikeMark(body: string): boolean {
  const kind = MARK_KIND.exec(body)?.[1]
  return kind !== undefined && normalizeMarkKind(kind) in CODE_MARK_KINDS
}

/**
 * Find the marks in the lines of a fence. A line that is nothing but a mark
 * comment leaves the code and marks the next code line; line numbers count
 * the lines that stay.
 */
export function scanCodeMarks(lines: string[]): ScannedMarks {
  const marks: CodeMark[] = []
  const stripped: MarkLine[] = []
  const problems: string[] = []
  let pending: RawMark[] = []
  let displayed = 0
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]
    let found: { code: string, from: number, marks: RawMark[] } | undefined
    for (const candidate of text.matchAll(COMMENT_CANDIDATE)) {
      const body = text.slice(candidate.index + candidate[0].length)
      const parsed = parseMarkComment(body)
      if (!parsed) {
        if (looksLikeMark(body))
          problems.push(`Line ${index + 1}: \`${body.trim()}\` looks like a code mark but does not parse: quotes and brackets must balance, and nothing may follow the last \`]\`. The comment stays in the code.`)
        continue
      }
      // A kind the theme does not know stays in the code: Shiki's own
      // `[!code …]` notation silently, anything else with a warning.
      const unknown = parsed.filter(mark => !(normalizeMarkKind(mark.kind) in CODE_MARK_KINDS))
      if (unknown.length) {
        const foreign = unknown.find(mark => normalizeMarkKind(mark.kind) !== 'code')
        if (foreign)
          problems.push(`[!${foreign.kind}] on line ${index + 1} is not a code mark kind (${Object.keys(CODE_MARK_KINDS).join(', ')}). The comment stays in the code.`)
        continue
      }
      const code = text.slice(0, candidate.index).trimEnd()
      found = { code, from: code.length, marks: parsed }
      break
    }
    if (found && found.code.trim() === '') {
      stripped.push({ index, from: 0, removeLine: true })
      pending.push(...found.marks)
      continue
    }
    displayed++
    const code = found ? found.code : text
    if (found)
      stripped.push({ index, from: found.from, removeLine: false })
    const own = [...pending, ...(found?.marks ?? [])]
    pending = []
    for (const raw of own)
      marks.push({ kind: normalizeMarkKind(raw.kind), line: displayed, args: raw.args, options: raw.options, code })
  }
  for (const raw of pending)
    problems.push(`[!${raw.kind}] on the last line marks nothing: a mark-only comment belongs above the line it marks.`)
  return { marks, lines: stripped, problems }
}

/** The code without its mark comments, and the marks found, with lines counted in the result. */
export function parseCodeMarks(code: string): { code: string, marks: CodeMark[], problems: string[] } {
  const lines = code.split(/\r?\n/)
  const scanned = scanCodeMarks(lines)
  if (!scanned.lines.length)
    return { code, marks: [], problems: scanned.problems }
  const kept: string[] = []
  const byIndex = new Map(scanned.lines.map(line => [line.index, line]))
  lines.forEach((text, index) => {
    const line = byIndex.get(index)
    if (!line)
      kept.push(text)
    else if (!line.removeLine)
      kept.push(text.slice(0, line.from))
  })
  return { code: kept.join('\n'), marks: scanned.marks, problems: scanned.problems }
}

// ---------------------------------------------------------------------------
// Rendering the components

function attributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Non-overlapping occurrences of `needle` in `text`, as the components count them. */
export function countOccurrences(text: string, needle: string): number {
  if (!needle)
    return 0
  let count = 0
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length))
    count++
  return count
}

export interface CodeMarkTags {
  /** Opening tags, outermost first, each on its own line. */
  open: string[]
  /** Closing tags, in the order they must follow the fence. */
  close: string[]
  problems: string[]
}

/** The wrapper components for the marks of one fence. */
export function renderCodeMarkTags(marks: CodeMark[]): CodeMarkTags {
  const open: string[] = []
  const problems: string[] = []
  const lineLists = new Map<string, number[]>()
  for (const mark of marks) {
    const spec = CODE_MARK_KINDS[mark.kind]
    if (!spec) {
      problems.push(`[!${mark.kind}] on line ${mark.line} is not a code mark kind (${Object.keys(CODE_MARK_KINDS).join(', ')}).`)
      continue
    }
    if (spec.lines) {
      const lines = lineLists.get(spec.component) ?? []
      lines.push(mark.line)
      lineLists.set(spec.component, lines)
      continue
    }
    const attrs: Record<string, string> = {}
    spec.slots.forEach((slot, index) => {
      if (mark.args[index] !== undefined)
        attrs[slot] = mark.args[index]
    })
    Object.assign(attrs, mark.options)
    const text = attrs.text ?? spec.text
    if (text !== undefined)
      attrs.text = text
    if (spec.slots[0] === 'text' && text === undefined) {
      problems.push(`[!${mark.kind}] on line ${mark.line} needs the text to mark.`)
      continue
    }
    let occurrences: (number | undefined)[] = [undefined]
    if ('occurrence' in attrs) {
      const wanted = Number(attrs.occurrence)
      if (!Number.isInteger(wanted) || wanted < 1) {
        problems.push(`[!${mark.kind}] on line ${mark.line}: occurrence=${attrs.occurrence} must be a positive whole number.`)
        continue
      }
      delete attrs.occurrence
      occurrences = [wanted]
    }
    else if (text !== undefined) {
      const count = countOccurrences(mark.code, text)
      if (!count) {
        problems.push(`[!${mark.kind}] on line ${mark.line}: "${text}" does not occur in \`${mark.code.trim()}\`.`)
        continue
      }
      occurrences = spec.occurrence === 'all'
        ? Array.from({ length: count }, (_, i) => i + 1)
        : [spec.occurrence === 'last' ? count : 1]
    }
    for (const occurrence of occurrences) {
      const parts = [`<${spec.component}`]
      // `text` first, then where it is, then what to say about it.
      if (attrs.text !== undefined)
        parts.push(`text="${attributeValue(attrs.text)}"`)
      parts.push(`:line="${mark.line}"`)
      if (occurrence !== undefined && occurrence !== 1)
        parts.push(`:occurrence="${occurrence}"`)
      for (const [key, value] of Object.entries(attrs)) {
        if (key !== 'text')
          parts.push(`${key}="${attributeValue(value)}"`)
      }
      open.push(`${parts.join(' ')}>`)
    }
  }
  for (const [component, lines] of lineLists)
    open.push(`<${component} :lines="[${[...new Set(lines)].sort((a, b) => a - b).join(', ')}]">`)
  const close = open.map(tag => `</${/^<(\w+)/.exec(tag)![1]}>`).reverse()
  return { open, close, problems }
}

// ---------------------------------------------------------------------------
// Slide edits

export interface CodeMarkInsertion {
  at: number
  text: string
  /** `left` goes before anything else inserted at `at`, `right` after. */
  side: 'left' | 'right'
}

export interface CodeMarkEdits {
  /** Comment removals, disjoint and in source order. */
  removals: SourceEdit[]
  insertions: CodeMarkInsertion[]
  problems: string[]
}

const BACKTICK_FENCE = /^ {0,3}(`{3,})\s*([^\r\n`]*)$/
const TILDE_FENCE = /^ {0,3}(~{3,})(.*)$/

/** Fences that are output or the other side of the code above them, never code of their own. */
const ATTACHED_LANGS = new Set(['console', 'sql'])

/**
 * The last line of the fences attached directly under the one closing at
 * `close`: a `console` or `sql` fence that starts on the very next line is
 * output or the other side of the same code, rendered as one window, so the
 * wrapper a mark asks for encloses them together, as a hand-written one does.
 * Any other fence is code of its own and gets its own wrappers.
 */
function attachedFencesEnd(lines: Line[], close: number): number {
  let end = close
  while (end + 1 < lines.length) {
    const open = lines[end + 1].text.match(BACKTICK_FENCE) ?? lines[end + 1].text.match(TILDE_FENCE)
    if (!open || !ATTACHED_LANGS.has(open[2].trim().match(/^[\w'-]+/)?.[0] ?? ''))
      break
    const marker = open[1]
    let next = -1
    for (let j = end + 2; j < lines.length; j++) {
      if (!/^ {4}/.test(lines[j].text) && lines[j].text.trimStart().startsWith(marker)) {
        next = j
        break
      }
    }
    if (next < 0)
      break
    end = next
  }
  return end
}

/**
 * The edits that take the mark comments out of every top-level fence of a
 * slide and wrap the fence in the components they ask for. Lines a fence
 * folds (its imports or its `// Example` prefix, see `code-imports.ts`) are
 * not displayed, so marks on them are left to the fold. Fences inside
 * classic ````md magic-move```` blocks are not wrapped: one component
 * cannot wrap a single step.
 */
export function codeMarkEdits(source: string, options: { fold?: boolean } = {}): CodeMarkEdits {
  const fold = options.fold !== false
  const lines = scanLines(source)
  const edits: CodeMarkEdits = { removals: [], insertions: [], problems: [] }
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text
    const open = text.match(BACKTICK_FENCE) ?? text.match(TILDE_FENCE)
    if (!open)
      continue
    const marker = open[1]
    const info = open[2].trim()
    let close = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (!/^ {4}/.test(lines[j].text) && lines[j].text.trimStart().startsWith(marker)) {
        close = j
        break
      }
    }
    if (close < 0)
      break
    if (marker.length > 3 && /(?:^|\s)magic-move(?:\s|$)/.test(info)) {
      // The steps of a classic block cannot be wrapped one by one; a mark in
      // there would stay on the slide while the handout and the snippet CLI
      // strip it, so say so instead of leaving the author to notice.
      for (let j = i + 1; j < close; j++) {
        const step = lines[j].text
        const marked = [...step.matchAll(COMMENT_CANDIDATE)].some((candidate) => {
          const parsed = parseMarkComment(step.slice(candidate.index + candidate[0].length))
          return parsed?.some(mark => normalizeMarkKind(mark.kind) in CODE_MARK_KINDS) ?? false
        })
        if (marked) {
          edits.problems.push(`Line ${j + 1}: code marks inside a classic magic-move block are not supported; wrap the block in the component instead.`)
          break
        }
      }
    }
    if (marker === '```' && info) {
      const body = lines.slice(i + 1, close)
      const bodyText = body.map(line => line.text).join('\n')
      const split = fold && shouldFoldImports(info) ? splitLeadingImports(bodyText) : undefined
      // What the fold keeps always ends with the tail of the fence; the kept
      // prelude before it (a `package` line) carries no marks.
      const tailStart = split?.bodyStartLine ?? 0
      const displayedBefore = split?.foldStartLine === undefined ? 0 : split.body.split('\n').length - (body.length - tailStart)
      const scanned = scanCodeMarks(body.slice(tailStart).map(line => line.text))
      edits.problems.push(...scanned.problems)
      for (const line of scanned.lines) {
        const source = body[tailStart + line.index]
        edits.removals.push(line.removeLine
          ? { start: source.start, end: source.next, text: '' }
          : { start: source.start + line.from, end: source.end, text: '' })
      }
      if (scanned.marks.length) {
        const marks = scanned.marks.map(mark => ({ ...mark, line: mark.line + displayedBefore }))
        const tags = renderCodeMarkTags(marks)
        edits.problems.push(...tags.problems)
        if (tags.open.length) {
          edits.insertions.push({ at: lines[i].start, text: `\n${tags.open.join('\n')}\n\n`, side: 'left' })
          edits.insertions.push({ at: lines[attachedFencesEnd(lines, close)].end, text: `\n\n${tags.close.join('\n')}\n`, side: 'right' })
        }
      }
    }
    i = close
  }
  return edits
}
