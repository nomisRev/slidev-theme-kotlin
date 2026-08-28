import { describe, expect, it } from 'vitest'
import { annotationDrafts, annotationEditorActionsFor, annotationEditorRegistryVersion, annotationGeometryVersion, clearAllAnnotationDrafts, clearAnnotationSelection, recordAnnotationUndo, recordAnnotationUndoOnce, registerAnnotationEditorActions, selectAnnotation, selectedAnnotationId, selectedAnnotationPart, setLabelDraft, takeAnnotationUndo } from './editor-store'

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

  it('records one pre-drag snapshot despite multiple debounced autosaves', () => {
    const session = {}
    recordAnnotationUndoOnce(session, 'long-drag', { x: .1, y: .2 })
    // A release save after an autosave must not replace the original undo
    // target with the intermediate value saved during the same gesture.
    recordAnnotationUndoOnce(session, 'long-drag', { x: .5, y: .6 })

    expect(takeAnnotationUndo('long-drag')).toEqual({ id: 'long-drag', geometry: { x: .1, y: .2 } })
    expect(takeAnnotationUndo('long-drag')).toBeUndefined()
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

  it('makes selected-instance connector actions available to the global toolbar only while mounted', async () => {
    const version = annotationEditorRegistryVersion.value
    let toggles = 0
    const unregister = registerAnnotationEditorActions('connector-alpha', {
      isManualConnector: () => toggles > 0,
      toggleConnectorAttachment: async () => { toggles++ },
    })

    const actions = annotationEditorActionsFor('connector-alpha')
    expect(actions?.isManualConnector()).toBe(false)
    await actions?.toggleConnectorAttachment()
    expect(actions?.isManualConnector()).toBe(true)
    expect(annotationEditorRegistryVersion.value).toBeGreaterThan(version)

    unregister()
    expect(annotationEditorActionsFor('connector-alpha')).toBeUndefined()
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
