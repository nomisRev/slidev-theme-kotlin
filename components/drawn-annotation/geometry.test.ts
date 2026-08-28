import { describe, expect, it } from 'vitest'
import { localPointToSlideFraction, slideFractionPointToLocal, validateDrawnAnnotationGeometry } from './geometry'

describe('DrawnAnnotation source geometry', () => {
  const slide = { left: 100, top: 50, width: 1600, height: 900 }
  // A nested overlay is deliberately offset and scaled differently from slide.
  const overlay = { left: 500, top: 200, width: 800, height: 450 }
  const canvas = { width: 400, height: 225 }

  it('round-trips normalized points through a nested SVG canvas', () => {
    const point = { x: .625, y: .25 }
    expect(localPointToSlideFraction(slideFractionPointToLocal(point, slide, overlay, canvas), slide, overlay, canvas)).toEqual(point)
  })

  it('accepts only the public source-local document shape', () => {
    expect(validateDrawnAnnotationGeometry({
      label: { x: .5, y: .25, width: .2 },
      connector: { start: { x: 0, y: 1 }, end: { x: 1, y: 0 } },
    })).toEqual({
      label: { x: .5, y: .25, width: .2 },
      connector: { start: { x: 0, y: 1 }, end: { x: 1, y: 0 } },
    })
    expect(() => validateDrawnAnnotationGeometry({ label: { x: 1.1, y: 0 } })).toThrow(/fractions/)
    expect(() => validateDrawnAnnotationGeometry({ label: { x: 0, y: 0, width: .01 } })).toThrow(/width/)
  })
})
