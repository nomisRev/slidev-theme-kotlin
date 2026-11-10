import { describe, expect, it } from 'vitest'
import { applyEdits } from '../setup/code-imports'
import { codeMarkEdits, countOccurrences, parseCodeMarks, parseMarkComment, renderCodeMarkTags } from '../setup/code-marks'
import { parseFenceInfo } from '../setup/magic-move-between'

describe('parseMarkComment', () => {
  it('reads a kind with a bare argument', () => {
    expect(parseMarkComment('[!smartcast result]')).toEqual([{ kind: 'smartcast', args: ['result'], options: {} }])
  })

  it('lets the last argument run to the end of the mark, unquoted', () => {
    expect(parseMarkComment('[!error insertUser No context argument for \'_: Raise<AlreadyExists>\' found]'))
      .toEqual([{ kind: 'error', args: ['insertUser', 'No context argument for \'_: Raise<AlreadyExists>\' found'], options: {} }])
    expect(parseMarkComment('[!context Accumulate<String>, Raise<String>]'))
      .toEqual([{ kind: 'context', args: ['Accumulate<String>, Raise<String>'], options: {} }])
  })

  it('quotes an argument that holds spaces or brackets, with backticks or double quotes', () => {
    expect(parseMarkComment('[!error `NonEmptyList("a", ["bb", "ccc"])` `constructor<A>(head: A, tail: List<A>): NonEmptyList<A>` is private]'))
      .toEqual([{ kind: 'error', args: ['NonEmptyList("a", ["bb", "ccc"])', '`constructor<A>(head: A, tail: List<A>): NonEmptyList<A>` is private'], options: {} }])
    expect(parseMarkComment('[!value "\\"John\\".length" 4]')).toEqual([{ kind: 'value', args: ['"John".length', '4'], options: {} }])
    expect(parseMarkComment('[!error [] No value passed for parameter `head`]'))
      .toEqual([{ kind: 'error', args: ['[]', 'No value passed for parameter `head`'], options: {} }])
  })

  it('takes key=value options before the arguments', () => {
    expect(parseMarkComment('[!smartcast on=1 occurrence=2 result]'))
      .toEqual([{ kind: 'smartcast', args: ['result'], options: { on: '1', occurrence: '2' } }])
    expect(parseMarkComment('[!this text="{ server" Routing]'))
      .toEqual([{ kind: 'this', args: ['Routing'], options: { text: '{ server' } }])
  })

  it('reads several marks in one comment and a mark without arguments', () => {
    expect(parseMarkComment('[!this Routing] [!suspend]'))
      .toEqual([{ kind: 'this', args: ['Routing'], options: {} }, { kind: 'suspend', args: [], options: {} }])
  })

  it('leaves an ordinary comment alone', () => {
    expect(parseMarkComment('[!smartcast result] and more words')).toBeUndefined()
    expect(parseMarkComment('[!smartcast result')).toBeUndefined()
    expect(parseMarkComment('[!suspend extra]')).toBeUndefined()
  })
})

describe('parseCodeMarks', () => {
  it('strips the comments and counts lines in what remains', () => {
    const { code, marks } = parseCodeMarks([
      'fun Application.users() = routing { // [!this Routing]',
      '  when (val result = insertUser(body)) {',
      '    is Success -> respond(result.user) // [!smartcast result]',
      '  }',
      '}',
    ].join('\n'))
    expect(code).toBe('fun Application.users() = routing {\n  when (val result = insertUser(body)) {\n    is Success -> respond(result.user)\n  }\n}')
    expect(marks.map(mark => [mark.kind, mark.line, mark.args])).toEqual([['this', 1, ['Routing']], ['smartcast', 3, ['result']]])
    expect(marks[1].code).toBe('    is Success -> respond(result.user)')
  })

  it('applies a mark-only line to the next line and removes it', () => {
    const { code, marks } = parseCodeMarks([
      'fun Application.users() = routing {',
      '  route(Api.Users.create) {',
      '    // [!error insertUser No context argument for \'_: Raise<AlreadyExists>\' found]',
      '    val user = insertUser(body)',
      '  }',
      '}',
    ].join('\n'))
    expect(code.split('\n')).toHaveLength(5)
    expect(marks).toHaveLength(1)
    expect(marks[0].line).toBe(3)
    expect(marks[0].code).toBe('    val user = insertUser(body)')
  })

  it('keeps a comment that only looks like a mark, and a mark inside a string', () => {
    const source = 'val x = 1 // [!todo] later\nval y = "// [!smartcast y] not a mark"'
    expect(parseCodeMarks(source).code).toBe(source)
  })

  it('reports a mark-only last line', () => {
    expect(parseCodeMarks('val x = 1\n// [!suspend]').problems).toHaveLength(1)
  })
})

describe('renderCodeMarkTags', () => {
  const marks = (code: string) => parseCodeMarks(code).marks

  it('paints every occurrence of a smart cast on the line', () => {
    const { open, close } = renderCodeMarkTags(marks('is Granted if access.user.active -> "Hello, ${access.user.name}" // [!smartcast access]'))
    expect(open).toEqual(['<SmartCast text="access" :line="1">', '<SmartCast text="access" :line="1" :occurrence="2">'])
    expect(close).toEqual(['</SmartCast>', '</SmartCast>'])
  })

  it('puts a type hint after the last brace of its line', () => {
    const { open } = renderCodeMarkTags(marks('install({ engine.createAndStart(host, port) }) { server, _ -> // [!context ResourceScope]'))
    expect(open).toEqual(['<TypeHint text="{" :line="1" :occurrence="2" context="ResourceScope">'])
    expect(renderCodeMarkTags(marks('fun main() = SuspendApp { // [!this SuspendAppScope]')).open)
      .toEqual(['<TypeHint text="{" :line="1" receiver="SuspendAppScope">'])
  })

  it('escapes attribute values and passes options through', () => {
    const { open } = renderCodeMarkTags(marks('val xs: NonEmptyList<String> = ["a", "bb"] // [!error on=1 `["a", "bb"]` `NonEmptyList<String>` for collection literal does not\\ndefine operator `of`]'))
    expect(open).toEqual(['<InlineCompilerError text="[&quot;a&quot;, &quot;bb&quot;]" :line="1" message="`NonEmptyList<String>` for collection literal does not\\ndefine operator `of`" on="1">'])
  })

  it('collects suspension points into one gutter', () => {
    const { open, close } = renderCodeMarkTags(marks('resourceScope { // [!context ResourceScope] [!suspend]\n  server(Netty) // [!suspend]\n  awaitCancellation() // [!suspend]'))
    expect(open).toEqual(['<TypeHint text="{" :line="1" context="ResourceScope">', '<SuspendGutter :lines="[1, 2, 3]">'])
    expect(close).toEqual(['</SuspendGutter>', '</TypeHint>'])
  })

  it('reports text that is not on the line', () => {
    expect(renderCodeMarkTags(marks('val x = 1 // [!smartcast y]')).problems[0]).toContain('"y" does not occur')
  })

  it('leaves a comment with an unknown kind in the code, silently for Shiki notation', () => {
    const unknown = parseCodeMarks('val x = 1 // [!squiggle x]')
    expect(unknown.code).toBe('val x = 1 // [!squiggle x]')
    expect(unknown.marks).toEqual([])
    expect(unknown.problems[0]).toContain('not a code mark kind')
    const shiki = parseCodeMarks('val x = 1 // [!code highlight]\nval y = 2 // [!code ++]')
    expect(shiki.code).toBe('val x = 1 // [!code highlight]\nval y = 2 // [!code ++]')
    expect(shiki.problems).toEqual([])
  })

  it('reports a known kind that does not parse, and leaves it in the code', () => {
    const unbalanced = parseCodeMarks("val x = 1 // [!error x Expected ']' here]")
    expect(unbalanced.code).toBe("val x = 1 // [!error x Expected ']' here]")
    expect(unbalanced.problems[0]).toContain('does not parse')
    expect(parseCodeMarks('val x = 1 // [!error `x` a lone ` backtick]').problems[0]).toContain('does not parse')
    expect(parseCodeMarks('val x = 1 // [!todo] later').problems).toEqual([])
  })

  it('rejects an occurrence that is not a positive whole number', () => {
    const { open, problems } = renderCodeMarkTags(marks('val a = a // [!smartcast occurrence=abc a]'))
    expect(open).toEqual([])
    expect(problems[0]).toContain('occurrence=abc')
    expect(renderCodeMarkTags(marks('val a = a // [!smartcast occurrence=0 a]')).problems[0]).toContain('occurrence=0')
    expect(renderCodeMarkTags(marks('val a = a // [!smartcast occurrence=2 a]')).open).toEqual(['<SmartCast text="a" :line="1" :occurrence="2">'])
  })

  it('counts occurrences without overlap', () => {
    expect(countOccurrences('aaa', 'aa')).toBe(1)
    expect(countOccurrences('access.access', 'access')).toBe(2)
  })
})

describe('parseFenceInfo', () => {
  it('takes the marks out of the code, with lines counted after the fold', () => {
    const fence = parseFenceInfo('kotlin', [
      'import io.ktor.server.routing.routing',
      '',
      'fun Application.users() = routing { // [!this Routing]',
      '  respond(user) // [!smartcast user]',
      '}',
    ].join('\n'))
    expect(fence.code).toBe('fun Application.users() = routing {\n  respond(user)\n}')
    expect(fence.marks.map(mark => [mark.kind, mark.line])).toEqual([['this', 1], ['smartcast', 2]])
  })

  it('strips marks from an // Example prefix too', () => {
    const fence = parseFenceInfo('kotlin', 'val helper = 1 // [!smartcast helper]\n// Example\nval x = helper // [!smartcast helper]')
    expect(fence.prefix).toBe('val helper = 1')
    expect(fence.marks.map(mark => mark.line)).toEqual([1])
  })
})

describe('codeMarkEdits', () => {
  const apply = (source: string, edits = codeMarkEdits(source)) => {
    let result = applyEdits(source, edits.removals)
    // Insertions address the original source; apply them from the end.
    const inserts = [...edits.insertions].sort((a, b) => b.at - a.at)
    for (const insertion of inserts) {
      const shift = edits.removals.filter(edit => edit.end <= insertion.at).reduce((sum, edit) => sum + (edit.end - edit.start), 0)
      result = result.slice(0, insertion.at - shift) + insertion.text + result.slice(insertion.at - shift)
    }
    return result
  }

  it('wraps the fence in the components, opening above and closing below', () => {
    const source = [
      '# Title',
      '',
      '```kotlin',
      'fun Application.users() = routing { // [!this Routing]',
      '  respond(user) // [!smartcast user]',
      '}',
      '```',
      '',
      '> lede',
    ].join('\n')
    expect(apply(source)).toBe([
      '# Title',
      '',
      '',
      '<TypeHint text="{" :line="1" receiver="Routing">',
      '<SmartCast text="user" :line="2">',
      '',
      '```kotlin',
      'fun Application.users() = routing {',
      '  respond(user)',
      '}',
      '```',
      '',
      '</SmartCast>',
      '</TypeHint>',
      '',
      '',
      '> lede',
    ].join('\n'))
  })

  it('counts lines after the imports the fence folds, and leaves folded lines to the fold', () => {
    const source = '```kotlin\nimport a.A // [!smartcast A]\n\nval a = A() // [!smartcast a]\n```'
    const edits = codeMarkEdits(source)
    expect(edits.insertions[0].text).toContain('<SmartCast text="a" :line="1">')
    expect(edits.removals).toHaveLength(1)
    expect(codeMarkEdits(source, { fold: false }).insertions[0].text).toContain(':line="3"')
  })

  it('removes a mark-only line with its line break', () => {
    const source = '```kotlin\n// [!error x boom]\nval x = 1\n```'
    expect(apply(source)).toContain('```kotlin\nval x = 1\n```')
  })

  it('closes the wrapper after a console fence attached directly under the code', () => {
    const source = [
      '```kotlin',
      'fun main() { // [!this Scope]',
      '  println(1)',
      '}',
      '```',
      '```console',
      '1',
      '```',
      '',
      'after',
    ].join('\n')
    const result = apply(source)
    expect(result).toContain('}\n```\n```console\n1\n```\n\n</TypeHint>\n')
    expect(result.indexOf('</TypeHint>')).toBeGreaterThan(result.indexOf('```console'))
  })

  it('gives a code fence that follows directly its own wrapper', () => {
    const source = [
      '```kotlin',
      'fun f() { // [!this Scope]',
      '}',
      '```',
      '```java no-compile',
      'int b = 2; // [!smartcast b]',
      '```',
    ].join('\n')
    const result = apply(source)
    expect(result.indexOf('</TypeHint>')).toBeLessThan(result.indexOf('<SmartCast'))
    expect(result).toContain('}\n```\n\n</TypeHint>\n')
    expect(result).toContain('int b = 2;\n```\n\n</SmartCast>')
  })

  it('leaves a fence without marks untouched', () => {
    const source = '```kotlin\nval x = 1\n```'
    expect(codeMarkEdits(source)).toEqual({ removals: [], insertions: [], problems: [] })
  })

  it('skips the steps of a classic magic-move block, and says so when one carries a mark', () => {
    const source = '````md magic-move\n```kotlin\nval x = 1 // [!smartcast x]\n```\n````'
    const edits = codeMarkEdits(source)
    expect(edits.insertions).toEqual([])
    expect(edits.removals).toEqual([])
    expect(edits.problems[0]).toContain('classic magic-move block')
    expect(codeMarkEdits('````md magic-move\n```kotlin\nval x = 1\n```\n````').problems).toEqual([])
  })
})
