import type { Box, PlanRequest, Side, SizeCandidate } from '../components/annotation-placement'
import { describe, expect, it } from 'vitest'
import {
  boxContains,
  boxesCollide,
  clipBox,
  dominantSide,
  intervalsOverlap,
  leaderPathD,
  makeBox,
  overlapArea,
  padBox,
  planLabel,
  routeBlocked,
  routeLeader,
  satisfiesSideContract,
  unionBox,
} from '../components/annotation-placement'

const SLIDE = { width: 1440, height: 810 }
const MARGIN = 24
const GAP = 28
const CLEARANCE = 16
const CORRIDOR = 34

function box(left: number, top: number, width: number, height: number): Box {
  return makeBox(left, top, left + width, top + height)
}

function request(overrides: Partial<PlanRequest>): PlanRequest {
  return {
    anchor: box(600, 380, 120, 40),
    safeArea: makeBox(MARGIN, MARGIN, SLIDE.width - MARGIN, SLIDE.height - MARGIN),
    gap: GAP,
    clearance: CLEARANCE,
    sides: ['right', 'down', 'left', 'up'] as Side[],
    sizes: [{ width: 220, height: 40 }] as SizeCandidate[],
    corridor: CORRIDOR,
    obstaclesByClick: new Map(),
    labelObstacles: [],
    ...overrides,
  }
}

describe('box and interval primitives', () => {
  it('measures overlap and detects collisions with sub-pixel slack', () => {
    const a = box(0, 0, 100, 100)
    expect(overlapArea(a, box(50, 50, 100, 100))).toBe(2500)
    expect(overlapArea(a, box(100, 0, 10, 10))).toBe(0)
    expect(boxesCollide(a, box(99, 0, 10, 10))).toBe(true)
    // Touching edges are not a collision.
    expect(boxesCollide(a, box(100, 0, 10, 10))).toBe(false)
    expect(boxesCollide(a, box(99.9, 0, 10, 10))).toBe(false)
  })

  it('unions, pads, clips and contains', () => {
    const union = unionBox([box(0, 0, 10, 10), box(20, 20, 10, 10)])
    expect([union.left, union.top, union.right, union.bottom]).toEqual([0, 0, 30, 30])
    const padded = padBox(box(10, 10, 10, 10), 5)
    expect([padded.left, padded.top, padded.right, padded.bottom]).toEqual([5, 5, 25, 25])
    expect(boxContains(padded, box(10, 10, 10, 10))).toBe(true)
    expect(boxContains(box(10, 10, 10, 10), padded)).toBe(false)
    const clipped = clipBox(box(-10, -10, 30, 30), box(0, 0, 100, 100))
    expect(clipped && [clipped.left, clipped.top, clipped.right, clipped.bottom]).toEqual([0, 0, 20, 20])
    expect(clipBox(box(-30, 0, 20, 20), box(0, 0, 100, 100))).toBeUndefined()
  })

  it('overlaps half-open intervals', () => {
    expect(intervalsOverlap({ start: 1, end: 3 }, { start: 2, end: 5 })).toBe(true)
    expect(intervalsOverlap({ start: 1, end: 2 }, { start: 2, end: 3 })).toBe(false)
    expect(intervalsOverlap({ start: 0, end: Number.POSITIVE_INFINITY }, { start: 7, end: 8 })).toBe(true)
  })

  it('finds the dominant side of a point', () => {
    const anchor = box(100, 100, 100, 40)
    expect(dominantSide(anchor, { x: 400, y: 130 })).toBe('right')
    expect(dominantSide(anchor, { x: 140, y: 400 })).toBe('down')
    expect(dominantSide(anchor, { x: -100, y: 110 })).toBe('left')
    expect(dominantSide(anchor, { x: 160, y: 0 })).toBe('up')
  })
})

describe('side contracts', () => {
  const anchor = box(600, 380, 120, 40)

  it('accepts a label that reads from the requested side', () => {
    const below = box(610, anchor.bottom + GAP, 100, 40)
    expect(satisfiesSideContract(below, 'down', anchor, GAP, CORRIDOR)).toBe(true)
  })

  it('rejects a label on another side or outside the corridor', () => {
    const toTheRight = box(anchor.right + GAP, 390, 100, 40)
    expect(satisfiesSideContract(toTheRight, 'down', anchor, GAP, CORRIDOR)).toBe(false)
    const driftedFarRight = box(anchor.cx + anchor.width / 2 + CORRIDOR + 60, anchor.bottom + GAP, 100, 40)
    expect(satisfiesSideContract(driftedFarRight, 'down', anchor, GAP, CORRIDOR)).toBe(false)
    const tooClose = box(610, anchor.bottom + 4, 100, 40)
    expect(satisfiesSideContract(tooClose, 'down', anchor, GAP, CORRIDOR)).toBe(false)
  })
})

describe('planLabel with an explicit side', () => {
  it('places below the anchor when there is room below (never to the right)', () => {
    const anchor = box(600, 200, 120, 40)
    const result = planLabel(request({ anchor, sides: ['down'] }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.side).toBe('down')
      expect(result.box.top).toBeGreaterThanOrEqual(anchor.bottom + GAP)
      expect(Math.abs(result.box.cx - anchor.cx)).toBeLessThanOrEqual(anchor.width / 2 + CORRIDOR)
    }
  })

  it('fails strictly when the requested side has no room, instead of drifting sideways', () => {
    // The anchor sits near the bottom; everything below is off the safe area.
    const anchor = box(600, SLIDE.height - 80, 120, 40)
    const result = planLabel(request({ anchor, sides: ['down'] }))
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.rejections.some(rejection => rejection.reason === 'outside-safe-area')).toBe(true)
  })

  it('fails strictly when the side is fully occupied in some click state', () => {
    const anchor = box(600, 200, 120, 40)
    // A slab covering everything below the anchor, present at click 2 only.
    const slab = box(0, anchor.bottom, SLIDE.width, SLIDE.height - anchor.bottom)
    const result = planLabel(request({
      anchor,
      sides: ['down'],
      obstaclesByClick: new Map([[1, []], [2, [slab]]]),
    }))
    expect(result.ok).toBe(false)
  })

  it('rejects candidates rather than clamping them to the slide edge', () => {
    // An anchor near the right edge: a right label cannot fit, and must not be
    // clamped back onto the slide (which would visually change its side).
    const anchor = box(SLIDE.width - 100, 400, 60, 40)
    const result = planLabel(request({ anchor, sides: ['right'] }))
    expect(result.ok).toBe(false)
  })
})

describe('planLabel with automatic placement', () => {
  it('prefers the right side when right and bottom are both free', () => {
    const anchor = box(400, 300, 120, 40)
    const result = planLabel(request({ anchor }))
    expect(result.ok && result.side).toBe('right')
  })

  it('uses a code-panel caller’s down-first ordering even when right is free', () => {
    const anchor = box(400, 300, 120, 40)
    const result = planLabel(request({ anchor, sides: ['down', 'right', 'left', 'up'] }))
    expect(result.ok && result.side).toBe('down')
  })

  it('moves to the bottom when the right side is occupied', () => {
    const anchor = box(400, 300, 120, 40)
    // A wide code panel filling everything right of the anchor.
    const panel = box(anchor.right, 0, SLIDE.width - anchor.right, SLIDE.height)
    const result = planLabel(request({
      anchor,
      obstaclesByClick: new Map([[1, [panel]]]),
    }))
    expect(result.ok && result.side).toBe('down')
  })

  it('clears the union of every sampled click state, not just the current one', () => {
    const anchor = box(200, 300, 120, 40)
    // Right of the anchor is free at click 1 but occupied at click 2.
    const laterCard = box(anchor.right + 10, 200, 400, 300)
    const clear = planLabel(request({ anchor, obstaclesByClick: new Map([[1, []]]) }))
    expect(clear.ok && clear.side).toBe('right')
    const blocked = planLabel(request({
      anchor,
      obstaclesByClick: new Map([[1, []], [2, [laterCard]]]),
    }))
    expect(blocked.ok).toBe(true)
    if (blocked.ok) {
      expect(blocked.side).not.toBe('right')
      // And the chosen box collides with nothing in either state.
      expect(boxesCollide(blocked.box, padBox(laterCard, CLEARANCE))).toBe(false)
    }
  })

  it('avoids earlier labels whose intervals overlap', () => {
    const anchor = box(400, 300, 120, 40)
    const earlierLabel = box(anchor.right + GAP, anchor.cy - 20, 300, 40)
    const result = planLabel(request({ anchor, labelObstacles: [earlierLabel] }))
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(boxesCollide(result.box, padBox(earlierLabel, CLEARANCE))).toBe(false)
  })

  it('wraps only when the natural width cannot be placed', () => {
    const anchor = box(200, 300, 120, 40)
    const sizes: SizeCandidate[] = [
      { width: 900, height: 40 },
      { cap: 300, width: 300, height: 80 },
    ]
    // Free slide: the natural single line wins.
    const free = planLabel(request({ anchor, sizes }))
    expect(free.ok && free.cap).toBeUndefined()
    // Fence off most of the slide so only a narrow column below-left remains.
    const fence = box(560, 0, SLIDE.width - 560, SLIDE.height)
    const cramped = planLabel(request({ anchor, sizes, obstaclesByClick: new Map([[1, [fence]]]) }))
    expect(cramped.ok).toBe(true)
    if (cramped.ok)
      expect(cramped.cap).toBe(300)
  })
})

describe('planLabel stability', () => {
  it('keeps the previous position while it stays valid', () => {
    const anchor = box(400, 300, 120, 40)
    const first = planLabel(request({ anchor }))
    expect(first.ok).toBe(true)
    if (!first.ok)
      return
    const again = planLabel(request({
      anchor,
      previous: { box: first.box, side: first.side, cap: first.cap },
    }))
    expect(again.ok && again.keptPrevious).toBe(true)
    if (again.ok)
      expect(again.box).toEqual(first.box)
  })

  it('replans when a newly sampled state collides with the previous position', () => {
    const anchor = box(400, 300, 120, 40)
    const first = planLabel(request({ anchor }))
    expect(first.ok).toBe(true)
    if (!first.ok)
      return
    const intruder = padBox(first.box, 4)
    const moved = planLabel(request({
      anchor,
      obstaclesByClick: new Map([[2, [intruder]]]),
      previous: { box: first.box, side: first.side, cap: first.cap },
    }))
    expect(moved.ok).toBe(true)
    if (moved.ok) {
      expect(moved.keptPrevious).toBe(false)
      expect(boxesCollide(moved.box, padBox(intruder, CLEARANCE))).toBe(false)
    }
  })

  it('drops a previous position whose size is no longer offered', () => {
    const anchor = box(400, 300, 120, 40)
    const stale = box(anchor.right + GAP, anchor.cy - 30, 500, 60)
    const result = planLabel(request({
      anchor,
      previous: { box: stale, side: 'right' },
    }))
    expect(result.ok && result.keptPrevious).toBe(false)
  })
})

describe('leader routing', () => {
  const source = box(600, 300, 140, 50)

  it('derives its ports from the label side', () => {
    const label = box(620, 500, 200, 40)
    const route = routeLeader({ side: 'down', source, label, obstacles: [], exclusions: [] })
    expect(route.ok).toBe(true)
    if (route.ok) {
      expect(route.kind).toBe('direct')
      const [start, end] = [route.points[0], route.points[route.points.length - 1]]
      expect(start.y).toBe(source.bottom)
      expect(end.y).toBeLessThanOrEqual(label.top)
      expect(end.x).toBeGreaterThanOrEqual(label.left)
      expect(end.x).toBeLessThanOrEqual(label.right)
    }
    const rightLabel = box(source.right + 60, 290, 200, 40)
    const rightRoute = routeLeader({ side: 'right', source, label: rightLabel, obstacles: [], exclusions: [] })
    expect(rightRoute.ok).toBe(true)
    if (rightRoute.ok) {
      expect(rightRoute.points[0].x).toBe(source.right)
      expect(rightRoute.points[rightRoute.points.length - 1].x).toBeLessThanOrEqual(rightLabel.left)
    }
  })

  it('prefers the direct segment and doglegs only around real content', () => {
    const label = box(900, 500, 200, 40)
    const direct = routeLeader({ side: 'down', source, label, obstacles: [], exclusions: [] })
    expect(direct.ok && direct.kind).toBe('direct')

    // A text line straddling the direct diagonal, but clear of the vertical
    // drop under the source and the vertical rise into the label.
    const textLine = box(700, 400, 160, 20)
    const routed = routeLeader({ side: 'down', source, label, obstacles: [textLine], exclusions: [] })
    expect(routed.ok).toBe(true)
    if (routed.ok) {
      expect(routed.kind).not.toBe('direct')
      expect(routed.points.length).toBeLessThanOrEqual(4)
      expect(routeBlocked(routed.points, [textLine], [])).toBe(false)
      // Side-preserving: every waypoint keeps moving downward.
      for (let i = 1; i < routed.points.length; i++)
        expect(routed.points[i].y).toBeGreaterThanOrEqual(routed.points[i - 1].y)
    }
  })

  it('ignores crossings inside the source and destination exclusion zones', () => {
    const label = box(620, 500, 200, 40)
    const nearSource = box(560, 350, 220, 24)
    const blocked = routeLeader({ side: 'down', source, label, obstacles: [nearSource], exclusions: [] })
    const excused = routeLeader({
      side: 'down',
      source,
      label,
      obstacles: [nearSource],
      exclusions: [padBox(source, 80)],
    })
    expect(excused.ok).toBe(true)
    // Without an exclusion the same route needed a dogleg or failed.
    if (blocked.ok && excused.ok)
      expect(excused.kind).toBe('direct')
  })

  it('omits the leader instead of drawing a lasso when no simple route is clear', () => {
    const label = box(620, 700, 200, 40)
    // Content fills the whole band between source and label.
    const wall = box(0, 380, SLIDE.width, 280)
    const route = routeLeader({ side: 'down', source, label, obstacles: [wall], exclusions: [] })
    expect(route.ok).toBe(false)
    if (!route.ok)
      expect(route.reason).toBe('crosses-content')
    // An explicit target connection still draws the direct line.
    const fallback = routeLeader({
      side: 'down',
      source,
      endPoint: { x: 700, y: 720 },
      obstacles: [wall],
      exclusions: [],
      fallbackToDirect: true,
    })
    expect(fallback.ok && fallback.kind).toBe('direct')
  })

  it('hops over the sentence when source and target share a text line', () => {
    // Circle around one word, arrow to another word later in the sentence:
    // the direct segment and every along-axis dogleg would strike through the
    // words between them, so the route swings above the line instead.
    const wordA = box(200, 300, 140, 50)
    const target = { x: 600, y: 325 }
    const sentence = box(350, 305, 210, 40)
    const route = routeLeader({
      side: 'right',
      source: wordA,
      endPoint: target,
      endRadius: 10,
      obstacles: [sentence],
      exclusions: [],
      fallbackToDirect: true,
    })
    expect(route.ok).toBe(true)
    if (route.ok) {
      expect(route.kind).toBe('dogleg')
      expect(route.points.length).toBe(4)
      expect(routeBlocked(route.points, [sentence], [])).toBe(false)
      // The swing passes above both the source and the target.
      expect(Math.min(...route.points.map(point => point.y))).toBeLessThan(wordA.top)
    }
  })

  it('hops over intervening words to reach a right-side label on the same line', () => {
    // `placement="right"` with the rest of the sentence between the mark and
    // the label: the direct leader and every along-axis dogleg would strike
    // through those words, so the route swings over (or under) the text line
    // and enters the label through its top or bottom edge instead.
    const wordA = box(200, 300, 140, 50)
    const label = box(700, 295, 220, 60)
    const sentence = box(360, 305, 320, 40)
    const route = routeLeader({ side: 'right', source: wordA, label, obstacles: [sentence], exclusions: [] })
    expect(route.ok).toBe(true)
    if (route.ok) {
      expect(route.kind).toBe('dogleg')
      expect(route.points.length).toBe(4)
      expect(routeBlocked(route.points, [sentence], [])).toBe(false)
      const end = route.points[route.points.length - 1]
      expect(end.x).toBeGreaterThanOrEqual(label.left)
      expect(end.x).toBeLessThanOrEqual(label.right)
      expect(end.y <= label.top || end.y >= label.bottom).toBe(true)
    }
  })

  it('rejects off-slide lanes and uses an in-frame swing instead', () => {
    const edgeSource = box(200, 20, 140, 50)
    const label = box(700, 20, 220, 60)
    const sentence = box(360, 25, 320, 40)
    const bounds = makeBox(8, 8, SLIDE.width - 8, SLIDE.height - 8)
    const route = routeLeader({
      side: 'right',
      source: edgeSource,
      label,
      obstacles: [sentence],
      exclusions: [],
      bounds,
    })
    expect(route.ok).toBe(true)
    if (route.ok) {
      expect(route.kind).toBe('dogleg')
      expect(route.smooth).toBe(true)
      // The first (upper) swing would have a y of -8. It is rejected in favour
      // of the lower lane, with every point inside the route boundary.
      expect(Math.min(...route.points.map(point => point.y))).toBeGreaterThanOrEqual(bounds.top)
      expect(Math.max(...route.points.map(point => point.y))).toBeGreaterThan(edgeSource.bottom)
    }
  })

  it('does not relax the slide boundary for an author-asserted destination', () => {
    const route = routeLeader({
      side: 'right',
      source,
      label: box(1500, 300, 200, 40),
      obstacles: [],
      exclusions: [],
      bounds: makeBox(8, 8, SLIDE.width - 8, SLIDE.height - 8),
      fallbackToDirect: true,
    })
    expect(route.ok).toBe(false)
    if (!route.ok)
      expect(route.reason).toBe('outside-slide')
  })

  it('draws the direct leader to a hand-pinned label when no route is clear', () => {
    const label = box(700, 295, 220, 60)
    // Text above, below and beside: no simple route is clear anywhere.
    const wall = padBox(box(360, 100, 320, 500), 0)
    const omitted = routeLeader({ side: 'right', source: box(200, 300, 140, 50), label, obstacles: [wall], exclusions: [] })
    expect(omitted.ok).toBe(false)
    const pinned = routeLeader({
      side: 'right',
      source: box(200, 300, 140, 50),
      label,
      obstacles: [wall],
      exclusions: [],
      fallbackToDirect: true,
    })
    expect(pinned.ok && pinned.kind).toBe('direct')
  })

  it('reports a touching destination instead of drawing a stub', () => {
    const label = box(source.cx - 100, source.bottom + 2, 200, 40)
    const route = routeLeader({ side: 'down', source, label, obstacles: [], exclusions: [] })
    expect(route.ok).toBe(false)
    if (!route.ok)
      expect(route.reason).toBe('touching')
  })

  it('renders a bounded cosmetic bow, never a broad curve', () => {
    const points = [{ x: 0, y: 0 }, { x: 0, y: 300 }]
    const d = leaderPathD(points, 0.12)
    // The quadratic control point of a 300px segment stays within the 4px cap,
    // inside the leader's 6px obstacle reserve.
    const match = d.match(/Q ([\d.-]+) ([\d.-]+)/)
    expect(match).toBeTruthy()
    if (match)
      expect(Math.abs(Number.parseFloat(match[1]))).toBeLessThanOrEqual(4)
    // The same bow at the slide edge is pulled into the in-frame boundary.
    const bounded = leaderPathD(points, 0.12, makeBox(0, 0, 100, 300))
    expect(bounded).toMatch(/Q 0 /)
    // A zero curve factor deliberately degenerates to straight segments.
    expect(leaderPathD(points, 0)).toBe('M 0 0 L 0 300')
  })

  it('rounds dogleg turns instead of rendering square brackets', () => {
    const points = [
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 400, y: 200 },
      { x: 400, y: 300 },
    ]
    const rounded = leaderPathD(points, 0.12, makeBox(0, 0, 500, 400))
    expect(rounded.match(/ Q /g)).toHaveLength(2)
    expect(rounded).not.toContain('L 100 200 L 400 200')
    expect(rounded.endsWith('L 400 300')).toBe(true)
    expect(leaderPathD(points, 0)).toBe('M 100 100 L 100 200 L 400 200 L 400 300')
    expect(leaderPathD(points, 0.12, undefined, true))
      .toBe('M 100 100 C 100 200 400 200 400 300')
  })
})
