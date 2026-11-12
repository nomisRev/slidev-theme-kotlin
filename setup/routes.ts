import { defineRoutesSetup } from '@slidev/types'

/**
 * On a phone or tablet the presenter route shows the tap remote
 * (`remote/RemoteControl.vue`): the upcoming slide, the notes, and two tap
 * zones. A laptop keeps Slidev's own presenter console, with its timer and
 * keyboard shortcuts. The primary pointer decides, so a laptop with a touch
 * screen still counts as a laptop.
 */
export default defineRoutesSetup((routes) => {
  const presenter = routes.find(route => route.name === 'presenter')
  if (!presenter)
    return routes
  const stock = presenter.component
  presenter.component = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)
      return import('../remote/RemoteControl.vue')
    return typeof stock === 'function' ? (stock as () => Promise<unknown>)() : Promise.resolve(stock)
  }
  return routes
})
