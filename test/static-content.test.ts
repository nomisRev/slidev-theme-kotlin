import { describe, expect, it } from 'vitest'
import {
  cleanProse,
  cleanSlideMarkdown,
  collectSections,
  deckDescription,
  expandMagicMoveBlocks,
  expandSnippetImports,
  renderHandout,
  renderLlmsFullTxt,
  renderLlmsTxt,
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

  it('uses the slot when there is no message attribute', () => {
    const prose = '<InlineCompilerError text="x">\n  Type mismatch\n</InlineCompilerError>'
    expect(cleanProse(prose, base)).toBe('> ⚠ **Compiler error** at `x`: Type mismatch')
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
  it('captions fences by identity and title, and keeps imports in the code', () => {
    const content = '```kotlin jdbc [Talks.kt] {1|2-3}\nimport a.A\n\nval x = A()\n```\n\n```sql\nSELECT 1\n```'
    expect(cleanSlideMarkdown(content, ctx)).toBe(
      '**JDBC · Talks.kt**\n\n```kotlin\nimport a.A\n\nval x = A()\n```\n\n```sql\nSELECT 1\n```',
    )
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

const deck: DeckInfo = {
  title: 'Exposed Fundamentals',
  description: 'From relational model to Kotlin queries',
  root: 'https://example.com/deck/',
  hashRouter: true,
  generatedAt: new Date('2026-09-03T00:00:00Z'),
}

const sections: HandoutSection[] = [
  { slug: 'slides', title: 'Exposed Fundamentals', file: 'slides.md', slides: [{ no: 1, title: 'Exposed Fundamentals', markdown: 'Welcome' }] },
  { slug: 'lesson-1', title: 'Lesson 1', file: 'lessons/lesson-1.md', slides: [
    { no: 2, title: 'Tables', markdown: '```kotlin\nobject Talks : Table()\n```', note: 'Mention *DSL*' },
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
})

describe('llms and sitemap', () => {
  it('renders llms.txt with section links', () => {
    const text = renderLlmsTxt(deck, sections)
    expect(text).toContain('# Exposed Fundamentals\n\n> From relational model to Kotlin queries')
    expect(text).toContain('- [Lesson 1](https://example.com/deck/handout/lesson-1.html): Tables')
    expect(text).toContain('- [Full text](https://example.com/deck/llms-full.txt)')
  })

  it('renders llms-full.txt with every slide and its code', () => {
    const text = renderLlmsFullTxt(deck, sections, true)
    expect(text).toContain('## Lesson 1\n\n### Tables\n\nSlide 2: https://example.com/deck/#/2\n\n```kotlin\nobject Talks : Table()\n```\n\n> Speaker notes: Mention *DSL*')
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
