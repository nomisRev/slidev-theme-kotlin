import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectSnippetFiles,
  isCompilable,
  renderJavaSnippetFile,
  renderSnippetFile,
  resolveSnippetSettings,
  scanKotlin,
  splitTopLevel,
  syncSnippetFiles,
} from '../setup/kotlin-snippets'
import type { SnippetSettings } from '../setup/kotlin-snippets'
import { parseFenceInfo } from '../setup/magic-move-between'

const settings: SnippetSettings = { dir: 'src/main/kotlin/snippets', javaDir: 'src/main/java/snippets', package: 'deck.snippets', imports: [] }
const source = { file: 'lessons/lesson-2.md', slide: 12, title: 'SQL-shaped Kotlin' }

describe('resolveSnippetSettings', () => {
  it('is off unless themeConfig.snippets is set', () => {
    expect(resolveSnippetSettings(undefined)).toBeUndefined()
    expect(resolveSnippetSettings({ snippets: false })).toBeUndefined()
  })

  it('takes the defaults for `true` and overrides from an object', () => {
    expect(resolveSnippetSettings({ snippets: true }))
      .toEqual({ dir: 'src/main/kotlin/snippets', javaDir: 'src/main/java/snippets', package: 'snippets', imports: [] })
    expect(resolveSnippetSettings({ snippets: { package: 'deck', imports: 'deck.support.*' } }))
      .toEqual({ dir: 'src/main/kotlin/snippets', javaDir: 'src/main/java/snippets', package: 'deck', imports: ['deck.support.*'] })
  })
})

describe('scanKotlin', () => {
  it('tracks bracket depth across strings, templates, and comments', () => {
    const lines = scanKotlin([
      'val a = "{" + \'{\' + """{""" // {',
      'val b = "${listOf(1).map { it }}" /* { */',
      'fun f() {',
      '  /* nested /* { */ */',
      '}',
    ].join('\n'))
    expect(lines.map(line => line.depthAtStart)).toEqual([0, 0, 0, 1, 1])
    expect(lines[0].masked.replace(/\s+/g, ' ').trim()).toBe('val a = " " + \' \' + """ """')
    expect(lines[1].masked.replace(/\s+/g, ' ').trim()).toBe('val b = " listOf(1).map { it }}"')
  })

  it('reports lines starting inside a block comment or raw string', () => {
    const lines = scanKotlin('val s = """\n  text\n"""\n/*\n*/\nval t = 1')
    expect(lines.map(line => line.insideAtStart)).toEqual([false, true, true, false, true, false])
  })
})

describe('splitTopLevel', () => {
  it('keeps declarations top-level and collects bare statements', () => {
    const split = splitTopLevel([
      'val count = Talks.id.count().alias("count")',
      '',
      'Talks.select(Talks.id, count)',
      '  .where { Talks.id eq id }',
      '  .groupBy(Talks.id)',
      '',
      'fun previews(): Query =',
      '  Talks.selectAll()',
    ].join('\n'))
    expect(split.declarations).toBe('val count = Talks.id.count().alias("count")\n\nfun previews(): Query =\n  Talks.selectAll()')
    expect(split.statements).toBe('Talks.select(Talks.id, count)\n  .where { Talks.id eq id }\n  .groupBy(Talks.id)')
  })

  it('attaches annotations and context lines to the declaration below', () => {
    const split = splitTopLevel('@JvmInline\nvalue class Title(val value: String)\n\ncontext(_: Transaction)\nfun previews() = Talks.selectAll()\n\n@Transactional\nprivate fun f() = 1')
    expect(split.declarations).toBe('@JvmInline\nvalue class Title(val value: String)\n\ncontext(_: Transaction)\nfun previews() = Talks.selectAll()\n\n@Transactional\nprivate fun f() = 1')
    expect(split.statements).toBe('')
  })

  it('treats continuation lines as part of the construct above', () => {
    const split = splitTopLevel('val x =\nlistOf(1)\n\ntransaction {\n  Talks.selectAll()\n}\n.also { }\n\nif (a) {\n} else {\n}')
    expect(split.declarations).toBe('val x =\nlistOf(1)')
    expect(split.statements).toBe('transaction {\n  Talks.selectAll()\n}\n.also { }\n\nif (a) {\n} else {\n}')
  })

  it('drops package lines and hoists file annotations', () => {
    const split = splitTopLevel('@file:OptIn(ExperimentalUuidApi::class)\npackage org.example\n\nobject Talks : Table("talks")')
    expect(split.fileAnnotations).toEqual(['@file:OptIn(ExperimentalUuidApi::class)'])
    expect(split.declarations).toBe('object Talks : Table("talks")')
  })

  it('does not mistake a brace inside a string for nesting', () => {
    const split = splitTopLevel('val open = "{"\nTalks.selectAll()')
    expect(split.declarations).toBe('val open = "{"')
    expect(split.statements).toBe('Talks.selectAll()')
  })
})

describe('isCompilable', () => {
  it('takes Kotlin fences without the no-compile flag or the gradle identity', () => {
    expect(isCompilable(parseFenceInfo('kotlin', 'val x = 1'))).toBe(true)
    expect(isCompilable(parseFenceInfo('kotlin jdbc {1|2}', 'val x = 1'))).toBe(true)
    expect(isCompilable(parseFenceInfo('kotlin no-compile jdbc', 'class Query(...)'))).toBe(false)
    expect(isCompilable(parseFenceInfo('kotlin gradle', 'plugins {}'))).toBe(false)
    expect(isCompilable(parseFenceInfo('java', 'class JavaUsage {}'))).toBe(true)
    expect(isCompilable(parseFenceInfo('kts', 'val x = 1'))).toBe(false)
    expect(isCompilable(parseFenceInfo('sql', 'SELECT 1'))).toBe(false)
  })
})

describe('renderSnippetFile', () => {
  it('writes a header, the package, imports, declarations, and a main for statements', () => {
    const fence = parseFenceInfo('kotlin', 'import org.jetbrains.exposed.v1.core.eq\nimport org.jetbrains.exposed.v1.jdbc.select\n\nval id = 1L\n\nTalks.select(Talks.id)\n  .where { Talks.id eq id }\n')
    expect(renderSnippetFile(fence, 'deck.snippets.lesson2.slide12', source, { ...settings, imports: ['deck.support.*'] })).toBe([
      '// Generated by slidev-theme-kotlin from lessons/lesson-2.md, slide 12 "SQL-shaped Kotlin".',
      '// Do not edit: change the slide and run `slidev-kotlin-snippets` again.',
      '',
      'package deck.snippets.lesson2.slide12',
      '',
      'import deck.support.*',
      'import org.jetbrains.exposed.v1.core.eq',
      'import org.jetbrains.exposed.v1.jdbc.select',
      '',
      'val id = 1L',
      '',
      'suspend fun main() {',
      '  Talks.select(Talks.id)',
      '    .where { Talks.id eq id }',
      '}',
      '',
    ].join('\n'))
  })

  it('renders a Java fence as a compilation unit', () => {
    const rendered = renderJavaSnippetFile(
      parseFenceInfo('java', 'import java.util.List;\n\nclass JavaUsage { List<String> values; }'),
      'deck.snippets.lesson2.slide12', source, settings,
    )
    expect(rendered).toBe([
      '// Generated by slidev-theme-kotlin from lessons/lesson-2.md, slide 12 "SQL-shaped Kotlin".',
      '// Do not edit: change the slide and run `slidev-kotlin-snippets` again.',
      '',
      'package deck.snippets.lesson2.slide12;',
      '',
      'import java.util.List;',
      '',
      'class JavaUsage { List<String> values; }',
      '',
    ].join('\n'))
  })

  it('renders an imports-only fence and a declarations-only fence without a main', () => {
    const importsOnly = renderSnippetFile(parseFenceInfo('kotlin show-imports', 'import a.A\nimport b.B\n'), 'p.s1', source, settings)
    expect(importsOnly).toBe('// Generated by slidev-theme-kotlin from lessons/lesson-2.md, slide 12 "SQL-shaped Kotlin".\n// Do not edit: change the slide and run `slidev-kotlin-snippets` again.\n\npackage p.s1\n\nimport a.A\nimport b.B\n')
    const declarations = renderSnippetFile(parseFenceInfo('kotlin', 'object Talks : Table("talks")'), 'p.s1', source, settings)
    expect(declarations.endsWith('package p.s1\n\nobject Talks : Table("talks")\n')).toBe(true)
  })

  it('compiles an Example prefix together with the example', () => {
    const fence = parseFenceInfo('kotlin', 'import a.A\n\nfun helper(): A = A()\n\n// Example: the slide shows only the call\nhelper()\n')
    expect(fence.code).toBe('helper()')
    expect(renderSnippetFile(fence, 'p.s1', source, settings).split('\n').slice(3).join('\n')).toBe([
      'package p.s1',
      '',
      'import a.A',
      '',
      'fun helper(): A = A()',
      '',
      'suspend fun main() {',
      '    helper()',
      '}',
      '',
    ].join('\n'))
  })

  it('keeps the Example prefix of a show-imports fence, marker line aside', () => {
    const fence = parseFenceInfo('kotlin show-imports', 'import a.A\n\nfun helper(): A = A()\n\n// Example\nhelper()\n')
    expect(fence.prefix).toBeUndefined()
    expect(renderSnippetFile(fence, 'p.s1', source, settings).split('\n').slice(3).join('\n')).toBe([
      'package p.s1',
      '',
      'import a.A',
      '',
      'fun helper(): A = A()',
      '',
      'suspend fun main() {',
      '    helper()',
      '}',
      '',
    ].join('\n'))
  })

  it('keeps file annotations before the package and avoids a second main', () => {
    const rendered = renderSnippetFile(parseFenceInfo('kotlin', '@file:OptIn(A::class)\nfun main() = println(1)\n\nmain()'), 'p.s1', source, settings)
    expect(rendered).toContain('\n@file:OptIn(A::class)\n\npackage p.s1\n')
    expect(rendered).toContain('suspend fun snippet() {\n    main()\n}')
  })
})

describe('collectSnippetFiles', () => {
  const root = '/deck'
  const slide = (index: number, filepath: string, title: string, content: string) => ({ index, title, content, source: { filepath } })

  it('names files by section and slide, and packages per file', () => {
    const files = collectSnippetFiles([
      slide(0, '/deck/slides.md', 'Welcome', 'no code'),
      slide(11, '/deck/lessons/lesson-2.md', 'SQL-shaped <span>Kotlin</span>', '```kotlin\nTalks.selectAll()\n```\n\n```sql\nSELECT *\n```'),
    ], root, settings)
    expect(files.map(file => [file.path, file.package])).toEqual([
      ['src/main/kotlin/snippets/lesson-2/012-sql-shaped-kotlin.kt', 'deck.snippets.lesson2.slide12'],
    ])
    expect(files[0].source).toEqual({ file: 'lessons/lesson-2.md', slide: 12, title: 'SQL-shaped Kotlin' })
    expect(files[0].content).toContain('suspend fun main() {\n    Talks.selectAll()\n}')
  })

  it('puts Java and Kotlin fences from one slide in the same package', () => {
    const content = '```java\npublic class JavaBean {}\n```\n\n```kotlin\nfun example(value: JavaBean) = value\n```'
    const files = collectSnippetFiles([slide(4, '/deck/lessons/lesson-2.md', 'Interop', content)], root, settings)
    expect(files.map(file => [file.path, file.package])).toEqual([
      ['src/main/kotlin/snippets/lesson-2/005-interop.kt', 'deck.snippets.lesson2.slide5'],
      ['src/main/java/snippets/lesson-2/JavaBean.java', 'deck.snippets.lesson2.slide5'],
    ])
  })

  it('gives a second slide declaring the same public Java type a directory of its own', () => {
    const content = '```java\npublic class Person {}\n```'
    const files = collectSnippetFiles([
      slide(4, '/deck/lessons/lesson-2.md', 'Getters', content),
      slide(5, '/deck/lessons/lesson-2.md', 'Setters', content),
    ], root, settings)
    expect(files.map(file => [file.path, file.package])).toEqual([
      ['src/main/java/snippets/lesson-2/Person.java', 'deck.snippets.lesson2.slide5'],
      ['src/main/java/snippets/lesson-2/006-setters/Person.java', 'deck.snippets.lesson2.slide6'],
    ])
  })

  it('tells parallel fences apart by their identity, else by letter', () => {
    const content = '```kotlin jdbc\nval a = 1\n```\n\n```kotlin r2dbc\nval a = 2\n```\n\n```kotlin\nval a = 3\n```\n\n```kotlin no-compile\nclass Query(...)\n```'
    const files = collectSnippetFiles([slide(4, '/deck/lessons/lesson-2.md', 'Executing', content)], root, settings)
    expect(files.map(file => [file.path, file.package])).toEqual([
      ['src/main/kotlin/snippets/lesson-2/005-executing-jdbc.kt', 'deck.snippets.lesson2.slide5jdbc'],
      ['src/main/kotlin/snippets/lesson-2/005-executing-r2dbc.kt', 'deck.snippets.lesson2.slide5r2dbc'],
      ['src/main/kotlin/snippets/lesson-2/005-executing-c.kt', 'deck.snippets.lesson2.slide5c'],
    ])
  })

  it('skips the fences an InlineCompilerError wraps', () => {
    const content = [
      '<InlineCompilerError text="previews" message="No context argument for \'_: Transaction\' found">',
      '',
      '```kotlin',
      'fun example() = previews()',
      '```',
      '',
      '</InlineCompilerError>',
      '',
      '```kotlin',
      'val ok = 1',
      '```',
    ].join('\n')
    const files = collectSnippetFiles([slide(6, '/deck/lessons/lesson-2.md', 'Transactions', content)], root, settings)
    expect(files.map(file => file.path)).toEqual(['src/main/kotlin/snippets/lesson-2/007-transactions.kt'])
    expect(files[0].content).toContain('val ok = 1')
  })

  it('takes the steps of a classic magic-move block', () => {
    const content = '````md magic-move\n```kotlin\nval a = 1\n```\n```kotlin\nval a = 2\n```\n````'
    const files = collectSnippetFiles([slide(2, '/deck/slides.md', 'Steps', content)], root, settings)
    expect(files.map(file => file.path)).toEqual([
      'src/main/kotlin/snippets/slides/003-steps-a.kt',
      'src/main/kotlin/snippets/slides/003-steps-b.kt',
    ])
  })
})

describe('syncSnippetFiles', () => {
  const dirs: string[] = []
  const tempRoot = () => {
    const dir = mkdtempSync(join(tmpdir(), 'kotlin-snippets-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true })
  })
  const file = (path: string, content: string) => ({ path, package: 'p', content, source })

  it('writes new and changed files and removes stale generated ones', () => {
    const root = tempRoot()
    const generated = join(root, settings.dir)
    mkdirSync(join(generated, 'old'), { recursive: true })
    writeFileSync(join(generated, 'old/stale.kt'), '// Generated by slidev-theme-kotlin from x\npackage p\n')
    writeFileSync(join(generated, 'old/Support.kt'), 'package p\n\nobject Support\n')

    const first = syncSnippetFiles(root, settings, [file(`${settings.dir}/a/one.kt`, 'one')])
    expect(first).toEqual({ written: [`${settings.dir}/a/one.kt`], removed: [`${settings.dir}/old/stale.kt`], unchanged: [] })
    expect(readFileSync(join(generated, 'a/one.kt'), 'utf-8')).toBe('one')
    expect(readFileSync(join(generated, 'old/Support.kt'), 'utf-8')).toContain('object Support')

    const second = syncSnippetFiles(root, settings, [file(`${settings.dir}/a/one.kt`, 'one')])
    expect(second).toEqual({ written: [], removed: [], unchanged: [`${settings.dir}/a/one.kt`] })
  })

  it('reports without writing in check mode', () => {
    const root = tempRoot()
    const result = syncSnippetFiles(root, settings, [file(`${settings.dir}/a/one.kt`, 'one')], { check: true })
    expect(result.written).toEqual([`${settings.dir}/a/one.kt`])
    expect(() => readFileSync(join(root, settings.dir, 'a/one.kt'))).toThrow()
  })
})
