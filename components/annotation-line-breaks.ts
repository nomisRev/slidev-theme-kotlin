/**
 * Lets compact Markdown attributes express a line break as `\\n`, while
 * preserving real line breaks supplied through a bound Vue string.
 */
export function normalizeAnnotationLineBreaks(value: string): string {
  return value.replace(/\\n/g, '\n')
}
