/**
 * Exact-text matching across syntax-token spans, shared by `DrawnAnnotation`
 * and `InlineCompilerError`.
 *
 * Shiki renders one span per token, so a match regularly starts and ends in
 * different text nodes, and Magic Move renders line breaks as `<br>` elements
 * where a static block uses newline characters. Both components therefore
 * flatten what is on screen into a list of text segments — each real text node
 * keeps its node, a rendered line break becomes a synthetic `"\n"` segment —
 * and this module maps the string offsets of the requested occurrence back
 * onto DOM Range boundaries.
 */

export interface TextSegment {
  /** The text node this segment renders; absent for a synthetic line break. */
  node?: Text
  text: string
}

export interface TextMatch {
  /** The rendered range of the requested occurrence, or null when unmatched. */
  range: Range | null
  /** Parent elements of every text node the match covers, in document order. */
  elements: HTMLElement[]
  /** Total number of occurrences found, reported so a miss can be explained. */
  matches: number
}

/** Finds the requested occurrence of `needle` in the flattened segments. */
export function findTextInSegments(segments: TextSegment[], needle: string, occurrence: number): TextMatch {
  const value = segments.map(segment => segment.text).join('')
  const starts: number[] = []
  for (let index = value.indexOf(needle); index >= 0; index = value.indexOf(needle, index + 1))
    starts.push(index)

  const start = starts[Math.max(1, occurrence) - 1]
  if (start === undefined)
    return { range: null, elements: [], matches: starts.length }

  const end = start + needle.length
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
      // A match that ends on a synthetic line break cannot put its boundary in
      // that segment, so trail the last real text node the match covered.
      if (startNode && end > next) {
        endNode = segment.node
        endOffset = segment.text.length
      }
    }
    offset = next
  }
  if (!startNode || !endNode)
    return { range: null, elements: [], matches: starts.length }

  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return { range, elements, matches: starts.length }
}
