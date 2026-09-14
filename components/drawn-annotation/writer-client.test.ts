import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveConnect, saveLabelGeometry } from './writer-client'

/** The base64url source locator the development server would inject. */
const locator = btoa(JSON.stringify({ file: 'slides.md', line: 3 })).replace(/\+/g, '-').replace(/\//g, '_')

/** Bodies of every POST the client sent to the writer endpoint. */
let writes: Array<{ locator: string, expectedRevision: string, geometry?: Record<string, unknown>, connect?: boolean | null }>

beforeEach(() => {
  writes = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') {
      // The first write loads source revisions before it can send anything.
      return { ok: true, status: 200, json: async () => ({ revisions: { 'slides.md': 'rev-1' } }) }
    }
    const body = JSON.parse(String(init.body))
    writes.push(body)
    return { ok: true, status: 200, json: async () => ({ revision: `rev-${writes.length + 1}`, geometry: body.geometry, connect: body.connect }) }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('saveLabelGeometry', () => {
  it('writes the label alone when the connector fields are absent, control point included', async () => {
    // "Use automatic connector" keeps `x`, `y` and `width` of the saved
    // geometry and drops everything else: the source then holds no connector
    // object at all, rather than one with individually removed fields.
    await saveLabelGeometry(locator, { x: 0.1, y: 0.2, width: 0.3, x1: undefined, y1: undefined, x2: undefined, y2: undefined, cx: undefined, cy: undefined })

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ locator, expectedRevision: 'rev-1', geometry: { label: { x: 0.1, y: 0.2, width: 0.3 } } })
    expect(writes[0].connect).toBeUndefined()
  })

  it('tags a connector with a control point as quadratic', async () => {
    await saveLabelGeometry(locator, { x1: 0.4, y1: 0.5, x2: 0.6, y2: 0.7, cx: 0.8, cy: 0.9 })

    expect(writes.at(-1)?.geometry).toEqual({
      connector: { type: 'quadratic', start: { x: 0.4, y: 0.5 }, control: { x: 0.8, y: 0.9 }, end: { x: 0.6, y: 0.7 } },
    })
  })

  it('resetting an annotation clears the binding', async () => {
    await saveLabelGeometry(locator, null)

    expect(writes.at(-1)?.geometry).toEqual({})
  })
})

describe('saveConnect', () => {
  it('sends the connect flag without touching geometry', async () => {
    await saveConnect(locator, false)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ locator, connect: false })
    expect(writes[0].geometry).toBeUndefined()
  })

  it('sends null to remove the binding, so the slide or deck default applies again', async () => {
    await saveConnect(locator, null)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ locator, connect: null })
    expect(writes[0].geometry).toBeUndefined()
  })
})
