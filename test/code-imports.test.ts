import { describe, expect, it } from 'vitest'
import {
  applyEdits,
  EXAMPLE_MARKER,
  foldImportEdits,
  shouldFoldImports,
  splitLeadingImports,
  stripThemeFlags,
  takeThemeFlags,
} from '../setup/code-imports'
import { extractTopLevelFences, parseFenceInfo } from '../setup/magic-move-between'

describe('splitLeadingImports', () => {
  it('splits a leading import block off the code', () => {
    const { imports, body } = splitLeadingImports([
      'import org.jetbrains.exposed.v1.core.eq',
      'import org.jetbrains.exposed.v1.jdbc.selectAll',
      '',
      'fun talks() = Talks.selectAll()',
    ].join('\n'))
    expect(imports).toEqual(['org.jetbrains.exposed.v1.core.eq', 'org.jetbrains.exposed.v1.jdbc.selectAll'])
    expect(body).toBe('fun talks() = Talks.selectAll()')
  })

  it('keeps aliases and drops trailing semicolons', () => {
    const { imports } = splitLeadingImports('import org.jetbrains.exposed.v1.jdbc.selectAll as jdbcSelectAll\nimport java.util.List;\n\nval x = 1')
    expect(imports).toEqual(['org.jetbrains.exposed.v1.jdbc.selectAll as jdbcSelectAll', 'java.util.List'])
  })

  it('allows blank lines between imports', () => {
    const { imports, body } = splitLeadingImports('import a.A\n\nimport b.B\n\nclass C')
    expect(imports).toEqual(['a.A', 'b.B'])
    expect(body).toBe('class C')
  })

  it('keeps a package line and @file annotation in the body', () => {
    const { imports, body } = splitLeadingImports('@file:OptIn(Foo::class)\npackage demo\n\nimport a.A\n\nclass C')
    expect(imports).toEqual(['a.A'])
    expect(body).toBe('@file:OptIn(Foo::class)\npackage demo\n\nclass C')
  })

  it('leaves code without leading imports alone', () => {
    const code = 'val x = 1\nimport not.at.the.Top'
    expect(splitLeadingImports(code)).toEqual({ imports: [], body: code })
  })

  it('reports the line span of the block', () => {
    const split = splitLeadingImports('package p\nimport a.A\n\nclass C')
    expect(split.foldStartLine).toBe(1)
    expect(split.bodyStartLine).toBe(3)
  })
})

describe('splitLeadingImports with an Example marker', () => {
  const snippet = [
    'import a.A',
    'import b.B',
    '',
    'fun helper(): A = A()',
    '',
    '// Example: the helper stays out of sight',
    'val x = helper()',
  ].join('\n')

  it('folds everything above the marker and drops the marker line', () => {
    const split = splitLeadingImports(snippet)
    expect(split.prefix).toBe('import a.A\nimport b.B\n\nfun helper(): A = A()')
    expect(split.imports).toEqual(['a.A', 'b.B'])
    expect(split.body).toBe('val x = helper()')
    expect(split.foldStartLine).toBe(0)
    expect(split.bodyStartLine).toBe(6)
  })

  it('accepts the marker with or without a description, in either case', () => {
    for (const marker of ['// Example', '//Example', '// example: lower case', '  // Example :  spaced  '])
      expect(EXAMPLE_MARKER.test(marker)).toBe(true)
    for (const line of ['// Examples of usage', '// An Example', 'val example = 1', '/* Example */'])
      expect(EXAMPLE_MARKER.test(line)).toBe(false)
  })

  it('folds a prelude too, and code without imports', () => {
    const split = splitLeadingImports('package demo\n\nobject Talks\n\n// Example\nTalks.selectAll()')
    expect(split.prefix).toBe('package demo\n\nobject Talks')
    expect(split.imports).toEqual([])
    expect(split.body).toBe('Talks.selectAll()')
  })

  it('treats a marker with nothing above it as an ordinary comment', () => {
    const code = '// Example: nothing to fold\nimport a.A\n\nval x = A()'
    const split = splitLeadingImports(code)
    expect(split.prefix).toBeUndefined()
    // The leading-imports rule does not apply either: the comment comes first.
    expect(split.imports).toEqual([])
    expect(split.body).toBe(code)
  })

  it('only honours the first marker', () => {
    const split = splitLeadingImports('val a = 1\n// Example\nval b = a\n// Example: again\nval c = b')
    expect(split.prefix).toBe('val a = 1')
    expect(split.body).toBe('val b = a\n// Example: again\nval c = b')
  })
})

describe('shouldFoldImports', () => {
  it('folds Kotlin and Java fences only', () => {
    expect(shouldFoldImports('kotlin')).toBe(true)
    expect(shouldFoldImports('kts gradle')).toBe(true)
    expect(shouldFoldImports('java')).toBe(true)
    expect(shouldFoldImports('kotlin{1,5-9}')).toBe(true)
    expect(shouldFoldImports('kotlin{5-7} jdbc')).toBe(true)
    expect(shouldFoldImports('sql')).toBe(false)
    expect(shouldFoldImports('ts')).toBe(false)
  })

  it('honours the show-imports flag', () => {
    expect(shouldFoldImports('kotlin show-imports')).toBe(false)
    expect(shouldFoldImports('kotlin jdbc show-imports {1|2}')).toBe(false)
    expect(shouldFoldImports('kotlin show-importsx')).toBe(true)
  })

  it('strips the flag from the info', () => {
    expect(stripThemeFlags('kotlin show-imports {1|2}')).toBe('kotlin {1|2}')
    expect(stripThemeFlags('kotlin jdbc')).toBe('kotlin jdbc')
    expect(stripThemeFlags('kotlin no-compile jdbc')).toBe('kotlin jdbc')
    expect(takeThemeFlags('kotlin no-compile show-imports')).toEqual({ info: 'kotlin', flags: ['no-compile', 'show-imports'] })
  })
})

describe('foldImportEdits', () => {
  const fold = (source: string) => applyEdits(source, foldImportEdits(source))

  it('removes the imports of a fence and leaves no trace on the slide', () => {
    const source = [
      '# Title',
      '',
      '```kotlin',
      'import a.A',
      'import b.B',
      '',
      'val x = A()',
      '```',
    ].join('\n')
    expect(fold(source)).toBe([
      '# Title',
      '',
      '```kotlin',
      'val x = A()',
      '```',
    ].join('\n'))
  })

  it('leaves fences without imports untouched', () => {
    const source = '```kotlin\nval x = 1\n```\n\n```sql\nSELECT 1\n```'
    expect(foldImportEdits(source)).toEqual([])
    expect(fold(source)).toBe(source)
  })

  it('keeps visible imports with show-imports and removes the flag', () => {
    const source = '```kotlin show-imports\nimport a.A\n\nval x = A()\n```'
    expect(fold(source)).toBe('```kotlin\nimport a.A\n\nval x = A()\n```')
  })

  it('does not fold languages without imports', () => {
    const source = '```sql\nimport nothing\n```'
    expect(fold(source)).toBe(source)
  })

  it('handles a fence whose imports are followed directly by the closing fence', () => {
    const source = '```kotlin\nimport a.A\n```'
    expect(fold(source)).toBe('```kotlin\n```')
  })

  it('folds each top-level fence separately', () => {
    const source = '```kotlin\nimport a.A\n\nval a = A()\n```\n\n```kotlin\nimport b.B\n\nval b = B()\n```'
    expect(fold(source)).toBe('```kotlin\nval a = A()\n```\n\n```kotlin\nval b = B()\n```')
  })

  it('folds every step of a classic magic-move block', () => {
    const source = [
      '````md magic-move',
      '```kotlin',
      'import a.A',
      '',
      'val a = A()',
      '```',
      '```kotlin',
      'import a.A',
      'import b.B',
      '',
      'val a = A(B())',
      '```',
      '````',
    ].join('\n')
    expect(fold(source)).toBe([
      '````md magic-move',
      '```kotlin',
      'val a = A()',
      '```',
      '```kotlin',
      'val a = A(B())',
      '```',
      '````',
    ].join('\n'))
  })

  it('ignores fences nested in other four-backtick or tilde blocks', () => {
    const source = '````md\n```kotlin\nimport a.A\n```\n````\n\n~~~\n```kotlin\nimport a.A\n```\n~~~'
    expect(fold(source)).toBe(source)
  })

  it('strips the theme flags even when folding is off', () => {
    const source = '```kotlin no-compile jdbc\nimport a.A\n\nval x = A()\n```'
    expect(applyEdits(source, foldImportEdits(source, { fold: false }))).toBe('```kotlin jdbc\nimport a.A\n\nval x = A()\n```')
  })

  it('preserves CRLF sources', () => {
    const source = '```kotlin\r\nimport a.A\r\n\r\nval x = A()\r\n```'
    expect(fold(source)).toBe('```kotlin\r\nval x = A()\r\n```')
  })

  it('removes an Example prefix together with the marker line', () => {
    const source = [
      '```kotlin {2}',
      'import a.A',
      '',
      'fun helper() = A()',
      '',
      '// Example: description',
      'val x = helper()',
      'val y = x',
      '```',
    ].join('\n')
    expect(fold(source)).toBe([
      '```kotlin {2}',
      'val x = helper()',
      'val y = x',
      '```',
    ].join('\n'))
  })

  it('removes the Example prefix of every step of a classic magic-move block', () => {
    const source = [
      '````md magic-move',
      '```kotlin',
      'object A',
      '// Example',
      'A',
      '```',
      '```kotlin',
      'object A',
      '// Example',
      'A.toString()',
      '```',
      '```kotlin',
      'import b.B',
      'object A',
      '// Example',
      'A.toString() + B',
      '```',
      '````',
    ].join('\n')
    expect(fold(source)).toBe([
      '````md magic-move',
      '```kotlin',
      'A',
      '```',
      '```kotlin',
      'A.toString()',
      '```',
      '```kotlin',
      'A.toString() + B',
      '```',
      '````',
    ].join('\n'))
  })
})

describe('magic-move fences fold imports the same way', () => {
  it('strips leading imports from a chain step and reports them', () => {
    const [fence] = extractTopLevelFences('```kotlin {1|2}\nimport a.A\n\nval x = A()\nval y = x\n```')
    expect(fence.code).toBe('val x = A()\nval y = x')
    expect(fence.imports).toEqual(['a.A'])
    expect(fence.ranges).toEqual(['1', '2'])
  })

  it('keeps imports with show-imports and strips the flag from the info', () => {
    const fence = parseFenceInfo('kotlin show-imports [Main.kt]', 'import a.A\n\nval x = A()\n')
    expect(fence.code).toBe('import a.A\n\nval x = A()')
    expect(fence.imports).toEqual([])
    expect(fence.info).toBe('kotlin [Main.kt]')
    expect(fence.title).toBe('Main.kt')
  })

  it('reports an Example prefix on a chain step', () => {
    const [fence] = extractTopLevelFences('```kotlin\nimport a.A\nval a = A()\n// Example\nval b = a\n```')
    expect(fence.code).toBe('val b = a')
    expect(fence.imports).toEqual(['a.A'])
    expect(fence.prefix).toBe('import a.A\nval a = A()')
    const [plain] = extractTopLevelFences('```kotlin\nval b = 1\n```')
    expect(plain).not.toHaveProperty('prefix')
  })

  it('can be disabled per deck', () => {
    const [fence] = extractTopLevelFences('```kotlin\nimport a.A\n\nval x = A()\n```', { foldImports: false })
    expect(fence.code).toBe('import a.A\n\nval x = A()')
    expect(fence.imports).toEqual([])
  })
})
