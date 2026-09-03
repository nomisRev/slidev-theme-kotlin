import { defineAppSetup } from '@slidev/types'
// @ts-ignore Slidev's virtual module, typed by @slidev/client's shim when it is loaded
import { slides } from '#slidev/slides'
import { countSlideView, slideNumberFromRoute } from './analytics'

/**
 * Count one GoatCounter pageview per slide (see `analytics.ts`). The hook
 * runs in every build, and does nothing unless the deck opted in: without
 * `themeConfig.analytics.goatcounter` there is no `count.js` on the page.
 *
 * Slidev keeps the click position in the query string, so the router fires
 * on every click; only a change of slide counts. The slide route (`/:no`)
 * carries no slide data, so the title comes from the slides list, the way
 * Slidev's own table of contents reads it.
 */
export default defineAppSetup(({ router }) => {
  if (typeof window === 'undefined')
    return
  let last: number | undefined
  router.afterEach((to) => {
    const no = slideNumberFromRoute(to.path)
    if (no === undefined || no === last)
      return
    last = no
    const slide = slides.value.find(route => route.no === no)
    countSlideView({ base: import.meta.env.BASE_URL, no, title: slide?.meta.slide?.title ?? document.title })
  })
})
