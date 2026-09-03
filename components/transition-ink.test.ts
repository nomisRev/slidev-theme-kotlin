import { describe, expect, it } from 'vitest'
import { rememberTransitionInk, takeTransitionInk } from './transition-ink'

const box = { left: .1, top: .2, right: .3, bottom: .25 }

describe('transition ink hand-off', () => {
  it('carries identical ink between adjacent pages exactly once', () => {
    rememberTransitionInk('identical', 10, box)

    expect(takeTransitionInk('identical', 11, box)).toBe(true)
    expect(takeTransitionInk('identical', 11, box)).toBe(false)
  })

  it('does not carry ink from a non-adjacent page or to a moved target', () => {
    rememberTransitionInk('non-adjacent', 10, box)
    expect(takeTransitionInk('non-adjacent', 12, box)).toBe(false)

    rememberTransitionInk('moved', 10, box)
    expect(takeTransitionInk('moved', 11, { ...box, top: .21, bottom: .26 })).toBe(false)
  })

  it('accepts sub-pixel layout differences at the standard slide size', () => {
    rememberTransitionInk('sub-pixel', 10, box)
    expect(takeTransitionInk('sub-pixel', 11, { ...box, left: .101, right: .301 })).toBe(true)
  })
})
