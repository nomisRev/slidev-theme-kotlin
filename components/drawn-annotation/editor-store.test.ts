import { describe, expect, it } from 'vitest'
import { annotationDrafts, annotationGeometryVersion, clearAllAnnotationDrafts, clearAnnotationSelection, recordAnnotationUndo, selectAnnotation, selectedAnnotationId, selectedAnnotationPart, setLabelDraft, takeAnnotationUndo } from './editor-store'

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

  it('records the selected control and clears stale slide selection', () => {
    clearAnnotationSelection()
    selectAnnotation('connector-alpha', 'end')
    expect(selectedAnnotationId.value).toBe('connector-alpha')
    expect(selectedAnnotationPart.value).toBe('end')

    // A different preloaded annotation cannot clear the current slide's target.
    clearAnnotationSelection('other-annotation')
    expect(selectedAnnotationId.value).toBe('connector-alpha')
    clearAnnotationSelection('connector-alpha')
    expect(selectedAnnotationId.value).toBeUndefined()
    expect(selectedAnnotationPart.value).toBeUndefined()
  })

  it('clears every in-memory preview after a document-wide reset', () => {
    clearAllAnnotationDrafts()
    const version = annotationGeometryVersion.value
    setLabelDraft('reset-alpha', { x: .1 })
    setLabelDraft('reset-beta', { x1: .2, y1: .3, x2: .4, y2: .5 })

    clearAllAnnotationDrafts()

    expect(annotationDrafts.size).toBe(0)
    expect(annotationGeometryVersion.value).toBeGreaterThan(version)
  })
})
