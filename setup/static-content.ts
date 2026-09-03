/**
 * Static, crawlable content for a built deck.
 *
 * A Slidev build is a single-page app: without JavaScript, `index.html`
 * contains nothing but the title. Search engines render JavaScript for the
 * root URL at best, and AI crawlers (GPTBot, ClaudeBot, CCBot, and the like)
 * render none at all, so the code on the slides never reaches them. This
 * plugin writes the deck's content as plain HTML and Markdown next to the
 * built app:
 *
 * - `handout/index.html` and `handout/<section>.html`: one page per source
 *   file (lesson) with every slide's title, content, and code, each linking
 *   back to the live slide.
 * - `llms.txt` and `llms-full.txt`: the llmstxt.org convention that coding
 *   agents and AI crawlers look for — an index, and the full Markdown.
 * - `sitemap.xml` (and `robots.txt` when the deck ships none): only when
 *   `themeConfig.siteUrl` gives the deck's public URL.
 *
 * The built `index.html` (and the `404.html` copied from it) points at these
 * files with `rel="alternate"` links and a short paragraph of visible links
 * that the app hides once it has mounted, so a crawler that lands on the
 * root page finds them even without a sitemap (see `indexHtmlTags`).
 *
 * Theme-specific markup is translated rather than dropped: a `DrawnAnnotation`
 * label becomes a quoted note about the code it points at, an
 * `InlineCompilerError` becomes its diagnostic, and imports folded on the
 * slides (see `code-imports.ts`) stay in the handout's fences, expanded.
 */
import type { ResolvedSlidevOptions, SlideInfo } from '@slidev/types'
import type { HtmlTagDescriptor, Plugin } from 'vite'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import MarkdownIt from 'markdown-it'
import { goatcounterTag, resolveAnalyticsSettings } from './analytics'
import { codeWindowIcon } from './code-window-icon'
import { parseFenceInfo } from './magic-move-between'
import type { ParsedFence } from './magic-move-between'

// ---------------------------------------------------------------------------
// Settings

export interface StaticContentSettings {
  /** `themeConfig.handout: false` turns the whole feature off. */
  enabled: boolean
  /** Public URL of the deck root, with the base path (`themeConfig.siteUrl`). */
  siteUrl?: string
  /** Include presenter notes in the handout (`themeConfig.handout.notes`). */
  notes: boolean
}

export function resolveStaticContentSettings(themeConfig: unknown): StaticContentSettings {
  const config = (themeConfig ?? {}) as { handout?: unknown, siteUrl?: unknown }
  const handout = config.handout
  const handoutOptions = handout && typeof handout === 'object' ? handout as { notes?: unknown, siteUrl?: unknown } : {}
  const siteUrl = [handoutOptions.siteUrl, config.siteUrl].find(url => typeof url === 'string' && url.trim()) as string | undefined
  return {
    enabled: handout !== false,
    siteUrl: siteUrl ? siteUrl.trim().replace(/\/?$/, '/') : undefined,
    notes: handoutOptions.notes !== false,
  }
}

// ---------------------------------------------------------------------------
// Sections

export interface HandoutSlide {
  /** 1-based slide number as shown in the presentation. */
  no: number
  title: string
  /**
   * Cleaned Markdown (see `cleanSlideMarkdown`), without the title heading.
   * Headings are relative to the slide's title at level 1, so a renderer
   * that prints the title at depth `d` shifts them by `d - 1` (`shiftHeadings`).
   */
  markdown: string
  note?: string
}

export interface HandoutSection {
  /** File name of the page, without `.html`; `index` for a single-section deck. */
  slug: string
  title: string
  /** Source file, relative to the deck root. */
  file: string
  slides: HandoutSlide[]
}

type SectionSlide = Pick<SlideInfo, 'index' | 'title' | 'content' | 'note' | 'frontmatter'> & {
  source: Pick<SlideInfo['source'], 'filepath'>
}

export interface CleanContext {
  /** Site base path, prefixed to root-absolute links and images. */
  base: string
  /** Resolve a `<<< @/path` snippet import to its file contents. */
  loadSnippet?: (path: string) => string | undefined
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section'
}

/**
 * Group slides by the file they were written in, in order of first
 * appearance. A deck that puts each lesson in its own `src:` file gets one
 * section per lesson; a single-file deck gets one section, `index`.
 */
export function collectSections(slides: SectionSlide[], userRoot: string, deckTitle: string, ctx: CleanContext): HandoutSection[] {
  const sections = new Map<string, HandoutSection>()
  for (const slide of slides) {
    const file = relative(userRoot, slide.source.filepath).split('\\').join('/')
    let section = sections.get(file)
    if (!section) {
      section = { slug: slugify(basename(file, extname(file))), title: '', file, slides: [] }
      sections.set(file, section)
    }
    const no = slide.index + 1
    const title = plainTitle(slide.title) || `Slide ${no}`
    section.slides.push({
      no,
      title,
      markdown: withoutTitleHeading(cleanSlideMarkdown(slide.content, ctx), title),
      note: slide.note?.trim() || undefined,
    })
  }

  const list = [...sections.values()]
  const usedSlugs = new Set<string>()
  for (const section of list) {
    section.title = section.slides.find(slide => !/^Slide \d+$/.test(slide.title))?.title
      ?? section.slug.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
    let slug = list.length === 1 ? 'index' : section.slug
    for (let n = 2; usedSlugs.has(slug); n++)
      slug = `${section.slug}-${n}`
    usedSlugs.add(slug)
    section.slug = slug
  }
  if (list.length > 1 && list[0].slides[0]?.no === 1)
    list[0].title = deckTitle
  return list
}

/** A slide title as plain text: Slidev keeps inline HTML such as `<span>` in it. */
export function plainTitle(title: string | undefined): string {
  return decodeEntities((title ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

/**
 * Drop the heading the slide's title came from, wherever it sits: a section
 * slide often puts a kicker (`Topic 2`) above it. The handout renders the
 * title itself, so keeping the heading would print it twice.
 */
function withoutTitleHeading(markdown: string, title: string): string {
  const match = markdown.match(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/m)
  if (match && plainTitle(match[1]) === title)
    return (markdown.slice(0, match.index) + markdown.slice(match.index! + match[0].length)).replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '')
  return markdown
}

// ---------------------------------------------------------------------------
// Markdown cleaning

interface Segment {
  fence: boolean
  text: string
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** Split Markdown into fenced code blocks and the text between them. */
export function splitFences(markdown: string): Segment[] {
  const lines = markdown.split(/\r?\n/)
  const segments: Segment[] = []
  let text: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE_OPEN)
    if (!open) {
      text.push(lines[i])
      continue
    }
    let close = i + 1
    while (close < lines.length && !(!/^ {4}/.test(lines[close]) && lines[close].trimStart().startsWith(open[1])))
      close++
    if (close >= lines.length) {
      text.push(...lines.slice(i))
      break
    }
    if (text.length)
      segments.push({ fence: false, text: text.join('\n') })
    text = []
    segments.push({ fence: true, text: lines.slice(i, close + 1).join('\n') })
    i = close
  }
  if (text.length)
    segments.push({ fence: false, text: text.join('\n') })
  return segments
}

const MAGIC_MOVE_BLOCK = /^ {0,3}(`{4,})(?:md|markdown)[ \t]+magic-move[^\r\n]*\r?\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm
const SNIPPET_IMPORT = /^<<<[ \t]+(\S+?)(?:#(\S+?))?(?:[ \t]+(\{[^\r\n]*\}))?[ \t]*(?:\r?\n|$)/gm

function snippetLanguage(path: string): string {
  const ext = extname(path).slice(1).toLowerCase()
  return { kt: 'kotlin', kts: 'kts', md: 'markdown', yml: 'yaml', sh: 'bash', mjs: 'js', cjs: 'js' }[ext] ?? ext
}

function snippetRegion(source: string, region: string): string {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex(line => new RegExp(`^\\s*(?://|#|<!--)\\s*#?region\\s+${region}\\b`).test(line))
  if (start < 0)
    return source
  const end = lines.findIndex((line, index) => index > start && /^\s*(?:\/\/|#|<!--)\s*#?endregion\b/.test(line))
  return lines.slice(start + 1, end < 0 ? lines.length : end).join('\n')
}

/** Inline `<<< @/path#region` snippet imports as ordinary fences. */
export function expandSnippetImports(markdown: string, ctx: CleanContext): string {
  return markdown.replace(SNIPPET_IMPORT, (line, path: string, region: string | undefined) => {
    const source = ctx.loadSnippet?.(path)
    if (source === undefined)
      return line
    const code = (region ? snippetRegion(source, region) : source).replace(/\s+$/, '')
    return `\`\`\`${snippetLanguage(path)}\n${code}\n\`\`\`\n`
  })
}

/** Replace classic ````md magic-move```` blocks with their steps. */
export function expandMagicMoveBlocks(markdown: string): string {
  return markdown.replace(MAGIC_MOVE_BLOCK, (_, __, body: string) => body)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Decode the entities an attribute value needs in slide markup (`&quot;` for a quote in `text`). */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#')
      return String.fromCodePoint(body[1].toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1)))
    return ENTITIES[body.toLowerCase()] ?? entity
  })
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of raw.matchAll(/([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g)) {
    const name = match[1].replace(/^:/, '')
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

const INLINE_CODE = /`[^`\r\n]+`/g

/** Run `fn` over the text outside inline code spans. */
function outsideInlineCode(text: string, fn: (text: string) => string): string {
  const spans: string[] = []
  const protectedText = text.replace(INLINE_CODE, (span) => {
    spans.push(span)
    return `\u0000${spans.length - 1}\u0000`
  })
  return fn(protectedText).replace(/\u0000(\d+)\u0000/g, (_, index) => spans[Number(index)])
}

function annotationNote(raw: string): string {
  const { text, label } = parseAttributes(raw)
  if (!label)
    return ''
  const target = text ? `**\`${text.replace(/`/g, '')}\`** — ` : ''
  return `\n\n> ${target}${label.replace(/\r?\n/g, ' ')}\n\n`
}

function compilerErrorNote(raw: string): string {
  const { text, message } = parseAttributes(raw)
  const diagnostic = (message || '').replace(/\s+/g, ' ').trim()
  if (!diagnostic)
    return ''
  const target = text ? ` at \`${text.replace(/`/g, '')}\`` : ''
  return `\n\n> ⚠ **Compiler error**${target}: ${diagnostic}\n\n`
}

// Attribute lists may hold `<` and `>` inside quotes (`text="Column<Long>"`),
// so a tag ends at the first `>` outside a quoted value.
const ATTRIBUTES = String.raw`((?:"[^"]*"|'[^']*'|[^>"'])*)`

/**
 * Translate the theme's components into Markdown notes and drop the wrappers
 * that only exist for the slide. This runs on the whole slide, before fences
 * are split off, because an `InlineCompilerError` wraps the fence it marks.
 */
export function translateComponents(content: string): string {
  return content
    .replace(new RegExp(`<DrawnAnnotation\\b${ATTRIBUTES}/?>`, 'g'), (_, raw) => annotationNote(raw))
    .replace(/<\/DrawnAnnotation>/g, '')
    .replace(new RegExp(`<InlineCompilerError\\b${ATTRIBUTES}/?>`, 'g'), (_, raw) => compilerErrorNote(raw))
    .replace(/<\/InlineCompilerError>/g, '')
    .replace(new RegExp(`<(?:Kodee|KodeeWrapper)\\b${ATTRIBUTES}/?>`, 'g'), '')
    .replace(/<\/(?:Kodee|KodeeWrapper)>/g, '')
}

const ATX_HEADING = /^( {0,3})(#{1,6})(?=[ \t]|$)/gm

/**
 * Move every ATX heading outside a fence `by` levels down the outline, never
 * past `######`. The slide Markdown keeps its headings relative to the
 * slide's title (level 1); the handout and `llms-full.txt` print that title
 * at different depths and shift the content to match.
 */
export function shiftHeadings(markdown: string, by: number): string {
  if (by <= 0)
    return markdown
  return splitFences(markdown)
    .map(segment => segment.fence
      ? segment.text
      : segment.text.replace(ATX_HEADING, (_, indent: string, hashes: string) => `${indent}${'#'.repeat(Math.min(6, hashes.length + by))}`))
    .join('\n')
}

/**
 * Put a slide's headings below its title: a second level-one heading on the
 * slide (a kicker, a second `#`) becomes `##`, so nothing in the content
 * outranks the title the handout prints for the slide.
 */
function demoteBelowTitle(text: string): string {
  return text.replace(/^( {0,3})#(?=[ \t]|$)/gm, '$1##')
}

/** Translate theme and Slidev markup in prose to plain Markdown. */
export function cleanProse(text: string, base: string): string {
  let result = translateComponents(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
  result = outsideInlineCode(result, prose => prose
    .replace(/<\/?[A-Za-z][^<>]*>/g, '')
    .replace(/\]\((?!\/\/)\/(?!\/)/g, `](${base}`))
  return result.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Render a parsed fence back to Markdown, with its caption. */
function fenceMarkdown(fence: ParsedFence): string {
  const caption = fenceCaption(fence)
  return `${caption ? `**${caption}**\n\n` : ''}\`\`\`${fence.lang}\n${fence.code}\n\`\`\``
}

const IDENTITY_LABELS: Record<string, string> = {
  kotlin: 'Kotlin',
  gradle: 'Gradle',
  amper: 'Amper',
  java: 'Java',
  terminal: 'Terminal',
  maven: 'Maven',
  postgresql: 'PostgreSQL',
  jdbc: 'JDBC',
  r2dbc: 'R2DBC',
}

/** The fence's identity (JDBC, Gradle, …) and `[title]`, joined for a caption. */
export function fenceCaption(fence: ParsedFence): string {
  const icon = codeWindowIcon(fence.lang, fence.meta)
  const identity = icon && icon !== 'kotlin' && icon !== 'postgresql' ? IDENTITY_LABELS[icon] : undefined
  return [identity, fence.title].filter(Boolean).join(' · ')
}

export function parseFenceBlock(block: string): ParsedFence {
  const lines = block.split(/\r?\n/)
  const info = lines[0].replace(/^ {0,3}(`{3,}|~{3,})/, '').trim()
  return parseFenceInfo(info, lines.slice(1, -1).join('\n'), { foldImports: false })
}

/**
 * Turn one slide's Markdown into plain Markdown: snippet imports inlined,
 * Magic Move blocks expanded, components translated, fences reduced to
 * `lang` plus code with a caption for their title or identity, and every
 * heading placed below the slide's title (see `demoteBelowTitle`).
 */
export function cleanSlideMarkdown(content: string, ctx: CleanContext): string {
  const expanded = translateComponents(expandMagicMoveBlocks(expandSnippetImports(content, ctx)))
  return splitFences(expanded)
    .map(segment => segment.fence
      ? fenceMarkdown(parseFenceBlock(segment.text))
      : demoteBelowTitle(cleanProse(segment.text, ctx.base)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---------------------------------------------------------------------------
// Rendering

export interface DeckInfo {
  title: string
  description: string
  /** `lang` from the headmatter, `en` when unset; the handout's `<html lang>`. */
  lang: string
  /** GoatCounter endpoint (`themeConfig.analytics.goatcounter`), when the deck counts pageviews. */
  analytics?: string
  /** URL of the deck root: `siteUrl` when configured, else the base path. */
  root: string
  /** Whether the deck routes by hash (`#/12`) or by path (`/12`). */
  hashRouter: boolean
  generatedAt: Date
}

export function slideUrl(deck: DeckInfo, no: number): string {
  return `${deck.root}${deck.hashRouter ? '#/' : ''}${no}`
}

export function sectionUrl(deck: DeckInfo, section: HandoutSection): string {
  return `${deck.root}handout/${section.slug === 'index' ? '' : `${section.slug}.html`}`
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export type Highlighter = (code: string, lang: string) => Promise<string | undefined>

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false })

/** Render a fence as a `<figure>` with an optional caption. */
export async function renderFence(fence: ParsedFence, highlight: Highlighter | undefined): Promise<string> {
  const caption = fenceCaption(fence)
  let code = await highlight?.(fence.code, fence.lang).catch(() => undefined)
  if (code)
    code = code.replace(/<code(?![^>]*\bclass=)/, `<code class="language-${escapeHtml(fence.lang)}"`)
  else
    code = `<pre><code class="language-${escapeHtml(fence.lang)}">${escapeHtml(fence.code)}</code></pre>`
  return `<figure class="code">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}${code}</figure>`
}

/** Render cleaned slide Markdown to HTML, highlighting fences. */
export async function renderMarkdown(source: string, highlight: Highlighter | undefined): Promise<string> {
  const fences: Promise<string>[] = []
  const withPlaceholders = splitFences(source).map((segment) => {
    if (!segment.fence)
      return segment.text
    fences.push(renderFence(parseFenceBlock(segment.text), highlight))
    return `\n\n%%FENCE-${fences.length - 1}%%\n\n`
  }).join('\n\n')
  const rendered = await Promise.all(fences)
  return markdown.render(withPlaceholders)
    .replace(/<p>%%FENCE-(\d+)%%<\/p>/g, (_, index) => rendered[Number(index)])
    .trim()
}

const HANDOUT_CSS = `
:root { color-scheme: light dark; --fg: #1a1a1a; --muted: #5c5c5c; --bg: #ffffff; --panel: #f6f7f9; --line: #e2e4e8; --accent: #7f52ff; --quote: #fbf6e6; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6e6e6; --muted: #a0a4ab; --bg: #16171a; --panel: #1f2126; --line: #30333a; --accent: #b39cff; --quote: #2a2618; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.6 "JetBrains Sans", Inter, system-ui, sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
header.site { border-bottom: 1px solid var(--line); background: var(--panel); }
header.site nav { max-width: 52rem; margin: 0 auto; padding: 0.75rem 1.25rem; display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; font-size: 0.9rem; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 0.5rem; }
h1 + p.lead { color: var(--muted); margin-top: 0; font-size: 1.05rem; }
section.slide { padding: 1.75rem 0; border-top: 1px solid var(--line); }
section.slide h2 { font-size: 1.35rem; margin: 0 0 0.75rem; display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap; }
section.slide h2 a.deep-link { font-size: 0.8rem; font-weight: 500; color: var(--muted); white-space: nowrap; }
section.slide h2 a.deep-link:hover { color: var(--accent); }
figure.code { margin: 1rem 0; }
figure.code figcaption { font: 600 0.75rem/1 "JetBrains Sans", Inter, system-ui, sans-serif; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.4rem; }
pre { margin: 0; padding: 0.9rem 1.1rem; overflow-x: auto; border: 1px solid var(--line); border-radius: 0.5rem; background: var(--panel); font: 0.88rem/1.55 "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
pre.shiki { background: var(--shiki-light-bg, var(--panel)) !important; }
@media (prefers-color-scheme: dark) { pre.shiki { background: var(--shiki-dark-bg, var(--panel)) !important; } pre.shiki span { color: var(--shiki-dark) !important; } }
code { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
:not(pre) > code { font-size: 0.9em; padding: 0.1em 0.35em; border-radius: 0.3em; background: var(--panel); }
blockquote { margin: 1rem 0; padding: 0.6rem 1rem; border-left: 3px solid var(--accent); background: var(--quote); border-radius: 0 0.4rem 0.4rem 0; }
blockquote p { margin: 0.25rem 0; }
aside.notes { margin-top: 1rem; padding: 0.75rem 1rem; border: 1px dashed var(--line); border-radius: 0.5rem; color: var(--muted); font-size: 0.95rem; }
aside.notes strong { color: var(--fg); }
ol.toc { padding-left: 1.5rem; }
ol.toc li { margin: 0.35rem 0; }
ol.toc ul { padding-left: 1.25rem; color: var(--muted); font-size: 0.95rem; }
nav.pager { display: flex; justify-content: space-between; gap: 1rem; margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--line); font-size: 0.95rem; }
footer { margin-top: 3rem; color: var(--muted); font-size: 0.85rem; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; }
td, th { border: 1px solid var(--line); padding: 0.3rem 0.6rem; }
`

interface PageOptions {
  deck: DeckInfo
  title: string
  description: string
  canonical: string
  body: string
  breadcrumbs: { href: string, label: string }[]
}

function pageShell({ deck, title, description, canonical, body, breadcrumbs }: PageOptions): string {
  const nav = breadcrumbs.map(({ href, label }) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join('')
  return `<!DOCTYPE html>
<html lang="${escapeHtml(deck.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:site_name" content="${escapeHtml(deck.title)}">
<link rel="alternate" type="text/markdown" title="Full text for language models" href="${escapeHtml(`${deck.root}llms-full.txt`)}">
<meta name="generator" content="slidev-theme-kotlin">
${deck.analytics ? `${goatcounterTag(deck.analytics, false)}\n` : ''}<style>${HANDOUT_CSS}</style>
</head>
<body>
<header class="site"><nav>${nav}</nav></header>
<main>
${body}
<footer>Generated from the slides on ${deck.generatedAt.toISOString().slice(0, 10)}. Every section links back to the live slide it was written for.</footer>
</main>
</body>
</html>
`
}

function slideSection(deck: DeckInfo, slide: HandoutSlide, html: string, notes: boolean): string {
  const note = notes && slide.note
    ? `<aside class="notes"><strong>Speaker notes</strong> ${markdown.renderInline(slide.note)}</aside>`
    : ''
  return `<section class="slide" id="slide-${slide.no}">
<h2>${escapeHtml(slide.title)} <a class="deep-link" href="${escapeHtml(slideUrl(deck, slide.no))}">slide ${slide.no} ↗</a></h2>
${html}${note}
</section>`
}

/** The section pages and, for a multi-section deck, the index page. */
export async function renderHandout(deck: DeckInfo, sections: HandoutSection[], highlight: Highlighter | undefined, notes: boolean): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const deckCrumb = { href: deck.root, label: `▶ ${deck.title}` }
  const indexCrumb = { href: `${deck.root}handout/`, label: 'Handout' }

  for (const [index, section] of sections.entries()) {
    // Slide titles are `<h2>`: content headings start at `<h3>`.
    const slides = await Promise.all(section.slides.map(async slide =>
      slideSection(deck, slide, await renderMarkdown(shiftHeadings(slide.markdown, 1), highlight), notes)))
    const previous = sections[index - 1]
    const next = sections[index + 1]
    const pager = sections.length > 1
      ? `<nav class="pager"><span>${previous ? `<a href="${escapeHtml(sectionUrl(deck, previous))}">← ${escapeHtml(previous.title)}</a>` : ''}</span><span>${next ? `<a href="${escapeHtml(sectionUrl(deck, next))}">${escapeHtml(next.title)} →</a>` : ''}</span></nav>`
      : ''
    const single = sections.length === 1
    const body = `<h1>${escapeHtml(single ? deck.title : section.title)}</h1>
${single
  ? `<p class="lead">${escapeHtml(deck.description || 'The full text and code of the slides.')} <a href="${escapeHtml(deck.root)}">Open the presentation</a>.</p>`
  : `<p class="lead">Part of <a href="${escapeHtml(deck.root)}">${escapeHtml(deck.title)}</a>. Slides ${section.slides[0]?.no}–${section.slides.at(-1)?.no}.</p>`}
${slides.join('\n')}
${pager}`
    files[`handout/${section.slug}.html`] = pageShell({
      deck,
      title: single ? deck.title : `${section.title} · ${deck.title}`,
      description: deck.description || `${section.title} — ${deck.title}`,
      canonical: sectionUrl(deck, section),
      body,
      breadcrumbs: single ? [deckCrumb] : [deckCrumb, indexCrumb],
    })
  }

  if (sections.length > 1) {
    const toc = sections.map(section => `<li><a href="${escapeHtml(sectionUrl(deck, section))}">${escapeHtml(section.title)}</a><ul>${
      section.slides.map(slide => `<li><a href="${escapeHtml(`${sectionUrl(deck, section)}#slide-${slide.no}`)}">${escapeHtml(slide.title)}</a></li>`).join('')
    }</ul></li>`).join('\n')
    files['handout/index.html'] = pageShell({
      deck,
      title: deck.title,
      description: deck.description || deck.title,
      canonical: `${deck.root}handout/`,
      body: `<h1>${escapeHtml(deck.title)}</h1>\n${deck.description ? `<p class="lead">${escapeHtml(deck.description)}</p>` : ''}\n<p>The full text and code of <a href="${escapeHtml(deck.root)}">the slides</a>, one page per section.</p>\n<ol class="toc">\n${toc}\n</ol>`,
      breadcrumbs: [deckCrumb],
    })
  }
  return files
}

/** llms.txt: the index that points language models at the full text. */
export function renderLlmsTxt(deck: DeckInfo, sections: HandoutSection[]): string {
  const lines = [`# ${deck.title}`, '']
  if (deck.description)
    lines.push(`> ${deck.description}`, '')
  lines.push(
    `The text and code of a slide deck. The presentation itself is at ${deck.root} and needs JavaScript; the pages below are its static handout, and \`llms-full.txt\` holds everything in one Markdown file.`,
    '',
    '## Sections',
    '',
  )
  for (const section of sections) {
    // Chains repeat a title across slides; list each once.
    const titles = [...new Set(section.slides.map(slide => slide.title).filter(title => !/^Slide \d+$/.test(title)))]
    lines.push(`- [${section.title}](${sectionUrl(deck, section)})${titles.length ? `: ${titles.slice(0, 8).join(', ')}${titles.length > 8 ? ', …' : ''}` : ''}`)
  }
  lines.push('', '## Optional', '', `- [Full text](${deck.root}llms-full.txt): every slide as Markdown, with complete code snippets`)
  return `${lines.join('\n')}\n`
}

/**
 * llms-full.txt: every slide as Markdown, in one outline: the deck, then
 * (for a multi-section deck) each section, then each slide, with the
 * slide's own headings below its title. A slide titled like the heading
 * above it (a section's title slide, the deck's cover) is not repeated.
 */
export function renderLlmsFullTxt(deck: DeckInfo, sections: HandoutSection[], notes: boolean): string {
  const lines = [`# ${deck.title}`, '']
  if (deck.description)
    lines.push(`> ${deck.description}`, '')
  lines.push(`Source: ${deck.root}`, '')
  const multi = sections.length > 1
  const slideDepth = multi ? 3 : 2
  for (const section of sections) {
    if (multi)
      lines.push(`## ${section.title}`, '')
    const parentTitle = multi ? section.title : deck.title
    for (const [index, slide] of section.slides.entries()) {
      if (!(index === 0 && slide.title === parentTitle))
        lines.push(`${'#'.repeat(slideDepth)} ${slide.title}`, '')
      lines.push(`Slide ${slide.no}: ${slideUrl(deck, slide.no)}`, '')
      if (slide.markdown)
        lines.push(shiftHeadings(slide.markdown, slideDepth - 1), '')
      if (notes && slide.note)
        lines.push(`> Speaker notes: ${slide.note.replace(/\s+/g, ' ')}`, '')
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

export function renderSitemap(deck: DeckInfo, sections: HandoutSection[]): string {
  const lastmod = deck.generatedAt.toISOString().slice(0, 10)
  const urls = [deck.root, ...(sections.length > 1 ? [`${deck.root}handout/`] : []), ...sections.map(section => sectionUrl(deck, section))]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url><loc>${escapeHtml(url)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
</urlset>
`
}

// ---------------------------------------------------------------------------
// Plugin

/** Plain-text description from Slidev's `seoMeta.ogDescription` or `info` (Markdown). */
export function deckDescription(config: { info?: string | boolean, seoMeta?: { ogDescription?: string } }): string {
  const seo = config.seoMeta?.ogDescription?.trim()
  if (seo)
    return seo
  if (typeof config.info !== 'string')
    return ''
  return config.info
    .split(/\n\s*\n/)[0]
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Build every static file for `options` and return them keyed by output
 * path. `base` is Vite's resolved base; `now` fixes the timestamp for tests.
 */
export async function buildStaticContent(options: ResolvedSlidevOptions, base: string, now = new Date()): Promise<Record<string, string>> {
  const settings = resolveStaticContentSettings(options.data.config.themeConfig)
  const config = options.data.config
  const lang = options.data.headmatter.lang
  const deck: DeckInfo = {
    title: config.title || options.data.headmatter.title as string || 'Slides',
    description: deckDescription(config),
    lang: typeof lang === 'string' && lang.trim() ? lang.trim() : 'en',
    analytics: resolveAnalyticsSettings(config.themeConfig)?.goatcounter,
    root: settings.siteUrl ?? base,
    hashRouter: config.routerMode === 'hash',
    generatedAt: now,
  }
  const loadSnippet = (path: string) => {
    const file = path.startsWith('@/') ? resolve(options.userRoot, path.slice(2)) : resolve(options.userRoot, path)
    if (!existsSync(file))
      return undefined
    return readFileSync(file, 'utf-8')
  }
  const sections = collectSections(options.data.slides, options.userRoot, deck.title, { base, loadSnippet })

  const { shiki, shikiOptions } = options.utils
  const themes = (shikiOptions as { themes?: unknown }).themes
  const highlight: Highlighter | undefined = shiki
    ? async (code, lang) => shiki.codeToHtml(code, {
        lang,
        ...(themes ? { themes, defaultColor: 'light' } : { theme: (shikiOptions as { theme?: string }).theme ?? 'vitesse-light' }),
      } as any)
    : undefined

  const files = await renderHandout(deck, sections, highlight, settings.notes)
  files['llms.txt'] = renderLlmsTxt(deck, sections)
  files['llms-full.txt'] = renderLlmsFullTxt(deck, sections, settings.notes)
  if (settings.siteUrl) {
    files['sitemap.xml'] = renderSitemap(deck, sections)
    // Crawlers read robots.txt at the root of the host only, so the file is
    // pointless (and misleading) for a deck served from a sub-path.
    if (servedFromHostRoot(settings.siteUrl))
      files['robots.txt'] = `User-agent: *\nAllow: /\n\nSitemap: ${settings.siteUrl}sitemap.xml\n`
  }
  return files
}

/** Whether `siteUrl` is the root of its host (`https://example.com/`, not `https://example.com/deck/`). */
export function servedFromHostRoot(siteUrl: string): boolean {
  try {
    return new URL(siteUrl).pathname === '/'
  }
  catch {
    return false
  }
}

/** The `Sitemap:` line a host's own robots.txt needs for a deck served from a sub-path. */
export function robotsSitemapHint(siteUrl: string): string | undefined {
  if (servedFromHostRoot(siteUrl))
    return undefined
  try {
    return `robots.txt is only read at the root of a host: add \`Sitemap: ${siteUrl}sitemap.xml\` to ${new URL(siteUrl).origin}/robots.txt`
  }
  catch {
    return undefined
  }
}

/** The class of the paragraph `indexHtmlTags` adds to the root page. */
export const STATIC_LINKS_CLASS = 'slidev-theme-kotlin-static-links'

/**
 * Tags that make the built `index.html` describe its static companions.
 *
 * Without JavaScript the deck's root page is empty, so a crawler that lands
 * on it (or on the `404.html` copied from it) would never learn that a
 * handout, `llms-full.txt`, or a sitemap exist. These tags point it there:
 * `rel="alternate"` links in the head, a paragraph at the end of the body
 * with the same links as visible text, a `<meta name="description">` when
 * Slidev's headmatter gives one, and, once the public URL is known, the
 * canonical URL and the sitemap.
 *
 * The paragraph is ordinary markup rather than `<noscript>`: text extractors
 * behind many AI crawlers drop `<noscript>` wholesale, while a paragraph
 * reaches every reader. A stylesheet rule hides it as soon as the app has
 * mounted into `#app`, so a visitor with JavaScript never sees it.
 */
export function indexHtmlTags(deck: Pick<DeckInfo, 'root' | 'description'>, siteUrl: string | undefined): HtmlTagDescriptor[] {
  const handout = `${deck.root}handout/`
  const fullText = `${deck.root}llms-full.txt`
  const tags: HtmlTagDescriptor[] = [
    { tag: 'meta', attrs: { name: 'robots', content: 'index, follow' }, injectTo: 'head' },
  ]
  if (deck.description)
    tags.push({ tag: 'meta', attrs: { name: 'description', content: deck.description }, injectTo: 'head' })
  if (siteUrl) {
    tags.push(
      { tag: 'link', attrs: { rel: 'canonical', href: siteUrl }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'sitemap', type: 'application/xml', title: 'Sitemap', href: `${siteUrl}sitemap.xml` }, injectTo: 'head' },
    )
  }
  tags.push(
    { tag: 'link', attrs: { rel: 'alternate', type: 'text/html', title: 'Handout', href: handout }, injectTo: 'head' },
    { tag: 'link', attrs: { rel: 'alternate', type: 'text/markdown', title: 'Full text for language models', href: fullText }, injectTo: 'head' },
    {
      tag: 'style',
      injectTo: 'head',
      children: `.${STATIC_LINKS_CLASS}{font:14px/1.5 system-ui,sans-serif;margin:1rem}#app:not(:empty)~.${STATIC_LINKS_CLASS}{display:none}`,
    },
    {
      tag: 'p',
      attrs: { class: STATIC_LINKS_CLASS },
      injectTo: 'body',
      children: `This presentation runs as a web app and needs JavaScript. Read the <a href="${escapeHtml(handout)}">handout</a> with every slide's text and code, or the <a href="${escapeHtml(fullText)}">full text as Markdown</a> (see <a href="${escapeHtml(`${deck.root}llms.txt`)}">llms.txt</a>).`,
    },
  )
  return tags
}

/**
 * Drop the `<meta name="description">` Slidev renders from the raw `info`
 * Markdown, so the page carries the theme's plain-text one alone.
 */
export function withoutSlidevDescription(html: string): string {
  return html.replace(/[ \t]*<meta name="description" content="[^"]*"\s*\/?>[ \t]*\r?\n?/g, '')
}

/** Vite plugin writing the static content after a `slidev build`. */
export function staticContentPlugin(options: ResolvedSlidevOptions): Plugin | undefined {
  const settings = resolveStaticContentSettings(options.data.config.themeConfig)
  if (!settings.enabled)
    return undefined
  let outDir = ''
  let base = '/'
  return {
    name: 'slidev-theme-kotlin:static-content',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const deck = { root: settings.siteUrl ?? base, description: deckDescription(options.data.config) }
        return { html: deck.description ? withoutSlidevDescription(html) : html, tags: indexHtmlTags(deck, settings.siteUrl) }
      },
    },
    async closeBundle() {
      const files = await buildStaticContent(options, base)
      for (const [path, content] of Object.entries(files)) {
        const target = resolve(outDir, path)
        // A deck's own public/robots.txt wins over the generated one.
        if (path === 'robots.txt' && existsSync(target))
          continue
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content, 'utf-8')
      }
      console.log(`[slidev-theme-kotlin] static content: ${Object.keys(files).join(', ')}`)
      const hint = settings.siteUrl && robotsSitemapHint(settings.siteUrl)
      if (hint)
        console.log(`[slidev-theme-kotlin] ${hint}`)
    },
  }
}
