import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TextSegment } from './code-text-match'
import { findTextInSegments, lineCount, lineSpanMatch, mergeVisualLines, segmentsOnLines, trimmedLineRange } from './code-text-match'

// The matcher only needs `document.createRange()` and the Range's boundary
// setters, so a tiny stand-in keeps these tests free of a DOM environment.
interface FakeRange {
  startContainer: unknown
  startOffset: number
  endContainer: unknown
  endOffset: number
  setStart: (node: unknown, offset: number) => void
  setEnd: (node: unknown, offset: number) => void
}
function fakeRange(): FakeRange {
  const range: FakeRange = {
    startContainer: null,
    startOffset: 0,
    endContainer: null,
    endOffset: 0,
    setStart(node, offset) {
      range.startContainer = node
      range.startOffset = offset
    },
    setEnd(node, offset) {
      range.endContainer = node
      range.endOffset = offset
    },
  }
  return range
}

let previousDocument: unknown
beforeEach(() => {
  previousDocument = (globalThis as any).document
  ;(globalThis as any).document = { createRange: fakeRange }
})
afterEach(() => {
  ;(globalThis as any).document = previousDocument
})

/** A text node stand-in whose parent element is its own token span. */
function token(text: string, line?: number, block?: number): TextSegment {
  const parent = { token: text }
  return { node: { data: text, parentElement: parent } as unknown as Text, text, line, block }
}
const newline = (line?: number, block?: number): TextSegment => ({ text: '\n', line, block })

/**
 * ```
 * fun main() {
 *     val x = 1
 *     val y = x
 * }
 * ```
 * as Shiki tokenises it: indentation shares a token with the first keyword.
 */
function block(blockNumber?: number): TextSegment[] {
  return [
    token('fun', 1, blockNumber), token(' main', 1, blockNumber), token('() {', 1, blockNumber), newline(1, blockNumber),
    token('    val', 2, blockNumber), token(' x', 2, blockNumber), token(' = ', 2, blockNumber), token('1', 2, blockNumber), newline(2, blockNumber),
    token('    val', 3, blockNumber), token(' y', 3, blockNumber), token(' = ', 3, blockNumber), token('x', 3, blockNumber), newline(3, blockNumber),
    token('}', 4, blockNumber),
  ]
}

function selected(range: FakeRange) {
  const start = range.startContainer as { data: string }
  const end = range.endContainer as { data: string }
  return `${start.data}[${range.startOffset}]..${end.data}[${range.endOffset}]`
}

describe('findTextInSegments', () => {
  it('matches across token spans and reports the occurrence count', () => {
    const match = findTextInSegments(block(), 'val x = 1', 1)
    expect(match.matches).toBe(1)
    expect(match.line).toBe(2)
    expect(selected(match.range as unknown as FakeRange)).toBe('    val[4]..1[1]')
    expect(match.elements.map(element => (element as unknown as { token: string }).token)).toEqual(['    val', ' x', ' = ', '1'])
  })

  it('selects the requested occurrence and explains a miss', () => {
    expect(findTextInSegments(block(), 'val', 2).line).toBe(3)
    const miss = findTextInSegments(block(), 'val', 3)
    expect(miss.range).toBeNull()
    expect(miss.matches).toBe(2)
  })

  it('matches a needle that spans lines, with or without the indentation', () => {
    const match = findTextInSegments(block(), 'val x = 1\n    val y', 1)
    expect(match.range).not.toBeNull()
    expect(match.line).toBe(2)
    expect(match.endLine).toBe(3)
    expect(selected(match.range as unknown as FakeRange)).toBe('    val[4].. y[2]')
    for (const needle of ['val x = 1\nval y', 'val x = 1\n  val y', 'val x = 1\n        val y'])
      expect(selected(findTextInSegments(block(), needle, 1).range as unknown as FakeRange)).toBe('    val[4].. y[2]')
    expect(findTextInSegments(block(), 'val x = 1\nx', 1).matches).toBe(0)
  })

  it('matches regex characters literally', () => {
    expect(findTextInSegments(block(), '() {', 1).matches).toBe(1)
    expect(findTextInSegments(block(), '(.*)', 1).matches).toBe(0)
  })

  it('cuts a multi-line match into one trimmed range per line', () => {
    const match = findTextInSegments(block(), 'main() {\nval x = 1\nval y', 1)
    expect(match.lineRanges!.map(range => selected(range as unknown as FakeRange)))
      .toEqual([' main[1]..() {[4]', '    val[4]..1[1]', '    val[4].. y[2]'])
  })

  it('narrows the search to one line and counts occurrences there', () => {
    expect(findTextInSegments(block(), 'val', 1, 3).line).toBe(3)
    expect(findTextInSegments(block(), 'val', 1, 2).line).toBe(2)
    const miss = findTextInSegments(block(), 'val', 2, 3)
    expect(miss.range).toBeNull()
    expect(miss.matches).toBe(1)
    expect(findTextInSegments(block(), 'main', 1, 2).matches).toBe(0)
  })

  it('treats `line` as the first line of a multi-line needle', () => {
    expect(findTextInSegments(block(), 'val x = 1\n    val y', 1, 2).line).toBe(2)
    expect(findTextInSegments(block(), 'val x = 1\n    val y', 1, 3).matches).toBe(0)
  })

  it('never matches across two code blocks that both have the requested line', () => {
    const segments = [...block(1), { text: 'Prose between the blocks' }, ...block(2)]
    expect(findTextInSegments(segments, '}', 1, 4).matches).toBe(2)
    expect(findTextInSegments(segments, '}fun', 1, 4).matches).toBe(0)
    // Segments outside any code block never take part in a line search.
    expect(findTextInSegments(segments, 'Prose', 1, 1).matches).toBe(0)
    expect(findTextInSegments(segments, 'Prose', 1).matches).toBe(1)
  })

  it('ends a match on the last real text node when it stops at a line break', () => {
    const match = findTextInSegments(block(), '() {\n', 1)
    expect(selected(match.range as unknown as FakeRange)).toBe('() {[0]..() {[4]')
  })
})

describe('lineSpanMatch', () => {
  it('spans the trimmed code of a line range, one range per line', () => {
    const match = lineSpanMatch(block(), 1, 3)
    expect(selected(match.range as unknown as FakeRange)).toBe('fun[0]..x[1]')
    expect(match.line).toBe(1)
    expect(match.endLine).toBe(3)
    expect(match.lineRanges!.map(range => selected(range as unknown as FakeRange)))
      .toEqual(['fun[0]..() {[4]', '    val[4]..1[1]', '    val[4]..x[1]'])
  })

  it('has no range over empty lines', () => {
    expect(lineSpanMatch([token('   ', 1), newline(1), token('x', 2)], 1, 1).range).toBeNull()
  })
})

describe('segmentsOnLines and trimmedLineRange', () => {
  it('keeps the requested lines in order', () => {
    expect(segmentsOnLines(block(), 2, 2).map(segment => segment.text).join('')).toBe('    val x = 1\n    val y = x\n')
  })

  it('underlines a line without its indentation', () => {
    const line = trimmedLineRange(block(), 2)
    expect(selected(line.range as unknown as FakeRange)).toBe('    val[4]..1[1]')
    expect(trimmedLineRange([token('   ', 1), newline(1), token('x', 2)], 1).range).toBeNull()
  })
})

describe('lineCount and mergeVisualLines', () => {
  it('counts the lines a needle spans', () => {
    expect(lineCount('one')).toBe(1)
    expect(lineCount('one\ntwo\nthree')).toBe(3)
  })

  it('merges token fragments per visual line and keeps lines apart', () => {
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top }) as DOMRect
    const lines = mergeVisualLines([
      rect(10, 100, 30, 20), rect(40, 101, 25, 18),
      rect(0, 0, 0, 20), // a collapsed boundary rect
      rect(10, 130, 50, 20),
    ])
    expect(lines).toEqual([
      { left: 10, top: 100, right: 65, bottom: 120 },
      { left: 10, top: 130, right: 60, bottom: 150 },
    ])
  })
})
