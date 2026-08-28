import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { drawnAnnotationEditor, findDrawnAnnotationTags, injectDrawnAnnotationLocators, patchDrawnAnnotationTag, serializeGeometry, validateGeometryPatch } from './drawn-annotation-editor'

const revision = (source: string) => createHash('sha256').update(source).digest('hex').slice(0, 16)

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

describe('source geometry editor', () => {
  it('injects transient locators without changing the source tag shape', () => {
    const source = '<DrawnAnnotation text="Suspend" label="driver">\n'
    expect(findDrawnAnnotationTags(source)).toHaveLength(1)
    const transformed = injectDrawnAnnotationLocators(source, 'slides.md')
    expect(transformed).toContain(':__drawn-annotation-locator=')
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
    const root = await mkdtemp(join(tmpdir(), 'drawn-annotation-'))
    const file = join(root, 'slides.md')
    const source = ['before', '<DrawnAnnotation text="first" label="one">', '<DrawnAnnotation text="second" label="two">', 'after'].join('\n')
    await writeFile(file, source)
    try {
      const plugin = drawnAnnotationEditor()
      plugin.configResolved({ root })
      const transformed = plugin.transform(source, file)?.code ?? ''
      const locator = /:__drawn-annotation-locator="([^"]+)"/.exec(transformed)?.[1]
      expect(locator).toBeTruthy()
      let handler: Function | undefined
      plugin.configureServer({ middlewares: { use(value: Function) { handler = value } } })
      expect(handler).toBeTruthy()

      const saved = await sourceRequest(handler!, {
        locator,
        expectedRevision: revision(source),
        geometry: { label: { x: .123456, y: .5, width: .25 }, connector: { start: { x: .1, y: .2 }, end: { x: .3, y: .4 } } },
      })
      expect(saved.status, JSON.stringify(saved.body)).toBe(200)
      const written = await readFile(file, 'utf8')
      expect(written).toContain('text="first" label="one" :geometry="{ label: { x: 0.1235, y: 0.5000, width: 0.2500 }, connector: { start: { x: 0.1000, y: 0.2000 }, end: { x: 0.3000, y: 0.4000 } } }">')
      expect(written).toContain('<DrawnAnnotation text="second" label="two">')

      const staleRevision = await sourceRequest(handler!, { locator, expectedRevision: revision(source), geometry: {} })
      expect(staleRevision).toMatchObject({ status: 409, body: { recovery: expect.stringContaining('Reload') } })

      // A client cannot bypass the locator fingerprint merely by learning the
      // newest document revision after someone has edited the opening tag.
      const edited = written.replace('text="first"', 'text="renamed"')
      await writeFile(file, edited)
      const staleLocator = await sourceRequest(handler!, { locator, expectedRevision: revision(edited), geometry: {} })
      expect(staleLocator).toMatchObject({ status: 409, body: { error: expect.stringContaining('stale locator') } })
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('derives relative locators from the Vite root and never transforms outside files', () => {
    const plugin = drawnAnnotationEditor()
    plugin.configResolved({ root: '/project' })
    const transformed = plugin.transform('<DrawnAnnotation />', 'slides.md')?.code ?? ''
    const locator = /:__drawn-annotation-locator="([^"]+)"/.exec(transformed)?.[1]
    expect(JSON.parse(Buffer.from(locator!, 'base64url').toString())).toMatchObject({ file: 'slides.md' })
    expect(plugin.transform('<DrawnAnnotation />', '/outside/slides.md')).toBeNull()
  })
})
