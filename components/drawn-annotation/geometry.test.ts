import { describe, expect, it } from 'vitest'
import { draftMatchesPersisted, DRAWN_ANNOTATION_ID, localToSlideFraction, readPersistedLabelGeometry, readUnitFraction, reconcileSavedDraft, slideFractionToLocal, snapFractionPoint } from './geometry'

describe('drawn annotation persisted geometry', () => {
  it('accepts only finite plain unit fractions', () => {
    expect(readUnitFraction(' .25 ')).toBe(.25)
    expect(readUnitFraction('1')).toBe(1)
    expect(readUnitFraction('-0.1')).toBeUndefined()
    expect(readUnitFraction('20%')).toBeUndefined()
    expect(readUnitFraction('calc(.2)')).toBeUndefined()
    expect(readUnitFraction('1.01')).toBeUndefined()
  })

  it('rejects a partial or unusable CSS geometry rule', () => {
    const values: Record<string, string> = {
      '--da-label-x': '.7125',
      '--da-label-y': 'invalid',
      '--da-label-width': '.1944',
    }
    const style = { getPropertyValue: (name: string) => values[name] ?? '' } as CSSStyleDeclaration
    expect(readPersistedLabelGeometry(style)).toEqual({ x: .7125, y: undefined, width: .1944, x1: undefined, y1: undefined, x2: undefined, y2: undefined })
  })

  it('converts through viewport scaling and a nested overlay without losing slide fractions', () => {
    const slide = { left: 100, top: 50, width: 720, height: 405 }
    const overlay = { left: 280, top: 131, width: 360, height: 202.5 }
    const canvas = { width: 1440, height: 810 }
    const point = slideFractionToLocal(.75, 'x', slide, overlay, canvas)
    expect(point).toBe(1440)
    expect(localToSlideFraction(point, 'x', slide, overlay, canvas)).toBeCloseTo(.75)
  })

  it('uses CSS-safe authored IDs', () => {
    expect(DRAWN_ANNOTATION_ID.test('nullable-return-label')).toBe(true)
    expect(DRAWN_ANNOTATION_ID.test('2bad')).toBe(false)
    expect(DRAWN_ANNOTATION_ID.test('bad selector]')).toBe(false)
  })

  it('keeps newer in-flight drag fields while canonicalizing saved fields', () => {
    const sent = { x: .123456, y: .25 }
    const current = { x: .3, y: .25, width: .4 }
    const persisted = { x: .1235, y: .25 }

    expect(reconcileSavedDraft(current, sent, persisted)).toEqual({ x: .3, y: .25, width: .4 })
    expect(draftMatchesPersisted(current, persisted)).toBe(false)
    expect(draftMatchesPersisted({ x: .1235, y: .25 }, persisted)).toBe(true)
  })

  it('snaps connector coordinates to nearby guides one axis at a time', () => {
    const guides = [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: 1, y: 1 }]
    expect(snapFractionPoint({ x: .493, y: .73 }, guides)).toEqual({ x: .5, y: .73 })
    expect(snapFractionPoint({ x: .493, y: .73 }, guides, .005)).toEqual({ x: .493, y: .73 })
    expect(snapFractionPoint({ x: .496, y: .504 }, guides)).toEqual({ x: .5, y: .5 })
  })
})
