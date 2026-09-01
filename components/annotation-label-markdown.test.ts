import { describe, expect, it } from 'vitest'
import { annotationLabelText, renderAnnotationLabel } from './annotation-label-markdown'

describe('DrawnAnnotation label Markdown', () => {
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

  it('escapes HTML supplied through a label prop', () => {
    expect(renderAnnotationLabel('<img src=x onerror=alert(1)>')).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
