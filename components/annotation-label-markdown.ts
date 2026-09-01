import MarkdownIt from 'markdown-it'

// Labels come from deck-authored Markdown, but still disable embedded HTML so
// rendering a prop never creates executable or arbitrary DOM.
const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
})

/** Render the small Markdown subset accepted by a DrawnAnnotation label. */
export function renderAnnotationLabel(source: string): string {
  return markdown.render(source)
}

/**
 * The positioned label is presentation-only, so give its live-region sibling
 * the Markdown-free equivalent instead of announcing backticks and `>`.
 */
export function annotationLabelText(source: string): string {
  return markdown.parse(source, {})
    .flatMap((token) => {
      if (token.type === 'inline') return token.children ?? []
      // Fenced and indented code have no inline child tokens.
      return token.type === 'fence' || token.type === 'code_block' ? [token] : []
    })
    .map((token) => {
      if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n'
      return token.content
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
