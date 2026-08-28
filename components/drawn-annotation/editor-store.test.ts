import { describe, expect, it } from 'vitest'
import { recordAnnotationUndo, takeAnnotationUndo } from './editor-store'

describe('DrawnAnnotation editor undo history', () => {
  it('keeps independent persisted snapshots per annotation and returns newest first', () => {
    recordAnnotationUndo('undo-label', { x: .1, y: .2 })
    recordAnnotationUndo('undo-other', null)
    recordAnnotationUndo('undo-label', { x: .3, y: .4, width: .5 })

    expect(takeAnnotationUndo('undo-label')).toEqual({ id: 'undo-label', geometry: { x: .3, y: .4, width: .5 } })
    expect(takeAnnotationUndo('undo-label')).toEqual({ id: 'undo-label', geometry: { x: .1, y: .2 } })
    expect(takeAnnotationUndo('undo-label')).toBeUndefined()
    expect(takeAnnotationUndo('undo-other')).toEqual({ id: 'undo-other', geometry: null })
  })
})
