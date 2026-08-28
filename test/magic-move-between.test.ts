import { describe, expect, it } from 'vitest'
import {
  extractTopLevelFences,
  isLinkedToPrevious,
  normalizeMagicMoveSeparators,
  parseFenceInfo,
  resolveChain,
} from '../setup/magic-move-between'

describe('normalizeMagicMoveSeparators', () => {
  it('rewrites a bare magic-move separator in place', () => {
    const lines = ['# A', '', '---', 'magic-move', '---', '', '# B']
    normalizeMagicMoveSeparators(lines)
    expect(lines).toEqual(['# A', '', '---', 'magicMove: true', '---', '', '# B'])
  })

  it('keeps the line count', () => {
    const lines = ['---', 'magic-move', '---']
    normalizeMagicMoveSeparators(lines)
    expect(lines).toHaveLength(3)
  })

  it('rewrites several separators', () => {
    const lines = ['# A', '---', 'magic-move', '---', '# B', '---', 'magic-move', '---', '# C']
    normalizeMagicMoveSeparators(lines)
    expect(lines.filter(l => l === 'magicMove: true')).toHaveLength(2)
  })

  it('ignores magic-move inside code fences', () => {
    const lines = ['```md', '---', 'magic-move', '---', '```']
    normalizeMagicMoveSeparators(lines)
    expect(lines[2]).toBe('magic-move')
  })

  it('ignores magic-move inside four-backtick fences with inner separators', () => {
    const lines = ['````md', '```', '---', 'magic-move', '---', '```', '````']
    normalizeMagicMoveSeparators(lines)
    expect(lines[3]).toBe('magic-move')
  })

  it('leaves regular frontmatter untouched', () => {
    const lines = ['---', 'layout: intro', '---', '# A']
    normalizeMagicMoveSeparators(lines)
    expect(lines[1]).toBe('layout: intro')
  })
})

describe('isLinkedToPrevious', () => {
  it('accepts magicMove and magic-move keys', () => {
    expect(isLinkedToPrevious({ magicMove: true })).toBe(true)
    expect(isLinkedToPrevious({ 'magic-move': true })).toBe(true)
  })

  it('rejects absent or falsy values', () => {
    expect(isLinkedToPrevious({})).toBe(false)
    expect(isLinkedToPrevious({ magicMove: false })).toBe(false)
    expect(isLinkedToPrevious(undefined)).toBe(false)
    expect(isLinkedToPrevious('magic-move')).toBe(false)
  })
})

describe('resolveChain', () => {
  const slides = (flags: boolean[]) => flags.map(magicMove => ({ frontmatter: magicMove ? { magicMove } : {} }))

  it('returns undefined for an unlinked slide', () => {
    expect(resolveChain(slides([false, false, false]), 1)).toBeUndefined()
  })

  it('finds the chain from its first slide', () => {
    expect(resolveChain(slides([false, false, true, true, false]), 1)).toEqual({ start: 1, end: 3 })
  })

  it('finds the chain from a middle slide', () => {
    expect(resolveChain(slides([false, false, true, true, false]), 2)).toEqual({ start: 1, end: 3 })
  })

  it('finds the chain from its last slide', () => {
    expect(resolveChain(slides([false, false, true, true, false]), 3)).toEqual({ start: 1, end: 3 })
  })

  it('keeps two chains separate', () => {
    // slides: 0, 1<-2, 3<-4
    const s = slides([false, false, true, false, true])
    expect(resolveChain(s, 1)).toEqual({ start: 1, end: 2 })
    expect(resolveChain(s, 3)).toEqual({ start: 3, end: 4 })
  })

  it('never links slide 0 to a predecessor', () => {
    // A stray magicMove on the first slide has no previous slide to link to.
    expect(resolveChain(slides([true, false]), 0)).toBeUndefined()
  })
})

describe('parseFenceInfo', () => {
  it('parses the language', () => {
    expect(parseFenceInfo('kotlin', 'val a = 1\n')).toMatchObject({ lang: 'kotlin', meta: '', code: 'val a = 1' })
  })

  it('drops the magic-move flag from the meta', () => {
    expect(parseFenceInfo('kotlin magic-move', 'x')).toMatchObject({ lang: 'kotlin', meta: '' })
  })

  it('keeps other modifiers such as gradle', () => {
    expect(parseFenceInfo('kotlin gradle magic-move', 'x')).toMatchObject({ lang: 'kotlin', meta: 'gradle' })
  })

  it('extracts a title', () => {
    expect(parseFenceInfo('kotlin [Main.kt]', 'x')).toMatchObject({ lang: 'kotlin', title: 'Main.kt', meta: '' })
  })

  it('parses lines options', () => {
    expect(parseFenceInfo('kotlin {lines:true}', 'x').lines).toBe(true)
    expect(parseFenceInfo('kotlin {lines: false}', 'x').lines).toBe(false)
    expect(parseFenceInfo('kotlin', 'x').lines).toBeUndefined()
  })

  it('extracts click-based highlight ranges', () => {
    expect(parseFenceInfo('kotlin {1|2-3|all}', 'x').ranges).toEqual(['1', '2-3', 'all'])
    expect(parseFenceInfo('kotlin', 'x').ranges).toEqual([])
  })

  it('treats a single static range as one range', () => {
    expect(parseFenceInfo('kotlin {2}', 'x').ranges).toEqual(['2'])
  })

  it('keeps ranges and an options object apart', () => {
    const fence = parseFenceInfo('kotlin {1|2} {lines:true}', 'x')
    expect(fence.ranges).toEqual(['1', '2'])
    expect(fence.optionsRaw).toBe('{lines:true}')
    expect(fence.lines).toBe(true)
    expect(fence.meta).toBe('')
  })

  it('recognises an options object regardless of position', () => {
    const fence = parseFenceInfo('kotlin {at:2} {1|2}', 'x')
    expect(fence.ranges).toEqual(['1', '2'])
    expect(fence.optionsRaw).toBe('{at:2}')
  })

  it('keeps modifiers clean of brace groups for the icon lookup', () => {
    expect(parseFenceInfo('kotlin gradle {1|2}', 'x').meta).toBe('gradle')
  })

  it('combines title, ranges, options, and magic-move flag', () => {
    const fence = parseFenceInfo('kotlin magic-move [Main.kt] {1|2} {lines:true}', 'x')
    expect(fence).toMatchObject({
      lang: 'kotlin',
      title: 'Main.kt',
      ranges: ['1', '2'],
      optionsRaw: '{lines:true}',
      lines: true,
      meta: '',
    })
  })
})

describe('extractTopLevelFences', () => {
  it('extracts fences in order', () => {
    const content = [
      '# Slide',
      '',
      '```kotlin',
      'class Person',
      '```',
      '',
      '```sql',
      'CREATE TABLE PERSON',
      '```',
    ].join('\n')
    const fences = extractTopLevelFences(content)
    expect(fences.map(f => f.lang)).toEqual(['kotlin', 'sql'])
    expect(fences[0].code).toBe('class Person')
    expect(fences[1].code).toBe('CREATE TABLE PERSON')
  })

  it('keeps multi-line code intact', () => {
    const content = '```kotlin\nclass Person(val name: String) {\n    fun introduce() = println("I am $name")\n}\n```'
    expect(extractTopLevelFences(content)[0].code)
      .toBe('class Person(val name: String) {\n    fun introduce() = println("I am $name")\n}')
  })

  it('skips classic magic-move blocks and their inner fences', () => {
    const content = [
      '````md magic-move',
      '```kotlin',
      'val a = 1',
      '```',
      '```kotlin',
      'val a = 2',
      '```',
      '````',
      '',
      '```sql',
      'SELECT 1;',
      '```',
    ].join('\n')
    const fences = extractTopLevelFences(content)
    expect(fences.map(f => f.lang)).toEqual(['sql'])
  })

  it('skips fences without a language', () => {
    expect(extractTopLevelFences('```\nplain\n```')).toEqual([])
  })

  it('stops at an unclosed fence', () => {
    expect(extractTopLevelFences('```kotlin\nval a = 1')).toEqual([])
  })
})
