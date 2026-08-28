import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { drawnAnnotationEditor, findDrawnAnnotationTags, injectDrawnAnnotationLocators, patchDrawnAnnotationTag, serializeGeometry, validateGeometryPatch } from './drawn-annotation-editor'

const revision = (source: string) => createHash('sha256').update(source).digest('hex').slice(0, 16)
const locatorOf = (transformed: string) => / __drawn-annotation-locator="([^"]+)"/.exec(transformed)?.[1]
const decode = (locator: string) => JSON.parse(Buffer.from(locator, 'base64url').toString())

async function sourceRequest(handler: Function, body: unknown) {
  const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST', url: '/__drawn-annotation-source',
  })
  return await new Promise<{ status: number, body: any }>((resolve, reject) => {
    const response = {
      statusCode: 200,
      setHeader() {},
      end(value: string) { resolve({ status: this.statusCode, body: JSON.parse(value) }) },
    }
    Promise.resolve(handler(request, response, reject)).catch(reject)
  })
}

/** A configured plugin plus its writer handler, serving a temporary project. */
async function serve(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'drawn-annotation-'))
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content)
  const plugin = drawnAnnotationEditor()
  plugin.configResolved({ root })
  let handler: Function | undefined
  plugin.configureServer({ middlewares: { use(value: Function) { handler = value } } })
  expect(handler).toBeTruthy()
  return { root, plugin, handler: handler!, dispose: () => rm(root, { recursive: true, force: true }) }
}

describe('source geometry editor', () => {
  it('injects transient locators without changing the source tag shape', () => {
    const source = '<DrawnAnnotation text="Suspend" label="driver">\n'
    expect(findDrawnAnnotationTags(source)).toHaveLength(1)
    const transformed = injectDrawnAnnotationLocators(source, 'slides.md')
    expect(transformed).toContain(' __drawn-annotation-locator="')
    // A bound attribute would be evaluated as a JavaScript expression by Vue.
    expect(transformed).not.toContain(':__drawn-annotation-locator')
    expect(source).not.toContain('__drawn')
  })

  it('serializes the Markdown geometry binding at fixed precision', () => {
    expect(serializeGeometry({ label: { x: .1, y: .2, width: .33333 } })).toBe('{ label: { x: 0.1000, y: 0.2000, width: 0.3333 } }')
  })

  it('rejects malformed normalized patches', () => {
    expect(() => validateGeometryPatch({ label: { x: 2, y: 0 } })).toThrow()
    expect(() => validateGeometryPatch({ label: { x: .1, y: .2 }, unexpected: true })).toThrow()
    expect(validateGeometryPatch({ connector: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } })).toBeTruthy()
  })

  it('replaces or removes only the geometry binding and preserves self-closing tags', () => {
    const tag = '<DrawnAnnotation text="Suspend" :geometry="{ label: { x: .1, y: .2 } }" on="0">'
    expect(patchDrawnAnnotationTag(tag, { connector: { start: { x: 0, y: .1 }, end: { x: .2, y: .3 } } }))
      .toBe('<DrawnAnnotation text="Suspend" :geometry="{ connector: { start: { x: 0.0000, y: 0.1000 }, end: { x: 0.2000, y: 0.3000 } } }" on="0">')
    expect(patchDrawnAnnotationTag('<DrawnAnnotation text="Suspend" />', { label: { x: .1, y: .2 } }))
      .toBe('<DrawnAnnotation text="Suspend"  :geometry="{ label: { x: 0.1000, y: 0.2000 } }"/>')
    expect(patchDrawnAnnotationTag(tag, {})).toBe('<DrawnAnnotation text="Suspend" on="0">')
  })

  it('writes only the located tag and rejects stale source revisions or fingerprints', async () => {
    const source = ['before', '<DrawnAnnotation text="first" label="one">', '<DrawnAnnotation text="second" label="two">', 'after'].join('\n')
    const { root, plugin, handler, dispose } = await serve({ 'slides.md': source })
    const file = join(root, 'slides.md')
    try {
      const locator = locatorOf(plugin.transform(source, file)?.code ?? '')
      expect(locator).toBeTruthy()
      expect(decode(locator!)).toMatchObject({ file: 'slides.md', line: 2, ordinal: 0, revision: revision(source) })

      const saved = await sourceRequest(handler, {
        locator,
        expectedRevision: revision(source),
        geometry: { label: { x: .123456, y: .5, width: .25 }, connector: { start: { x: .1, y: .2 }, end: { x: .3, y: .4 } } },
      })
      expect(saved.status, JSON.stringify(saved.body)).toBe(200)
      const written = await readFile(file, 'utf8')
      expect(written).toContain('text="first" label="one" :geometry="{ label: { x: 0.1235, y: 0.5000, width: 0.2500 }, connector: { start: { x: 0.1000, y: 0.2000 }, end: { x: 0.3000, y: 0.4000 } } }">')
      expect(written).toContain('<DrawnAnnotation text="second" label="two">')

      const staleRevision = await sourceRequest(handler, { locator, expectedRevision: revision(source), geometry: {} })
      expect(staleRevision).toMatchObject({ status: 409, body: { recovery: expect.stringContaining('Reload') } })

      // A client cannot bypass the locator fingerprint merely by learning the
      // newest document revision after someone has edited the opening tag.
      const edited = written.replace('text="first"', 'text="renamed"')
      await writeFile(file, edited)
      const staleLocator = await sourceRequest(handler, { locator, expectedRevision: revision(edited), geometry: {} })
      expect(staleLocator).toMatchObject({ status: 409, body: { error: expect.stringContaining('stale locator') } })
    }
    finally {
      await dispose()
    }
  })

  it('addresses the real Markdown file when Slidev transforms a single slide chunk', async () => {
    // Slidev loads each slide as `<file>__slidev_<n>.md` whose code is only
    // that slide's content. Two slides carry byte-identical tags on purpose.
    const tag = '<DrawnAnnotation text="main" label="entry point" :on="1">'
    const slides = [`# One\n\n${tag}\n\n\`\`\`kotlin\nfun main() {}\n\`\`\`\n`, '# Two\n\nplain slide\n', `# Three\n\n${tag}\n\ntext\n`]
    const source = `---\ntitle: Deck\n---\n\n${slides.join('\n---\n\n')}`
    const { root, plugin, handler, dispose } = await serve({ 'slides.md': source })
    try {
      const chunk = slides[2]
      expect(source.indexOf(chunk)).toBeGreaterThan(0)
      const transformed = plugin.transform(chunk, `${join(root, 'slides.md')}__slidev_3.md`)?.code ?? ''
      const locator = locatorOf(transformed)
      expect(locator).toBeTruthy()
      // The locator names the file the author edits, at the tag's real line
      // (the second occurrence of the tag, on slide three).
      const lines = source.split('\n')
      const line = lines.indexOf(tag, lines.indexOf(tag) + 1) + 1
      expect(line).toBeGreaterThan(1)
      expect(decode(locator!)).toMatchObject({ file: 'slides.md', ordinal: 1, line, revision: revision(source) })

      const saved = await sourceRequest(handler, { locator, expectedRevision: revision(source), geometry: { label: { x: .25, y: .75 } } })
      expect(saved.status, JSON.stringify(saved.body)).toBe(200)
      const written = await readFile(join(root, 'slides.md'), 'utf8')
      const patched = '<DrawnAnnotation text="main" label="entry point" :on="1" :geometry="{ label: { x: 0.2500, y: 0.7500 } }">'
      expect(written.split('\n')[line - 1]).toBe(patched)
      // The identical tag on slide one is left alone.
      expect(written.split(tag)).toHaveLength(2)
      expect(written.split(patched)).toHaveLength(2)
      expect(written.replace(patched, tag)).toBe(source)

      // Frontmatter modules and unreadable files never receive a locator.
      expect(plugin.transform(chunk, `${join(root, 'slides.md')}__slidev_3.frontmatter`)).toBeNull()
      expect(plugin.transform(chunk, `${join(root, 'missing.md')}__slidev_1.md`)).toBeNull()
    }
    finally {
      await dispose()
    }
  })

  it('derives relative locators from the Vite root and never transforms outside files', async () => {
    const { root, plugin, dispose } = await serve({ 'slides.md': '<DrawnAnnotation />' })
    try {
      const locator = locatorOf(plugin.transform('<DrawnAnnotation />', 'slides.md')?.code ?? '')
      expect(decode(locator!)).toMatchObject({ file: 'slides.md', line: 1 })
      expect(plugin.transform('<DrawnAnnotation />', '/outside/slides.md')).toBeNull()
      expect(plugin.transform('<DrawnAnnotation />', join(root, '..', 'slides.md'))).toBeNull()
    }
    finally {
      await dispose()
    }
  })
})
