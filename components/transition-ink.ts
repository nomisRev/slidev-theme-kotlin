/**
 * Carries annotation ink across one cross-slide Magic Move transition.
 *
 * Slidev keeps both pages mounted but each page has its own annotation
 * component instance. A matching annotation on the next page therefore has no
 * component state to tell it that the ink was already visible. This tiny,
 * module-local hand-off bridges that one navigation boundary. It deliberately
 * matches both a semantic identity and the final normalized bounds: two equal
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
}

const inkByIdentity = new Map<string, TransitionInk[]>()

/** Record ink that was visible when its page was left. */
export function rememberTransitionInk(identity: string, page: number, box: TransitionInkBox) {
  const records = inkByIdentity.get(identity) ?? []
  // Repeated active/inactive updates for the same annotation replace its old
  // hand-off instead of accumulating stale geometry.
  const existing = records.findIndex(record => record.page === page)
  const record = { page, ...box }
  if (existing >= 0)
    records[existing] = record
  else
    records.push(record)
  inkByIdentity.set(identity, records)
}

/**
 * Consume ink from the immediately adjacent page when it occupies the same
 * final position. Coordinates are fractions of the concrete slide, so this
 * survives presenter scaling and a differently sized browser window.
 */
export function takeTransitionInk(identity: string, page: number, box: TransitionInkBox) {
  const records = inkByIdentity.get(identity)
  if (!records?.length)
    return false

  const adjacent = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => Math.abs(record.page - page) === 1)
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
  return true
}
