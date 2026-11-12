/**
 * Lifts an annotation that was carried over from the neighbouring slide of a
 * cross-slide Magic Move chain above the code window while a view transition
 * is running.
 *
 * With `transition: view-transition` the browser paints the page as a stack
 * of snapshots: the root first, then every element that has a
 * `view-transition-name`, and `MagicMoveBetween` names its code window so it
 * morphs live instead of cross-fading with the page. Everything an annotation
 * draws on top of the window (a squiggle, an inline message, hand-drawn ink)
 * belongs to the root snapshot and would spend the transition hidden
 * underneath the window. A carried annotation therefore becomes a snapshot of
 * its own for as long as it is carried, which the browser stacks above the
 * window; `styles/layout.css` shows it complete from the first frame.
 *
 * The name has to be unique in the document, or the browser skips the whole
 * transition, so each caller gets its own.
 */
import type { CSSProperties, Ref } from 'vue'
import { computed } from 'vue'

let layers = 0

export function useCarriedLayer(carried: Ref<boolean>) {
  const name = `magic-move-carried-${++layers}`
  return computed<CSSProperties | undefined>(() => carried.value
    ? { 'view-transition-name': name, 'view-transition-class': 'magic-move-carried' } as CSSProperties
    : undefined)
}
