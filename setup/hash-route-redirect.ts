import type { ResolvedSlidevOptions } from '@slidev/types'
import type { Plugin } from 'vite'

/**
 * Static hosts without a single-page-app rewrite (GitHub Pages, for one)
 * answer a history-mode deep link such as `/deck/12` with the deck's
 * `404.html`. With `routerMode: hash` the deck itself no longer creates such
 * links, but links that were shared before the switch still exist. This
 * script, injected into the built `index.html` (and hence into the copied
 * `404.html`), sends those old paths to their hash-mode equivalent.
 */
export function hashRouteRedirectScript(base: string): string {
  return [
    '(function(){',
    `var base=${JSON.stringify(base)};`,
    'var path=location.pathname;',
    'if(path.indexOf(base)!==0)return;',
    'var route=/^(\\d+|presenter(?:\\/\\d+)?|overview|notes|print|export)\\/?$/.exec(path.slice(base.length));',
    'if(!route||location.hash)return;',
    'location.replace(base+"#/"+route[1]+location.search);',
    '})();',
  ].join('')
}

/** Vite plugin adding the redirect script to hash-mode builds. */
export function hashRouteRedirectPlugin(options: ResolvedSlidevOptions): Plugin | undefined {
  if (options.data.config.routerMode !== 'hash')
    return undefined
  let base = '/'
  return {
    name: 'slidev-theme-kotlin:hash-route-redirect',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return {
          html,
          tags: [{ tag: 'script', injectTo: 'head-prepend', children: hashRouteRedirectScript(base) }],
        }
      },
    },
  }
}
