import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAnnotationGeometry } from './writer-client'

/** The base64url source locator the development server would inject. */
const locator = btoa(JSON.stringify({ file: 'slides.md', line: 3 })).replace(/\+/g, '-').replace(/\//g, '_')

/** Bodies of every POST the client sent to the writer endpoint. */
let writes: Array<{ locator: string, expectedRevision: string, geometry: Record<string, unknown> }>

beforeEach(() => {
  writes = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') {
      // The first write loads source revisions before it can send anything.
      return { ok: true, status: 200, json: async () => ({ revisions: { 'slides.md': 'rev-1' } }) }
    }
    const body = JSON.parse(String(init.body))
    writes.push(body)
    return { ok: true, status: 200, json: async () => ({ revision: `rev-${writes.length + 1}`, geometry: body.geometry }) }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resetAnnotationGeometry', () => {
  it('switching to the automatic connector removes the whole connector object, control point included', async () => {
    await resetAnnotationGeometry(locator, 'connector', { x: 0.1, y: 0.2, width: 0.3, x1: 0.4, y1: 0.5, x2: 0.6, y2: 0.7, cx: 0.8, cy: 0.9 })

    expect(writes).toHaveLength(1)
    // Only the label survives: no connector key at all, rather than a
    // connector with individually removed fields.
    expect(writes[0].geometry).toEqual({ label: { x: 0.1, y: 0.2, width: 0.3 } })
  })

  it('resetting the label keeps the manual connector, control point included', async () => {
    await resetAnnotationGeometry(locator, 'label', { x: 0.1, y: 0.2, width: 0.3, x1: 0.4, y1: 0.5, x2: 0.6, y2: 0.7, cx: 0.8, cy: 0.9 })

    expect(writes.at(-1)?.geometry).toEqual({
      connector: { type: 'quadratic', start: { x: 0.4, y: 0.5 }, control: { x: 0.8, y: 0.9 }, end: { x: 0.6, y: 0.7 } },
    })
  })

  it('resetting the connector of a label-only geometry writes the label unchanged', async () => {
    await resetAnnotationGeometry(locator, 'connector', { x: 0.1, y: 0.2 })

    expect(writes.at(-1)?.geometry).toEqual({ label: { x: 0.1, y: 0.2 } })
  })

  it('resetting with no known source geometry clears the binding', async () => {
    await resetAnnotationGeometry(locator, 'connector', null)

    expect(writes.at(-1)?.geometry).toEqual({})
  })
})
