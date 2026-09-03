import { describe, expect, it } from 'vitest'
import {
  analyticsTags,
  goatcounterTag,
  resolveAnalyticsSettings,
  slideNumberFromRoute,
  slideViewPath,
} from '../setup/analytics'

describe('resolveAnalyticsSettings', () => {
  it('is off unless themeConfig.analytics.goatcounter is set', () => {
    expect(resolveAnalyticsSettings(undefined)).toBeUndefined()
    expect(resolveAnalyticsSettings({ analytics: {} })).toBeUndefined()
    expect(resolveAnalyticsSettings({ analytics: { goatcounter: ' ' } })).toBeUndefined()
    expect(resolveAnalyticsSettings({ analytics: { goatcounter: 'not a code!' } })).toBeUndefined()
  })

  it('takes an endpoint URL or a bare site code', () => {
    expect(resolveAnalyticsSettings({ analytics: { goatcounter: 'https://nomsrev.goatcounter.com/count' } }))
      .toEqual({ goatcounter: 'https://nomsrev.goatcounter.com/count' })
    expect(resolveAnalyticsSettings({ analytics: { goatcounter: 'nomsrev' } }))
      .toEqual({ goatcounter: 'https://nomsrev.goatcounter.com/count' })
  })
})

describe('tags', () => {
  it('renders the handout tag counting on load, and the deck tag waiting for count()', () => {
    expect(goatcounterTag('https://x.goatcounter.com/count', false))
      .toBe('<script data-goatcounter="https://x.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>')
    expect(goatcounterTag('https://x.goatcounter.com/count?a="b"', true))
      .toBe('<script data-goatcounter="https://x.goatcounter.com/count?a=&quot;b&quot;" data-goatcounter-settings=\'{"no_onload":true}\' async src="https://gc.zgo.at/count.js"></script>')
    expect(analyticsTags({ goatcounter: 'https://x.goatcounter.com/count' })).toEqual([{
      tag: 'script',
      attrs: { 'data-goatcounter': 'https://x.goatcounter.com/count', 'data-goatcounter-settings': '{"no_onload":true}', 'async': true, 'src': 'https://gc.zgo.at/count.js' },
      injectTo: 'head',
    }])
  })
})

describe('slide views', () => {
  it('recognises slide routes only', () => {
    expect(slideNumberFromRoute('/12')).toBe(12)
    expect(slideNumberFromRoute('/1/')).toBe(1)
    for (const path of ['/', '/presenter/3', '/overview', '/notes', '/print', '/export/2', '/entry'])
      expect(slideNumberFromRoute(path)).toBeUndefined()
  })

  it('records the slide under the deck base whatever the router mode', () => {
    expect(slideViewPath('/exposed-fundamentals/', 12)).toBe('/exposed-fundamentals/12')
    expect(slideViewPath('/exposed-fundamentals', 12)).toBe('/exposed-fundamentals/12')
    expect(slideViewPath('/', 1)).toBe('/1')
  })
})
