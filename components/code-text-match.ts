/**
 * Exact-text matching across syntax-token spans, shared by `DrawnAnnotation`,
 * `InlineCompilerError` and the `code-highlight.ts` components (`SmartCast`,
 * `Warning`, `TypeHint`, `InlineValue`).
 *
 * Shiki renders one span per token, so a match regularly starts and ends in
 * different text nodes, and Magic Move renders line breaks as `<br>` elements
 * where a static block uses newline characters. Every component therefore
 * flattens what is on screen into a list of text segments — each real text
 * node keeps its node, a rendered line break becomes a synthetic `"\n"`
 * segment — and this module maps the string offsets of the requested
 * occurrence back onto DOM Range boundaries.
 *
 * Segments carry the one-based source line of the code block they render, so
 * a search can be narrowed to one line, or to the lines a multi-line needle
 * spans, without walking the DOM a second time.
 */

export interface TextSegment {
  /** The text node this segment renders; absent for a synthetic line break. */
  node?: Text
  text: string
  /** One-based source line inside its code block, when the segment comes from one. */
  line?: number
  /** Which code block the segment belongs to, when a search spans several. */
  block?: number
}

export interface TextRange {
  /** The rendered range, or null when there is nothing to select. */
  range: Range | null
  /** Parent elements of every text node the range covers, in document order. */
  elements: HTMLElement[]
}

export interface TextMatch extends TextRange {
  /** Total number of occurrences found, reported so a miss can be explained. */
  matches: number
  /** Source line the match starts on, when the segments carry line numbers. */
  line?: number
}

/** Tokens Magic Move is animating out; their text is on its way off the slide. */
const LEAVING_TOKENS = '.shiki-magic-move-leave, .shiki-magic-move-leave-to'

/** Number of source lines a needle spans: one more than its line breaks. */
export function lineCount(needle: string) {
  let count = 1
  for (let index = needle.indexOf('\n'); index >= 0; index = needle.indexOf('\n', index + 1))
    count++
  return count
}

/**
 * Flattens one code block into text segments, each stamped with its source
 * line. Magic Move renders tokens and `<br>` elements directly in its `<pre>`;
 * a static Shiki block renders `.line` spans inside `<code>`. Both shapes come
 * out as the same list, so one exact match works in either.
 */
export function codeTextSegments(code: HTMLElement, magicMove: boolean): TextSegment[] {
  const segments: TextSegment[] = []
  if (magicMove) {
    // One walk over the whole block: this runs on every step Magic Move
    // renders, and a walk per token span was measurable on large windows.
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE)
          return NodeFilter.FILTER_ACCEPT
        const element = node as HTMLElement
        // Outgoing tokens of the previous step linger (absolutely positioned)
        // during a transition; rejecting them prunes their text as well.
        if (element.className.includes('shiki-magic-move-leave'))
          return NodeFilter.FILTER_REJECT
        return element.tagName === 'BR' && element.parentElement === code ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      },
    })
    let line = 1
    let node: Node | null
    // eslint-disable-next-line no-cond-assign
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE)
        segments.push({ text: '\n', line: line++ })
      else
        segments.push({ node: node as Text, text: (node as Text).data, line })
    }
    return segments
  }

  const lines = code.querySelectorAll<HTMLElement>('.line')
  lines.forEach((lineElement, index) => {
    const line = index + 1
    const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest(LEAVING_TOKENS) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    })
    let node: Node | null
    // eslint-disable-next-line no-cond-assign
    while ((node = walker.nextNode()))
      segments.push({ node: node as Text, text: (node as Text).data, line })
    if (index < lines.length - 1)
      segments.push({ text: '\n', line })
  })
  return segments
}

/**
 * Narrows segments to the source lines `line` … `line + count - 1`. Segments
 * without a line number are outside any code block and never match a line
 * search. When several code blocks contribute segments, their line numbers
 * restart at one, so a separator that no code contains keeps a match from
 * straddling two blocks.
 */
export function segmentsOnLines(segments: TextSegment[], line: number, count = 1): TextSegment[] {
  const last = line + Math.max(1, count) - 1
  const scoped: TextSegment[] = []
  let block: number | undefined
  for (const segment of segments) {
    if (segment.line === undefined || segment.line < line || segment.line > last)
      continue
    if (scoped.length && segment.block !== block)
      scoped.push({ text: '\u0000' })
    block = segment.block
    scoped.push(segment)
  }
  return scoped
}

/** Maps string offsets over the joined segment text back onto a DOM Range. */
export function rangeFromSegments(segments: TextSegment[], start: number, end: number): TextRange {
  let offset = 0
  let startNode: Text | undefined
  let endNode: Text | undefined
  let startOffset = 0
  let endOffset = 0
  const elements: HTMLElement[] = []
  for (const segment of segments) {
    const next = offset + segment.text.length
    if (segment.node) {
      if (!startNode && start >= offset && start < next) {
        startNode = segment.node
        startOffset = start - offset
      }
      if (start < next && end > offset && segment.node.parentElement
        && !elements.includes(segment.node.parentElement))
        elements.push(segment.node.parentElement)
      if (startNode && end > offset && end <= next) {
        endNode = segment.node
        endOffset = end - offset
        break
      }
      // A range that ends on a synthetic line break cannot put its boundary in
      // that segment, so trail the last real text node it covered.
      if (startNode && end > next) {
        endNode = segment.node
        endOffset = segment.text.length
      }
    }
    offset = next
  }
  if (!startNode || !endNode)
    return { range: null, elements: [] }

  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return { range, elements }
}

/**
 * Finds the requested occurrence of `needle` in the flattened segments. With
 * `line`, only that source line is searched — or, for a needle that spans
 * several lines, the lines starting there — and occurrences are counted
 * inside that scope.
 */
export function findTextInSegments(segments: TextSegment[], needle: string, occurrence: number, line?: number): TextMatch {
  const scoped = line === undefined ? segments : segmentsOnLines(segments, line, lineCount(needle))
  const value = scoped.map(segment => segment.text).join('')
  const starts: number[] = []
  for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + 1))
    starts.push(index)

  const start = starts[Math.max(1, occurrence) - 1]
  if (start === undefined)
    return { range: null, elements: [], matches: starts.length }

  const { range, elements } = rangeFromSegments(scoped, start, start + needle.length)
  if (!range)
    return { range: null, elements: [], matches: starts.length }
  return { range, elements, matches: starts.length, line: startLine(scoped, start) }
}

/** The source line of the segment containing `offset` of the joined text. */
function startLine(segments: TextSegment[], offset: number): number | undefined {
  let position = 0
  for (const segment of segments) {
    const next = position + segment.text.length
    if (offset >= position && offset < next)
      return segment.line
    position = next
  }
  return undefined
}

/**
 * The code of one source line without its indentation and trailing
 * whitespace: what a line diagnostic underlines, and what a message on that
 * line sits after. Shiki commonly puts a line's indentation in the same token
 * as its first keyword, so this trims inside text nodes, not just around
 * whole tokens. An empty line has no range.
 */
export function trimmedLineRange(segments: TextSegment[], line: number): TextRange {
  const scoped = segmentsOnLines(segments, line)
  const value = scoped.map(segment => segment.text).join('')
  const start = value.length - value.trimStart().length
  const end = value.trimEnd().length
  if (start >= end)
    return { range: null, elements: [] }
  return rangeFromSegments(scoped, start, end)
}

export interface VisualLineBox {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * A Range reports one client rect per rendered inline fragment, and Shiki
 * makes those fragments syntax-token spans, so one continuous line commonly
 * has several rects. Merges the fragments that share a visual line — a
 * wrapped line counts as several — and keeps separate lines separate, in
 * document order. Empty rects, such as a collapsed boundary, are ignored.
 */
export function mergeVisualLines(rects: Iterable<DOMRect>): VisualLineBox[] {
  const lines: VisualLineBox[] = []
  for (const rect of rects) {
    if (!rect.width || !rect.height)
      continue
    const center = rect.top + rect.height / 2
    const line = lines.find((candidate) => {
      // Text on one line can have slightly different bounds, for example a
      // differently sized inline fragment. A quarter of the smaller height
      // accepts that while keeping adjacent lines distinct, even when their
      // line boxes touch.
      const tolerance = Math.max(1, Math.min(candidate.bottom - candidate.top, rect.height) / 4)
      return Math.abs((candidate.top + candidate.bottom) / 2 - center) <= tolerance
    })
    if (line) {
      line.left = Math.min(line.left, rect.left)
      line.top = Math.min(line.top, rect.top)
      line.right = Math.max(line.right, rect.right)
      line.bottom = Math.max(line.bottom, rect.bottom)
    }
    else {
      lines.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
    }
  }
  return lines.sort((a, b) => a.top - b.top || a.left - b.left)
}
