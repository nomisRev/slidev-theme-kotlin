import { describe, expect, it } from 'vitest'
import {
  annotationDrafts,
  annotationEditorActionsFor,
  annotationEditorRegistryVersion,
  annotationGeometryVersion,
  claimAnnotationSelection,
  clearAnnotationSelection,
  migrateAnnotationLocator,
  recordAnnotationUndo,
  registerAnnotationEditorActions,
  releaseAnnotationSelection,
  selectAnnotation,
  selectedAnnotationId,
  selectedAnnotationPart,
  setLabelDraft,
  takeAnnotationUndo,
} from './editor-store'
import type { AnnotationEditorActions } from './editor-store'

function actions(): AnnotationEditorActions {
  return { isManualConnector: () => false, toggleConnectorAttachment: async () => {}, persistedGeometry: () => ({}) }
}

describe('annotation editor store', () => {
  it('moves selection, draft, undo history and actions to a changed locator', () => {
    const registered = actions()
    const unregister = registerAnnotationEditorActions('old', registered)
    selectAnnotation('old', 'width')
    setLabelDraft('old', { x: .1, y: .2 })
    recordAnnotationUndo('old', { x: .3, y: .4 })
    recordAnnotationUndo('other', null)
    const drafts = annotationGeometryVersion.value
    const registry = annotationEditorRegistryVersion.value

    migrateAnnotationLocator('old', 'new')

    expect(selectedAnnotationId.value).toBe('new')
    expect(selectedAnnotationPart.value).toBe('width')
    expect(annotationDrafts.get('old')).toBeUndefined()
    expect(annotationDrafts.get('new')).toEqual({ x: .1, y: .2 })
    expect(annotationGeometryVersion.value).toBe(drafts + 1)
    expect(annotationEditorActionsFor('old')).toBeUndefined()
    expect(annotationEditorActionsFor('new')).toBe(registered)
    expect(annotationEditorRegistryVersion.value).toBe(registry + 1)
    expect(takeAnnotationUndo('old')).toBeUndefined()
    expect(takeAnnotationUndo('new')).toEqual({ locator: 'new', geometry: { x: .3, y: .4 } })
    expect(takeAnnotationUndo('other')).toEqual({ locator: 'other', geometry: null })

    // Unmounting after a migration still removes the component's actions.
    unregister()
    expect(annotationEditorActionsFor('new')).toBeUndefined()
    clearAnnotationSelection()
    annotationDrafts.clear()
  })

  it('leaves other annotations and a same-locator migration untouched', () => {
    const other = actions()
    registerAnnotationEditorActions('other', other)
    selectAnnotation('other')
    setLabelDraft('other', { width: .5 })
    const drafts = annotationGeometryVersion.value
    const registry = annotationEditorRegistryVersion.value

    migrateAnnotationLocator('old', 'new')
    migrateAnnotationLocator('other', 'other')

    expect(selectedAnnotationId.value).toBe('other')
    expect(annotationDrafts.get('other')).toEqual({ width: .5 })
    expect(annotationEditorActionsFor('other')).toBe(other)
    expect(annotationEditorActionsFor('new')).toBeUndefined()
    expect(annotationGeometryVersion.value).toBe(drafts)
    expect(annotationEditorRegistryVersion.value).toBe(registry)
    clearAnnotationSelection()
    annotationDrafts.clear()
  })

  it('does not let a stale unregister remove a newer registration', () => {
    const first = actions()
    const second = actions()
    const unregisterFirst = registerAnnotationEditorActions('shared', first)
    registerAnnotationEditorActions('shared', second)
    unregisterFirst()
    expect(annotationEditorActionsFor('shared')).toBe(second)
  })

  it('hands a selection from an unmounting annotation to its remounted successor', () => {
    selectAnnotation('tag', 'width')
    releaseAnnotationSelection('tag')
    // Nothing stays selected while the annotation is gone.
    expect(selectedAnnotationId.value).toBeUndefined()
    expect(selectedAnnotationPart.value).toBeUndefined()
    claimAnnotationSelection('other')
    expect(selectedAnnotationId.value).toBeUndefined()
    claimAnnotationSelection('tag')
    expect(selectedAnnotationId.value).toBe('tag')
    expect(selectedAnnotationPart.value).toBe('width')
    // A claim is single use.
    clearAnnotationSelection()
    claimAnnotationSelection('tag')
    expect(selectedAnnotationId.value).toBeUndefined()
  })

  it('ignores releases of unselected annotations and drops a release once the author moves on', () => {
    selectAnnotation('tag')
    releaseAnnotationSelection('other')
    expect(selectedAnnotationId.value).toBe('tag')

    releaseAnnotationSelection('tag')
    selectAnnotation('other')
    claimAnnotationSelection('tag')
    expect(selectedAnnotationId.value).toBe('other')

    clearAnnotationSelection()
    selectAnnotation('tag')
    releaseAnnotationSelection('tag')
    clearAnnotationSelection()
    claimAnnotationSelection('tag')
    expect(selectedAnnotationId.value).toBeUndefined()
  })
})
