import { describe, expect, it } from 'vitest'
import {
  cleanProse,
  cleanSlideMarkdown,
  collectSections,
  deckDescription,
  expandMagicMoveBlocks,
  expandSnippetImports,
  indexHtmlTags,
  renderHandout,
  renderLlmsFullTxt,
  renderLlmsTxt,
  robotsSitemapHint,
  servedFromHostRoot,
  shiftHeadings,
  withoutSlidevDescription,
  renderMarkdown,
  renderSitemap,
  resolveStaticContentSettings,
  sectionUrl,
  slideUrl,
  splitFences,
} from '../setup/static-content'
import type { DeckInfo, HandoutSection } from '../setup/static-content'

const base = '/deck/'
const ctx = { base }

describe('resolveStaticContentSettings', () => {
  it('is on by default without a site URL', () => {
    expect(resolveStaticContentSettings(undefined)).toEqual({ enabled: true, siteUrl: undefined, notes: true })
  })

  it('reads siteUrl and normalises its trailing slash', () => {
    expect(resolveStaticContentSettings({ siteUrl: 'https://example.com/deck' }).siteUrl).toBe('https://example.com/deck/')
    expect(resolveStaticContentSettings({ handout: { siteUrl: 'https://example.com/deck/' } }).siteUrl).toBe('https://example.com/deck/')
  })

  it('can be disabled, and notes can be left out', () => {
    expect(resolveStaticContentSettings({ handout: false }).enabled).toBe(false)
    expect(resolveStaticContentSettings({ handout: { notes: false } })).toMatchObject({ enabled: true, notes: false })
  })
})

describe('splitFences', () => {
  it('separates fenced code from prose', () => {
    const segments = splitFences('# A\n\n```kotlin\nval x = 1\n```\n\nafter')
    expect(segments).toEqual([
      { fence: false, text: '# A\n' },
      { fence: true, text: '```kotlin\nval x = 1\n```' },
      { fence: false, text: '\nafter' },
    ])
  })

  it('keeps nested fences inside a four-backtick block together', () => {
    const segments = splitFences('````md\n```kotlin\nval x = 1\n```\n````')
    expect(segments).toEqual([{ fence: true, text: '````md\n```kotlin\nval x = 1\n```\n````' }])
  })

  it('treats an unclosed fence as prose', () => {
    expect(splitFences('```kotlin\nval x = 1')).toEqual([{ fence: false, text: '```kotlin\nval x = 1' }])
  })
})

describe('expandMagicMoveBlocks', () => {
  it('replaces the block with its steps', () => {
    const source = '````md magic-move {lines:true}\n```kotlin\nval a = 1\n```\n```kotlin\nval a = 2\n```\n````'
    expect(expandMagicMoveBlocks(source)).toBe('```kotlin\nval a = 1\n```\n```kotlin\nval a = 2\n```\n')
  })
})

describe('expandSnippetImports', () => {
  const files: Record<string, string> = {
    '@/src/Main.kt': 'package demo\n\n// #region hello\nfun hello() = "hi"\n// #endregion\n\nfun other() = 1\n',
  }
  const load = (path: string) => files[path]

  it('inlines a whole file as a fence', () => {
    expect(expandSnippetImports('<<< @/src/Main.kt\n', { base, loadSnippet: load }))
      .toBe('```kotlin\npackage demo\n\n// #region hello\nfun hello() = "hi"\n// #endregion\n\nfun other() = 1\n```\n')
  })

  it('inlines a region and drops the meta', () => {
    expect(expandSnippetImports('<<< @/src/Main.kt#hello {1}\n', { base, loadSnippet: load }))
      .toBe('```kotlin\nfun hello() = "hi"\n```\n')
  })

  it('leaves an unresolvable import in place', () => {
    expect(expandSnippetImports('<<< @/missing.kt\n', { base, loadSnippet: load })).toBe('<<< @/missing.kt\n')
    expect(expandSnippetImports('<<< @/missing.kt\n', ctx)).toBe('<<< @/missing.kt\n')
  })
})

describe('cleanProse', () => {
  it('turns an annotation label into a note and drops bare marks', () => {
    const prose = '<DrawnAnnotation text="selectAll()" color="red" />\n<DrawnAnnotation text="where" label="Filters **rows**" :connect="false" />'
    expect(cleanProse(prose, base)).toBe('> **`where`** — Filters **rows**')
  })

  it('decodes entities in attribute values', () => {
    const prose = '<DrawnAnnotation text="Table(&quot;profiles&quot;)" label="Lower &amp; plural" />'
    expect(cleanProse(prose, base)).toBe('> **`Table("profiles")`** — Lower & plural')
  })

  it('renders a compiler error with its target', () => {
    const prose = '<InlineCompilerError text="Talks.id" message="Unresolved reference: id" at="1" />'
    expect(cleanProse(prose, base)).toBe('> ⚠ **Compiler error** at `Talks.id`: Unresolved reference: id')
  })

  it('translates the code highlights and keeps generics in their attributes', () => {
    const prose = [
      '<Warning text="names: List<String>" message="Unused parameter" :on="1" />',
      '<SmartCast text="name" />',
      '<SmartCast text="name" message="Smart cast to `String`" />',
      '<TypeHint :line="2" receiver="HTML" />',
      '<TypeHint :line="3" context="Clock" />',
      '<InlineValue text="numbers" value="List<Int> = [1, 2]" />',
    ].join('\n')
    expect(cleanProse(prose, base)).toBe([
      '> **Warning** at `names: List<String>`: Unused parameter',
      '> **Smart cast** at `name`: Smart cast to `String`',
      '> **Type hint** `this: HTML`',
      '> **Type hint** `context(Clock)`',
      '> **Inline value** `numbers`: `List<Int> = [1, 2]`',
    ].join('\n\n'))
  })

  it('keeps generics inside attribute values', () => {
    const prose = '<DrawnAnnotation text="Column<Long>" label="Every column is typed" />\n<DrawnAnnotation text="IdTable<Long>" color="red" />'
    expect(cleanProse(prose, base)).toBe('> **`Column<Long>`** — Every column is typed')
  })

  it('removes comments, Kodee, and click wrappers but keeps their content', () => {
    const prose = '<!-- note -->\n<Kodee variant="wave" />\n<v-clicks>\n\n- one\n- two\n\n</v-clicks>\n<div class="grid">\n\ntext\n\n</div>'
    expect(cleanProse(prose, base)).toBe('- one\n- two\n\ntext')
  })

  it('keeps generics inside inline code', () => {
    expect(cleanProse('Returns `Flow<ResultRow>` <span>now</span>', base)).toBe('Returns `Flow<ResultRow>` now')
  })

  it('prefixes root-absolute links and images with the base', () => {
    expect(cleanProse('![logo](/logo.svg) and [docs](/docs) but [ext](//cdn/x)', base))
      .toBe('![logo](/deck/logo.svg) and [docs](/deck/docs) but [ext](//cdn/x)')
  })
})

describe('cleanSlideMarkdown', () => {
  it('translates a compiler error that wraps a fence', () => {
    const content = '<InlineCompilerError text="previews" occurrence=2 message="No context argument found">\n\n```kotlin\nfun example() = previews()\n```\n\n</InlineCompilerError>'
    expect(cleanSlideMarkdown(content, ctx)).toBe('> ⚠ **Compiler error** at `previews`: No context argument found\n\n```kotlin\nfun example() = previews()\n```')
  })


  it('captions fences by identity and title, and keeps imports in the code', () => {
    const content = '```kotlin jdbc [Talks.kt] {1|2-3}\nimport a.A\n\nval x = A()\n```\n\n```sql\nSELECT 1\n```'
    expect(cleanSlideMarkdown(content, ctx)).toBe(
      '**JDBC · Talks.kt**\n\n```kotlin\nimport a.A\n\nval x = A()\n```\n\n```sql\nSELECT 1\n```',
    )
  })

  it('puts every heading below the slide title and leaves fences alone', () => {
    const content = '## Kicker\n\n# Title\n\n# Another\n\n### Deep\n\n```yaml\n# not a heading\n```'
    expect(cleanSlideMarkdown(content, ctx)).toBe('## Kicker\n\n## Title\n\n## Another\n\n### Deep\n\n```yaml\n# not a heading\n```')
  })

  it('does not caption plain Kotlin or SQL fences', () => {
    expect(cleanSlideMarkdown('```kts gradle\nplugins {}\n```', ctx)).toBe('**Gradle**\n\n```kts\nplugins {}\n```')
    expect(cleanSlideMarkdown('```kotlin\nval x = 1\n```', ctx)).toBe('```kotlin\nval x = 1\n```')
  })
})

const slide = (index: number, filepath: string, title: string | undefined, content: string, note?: string) =>
  ({ index, title, content, note, frontmatter: {}, source: { filepath } })

describe('collectSections', () => {
  const root = '/deck'

  it('groups slides by source file, in order, and titles the entry section after the deck', () => {
    const sections = collectSections([
      slide(0, '/deck/slides.md', 'My Deck', '# My Deck\n\nWelcome'),
      slide(1, '/deck/lessons/lesson-1.md', 'Lesson 1', '# Lesson 1'),
      slide(2, '/deck/lessons/lesson-1.md', 'Tables', '# Tables\n\n```kotlin\nobject T : Table()\n```'),
      slide(3, '/deck/lessons/closing.md', 'Thanks', '# Thanks'),
    ], root, 'My Deck', ctx)
    expect(sections.map(section => [section.slug, section.title, section.slides.map(s => s.no)])).toEqual([
      ['slides', 'My Deck', [1]],
      ['lesson-1', 'Lesson 1', [2, 3]],
      ['closing', 'Thanks', [4]],
    ])
    expect(sections[1].slides[1].markdown).toBe('```kotlin\nobject T : Table()\n```')
    expect(sections[0].slides[0].markdown).toBe('Welcome')
  })

  it('strips inline HTML from titles and drops the matching heading', () => {
    const [section] = collectSections([slide(0, '/deck/slides.md', '<span color="#f59e0b">JDBC</span> ~ <span>R2DBC</span>', '# <span color="#f59e0b">JDBC</span> ~ <span>R2DBC</span>\n\n> Same code')], root, 'Deck', ctx)
    expect(section.slides[0].title).toBe('JDBC ~ R2DBC')
    expect(section.slides[0].markdown).toBe('> Same code')
  })

  it('drops the title heading even below a kicker', () => {
    const [section] = collectSections([slide(0, '/deck/slides.md', 'SQL DSL', '<div class="lesson-number">Topic 2</div>\n\n# SQL DSL\n\n## Write queries deliberately')], root, 'Deck', ctx)
    expect(section.slides[0].markdown).toBe('Topic 2\n\n## Write queries deliberately')
  })

  it('uses a single index section for a single-file deck', () => {
    const sections = collectSections([slide(0, '/deck/slides.md', 'Only', 'x')], root, 'Only', ctx)
    expect(sections).toHaveLength(1)
    expect(sections[0].slug).toBe('index')
  })

  it('falls back to slide numbers for untitled slides', () => {
    const [section] = collectSections([slide(4, '/deck/slides.md', undefined, 'no heading')], root, 'Deck', ctx)
    expect(section.slides[0].title).toBe('Slide 5')
    expect(section.slides[0].markdown).toBe('no heading')
  })
})

describe('shiftHeadings', () => {
  it('moves headings down the outline outside fences, capped at six', () => {
    expect(shiftHeadings('## Sub\n\n```sh\n## keep\n```\n\n###### Six\n#no', 2)).toBe('#### Sub\n\n```sh\n## keep\n```\n\n###### Six\n#no')
    expect(shiftHeadings('## Sub', 0)).toBe('## Sub')
  })
})

const deck: DeckInfo = {
  title: 'Exposed Fundamentals',
  description: 'From relational model to Kotlin queries',
  lang: 'en',
  root: 'https://example.com/deck/',
  hashRouter: true,
  generatedAt: new Date('2026-09-03T00:00:00Z'),
}

const sections: HandoutSection[] = [
  { slug: 'slides', title: 'Exposed Fundamentals', file: 'slides.md', slides: [{ no: 1, title: 'Exposed Fundamentals', markdown: 'Welcome' }] },
  { slug: 'lesson-1', title: 'Lesson 1', file: 'lessons/lesson-1.md', slides: [
    { no: 2, title: 'Tables', markdown: '## Columns\n\n```kotlin\nobject Talks : Table()\n```', note: 'Mention *DSL*' },
  ] },
]

describe('urls', () => {
  it('links slides by hash or path', () => {
    expect(slideUrl(deck, 12)).toBe('https://example.com/deck/#/12')
    expect(slideUrl({ ...deck, hashRouter: false }, 12)).toBe('https://example.com/deck/12')
  })

  it('links sections under handout/', () => {
    expect(sectionUrl(deck, sections[1])).toBe('https://example.com/deck/handout/lesson-1.html')
    expect(sectionUrl(deck, { ...sections[1], slug: 'index' })).toBe('https://example.com/deck/handout/')
  })
})

describe('renderMarkdown', () => {
  it('renders fences through the highlighter with a language class', async () => {
    const html = await renderMarkdown('Text\n\n```kotlin\nval x = 1\n```', async (code, lang) => `<pre class="shiki"><code>${lang}:${code}</code></pre>`)
    expect(html).toBe('<p>Text</p>\n<figure class="code"><pre class="shiki"><code class="language-kotlin">kotlin:val x = 1</code></pre></figure>')
  })

  it('falls back to escaped plain code', async () => {
    const html = await renderMarkdown('```sql\nSELECT * FROM t WHERE a < b\n```', undefined)
    expect(html).toBe('<figure class="code"><pre><code class="language-sql">SELECT * FROM t WHERE a &lt; b</code></pre></figure>')
  })

  it('escapes stray HTML in prose', async () => {
    expect(await renderMarkdown('a <b>bold</b>', undefined)).toBe('<p>a &lt;b&gt;bold&lt;/b&gt;</p>')
  })
})

describe('renderHandout', () => {
  it('writes one page per section plus an index for multi-section decks', async () => {
    const files = await renderHandout(deck, sections, undefined, true)
    expect(Object.keys(files).sort()).toEqual(['handout/index.html', 'handout/lesson-1.html', 'handout/slides.html'])
    const lesson = files['handout/lesson-1.html']
    expect(lesson).toContain('<title>Lesson 1 · Exposed Fundamentals</title>')
    expect(lesson).toContain('<link rel="canonical" href="https://example.com/deck/handout/lesson-1.html">')
    expect(lesson).toContain('<section class="slide" id="slide-2">')
    expect(lesson).toContain('href="https://example.com/deck/#/2">slide 2 ↗</a>')
    expect(lesson).toContain('<code class="language-kotlin">object Talks : Table()</code>')
    // Slide titles are h2, so a slide's own `##` renders one level below.
    expect(lesson).toContain('<h3>Columns</h3>')
    expect(lesson).not.toContain('<h2>Columns</h2>')
    expect(lesson).toContain('<html lang="en">')
    expect(lesson).toContain('<meta property="og:type" content="article">')
    expect(lesson).toContain('<meta property="og:title" content="Lesson 1 · Exposed Fundamentals">')
    expect(lesson).toContain('<meta property="og:url" content="https://example.com/deck/handout/lesson-1.html">')
    expect(lesson).toContain('<meta property="og:site_name" content="Exposed Fundamentals">')
    expect(lesson).toContain('<strong>Speaker notes</strong> Mention <em>DSL</em>')
    expect(lesson).toContain('← Exposed Fundamentals')
    expect(files['handout/index.html']).toContain('href="https://example.com/deck/handout/lesson-1.html#slide-2">Tables</a>')
  })

  it('leaves notes out on request and uses a single page for one section', async () => {
    const files = await renderHandout(deck, [sections[1]], undefined, false)
    expect(Object.keys(files)).toEqual(['handout/lesson-1.html'])
    expect(files['handout/lesson-1.html']).not.toContain('Speaker notes')
    expect(files['handout/lesson-1.html']).toContain('<h1>Exposed Fundamentals</h1>')
  })

  it('adds the GoatCounter tag when the deck counts pageviews', async () => {
    const files = await renderHandout({ ...deck, analytics: 'https://x.goatcounter.com/count' }, [sections[1]], undefined, false)
    expect(files['handout/lesson-1.html']).toContain('<script data-goatcounter="https://x.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>')
    const plain = await renderHandout(deck, [sections[1]], undefined, false)
    expect(plain['handout/lesson-1.html']).not.toContain('goatcounter')
  })

  it('takes the language from the deck', async () => {
    const files = await renderHandout({ ...deck, lang: 'nl' }, [sections[1]], undefined, false)
    expect(files['handout/lesson-1.html']).toContain('<html lang="nl">')
  })
})

describe('llms and sitemap', () => {
  it('renders llms.txt with section links', () => {
    const text = renderLlmsTxt(deck, sections)
    expect(text).toContain('# Exposed Fundamentals\n\n> From relational model to Kotlin queries')
    expect(text).toContain('- [Lesson 1](https://example.com/deck/handout/lesson-1.html): Tables')
    expect(text).toContain('- [Full text](https://example.com/deck/llms-full.txt)')
  })

  it('renders llms-full.txt as one outline: deck, section, slide, then the slide\'s headings', () => {
    const text = renderLlmsFullTxt(deck, sections, true)
    expect(text).toContain('## Lesson 1\n\n### Tables\n\nSlide 2: https://example.com/deck/#/2\n\n#### Columns\n\n```kotlin\nobject Talks : Table()\n```\n\n> Speaker notes: Mention *DSL*')
  })

  it('does not repeat a title slide under the heading it came from', () => {
    const multi = renderLlmsFullTxt(deck, sections, false)
    expect(multi).toContain('## Exposed Fundamentals\n\nSlide 1: https://example.com/deck/#/1\n\nWelcome')
    expect(multi).not.toContain('### Exposed Fundamentals')
    const single = renderLlmsFullTxt(deck, [{ ...sections[0], slides: [...sections[0].slides, { no: 2, title: 'Next', markdown: '## Sub' }] }], false)
    expect(single).toContain('# Exposed Fundamentals\n\n> From relational model to Kotlin queries\n\nSource: https://example.com/deck/\n\nSlide 1: https://example.com/deck/#/1\n\nWelcome\n\n## Next\n\nSlide 2: https://example.com/deck/#/2\n\n### Sub')
  })

  it('writes robots.txt only for a deck at the root of its host', () => {
    expect(servedFromHostRoot('https://example.com/')).toBe(true)
    expect(servedFromHostRoot('https://example.com/deck/')).toBe(false)
    expect(servedFromHostRoot('not a url')).toBe(false)
    expect(robotsSitemapHint('https://example.com/')).toBeUndefined()
    expect(robotsSitemapHint('https://user.github.io/deck/')).toBe('robots.txt is only read at the root of a host: add `Sitemap: https://user.github.io/deck/sitemap.xml` to https://user.github.io/robots.txt')
  })

  it('renders a sitemap of the deck and handout pages', () => {
    const xml = renderSitemap(deck, sections)
    expect(xml).toContain('<loc>https://example.com/deck/</loc><lastmod>2026-09-03</lastmod>')
    expect(xml).toContain('<loc>https://example.com/deck/handout/</loc>')
    expect(xml).toContain('<loc>https://example.com/deck/handout/lesson-1.html</loc>')
  })
})

describe('deckDescription', () => {
  it('prefers seoMeta and flattens Markdown info', () => {
    expect(deckDescription({ seoMeta: { ogDescription: 'SEO' }, info: 'x' })).toBe('SEO')
    expect(deckDescription({ info: '## Intro\n\nA *deck* about [Exposed](https://x)\n\nMore' })).toBe('Intro')
    expect(deckDescription({ info: 'A *deck* about [Exposed](https://x)' })).toBe('A deck about Exposed')
    expect(deckDescription({ info: false })).toBe('')
  })
})

describe('indexHtmlTags', () => {
  const attrs = (tags: ReturnType<typeof indexHtmlTags>) => tags.map(tag => ({ tag: tag.tag, injectTo: tag.injectTo, ...tag.attrs }))

  it('points the root page at the handout and llms-full.txt with visible links the app hides', () => {
    const tags = indexHtmlTags({ root: '/deck/', description: '' }, undefined)
    expect(attrs(tags)).toEqual([
      { tag: 'meta', injectTo: 'head', name: 'robots', content: 'index, follow' },
      { tag: 'link', injectTo: 'head', rel: 'alternate', type: 'text/html', title: 'Handout', href: '/deck/handout/' },
      { tag: 'link', injectTo: 'head', rel: 'alternate', type: 'text/markdown', title: 'Full text for language models', href: '/deck/llms-full.txt' },
      { tag: 'style', injectTo: 'head' },
      { tag: 'p', injectTo: 'body', class: 'slidev-theme-kotlin-static-links' },
    ])
    expect(tags.at(-2)?.children).toContain('#app:not(:empty)~.slidev-theme-kotlin-static-links{display:none}')
    const links = tags.at(-1)?.children as string
    expect(links).toContain('<a href="/deck/handout/">handout</a>')
    expect(links).toContain('<a href="/deck/llms-full.txt">full text as Markdown</a>')
    expect(links).toContain('<a href="/deck/llms.txt">llms.txt</a>')
  })

  it('removes the description Slidev rendered from the raw info', () => {
    const html = '<head>\n<meta name="description" content="*Raw* info">\n<meta property="og:title" content="T"></head>'
    expect(withoutSlidevDescription(html)).toBe('<head>\n<meta property="og:title" content="T"></head>')
  })

  it('adds the description, canonical URL, and sitemap once the public URL is known', () => {
    const tags = attrs(indexHtmlTags({ root: 'https://example.com/deck/', description: 'From relational model to Kotlin queries' }, 'https://example.com/deck/'))
    expect(tags).toContainEqual({ tag: 'meta', injectTo: 'head', name: 'description', content: 'From relational model to Kotlin queries' })
    expect(tags).toContainEqual({ tag: 'link', injectTo: 'head', rel: 'canonical', href: 'https://example.com/deck/' })
    expect(tags).toContainEqual({ tag: 'link', injectTo: 'head', rel: 'sitemap', type: 'application/xml', title: 'Sitemap', href: 'https://example.com/deck/sitemap.xml' })
    expect(tags).toContainEqual({ tag: 'link', injectTo: 'head', rel: 'alternate', type: 'text/markdown', title: 'Full text for language models', href: 'https://example.com/deck/llms-full.txt' })
  })
})
