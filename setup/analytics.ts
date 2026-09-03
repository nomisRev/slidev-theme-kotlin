/**
 * Privacy-friendly analytics with GoatCounter (https://www.goatcounter.com).
 *
 * A deck opts in from its headmatter with the endpoint of its GoatCounter
 * site, or just the site code:
 *
 * ```yaml
 * themeConfig:
 *   analytics:
 *     goatcounter: https://mysite.goatcounter.com/count   # or: mysite
 * ```
 *
 * `analyticsPlugin` then adds `count.js` to the built `index.html`, with
 * `no_onload` so the script counts nothing by itself, and `setup/main.ts`
 * sends one pageview per slide instead: `<base><slide number>`, with the
 * slide's title, whichever router mode the deck is built with. The presenter,
 * overview, notes, print, and export views are never counted, nor are the
 * clicks within a slide. Handout pages carry the plain tag; each has its own
 * canonical URL, which `count.js` records as the path.
 *
 * `count.js` drops requests from localhost, private networks, iframes, and
 * headless browsers on its own, so `slidev dev`, exports, and screenshots
 * never reach the dashboard. The plugin only runs on `slidev build` anyway.
 */
import type { ResolvedSlidevOptions } from '@slidev/types'
import type { HtmlTagDescriptor, Plugin } from 'vite'

/** The script GoatCounter serves, unminified so it can be read. */
export const GOATCOUNTER_SCRIPT = 'https://gc.zgo.at/count.js'

export interface AnalyticsSettings {
  /** The GoatCounter endpoint pageviews are sent to (`https://<code>.goatcounter.com/count`). */
  goatcounter: string
}

/**
 * `themeConfig.analytics.goatcounter`: the endpoint URL, or a bare site
 * code that becomes `https://<code>.goatcounter.com/count`.
 */
export function resolveAnalyticsSettings(themeConfig: unknown): AnalyticsSettings | undefined {
  const analytics = (themeConfig as { analytics?: unknown } | undefined)?.analytics
  const raw = analytics && typeof analytics === 'object' ? (analytics as { goatcounter?: unknown }).goatcounter : undefined
  if (typeof raw !== 'string' || !raw.trim())
    return undefined
  const value = raw.trim()
  if (/^https?:\/\//.test(value))
    return { goatcounter: value }
  if (/^[a-z0-9-]+$/i.test(value))
    return { goatcounter: `https://${value}.goatcounter.com/count` }
  return undefined
}

/**
 * The `count.js` tag for a page. With `manual`, the script counts nothing on
 * load and waits for `count()` calls (see `countSlideView`).
 */
export function goatcounterTag(endpoint: string, manual: boolean): string {
  const settings = manual ? ` data-goatcounter-settings='{"no_onload":true}'` : ''
  return `<script data-goatcounter="${escapeAttribute(endpoint)}"${settings} async src="${GOATCOUNTER_SCRIPT}"></script>`
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** The tag as Vite's `transformIndexHtml` wants it, for the deck's `index.html`. */
export function analyticsTags(settings: AnalyticsSettings): HtmlTagDescriptor[] {
  return [{
    tag: 'script',
    attrs: {
      'data-goatcounter': settings.goatcounter,
      'data-goatcounter-settings': '{"no_onload":true}',
      'async': true,
      'src': GOATCOUNTER_SCRIPT,
    },
    injectTo: 'head',
  }]
}

/** Vite plugin adding `count.js` to a built deck. */
export function analyticsPlugin(options: ResolvedSlidevOptions): Plugin | undefined {
  const settings = resolveAnalyticsSettings(options.data.config.themeConfig)
  if (!settings)
    return undefined
  return {
    name: 'slidev-theme-kotlin:analytics',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => analyticsTags(settings),
    },
  }
}

// ---------------------------------------------------------------------------
// Client side (used by setup/main.ts)

/** The slide number a route path addresses (`/12`), or `undefined` for every other view. */
export function slideNumberFromRoute(path: string): number | undefined {
  const match = path.match(/^\/(\d+)\/?$/)
  return match ? Number(match[1]) : undefined
}

/** The path recorded for a slide: the deck's base plus the slide number, in any router mode. */
export function slideViewPath(base: string, no: number): string {
  return `${base.replace(/\/?$/, '/')}${no}`
}

interface GoatCounter {
  count?: (vars: { path: string, title?: string }) => void
}

declare global {
  interface Window {
    goatcounter?: GoatCounter
  }
}

/**
 * Send one pageview for a slide. `count.js` loads asynchronously, so a view
 * that happens before it is ready waits for the script's `load` event; a
 * page without the script (a build without analytics, a blocked request)
 * sends nothing.
 */
export function countSlideView(view: { base: string, no: number, title?: string }): void {
  const send = () => window.goatcounter?.count?.({ path: slideViewPath(view.base, view.no), title: view.title })
  if (window.goatcounter?.count) {
    send()
    return
  }
  const script = document.querySelector<HTMLScriptElement>('script[data-goatcounter]')
  script?.addEventListener('load', send, { once: true })
}
