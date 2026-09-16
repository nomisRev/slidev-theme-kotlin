import { describe, expect, it } from 'vitest'
import { annotationLabelText, renderAnnotationLabel } from './annotation-label-markdown'

describe('annotation label Markdown', () => {
  it('renders backticked source as semantic inline code', () => {
    expect(renderAnnotationLabel('`class MyClass`')).toBe('<p><code>class MyClass</code></p>\n')
    expect(annotationLabelText('`class MyClass`')).toBe('class MyClass')
  })

  it('renders a Markdown quote and keeps its live-region text readable', () => {
    expect(renderAnnotationLabel('> I am a quote in markdown')).toBe('<blockquote>\n<p>I am a quote in markdown</p>\n</blockquote>\n')
    expect(annotationLabelText('> I am a quote in markdown')).toBe('I am a quote in markdown')
  })

  it('announces fenced code without its Markdown delimiters', () => {
    expect(annotationLabelText('```kotlin\nclass MyClass\n```')).toBe('class MyClass')
  })

  it('renders explicit and literal line breaks in a label', () => {
    expect(renderAnnotationLabel('First\\nSecond')).toBe('<p>First<br>\nSecond</p>\n')
    expect(renderAnnotationLabel('First\nSecond')).toBe('<p>First<br>\nSecond</p>\n')
    expect(annotationLabelText('First\\nSecond')).toBe('First Second')
  })

  it('escapes HTML supplied through a label prop', () => {
    expect(renderAnnotationLabel('<img src=x onerror=alert(1)>')).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('annotation label Markdown subset', () => {
  it('renders strong and emphasised text', () => {
    expect(renderAnnotationLabel('Await **all** of them')).toBe('<p>Await <strong>all</strong> of them</p>\n')
    expect(renderAnnotationLabel('a *word* here')).toBe('<p>a <em>word</em> here</p>\n')
    expect(annotationLabelText('Await **all** of them')).toBe('Await all of them')
  })

  it('keeps asterisks inside code and unmatched asterisks literal', () => {
    expect(renderAnnotationLabel('`*.example.com` also works')).toBe('<p><code>*.example.com</code> also works</p>\n')
    expect(renderAnnotationLabel('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>\n')
    expect(renderAnnotationLabel('a ** b')).toBe('<p>a ** b</p>\n')
  })

  it('matches backtick runs of the same length and trims padded spans', () => {
    expect(renderAnnotationLabel('`` a`b `` and `c`')).toBe('<p><code>a`b</code> and <code>c</code></p>\n')
    expect(renderAnnotationLabel('an unclosed ` tick')).toBe('<p>an unclosed ` tick</p>\n')
  })

  it('separates paragraphs on blank lines and nests quotes', () => {
    expect(renderAnnotationLabel('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>\n')
    expect(renderAnnotationLabel('> `Int`\n> or `Long`')).toBe('<blockquote>\n<p><code>Int</code><br>\nor <code>Long</code></p>\n</blockquote>\n')
  })

  it('renders fenced code as a block and escapes it', () => {
    expect(renderAnnotationLabel('```kotlin\nval x = a < b\n```')).toBe('<pre><code class="language-kotlin">val x = a &lt; b\n</code></pre>\n')
  })

  it('renders underscore emphasis and strong text', () => {
    expect(renderAnnotationLabel('Function with an _expression body_')).toBe('<p>Function with an <em>expression body</em></p>\n')
    expect(renderAnnotationLabel('`map` A to _many_ B\'s and _flatten_ nested lists')).toBe('<p><code>map</code> A to <em>many</em> B\'s and <em>flatten</em> nested lists</p>\n')
    expect(renderAnnotationLabel('__really__ sure')).toBe('<p><strong>really</strong> sure</p>\n')
  })

  it('keeps an underscore inside a word as text', () => {
    expect(renderAnnotationLabel('snake_case_name and RETURN_GENERATED_KEYS')).toBe('<p>snake_case_name and RETURN_GENERATED_KEYS</p>\n')
    expect(renderAnnotationLabel('_open but no_close')).toBe('<p>_open but no_close</p>\n')
  })

  it('escapes HTML inside code and emphasis too', () => {
    expect(renderAnnotationLabel('`<b>` and **<i>**')).toBe('<p><code>&lt;b&gt;</code> and <strong>&lt;i&gt;</strong></p>\n')
    expect(annotationLabelText('`<b>`')).toBe('<b>')
  })
})
