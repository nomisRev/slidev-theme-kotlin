import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('DrawnAnnotation writer client', () => {
  it('serializes local saves so each queued patch uses the newest revision', async () => {
    let revision = 'initial'
    const requests: { expectedRevision: string, annotations: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method)
        return Response.json({ geometry: {}, revision })

      const request = JSON.parse(init.body as string)
      requests.push(request)
      expect(request.expectedRevision).toBe(revision)
      revision = `revision-${requests.length}`
      return Response.json({ geometry: {}, revision })
    }))

    const writer = await import('./writer-client')
    await writer.loadAnnotationGeometry()
    await Promise.all([
      writer.saveLabelGeometry('first', { x: .1, y: .2 }),
      writer.saveLabelGeometry('second', { x: .3, y: .4 }),
    ])

    expect(requests).toEqual([
      { expectedRevision: 'initial', annotations: { first: { x: .1, y: .2 } } },
      { expectedRevision: 'revision-1', annotations: { second: { x: .3, y: .4 } } },
    ])
  })
})
