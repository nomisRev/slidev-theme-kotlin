/**
 * Carries annotation ink from one component instance to the one that takes
 * its place, across one cross-slide Magic Move transition or a remount of the
 * same slide.
 *
 * Slidev keeps both pages of a Magic Move chain mounted but each page has its
 * own annotation component instance, and it also unmounts and remounts the
 * slide it is showing at times (its slideshow container changes shape on the
 * first click after a view transition). Either way the instance that appears
 * has no component state to tell it that the ink was already visible. This
 * tiny, module-local hand-off bridges that boundary. It deliberately matches
 * both a semantic identity and the final normalized bounds: two equal
 * annotations elsewhere on a slide must still draw independently.
 */
export interface TransitionInkBox {
  left: number
  top: number
  right: number
  bottom: number
}

interface TransitionInk extends TransitionInkBox {
  page: number
  /** Left for the neighbouring page rather than for a remount of this one. */
  handedOver: boolean
  onTaken?: () => void
}

const inkByIdentity = new Map<string, TransitionInk[]>()

/**
 * Record ink that was visible when its instance was unmounted, for the
 * instance that replaces it on the same page.
 */
export function rememberTransitionInk(identity: string, page: number, box: TransitionInkBox) {
  store(identity, { page, ...box, handedOver: false })
}

/**
 * Record ink that was visible when its page was left, for the equivalent
 * annotation on the neighbouring page. Never taken back by the page that left
 * it: an annotation its neighbour does not have is simply new on the way back.
 * `onTaken` runs when the neighbour takes the ink over, so the instance that
 * left it can drop its own copy at once instead of fading out underneath.
 */
export function handOverTransitionInk(identity: string, page: number, box: TransitionInkBox, onTaken?: () => void) {
  store(identity, { page, ...box, handedOver: true, onTaken })
}

function store(identity: string, record: TransitionInk) {
  const records = inkByIdentity.get(identity) ?? []
  // Repeated active/inactive updates for the same annotation replace its old
  // hand-off instead of accumulating stale geometry.
  const existing = records.findIndex(other => other.page === record.page)
  if (existing >= 0)
    records[existing] = record
  else
    records.push(record)
  inkByIdentity.set(identity, records)
}

/**
 * Consume ink left by an unmounted instance of the same page, or handed over
 * by the immediately adjacent one, when it occupies the same final position.
 * Coordinates are fractions of the concrete slide, so this survives presenter
 * scaling and a differently sized browser window.
 */
export function takeTransitionInk(identity: string, page: number, box: TransitionInkBox) {
  const records = inkByIdentity.get(identity)
  if (!records?.length)
    return false

  const adjacent = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => Math.abs(record.page - page) === (record.handedOver ? 1 : 0))
  if (!adjacent.length)
    return false

  const distance = (record: TransitionInk) => Math.max(
    Math.abs(record.left - box.left),
    Math.abs(record.top - box.top),
    Math.abs(record.right - box.right),
    Math.abs(record.bottom - box.bottom),
  )
  const closest = adjacent.reduce((best, candidate) =>
    distance(candidate.record) < distance(best.record) ? candidate : best,
  )

  // About three to four slide pixels at the standard 1440×810 canvas. This
  // accepts sub-pixel browser/layout differences without treating a moved code
  // line as the same annotation.
  if (distance(closest.record) > 0.003)
    return false

  records.splice(closest.index, 1)
  if (records.length)
    inkByIdentity.set(identity, records)
  else
    inkByIdentity.delete(identity)
  closest.record.onTaken?.()
  return true
}
