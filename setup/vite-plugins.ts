import { defineVitePluginsSetup } from '@slidev/types'
import { analyticsPlugin } from './analytics'
import { hashRouteRedirectPlugin } from './hash-route-redirect'
import { staticContentPlugin } from './static-content'

/**
 * Build-time plugins every deck on this theme gets without configuration:
 *
 * - `static-content` writes a crawlable handout, `llms.txt`, `llms-full.txt`,
 *   and a sitemap next to the built deck (see `static-content.ts`).
 * - `hash-route-redirect` keeps old history-mode deep links working once a
 *   deck is built with `--router-mode hash` (see `hash-route-redirect.ts`).
 * - `analytics` adds GoatCounter to decks that set
 *   `themeConfig.analytics.goatcounter` (see `analytics.ts`).
 */
export default defineVitePluginsSetup(options => [
  hashRouteRedirectPlugin(options),
  staticContentPlugin(options),
  analyticsPlugin(options),
])
