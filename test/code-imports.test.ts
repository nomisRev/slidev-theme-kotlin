import { describe, expect, it } from 'vitest'
import {
  applyEdits,
  codeImportsMarkup,
  foldImportEdits,
  shouldFoldImports,
  splitLeadingImports,
  stripShowImportsFlag,
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
    expect(split.importStartLine).toBe(1)
    expect(split.bodyStartLine).toBe(3)
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
    expect(stripShowImportsFlag('kotlin show-imports {1|2}')).toBe('kotlin {1|2}')
    expect(stripShowImportsFlag('kotlin jdbc')).toBe('kotlin jdbc')
  })
})

describe('foldImportEdits', () => {
  const fold = (source: string) => applyEdits(source, foldImportEdits(source))

  it('moves the imports of a fence into a CodeImports component before it', () => {
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
      '',
      codeImportsMarkup(['a.A', 'b.B']),
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
    expect(fold(source)).toBe(`\n${codeImportsMarkup(['a.A'])}\n\n\`\`\`kotlin\n\`\`\``)
  })

  it('folds each top-level fence separately', () => {
    const source = '```kotlin\nimport a.A\n\nval a = A()\n```\n\n```kotlin\nimport b.B\n\nval b = B()\n```'
    const result = fold(source)
    expect(result).toContain(codeImportsMarkup(['a.A']))
    expect(result).toContain(codeImportsMarkup(['b.B']))
    expect(result).not.toContain('import ')
  })

  it('shares one component across the steps of a classic magic-move block', () => {
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
      '',
      codeImportsMarkup(['a.A', 'b.B']),
      '',
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

  it('preserves CRLF sources', () => {
    const source = '```kotlin\r\nimport a.A\r\n\r\nval x = A()\r\n```'
    expect(fold(source)).toBe(`\n${codeImportsMarkup(['a.A'])}\n\n\`\`\`kotlin\r\nval x = A()\r\n\`\`\``)
  })

  it('escapes the JSON for a single-quoted attribute', () => {
    expect(codeImportsMarkup(['a.b as `weird\'name`'])).toBe(`<CodeImports :imports='["a.b as \`weird&#39;name\`"]' />`)
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

  it('can be disabled per deck', () => {
    const [fence] = extractTopLevelFences('```kotlin\nimport a.A\n\nval x = A()\n```', { foldImports: false })
    expect(fence.code).toBe('import a.A\n\nval x = A()')
    expect(fence.imports).toEqual([])
  })
})
