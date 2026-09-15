import { configs } from '@slidev/client/env.ts'

/**
 * Whether slide navigation is a browser View Transition, in which case the
 * mascot's `view-transition-name` carries it across slides and v-motion must
 * stay out of the way. Only true when the deck (or the slide) asks for
 * `view-transition` AND the browser implements the API: Slidev falls back to
 * a normal transition otherwise, and so does the mascot.
 */
export function usesViewTransition(slideTransition: unknown): boolean {
  return (slideTransition ?? configs.transition) === 'view-transition'
    && typeof document !== 'undefined' && 'startViewTransition' in document
}
