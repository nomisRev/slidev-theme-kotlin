import { describe, expect, it } from 'vitest'
import { localLabelWidthToSlideFraction, localPointToSlideFraction, nudgeConnector, nudgeLabelWidth, persistedGeometrySignature, quadraticControlForCubic, slideFractionPointToLocal, translateConnector, validateDrawnAnnotationGeometry } from './geometry'

describe('DrawnAnnotation source geometry', () => {
  const slide = { left: 100, top: 50, width: 1600, height: 900 }
  // A nested overlay is deliberately offset and scaled differently from slide.
  const overlay = { left: 500, top: 200, width: 800, height: 450 }
  const canvas = { width: 400, height: 225 }

  it('round-trips normalized points through a nested SVG canvas', () => {
    const point = { x: .625, y: .25 }
    expect(localPointToSlideFraction(slideFractionPointToLocal(point, slide, overlay, canvas), slide, overlay, canvas)).toEqual(point)
  })

  it('nudges label widths in slide fractions for fitted and natural labels in a nested overlay', () => {
    const slideWidth = 1000
    const halfSlideOverlayWidth = 500
    const nudge = .002

    // Fitted width is local-SVG pixels, so it first becomes slide pixels.
    const fittedFraction = localLabelWidthToSlideFraction(100, halfSlideOverlayWidth, halfSlideOverlayWidth, slideWidth)
    expect(fittedFraction).toBe(.1)
    expect(nudgeLabelWidth(fittedFraction, nudge)).toBeCloseTo(.102)

    // A natural label is already measured in viewport (and therefore slide)
    // pixels. It must not be converted through the narrow overlay.
    const naturalFraction = 100 / slideWidth
    expect(nudgeLabelWidth(naturalFraction, nudge)).toBeCloseTo(.102)
  })

  it('translates a quadratic connector as a bounded rigid control polygon', () => {
    const connector = { x1: .1, y1: .2, x2: .3, y2: .4, cx: .95, cy: .7 }
    const translated = translateConnector(connector, .1, .5)

    // The control point reaches the right edge first, so all points share its
    // .05 bound rather than allowing the curve to distort at the edge.
    expect(translated.x1).toBeCloseTo(.15)
    expect(translated.y1).toBeCloseTo(.5)
    expect(translated.x2).toBeCloseTo(.35)
    expect(translated.y2).toBeCloseTo(.7)
    expect(translated.cx).toBe(1)
    expect(translated.cy).toBe(1)
    expect(translated.x2 - translated.x1).toBeCloseTo(connector.x2 - connector.x1)
    expect(translated.cx! - translated.x1).toBeCloseTo(connector.cx - connector.x1)
    expect(translated.cy! - translated.y1).toBeCloseTo(connector.cy - connector.y1)
  })

  it('keeps endpoint-only translations unchanged and retains controls on endpoint nudges', () => {
    const endpoints = { x1: .1, y1: .2, x2: .3, y2: .4 }
    const translated = translateConnector(endpoints, -.5, .5)
    expect(translated.x1).toBe(0)
    expect(translated.y1).toBeCloseTo(.7)
    expect(translated.x2).toBeCloseTo(.2)
    expect(translated.y2).toBeCloseTo(.9)

    const quadratic = { ...endpoints, cx: .2, cy: .3 }
    expect(nudgeConnector(quadratic, 'start', .1, -.1)).toEqual({ x1: .2, y1: .1, x2: .3, y2: .4, cx: .2, cy: .3 })
    const bodyNudge = nudgeConnector(quadratic, 'body', .9, 0)
    expect(bodyNudge.x1).toBeCloseTo(.8)
    expect(bodyNudge.x2).toBe(1)
    expect(bodyNudge.cx).toBeCloseTo(.9)
    expect(bodyNudge.cy).toBe(.3)
  })

  it('compares persisted geometry by value, not by key order or presence of undefined', () => {
    expect(persistedGeometrySignature({ x: .1, y: .2 })).toBe(persistedGeometrySignature({ y: .2, x: .1, width: undefined }))
    expect(persistedGeometrySignature(undefined)).toBe(persistedGeometrySignature({}))
    expect(persistedGeometrySignature({ x: .1, y: .2 })).not.toBe(persistedGeometrySignature({ x: .1, y: .2, width: .3 }))
    expect(persistedGeometrySignature({ x1: 0, y1: 0, x2: 1, y2: 1 })).not.toBe(persistedGeometrySignature({ x1: 0, y1: 0, x2: 1, y2: 1, cx: .5, cy: .5 }))
  })

  it('approximates a cubic with the quadratic through the cubic midpoint', () => {
    const start = { x: 0, y: 0 }
    const c1 = { x: .1, y: .3 }
    const c2 = { x: .5, y: .4 }
    const end = { x: .8, y: 0 }
    const control = quadraticControlForCubic(start, c1, c2, end)

    // Q = (3(C1 + C2) − (P0 + P3)) / 4.
    expect(control.x).toBeCloseTo((3 * (.1 + .5) - .8) / 4)
    expect(control.y).toBeCloseTo(3 * (.3 + .4) / 4)

    // The defining property of the midpoint approximation: the quadratic
    // passes through the cubic's own midpoint B₃(½) = (P0 + 3C1 + 3C2 + P3)/8.
    const cubicMidY = (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8
    const quadraticMidY = (start.y + 2 * control.y + end.y) / 4
    expect(quadraticMidY).toBeCloseTo(cubicMidY)

    // A degree-elevated straight cubic converts back to its chord midpoint,
    // so materializing a visually straight leader stays visually straight.
    const straight = quadraticControlForCubic({ x: 0, y: 0 }, { x: 1 / 3, y: 1 / 3 }, { x: 2 / 3, y: 2 / 3 }, { x: 1, y: 1 })
    expect(straight.x).toBeCloseTo(.5)
    expect(straight.y).toBeCloseTo(.5)
  })

  it('nudges the quadratic control point alone, clamped to the slide', () => {
    const quadratic = { x1: .1, y1: .2, x2: .3, y2: .4, cx: .5, cy: .01 }
    expect(nudgeConnector(quadratic, 'control', .01, -.05)).toEqual({ x1: .1, y1: .2, x2: .3, y2: .4, cx: .51, cy: 0 })
    // A control nudge on a straight connector changes nothing.
    expect(nudgeConnector({ x1: .1, y1: .2, x2: .3, y2: .4 }, 'control', .01, .01)).toEqual({ x1: .1, y1: .2, x2: .3, y2: .4 })
  })

  it('accepts only the public source-local document shape', () => {
    expect(validateDrawnAnnotationGeometry({
      label: { x: .5, y: .25, width: .2 },
      connector: { start: { x: 0, y: 1 }, end: { x: 1, y: 0 } },
    })).toEqual({
      label: { x: .5, y: .25, width: .2 },
      connector: { start: { x: 0, y: 1 }, end: { x: 1, y: 0 } },
    })
    expect(validateDrawnAnnotationGeometry({
      connector: { start: { x: .1, y: .2 }, control: { x: .3, y: .4 }, end: { x: .5, y: .6 } },
    })).toEqual({ connector: { start: { x: .1, y: .2 }, control: { x: .3, y: .4 }, end: { x: .5, y: .6 } } })
    expect(validateDrawnAnnotationGeometry({
      connector: { type: 'quadratic', start: { x: .1, y: .2 }, control: { x: .3, y: .4 }, end: { x: .5, y: .6 } },
    })).toEqual({ connector: { start: { x: .1, y: .2 }, control: { x: .3, y: .4 }, end: { x: .5, y: .6 } } })
    // The theme's published API carries no backward compatibility: the
    // pre-quadratic editor's polyline shape is rejected, not adapted.
    expect(() => validateDrawnAnnotationGeometry({
      connector: { type: 'polyline', points: [{ x: .1, y: .2 }, { x: .3, y: .4 }, { x: .5, y: .6 }] },
    })).toThrow(/connector/)
    expect(() => validateDrawnAnnotationGeometry({ connector: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, unexpected: true } })).toThrow(/connector/)
    expect(() => validateDrawnAnnotationGeometry({ label: { x: 1.1, y: 0 } })).toThrow(/fractions/)
    expect(() => validateDrawnAnnotationGeometry({ label: { x: 0, y: 0, width: .01 } })).toThrow(/width/)
  })
})
