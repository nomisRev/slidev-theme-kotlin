/**
 * Pure geometry for DrawnAnnotation's automatic label placement and leader
 * routing. Nothing in this module touches the DOM: everything works on plain
 * boxes in the slide's unscaled coordinate system, so every decision can be
 * unit-tested deterministically and behaves identically in the presenter
 * view, in exports and at any window size.
 *
 * The behaviour implemented here is specified in
 * docs/drawn-annotation-automatic-placement-spec.md.
 */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  cx: number
  cy: number
}

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** Half-open click interval: visible for every click `c` with start <= c < end. */
export interface Interval {
  start: number
  end: number
}

export type Side = 'right' | 'down' | 'left' | 'up'

/**
 * The order `auto` tries sides in. Teaching slides grow from the top left,
 * which leaves the right and lower areas as the most useful annotation space.
 */
export const SIDE_ORDER: readonly Side[] = ['right', 'down', 'left', 'up']

// Sub-pixel slack: measured geometry arrives with rounding noise, and a
// candidate must not be rejected over a hundredth of a pixel.
const EPS = 0.25

export function makeBox(left: number, top: number, right: number, bottom: number): Box {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  }
}

export function padBox(box: Box, padding: number): Box {
  return makeBox(box.left - padding, box.top - padding, box.right + padding, box.bottom + padding)
}

export function unionBox(boxes: Box[]): Box {
  return makeBox(
    Math.min(...boxes.map(box => box.left)),
    Math.min(...boxes.map(box => box.top)),
    Math.max(...boxes.map(box => box.right)),
    Math.max(...boxes.map(box => box.bottom)),
  )
}

export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

/** True overlap, ignoring sub-pixel touches. */
export function boxesCollide(a: Box, b: Box): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > EPS
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > EPS
}

export function boxContains(outer: Box, inner: Box, slack = 0.5): boolean {
  return inner.left >= outer.left - slack
    && inner.top >= outer.top - slack
    && inner.right <= outer.right + slack
    && inner.bottom <= outer.bottom + slack
}

/** The part of `box` inside `bounds`, or undefined when nothing remains. */
export function clipBox(box: Box, bounds: Box): Box | undefined {
  const left = Math.max(box.left, bounds.left)
  const top = Math.max(box.top, bounds.top)
  const right = Math.min(box.right, bounds.right)
  const bottom = Math.min(box.bottom, bounds.bottom)
  return right - left > 0 && bottom - top > 0 ? makeBox(left, top, right, bottom) : undefined
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function pointInBox(point: Point, box: Box): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

/** The side of `from` that the point lies on, by its dominant axis. */
export function dominantSide(from: Box, to: Point): Side {
  const dx = to.x - from.cx
  const dy = to.y - from.cy
  if (Math.abs(dx) >= Math.abs(dy))
    return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'down' : 'up'
}

// ---------------------------------------------------------------------------
// Label placement
// ---------------------------------------------------------------------------

/** One measured label size. `cap` is the max-width that produced it; absent for the natural, unwrapped line. */
export interface SizeCandidate extends Size {
  cap?: number
}

export interface PlanRequest {
  /** Padded rectangle around the source mark (or target) the label belongs to. */
  anchor: Box
  /**
   * The slide minus its safe margin, in the same coordinate system as the
   * anchor and obstacles. Candidates must lie fully inside it; the margin is
   * global layout policy, distinct from clearance.
   */
  safeArea: Box
  /** Smallest distance between the anchor and the label. */
  gap: number
  /** Breathing room the label keeps from every obstacle. */
  clearance: number
  /** Sides to try, in order. One entry for an explicit placement. */
  sides: readonly Side[]
  /** Measured label sizes, natural first, then narrower wrapping caps. */
  sizes: readonly SizeCandidate[]
  /**
   * Extra lateral corridor beyond half the anchor extent — roughly one label
   * line-height. It exists to dodge a nearby word, not to change the side.
   */
  corridor: number
  /**
   * Obstacles per sampled click state, uninflated, in slide coordinates.
   * A candidate must clear every state: this is an AND over clicks.
   */
  obstaclesByClick: ReadonlyMap<number, readonly Box[]>
  /** Final boxes of earlier labels whose intervals overlap this one. */
  labelObstacles: readonly Box[]
  /** The previously chosen position, kept while it stays valid. */
  previous?: { box: Box, side: Side, cap?: number }
}

export interface Rejection {
  side: Side
  cap?: number
  box: Box
  reason: 'outside-safe-area' | 'obstacle' | 'label'
  click?: number
}

export type PlanResult =
  | { ok: true, box: Box, side: Side, cap?: number, keptPrevious: boolean, rejections: Rejection[] }
  | { ok: false, reason: string, rejections: Rejection[] }

// Search steps in slide pixels. Distance grows outward along the requested
// side; lateral steps stay inside the corridor.
const DISTANCE_STEP = 12
const LATERAL_STEP = 12
// How far beyond `gap` a label may travel from its anchor while `auto` is
// choosing a side. This bound is what makes an occupied side genuinely fail
// over to the next one: without it, a label could leapfrog a whole code panel
// and land far away on the "preferred" side, connected by a leader that no
// longer reads as a teaching annotation. An explicit side is not bounded this
// way — the author chose the side, so honouring it farther away (up to the
// safe area) beats hiding the label.
const MAX_REACH = 360
// Only this many rejections are kept for diagnostics; the counts say the rest.
const REJECTION_CAP = 24

function isVertical(side: Side): boolean {
  return side === 'up' || side === 'down'
}

/**
 * How far a candidate's centre may drift sideways from the anchor's centre.
 * For a vertical side the drift runs along the marked text, which is benign,
 * so the full corridor applies. For a horizontal side the drift is vertical:
 * even half a line height moves the label onto another text line's level,
 * where it reads as anchored to the wrong thing — so it is kept much tighter.
 */
function lateralLimit(side: Side, anchor: Box, corridor: number): number {
  return isVertical(side)
    ? anchor.width / 2 + corridor
    : anchor.height / 2 + Math.min(corridor, 14)
}

function candidateBox(side: Side, anchor: Box, distance: number, lateral: number, size: Size): Box {
  switch (side) {
    case 'down': {
      const left = anchor.cx + lateral - size.width / 2
      const top = anchor.bottom + distance
      return makeBox(left, top, left + size.width, top + size.height)
    }
    case 'up': {
      const left = anchor.cx + lateral - size.width / 2
      const bottom = anchor.top - distance
      return makeBox(left, bottom - size.height, left + size.width, bottom)
    }
    case 'right': {
      const top = anchor.cy + lateral - size.height / 2
      const left = anchor.right + distance
      return makeBox(left, top, left + size.width, top + size.height)
    }
    case 'left': {
      const top = anchor.cy + lateral - size.height / 2
      const right = anchor.left - distance
      return makeBox(right - size.width, top, right, top + size.height)
    }
  }
}

/**
 * Whether a box honours the directional contract of `side`: at least `gap`
 * beyond the anchor on that side, and laterally within the corridor. This is
 * what makes `placement="down"` mean *below*, never a clamped right-side spot.
 */
export function satisfiesSideContract(box: Box, side: Side, anchor: Box, gap: number, corridor: number): boolean {
  const limit = lateralLimit(side, anchor, corridor) + EPS
  switch (side) {
    case 'down':
      return box.top >= anchor.bottom + gap - EPS && Math.abs(box.cx - anchor.cx) <= limit
    case 'up':
      return box.bottom <= anchor.top - gap + EPS && Math.abs(box.cx - anchor.cx) <= limit
    case 'right':
      return box.left >= anchor.right + gap - EPS && Math.abs(box.cy - anchor.cy) <= limit
    case 'left':
      return box.right <= anchor.left - gap + EPS && Math.abs(box.cy - anchor.cy) <= limit
  }
}

function insideSafeArea(box: Box, request: PlanRequest): boolean {
  return box.left >= request.safeArea.left - EPS
    && box.top >= request.safeArea.top - EPS
    && box.right <= request.safeArea.right + EPS
    && box.bottom <= request.safeArea.bottom + EPS
}

/**
 * The hard-validity predicate: zero collision, in every sampled click state,
 * as a boolean — never an overlap area traded against distance or order.
 */
function firstViolation(box: Box, request: PlanRequest): { reason: Rejection['reason'], click?: number } | undefined {
  if (!insideSafeArea(box, request))
    return { reason: 'outside-safe-area' }
  for (const [click, obstacles] of request.obstaclesByClick) {
    for (const obstacle of obstacles) {
      if (boxesCollide(box, padBox(obstacle, request.clearance)))
        return { reason: 'obstacle', click }
    }
  }
  for (const label of request.labelObstacles) {
    if (boxesCollide(box, padBox(label, request.clearance)))
      return { reason: 'label' }
  }
  return undefined
}

/** Lateral corridor offsets, centred first, positive before negative. */
function lateralOffsets(limit: number): number[] {
  const offsets = [0]
  for (let step = LATERAL_STEP; step < limit; step += LATERAL_STEP)
    offsets.push(step, -step)
  if (limit >= LATERAL_STEP)
    offsets.push(limit, -limit)
  return offsets
}

/** How far a candidate can travel outward before its far edge leaves the safe area. */
function maxDistance(side: Side, anchor: Box, size: Size, request: PlanRequest): number {
  switch (side) {
    case 'down': return request.safeArea.bottom - size.height - anchor.bottom
    case 'up': return anchor.top - request.safeArea.top - size.height
    case 'right': return request.safeArea.right - size.width - anchor.right
    case 'left': return anchor.left - request.safeArea.left - size.width
  }
}

/**
 * Finds the label rectangle. Candidates are generated per side, natural width
 * before wrapped, closer before farther, centred before displaced — which is
 * the specification's lexicographic ranking, walked in order so the first
 * valid candidate is the chosen one. A candidate that leaves the safe area is
 * rejected, never clamped: clamping is what used to silently change the side.
 *
 * A `previous` position is kept as long as it still satisfies every hard
 * constraint, so a settled label does not wander to a marginally better spot
 * every time something else on the slide moves.
 */
export function planLabel(request: PlanRequest): PlanResult {
  const rejections: Rejection[] = []
  const record = (rejection: Rejection) => {
    if (rejections.length < REJECTION_CAP)
      rejections.push(rejection)
  }

  const previous = request.previous
  if (
    previous
    && request.sides.includes(previous.side)
    && request.sizes.some(size =>
      Math.abs(size.width - previous.box.width) < 1 && Math.abs(size.height - previous.box.height) < 1)
    && satisfiesSideContract(previous.box, previous.side, request.anchor, request.gap, request.corridor)
    && !firstViolation(previous.box, request)
  ) {
    return { ok: true, box: previous.box, side: previous.side, cap: previous.cap, keptPrevious: true, rejections }
  }

  // A single requested side is an explicit contract; several sides mean the
  // planner is choosing, and then the reach bound arbitrates between them.
  const reach = request.sides.length > 1 ? request.gap + MAX_REACH : Number.POSITIVE_INFINITY

  for (const side of request.sides) {
    const laterals = lateralOffsets(lateralLimit(side, request.anchor, request.corridor))
    for (const size of request.sizes) {
      if (size.width <= 0 || size.height <= 0)
        continue
      const farthest = Math.min(maxDistance(side, request.anchor, size, request), reach)
      if (farthest < request.gap) {
        record({ side, cap: size.cap, box: candidateBox(side, request.anchor, request.gap, 0, size), reason: 'outside-safe-area' })
        continue
      }
      // For a vertical side the label slides outward first and only then
      // along the corridor. For a horizontal side that order flips: vertical
      // drift moves the label onto another text line's level, where it reads
      // as anchored to the wrong thing, so staying level with the anchor —
      // even farther away — beats a close but displaced spot.
      const outer = isVertical(side) ? [undefined] : laterals
      for (const fixedLateral of outer) {
        for (let distance = request.gap; distance <= farthest; distance += DISTANCE_STEP) {
          for (const lateral of fixedLateral === undefined ? laterals : [fixedLateral]) {
            const box = candidateBox(side, request.anchor, distance, lateral, size)
            const violation = firstViolation(box, request)
            if (!violation)
              return { ok: true, box, side, cap: size.cap, keptPrevious: false, rejections }
            record({ side, cap: size.cap, box, ...violation })
          }
        }
      }
    }
  }

  return { ok: false, reason: 'no-valid-candidate', rejections }
}

// ---------------------------------------------------------------------------
// Leader routing
// ---------------------------------------------------------------------------

export interface LeaderRequest {
  /** The side the label was placed on; it fixes the ports of the leader. */
  side: Side
  /** Padded box around the source mark. */
  source: Box
  /** The label rectangle, when the leader points at a label. */
  label?: Box
  /** The exact destination point, for target connections. */
  endPoint?: Point
  /** How far before `endPoint` the line stops — the target mark's radius. */
  endRadius?: number
  /** Content the line must not strike through: text lines, media, other marks. */
  obstacles: readonly Box[]
  /** Zones where crossing is expected and allowed: around the source and destination. */
  exclusions: readonly Box[]
  /** The inset slide rectangle every route point must stay inside. A route is
   * rejected, never clipped, when a dogleg would leave it. */
  bounds?: Box
  /** Draw the direct segment even when it crosses content: for explicit target
   * connections and labels pinned by hand, both of which are author assertions. */
  fallbackToDirect?: boolean
}

/** `point` moved `distance` back along the line that reaches it from `from`. */
export function backOffPoint(point: Point, from: Point, distance: number): Point {
  const dx = point.x - from.x
  const dy = point.y - from.y
  const length = Math.hypot(dx, dy) || 1
  return { x: point.x - dx / length * distance, y: point.y - dy / length * distance }
}

export type LeaderResult =
  | { ok: true, points: Point[], kind: 'direct' | 'elbow' | 'dogleg', smooth: boolean }
  | { ok: false, reason: 'touching' | 'crosses-content' | 'outside-slide' | 'no-destination' }

/**
 * Whether a polyline crosses any obstacle outside the exclusion zones. The
 * segments are sampled, which keeps the check simple and deterministic; the
 * step is small against the size of a text line.
 */
export function routeBlocked(points: readonly Point[], obstacles: readonly Box[], exclusions: readonly Box[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      if (exclusions.some(zone => pointInBox(point, zone)))
        continue
      if (obstacles.some(box => pointInBox(point, box)))
        return true
    }
  }
  return false
}

/** Bézier controls for a simple route. Cubic controls are nudged past
 * their dogleg lane: a cubic only approaches its controls, so this
 * makes the visible curve reach the already-tested clear lane instead of
 * cutting the corner back toward the obstacle. */
function smoothRouteControls(points: readonly Point[], bounds?: Box): Point[] {
  const bounded = (point: Point): Point => bounds
    ? { x: clamp(point.x, bounds.left, bounds.right), y: clamp(point.y, bounds.top, bounds.bottom) }
    : point
  if (points.length === 3)
    return [bounded(points[1])]
  const first = { ...points[1] }
  const second = { ...points[2] }
  if (Math.abs(first.y - second.y) <= EPS) {
    const endpointMid = (points[0].y + points[3].y) / 2
    first.y = second.y = endpointMid + (first.y - endpointMid) * 2
  }
  if (Math.abs(first.x - second.x) <= EPS) {
    const endpointMid = (points[0].x + points[3].x) / 2
    first.x = second.x = endpointMid + (first.x - endpointMid) * 2
  }
  return [bounded(first), bounded(second)]
}

/**
 * Whether treating a three-point elbow as one quadratic, or a four-point
 * dogleg as one cubic hand gesture, remains in the route's clear corridor.
 * The waypoints become Bézier controls rather than hard corners. We only use
 * this prettier rendering when its actual curve passes the same hard checks;
 * otherwise the collision-tested polyline is retained and merely rounded at
 * its turns.
 */
function smoothRouteBlocked(points: readonly Point[], obstacles: readonly Box[], exclusions: readonly Box[], bounds?: Box): boolean {
  if (points.length !== 3 && points.length !== 4)
    return true
  const controls = smoothRouteControls(points, bounds)
  const steps = Math.max(24, Math.ceil(points.reduce((length, point, index) => {
    if (!index)
      return length
    return length + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y)
  }, 0) / 6))
  for (let step = 0; step <= steps; step++) {
    const t = step / steps
    const inverse = 1 - t
    const point = points.length === 3
      ? {
          x: inverse ** 2 * points[0].x + 2 * inverse * t * controls[0].x + t ** 2 * points[2].x,
          y: inverse ** 2 * points[0].y + 2 * inverse * t * controls[0].y + t ** 2 * points[2].y,
        }
      : {
          x: inverse ** 3 * points[0].x + 3 * inverse ** 2 * t * controls[0].x + 3 * inverse * t ** 2 * controls[1].x + t ** 3 * points[3].x,
          y: inverse ** 3 * points[0].y + 3 * inverse ** 2 * t * controls[0].y + 3 * inverse * t ** 2 * controls[1].y + t ** 3 * points[3].y,
        }
    if (bounds && !pointInBox(point, bounds))
      return true
    if (exclusions.some(zone => pointInBox(point, zone)))
      continue
    if (obstacles.some(box => pointInBox(point, box)))
      return true
  }
  return false
}

/**
 * Routes the leader between the source mark and its destination. The ports are
 * derived from the final label side — a down label is entered through its top,
 * a right label through its left edge — so the line always communicates the
 * chosen placement. The direct segment is preferred; when it crosses content,
 * one short side-preserving dogleg with at most two bends is tried. There is
 * never a long detour: when no simple clear route exists the leader is omitted
 * (or, for explicit target connections and hand-pinned labels, drawn direct
 * anyway).
 */
export function routeLeader(request: LeaderRequest): LeaderResult {
  const { side, source, obstacles, exclusions } = request
  const vertical = isVertical(side)
  const sign = side === 'down' || side === 'right' ? 1 : -1

  const start: Point = vertical
    ? { x: source.cx, y: sign > 0 ? source.bottom : source.top }
    : { x: sign > 0 ? source.right : source.left, y: source.cy }

  const candidates: { points: Point[], kind: 'direct' | 'elbow' | 'dogleg' }[] = []
  // How far the middle segment of a perpendicular swing stays from content.
  const SWING = 28

  if (request.endPoint) {
    const target = request.endPoint
    const radius = request.endRadius ?? 6
    candidates.push({ points: [start, backOffPoint(target, start, radius)], kind: 'direct' })

    // A dogleg along the side's own axis. It only makes sense with room for a
    // middle segment, and it must keep moving in the side's direction — a
    // route may bend, but it never reverses.
    const span = vertical ? (target.y - start.y) * sign : (target.x - start.x) * sign
    if (span > 24) {
      const axisLand: Point = vertical
        ? { x: target.x, y: target.y - sign * radius }
        : { x: target.x - sign * radius, y: target.y }
      const approach = Math.min(24, span * 0.4)
      const elbow: Point = vertical
        ? { x: axisLand.x, y: axisLand.y - sign * approach }
        : { x: axisLand.x - sign * approach, y: axisLand.y }
      candidates.push({ points: [start, elbow, axisLand], kind: 'elbow' })
      for (const t of [0.5, 0.3, 0.7]) {
        const mid = vertical ? start.y + (target.y - start.y) * t : start.x + (target.x - start.x) * t
        const first: Point = vertical ? { x: start.x, y: mid } : { x: mid, y: start.y }
        const second: Point = vertical ? { x: axisLand.x, y: mid } : { x: mid, y: axisLand.y }
        candidates.push({ points: [start, first, second, axisLand], kind: 'dogleg' })
      }
    }

    // A perpendicular swing, still at most two bends: a connection between
    // two words in one sentence cannot dodge sideways along its own axis, so
    // it hops over (or under) the line instead — the natural drawn gesture.
    if (vertical) {
      for (const direction of [-1, 1] as const) {
        const x = direction < 0
          ? Math.min(source.left, target.x) - SWING
          : Math.max(source.right, target.x) + SWING
        candidates.push({
          points: [
            { x: direction < 0 ? source.left : source.right, y: source.cy },
            { x, y: source.cy },
            { x, y: target.y },
            { x: target.x + direction * radius, y: target.y },
          ],
          kind: 'dogleg',
        })
      }
    }
    else {
      for (const direction of [-1, 1] as const) {
        const y = direction < 0
          ? Math.min(source.top, target.y) - SWING
          : Math.max(source.bottom, target.y) + SWING
        candidates.push({
          points: [
            { x: source.cx, y: direction < 0 ? source.top : source.bottom },
            { x: source.cx, y },
            { x: target.x, y },
            { x: target.x, y: target.y + direction * radius },
          ],
          kind: 'dogleg',
        })
      }
    }
  }
  else if (request.label) {
    // The line terminates at the near edge of label ink, not at its centre.
    const label = request.label
    const inset = Math.min(6, label.width / 2, label.height / 2)
    const end: Point = vertical
      ? { x: clamp(start.x, label.left + inset, label.right - inset), y: sign > 0 ? label.top - 2 : label.bottom + 2 }
      : { x: sign > 0 ? label.left - 2 : label.right + 2, y: clamp(start.y, label.top + inset, label.bottom - inset) }
    candidates.push({ points: [start, end], kind: 'direct' })

    const span = vertical ? (end.y - start.y) * sign : (end.x - start.x) * sign
    if (span > 24) {
      const approach = Math.min(24, span * 0.4)
      const elbow: Point = vertical
        ? { x: end.x, y: end.y - sign * approach }
        : { x: end.x - sign * approach, y: end.y }
      candidates.push({ points: [start, elbow, end], kind: 'elbow' })
      for (const t of [0.5, 0.3, 0.7]) {
        const mid = vertical ? start.y + (end.y - start.y) * t : start.x + (end.x - start.x) * t
        const first: Point = vertical ? { x: start.x, y: mid } : { x: mid, y: start.y }
        const second: Point = vertical ? { x: end.x, y: mid } : { x: mid, y: end.y }
        candidates.push({ points: [start, first, second, end], kind: 'dogleg' })
      }
    }

    // The same perpendicular swing a target connection gets: a right label
    // whose direct leader would strike through the words between the mark and
    // the label hops over (or under) the text line instead, entering the
    // label through its top or bottom edge — still at most two bends. The
    // roomy swing is tried first, then tighter ones for dense slides, and
    // last the lane between the source's and the label's own near edges —
    // which is often the only clear corridor when other content hems both in.
    if (vertical) {
      const lanes: { x: number, direction: -1 | 1 }[] = []
      for (const swing of [SWING, 14, 6]) {
        lanes.push(
          { x: Math.min(source.left, label.left) - swing, direction: -1 },
          { x: Math.max(source.right, label.right) + swing, direction: 1 },
        )
      }
      if (Math.abs(source.left - label.left) > 12)
        lanes.push({ x: (source.left + label.left) / 2, direction: -1 })
      if (Math.abs(source.right - label.right) > 12)
        lanes.push({ x: (source.right + label.right) / 2, direction: 1 })
      for (const { x, direction } of lanes) {
        const entryY = clamp(start.y, label.top + inset, label.bottom - inset)
        candidates.push({
          points: [
            { x: direction < 0 ? source.left : source.right, y: source.cy },
            { x, y: source.cy },
            { x, y: entryY },
            { x: direction < 0 ? label.left - 2 : label.right + 2, y: entryY },
          ],
          kind: 'dogleg',
        })
      }
    }
    else {
      const lanes: { y: number, direction: -1 | 1 }[] = []
      for (const swing of [SWING, 14, 6]) {
        lanes.push(
          { y: Math.min(source.top, label.top) - swing, direction: -1 },
          { y: Math.max(source.bottom, label.bottom) + swing, direction: 1 },
        )
      }
      if (Math.abs(source.top - label.top) > 12)
        lanes.push({ y: (source.top + label.top) / 2, direction: -1 })
      if (Math.abs(source.bottom - label.bottom) > 12)
        lanes.push({ y: (source.bottom + label.bottom) / 2, direction: 1 })
      for (const { y, direction } of lanes) {
        const entryX = clamp(start.x, label.left + inset, label.right - inset)
        candidates.push({
          points: [
            { x: source.cx, y: direction < 0 ? source.top : source.bottom },
            { x: source.cx, y },
            { x: entryX, y },
            { x: entryX, y: direction < 0 ? label.top - 2 : label.bottom + 2 },
          ],
          kind: 'dogleg',
        })
      }
    }
  }
  else {
    return { ok: false, reason: 'no-destination' }
  }

  const direct = candidates[0].points
  const directEnd = direct[direct.length - 1]
  if (Math.hypot(directEnd.x - direct[0].x, directEnd.y - direct[0].y) < 8)
    return { ok: false, reason: 'touching' }

  // A route is given a little breathing room from text. Besides looking less
  // cramped, this reserve lets the renderer round a dogleg's corners without
  // cutting the rounded stroke back into the obstacle the square construction
  // just avoided.
  const routeObstacles = obstacles.map(obstacle => padBox(obstacle, 6))
  const insideBounds = (points: readonly Point[]) => !request.bounds || points.every(point =>
    point.x >= request.bounds!.left - EPS
    && point.x <= request.bounds!.right + EPS
    && point.y >= request.bounds!.top - EPS
    && point.y <= request.bounds!.bottom + EPS)

  let hadInBoundsCandidate = false
  for (const candidate of candidates) {
    if (!insideBounds(candidate.points))
      continue
    hadInBoundsCandidate = true
    if (!routeBlocked(candidate.points, routeObstacles, exclusions)) {
      const smooth = !smoothRouteBlocked(candidate.points, routeObstacles, exclusions, request.bounds)
      return { ok: true, ...candidate, smooth }
    }
  }

  // Crossing limited to the source/destination exclusion zones already counts
  // as clear above. Anything else is a real strike-through: better no leader
  // than a lasso, unless the author explicitly connected two elements. Even an
  // author assertion may not send ink outside the slide.
  if (request.fallbackToDirect && insideBounds(direct))
    return { ok: true, points: direct, kind: 'direct', smooth: false }
  return { ok: false, reason: hadInBoundsCandidate ? 'crosses-content' : 'outside-slide' }
}

/**
 * An SVG path for a routed leader. Direct leaders get only a small bounded bow.
 * Doglegs retain the collision-tested corridor but round each turn, so the
 * result reads as one hand gesture rather than a square bracket. Every control
 * point remains inside `bounds`; Bézier curves stay inside the convex hull of
 * their points, which guarantees that rendering cannot put a valid route back
 * outside the slide.
 */
export function leaderPathD(points: readonly Point[], curve: number, bounds?: Box, smooth = false): string {
  const compact = points.filter((point, index) => index === 0
    || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > EPS)
  if (!compact.length)
    return ''

  const bounded = (point: Point): Point => bounds
    ? { x: clamp(point.x, bounds.left, bounds.right), y: clamp(point.y, bounds.top, bounds.bottom) }
    : point
  let d = `M ${compact[0].x} ${compact[0].y}`
  if (compact.length === 1)
    return d

  // Clear elbows and doglegs can become a single quadratic/cubic stroke. The
  // route planner sampled this exact curve before setting `smooth`; its
  // derived controls are clamped to the same in-frame boundary.
  if (smooth && Math.abs(curve) >= 0.01 && compact.length === 3) {
    const [control] = smoothRouteControls(compact, bounds)
    const end = compact[2]
    return `${d} Q ${control.x} ${control.y} ${end.x} ${end.y}`
  }
  if (smooth && Math.abs(curve) >= 0.01 && compact.length === 4) {
    const [first, second] = smoothRouteControls(compact, bounds)
    const end = compact[3]
    return `${d} C ${first.x} ${first.y} ${second.x} ${second.y} ${end.x} ${end.y}`
  }

  if (compact.length === 2) {
    const [a, b] = compact
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    const bow = Math.min(4, length * Math.abs(curve) * 0.5) * Math.sign(curve)
    if (Math.abs(bow) < 1.5)
      return `${d} L ${b.x} ${b.y}`
    const control = bounded({
      x: (a.x + b.x) / 2 - dy / length * bow,
      y: (a.y + b.y) / 2 + dx / length * bow,
    })
    return `${d} Q ${control.x} ${control.y} ${b.x} ${b.y}`
  }

  // The prop still controls the amount of curve, but a large value cannot make
  // broad loops: only the immediate corner is rounded, with a 22px cap.
  const wantedRadius = Math.min(22, Math.abs(curve) * 100)
  if (wantedRadius < 1.5)
    return `${d} ${compact.slice(1).map(point => `L ${point.x} ${point.y}`).join(' ')}`

  for (let i = 1; i < compact.length - 1; i++) {
    const previous = compact[i - 1]
    const corner = compact[i]
    const next = compact[i + 1]
    const incomingLength = Math.hypot(previous.x - corner.x, previous.y - corner.y)
    const outgoingLength = Math.hypot(next.x - corner.x, next.y - corner.y)
    const radius = Math.min(wantedRadius, incomingLength / 3, outgoingLength / 3)
    const entry = bounded({
      x: corner.x + (previous.x - corner.x) / incomingLength * radius,
      y: corner.y + (previous.y - corner.y) / incomingLength * radius,
    })
    const exit = bounded({
      x: corner.x + (next.x - corner.x) / outgoingLength * radius,
      y: corner.y + (next.y - corner.y) / outgoingLength * radius,
    })
    d += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`
  }
  const end = compact[compact.length - 1]
  return `${d} L ${end.x} ${end.y}`
}
