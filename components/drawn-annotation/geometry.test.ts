import { describe, expect, it } from 'vitest'
import { localLabelWidthToSlideFraction, localPointToSlideFraction, nudgeLabelWidth, slideFractionPointToLocal, validateDrawnAnnotationGeometry } from './geometry'

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
    expect(validateDrawnAnnotationGeometry({
      connector: { type: 'polyline', points: [{ x: .1, y: .2 }, { x: .3, y: .4 }, { x: .5, y: .6 }] },
    })).toEqual({ connector: { start: { x: .1, y: .2 }, end: { x: .5, y: .6 } } })
    expect(() => validateDrawnAnnotationGeometry({ connector: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, unexpected: true } })).toThrow(/connector/)
    expect(() => validateDrawnAnnotationGeometry({ label: { x: 1.1, y: 0 } })).toThrow(/fractions/)
    expect(() => validateDrawnAnnotationGeometry({ label: { x: 0, y: 0, width: .01 } })).toThrow(/width/)
  })
})
