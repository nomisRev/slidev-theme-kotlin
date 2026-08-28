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

  it('resets only connector endpoints, preserving saved label geometry', async () => {
    let revision = 'initial'
    const requests: { expectedRevision: string, annotations: Record<string, Record<string, number | null> | null> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method)
        return Response.json({ geometry: { note: { x: .1, y: .2, width: .3, x1: .3, y1: .4, x2: .5, y2: .6 } }, revision })
      const request = JSON.parse(init.body as string)
      requests.push(request)
      expect(request.expectedRevision).toBe(revision)
      revision = 'connector-reset'
      return Response.json({ geometry: { note: { x: .1, y: .2, width: .3 } }, revision })
    }))

    const writer = await import('./writer-client')
    await writer.loadAnnotationGeometry()
    await writer.resetAnnotationGeometry('note', 'connector')

    expect(requests).toEqual([{
      expectedRevision: 'initial',
      annotations: { note: { x1: null, y1: null, x2: null, y2: null } },
    }])
  })

  it('restores an exact snapshot, clearing connector fields introduced by a later edit', async () => {
    let revision = 'initial'
    const requests: { expectedRevision: string, annotations: Record<string, Record<string, number | null> | null> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method)
        return Response.json({ geometry: { note: { x: .1, y: .2, x1: .3, y1: .4, x2: .5, y2: .6 } }, revision })
      const request = JSON.parse(init.body as string)
      requests.push(request)
      expect(request.expectedRevision).toBe(revision)
      revision = 'restored'
      return Response.json({ geometry: { note: { x: .1, y: .2 } }, revision })
    }))

    const writer = await import('./writer-client')
    await writer.loadAnnotationGeometry()
    // Making an automatic connector manual adds four fields. Undo must remove
    // those fields, not merely reapply the old label coordinates over them.
    await writer.restoreAnnotationGeometry('note', { x: .1, y: .2 })

    expect(requests).toEqual([{
      expectedRevision: 'initial',
      annotations: { note: { x: .1, y: .2, x1: null, y1: null, x2: null, y2: null } },
    }])
  })

  it('queues a cancelled drag restore after its in-flight autosave', async () => {
    let revision = 'initial'
    const requests: { expectedRevision: string, annotations: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method)
        return Response.json({ geometry: { note: { x: .1, y: .2 } }, revision })
      const request = JSON.parse(init.body as string)
      requests.push(request)
      expect(request.expectedRevision).toBe(revision)
      revision = `revision-${requests.length}`
      return Response.json({ geometry: {}, revision })
    }))

    const writer = await import('./writer-client')
    await writer.loadAnnotationGeometry()
    // Escape can arrive after a debounced save has started. The restore must
    // wait for it rather than using the stale initial revision.
    await Promise.all([
      writer.saveLabelGeometry('note', { x: .8, y: .9 }),
      writer.restoreAnnotationGeometry('note', { x: .1, y: .2 }),
    ])

    expect(requests).toEqual([
      { expectedRevision: 'initial', annotations: { note: { x: .8, y: .9 } } },
      { expectedRevision: 'revision-1', annotations: { note: { x: .1, y: .2 } } },
    ])
  })
})
