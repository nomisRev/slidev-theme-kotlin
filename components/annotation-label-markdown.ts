import { normalizeAnnotationLineBreaks } from './annotation-line-breaks'

/**
 * The small Markdown subset a `DrawnAnnotation` label and an inline
 * diagnostic message accept: paragraphs, `>` quotes, fenced code, backticked
 * inline code, `**strong**`, `*emphasis*`, and line breaks. Everything else
 * is text, and embedded HTML is always escaped, so rendering a prop never
 * creates executable or arbitrary DOM.
 *
 * Hand-written rather than markdown-it: the full parser and its linkifier
 * were the largest thing the theme added to the browser bundle, loaded by
 * every slide with an annotation, to render a label of a few words. The
 * output keeps markdown-it's shape (`<p>`, `<br>\n`, `<blockquote>\n…`) so
 * the theme's label CSS applies unchanged.
 */
export function renderAnnotationLabel(source: string): string {
  return renderBlocks(normalizeAnnotationLineBreaks(source).split('\n'))
}

/**
 * The positioned label is presentation-only, so give its live-region sibling
 * the Markdown-free equivalent instead of announcing backticks and `>`.
 */
export function annotationLabelText(source: string): string {
  return renderAnnotationLabel(source)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const FENCE = /^ {0,3}(`{3,})\s*(\S*)/

function renderBlocks(lines: string[]): string {
  let html = ''
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length)
      html += `<p>${paragraph.map(renderInline).join('<br>\n')}</p>\n`
    paragraph = []
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const fence = line.match(FENCE)
    if (fence) {
      flush()
      const marker = fence[1]
      const language = fence[2]
      const code: string[] = []
      while (++index < lines.length && !lines[index].trimStart().startsWith(marker))
        code.push(lines[index])
      html += `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}\n</code></pre>\n`
      continue
    }
    if (line.startsWith('>')) {
      flush()
      const quoted: string[] = []
      for (; index < lines.length && lines[index].startsWith('>'); index++)
        quoted.push(lines[index].replace(/^> ?/, ''))
      index--
      html += `<blockquote>\n${renderBlocks(quoted)}</blockquote>\n`
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    paragraph.push(line)
  }
  flush()
  return html
}

/** Code spans first, so a `*` inside backticks is never emphasis. */
function renderInline(text: string): string {
  let html = ''
  let index = 0
  while (index < text.length) {
    if (text[index] === '`') {
      const run = text.slice(index).match(/^`+/)![0]
      const close = closingRun(text, index + run.length, run)
      if (close >= 0) {
        let code = text.slice(index + run.length, close)
        // Markdown drops one space on each side of a padded span.
        if (code.startsWith(' ') && code.endsWith(' ') && code.trim())
          code = code.slice(1, -1)
        html += `<code>${escapeHtml(code)}</code>`
        index = close + run.length
        continue
      }
    }
    const marker = text.startsWith('**', index) ? '**' : text[index] === '*' ? '*' : undefined
    if (marker) {
      const close = text.indexOf(marker, index + marker.length)
      const inner = close > index + marker.length ? text.slice(index + marker.length, close) : ''
      if (inner && !/^\s|\s$/.test(inner)) {
        const tag = marker === '**' ? 'strong' : 'em'
        html += `<${tag}>${renderInline(inner)}</${tag}>`
        index = close + marker.length
        continue
      }
    }
    html += escapeHtml(text[index])
    index++
  }
  return html
}

/** Where a backtick run of exactly `run.length` closes the span opened at `from`, or -1. */
function closingRun(text: string, from: number, run: string): number {
  for (let at = text.indexOf(run, from); at >= 0; at = text.indexOf(run, at + 1)) {
    const before = at > 0 && text[at - 1] === '`'
    const after = text[at + run.length] === '`'
    if (!before && !after)
      return at
  }
  return -1
}
