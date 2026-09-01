import { describe, expect, it } from 'vitest'
import {
  activeAnnotationGestures,
  annotationDrafts,
  annotationEditorActionsFor,
  annotationEditorRegistryVersion,
  annotationGeometryVersion,
  annotationLabelLayoutVersion,
  beginAnnotationDraftGesture,
  claimAnnotationSelection,
  clearAnnotationSelection,
  clearLabelDraftFields,
  endAnnotationDraftGesture,
  migrateAnnotationLocator,
  recordAnnotationUndo,
  registerAnnotationEditorActions,
  releaseAnnotationSelection,
  replaceLabelDraft,
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

  it('coalesces dependent label-layout invalidation during a gesture while retaining per-draft updates', () => {
    const geometry = annotationGeometryVersion.value
    const layout = annotationLabelLayoutVersion.value

    beginAnnotationDraftGesture('dragged', 'label')
    setLabelDraft('dragged', { x: .1, y: .2 })
    setLabelDraft('dragged', { x: .2, y: .3 })
    setLabelDraft('dragged', { x: .3, y: .4 })
    endAnnotationDraftGesture('dragged', 'label')

    // The owner can observe all three geometry changes, but other labels only
    // re-place once on grab and once on release.
    expect(annotationGeometryVersion.value).toBe(geometry + 3)
    expect(annotationLabelLayoutVersion.value).toBe(layout + 2)
    annotationDrafts.clear()
  })

  it('counts in-flight gestures of every kind for the session-level Escape handler', () => {
    expect(activeAnnotationGestures.value).toBe(0)
    beginAnnotationDraftGesture('a', 'label')
    beginAnnotationDraftGesture('b', 'connector')
    expect(activeAnnotationGestures.value).toBe(2)
    endAnnotationDraftGesture('b', 'connector')
    expect(activeAnnotationGestures.value).toBe(1)
    endAnnotationDraftGesture('a', 'label')
    endAnnotationDraftGesture('a', 'label')
    // A double end never goes negative, so a stray event cannot wedge Escape.
    expect(activeAnnotationGestures.value).toBe(0)
    annotationDrafts.clear()
  })

  it('replaces a draft with an exact snapshot instead of merging, and null clears it', () => {
    setLabelDraft('tag', { x: .1, y: .2, width: .3 })
    replaceLabelDraft('tag', { x1: 0, y1: 0, x2: 1, y2: 1 })
    // No label fields survive the replacement: Undo restores the snapshot as
    // it was recorded, not a merge of old and new.
    expect(annotationDrafts.get('tag')).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 })
    replaceLabelDraft('tag', null)
    expect(annotationDrafts.get('tag')).toBeUndefined()
    annotationDrafts.clear()
  })

  it('clears one part of a draft while keeping uncommitted edits to the other', () => {
    setLabelDraft('tag', { x: .1, y: .2, x1: 0, y1: 0, x2: 1, y2: 1, cx: .5, cy: .5 })
    clearLabelDraftFields('tag', 'connector')
    expect(annotationDrafts.get('tag')).toEqual({ x: .1, y: .2 })
    clearLabelDraftFields('tag', 'label')
    // A draft with nothing left disappears entirely.
    expect(annotationDrafts.get('tag')).toBeUndefined()
    clearLabelDraftFields('tag', 'label')
    expect(annotationDrafts.get('tag')).toBeUndefined()
    annotationDrafts.clear()
  })

  it('restores undo snapshots as local drafts', () => {
    setLabelDraft('tag', { x: .5, y: .5 })
    recordAnnotationUndo('tag', null)
    setLabelDraft('tag', { x: .6 })
    recordAnnotationUndo('tag', { x: .5, y: .5 })

    const last = takeAnnotationUndo('tag')!
    replaceLabelDraft(last.locator, last.geometry)
    expect(annotationDrafts.get('tag')).toEqual({ x: .5, y: .5 })

    const first = takeAnnotationUndo('tag')!
    replaceLabelDraft(first.locator, first.geometry)
    expect(annotationDrafts.get('tag')).toBeUndefined()
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
