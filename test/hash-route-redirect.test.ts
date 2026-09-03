import { describe, expect, it } from 'vitest'
import { hashRouteRedirectPlugin, hashRouteRedirectScript } from '../setup/hash-route-redirect'

function run(script: string, href: string): string | undefined {
  let replaced: string | undefined
  const url = new URL(href)
  const location = {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    replace(target: string) { replaced = target },
  }
  // eslint-disable-next-line no-new-func
  new Function('location', script)(location)
  return replaced
}

describe('hashRouteRedirectScript', () => {
  const script = hashRouteRedirectScript('/deck/')

  it('sends history-mode slide links to their hash route', () => {
    expect(run(script, 'https://x.test/deck/74')).toBe('/deck/#/74')
    expect(run(script, 'https://x.test/deck/74/')).toBe('/deck/#/74')
    expect(run(script, 'https://x.test/deck/74?clicks=2')).toBe('/deck/#/74?clicks=2')
    expect(run(script, 'https://x.test/deck/presenter/3')).toBe('/deck/#/presenter/3')
    expect(run(script, 'https://x.test/deck/overview')).toBe('/deck/#/overview')
  })

  it('leaves the root, hash routes, and unknown paths alone', () => {
    expect(run(script, 'https://x.test/deck/')).toBeUndefined()
    expect(run(script, 'https://x.test/deck/#/74')).toBeUndefined()
    expect(run(script, 'https://x.test/deck/74#/2')).toBeUndefined()
    expect(run(script, 'https://x.test/deck/handout/lesson-1.html')).toBeUndefined()
    expect(run(script, 'https://x.test/other/74')).toBeUndefined()
  })
})

describe('hashRouteRedirectPlugin', () => {
  const options = (routerMode: string) => ({ data: { config: { routerMode } } }) as any

  it('only applies to hash-mode builds', () => {
    expect(hashRouteRedirectPlugin(options('history'))).toBeUndefined()
    expect(hashRouteRedirectPlugin(options('hash'))?.apply).toBe('build')
  })

  it('injects the script with the resolved base', () => {
    const plugin = hashRouteRedirectPlugin(options('hash'))!
    ;(plugin.configResolved as any)({ base: '/deck/' })
    const result = (plugin.transformIndexHtml as any).handler('<html></html>')
    expect(result.tags[0]).toMatchObject({ tag: 'script', injectTo: 'head-prepend' })
    expect(result.tags[0].children).toContain('var base="/deck/"')
  })
})
