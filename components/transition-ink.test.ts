import { describe, expect, it } from 'vitest'
import { handOverTransitionInk, rememberTransitionInk, takeTransitionInk } from './transition-ink'

const box = { left: .1, top: .2, right: .3, bottom: .25 }

describe('transition ink hand-off', () => {
  it('carries identical ink between adjacent pages exactly once', () => {
    handOverTransitionInk('identical', 10, box)

    expect(takeTransitionInk('identical', 11, box)).toBe(true)
    expect(takeTransitionInk('identical', 11, box)).toBe(false)
  })

  it('carries ink left behind on the same page to the instance replacing it', () => {
    rememberTransitionInk('remount', 10, box)

    expect(takeTransitionInk('remount', 10, box)).toBe(true)
    expect(takeTransitionInk('remount', 10, box)).toBe(false)
  })

  it('keeps handed-over ink for the neighbour and remounted ink for its own page', () => {
    handOverTransitionInk('for-neighbour', 10, box)
    expect(takeTransitionInk('for-neighbour', 10, box)).toBe(false)

    rememberTransitionInk('for-remount', 10, box)
    expect(takeTransitionInk('for-remount', 11, box)).toBe(false)
  })

  it('tells the page that handed ink over once it is taken', () => {
    let taken = 0
    handOverTransitionInk('told', 10, box, () => taken++)
    expect(takeTransitionInk('told', 12, box)).toBe(false)
    expect(taken).toBe(0)
    expect(takeTransitionInk('told', 9, box)).toBe(true)
    expect(taken).toBe(1)
  })

  it('does not carry ink from a non-adjacent page or to a moved target', () => {
    handOverTransitionInk('non-adjacent', 10, box)
    expect(takeTransitionInk('non-adjacent', 12, box)).toBe(false)

    handOverTransitionInk('moved', 10, box)
    expect(takeTransitionInk('moved', 11, { ...box, top: .21, bottom: .26 })).toBe(false)
  })

  it('accepts sub-pixel layout differences at the standard slide size', () => {
    handOverTransitionInk('sub-pixel', 10, box)
    expect(takeTransitionInk('sub-pixel', 11, { ...box, left: .101, right: .301 })).toBe(true)
  })
})
