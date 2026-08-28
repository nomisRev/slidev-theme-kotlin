/** Geometry shared by the annotation renderer and its future development editor. */
export interface ViewportBox {
  left: number
  top: number
  width: number
  height: number
}

export interface LocalCanvas {
  width: number
  height: number
}

export interface PersistedLabelGeometry {
  /** Fractions of the concrete Slidev slide, never CSS percentages. */
  x?: number
  y?: number
  width?: number
}

/** A manually authored leader line, expressed in concrete-slide fractions. */
export interface ManualConnectorGeometry {
  x1?: number
  y1?: number
  x2?: number
  y2?: number
}

export type PersistedAnnotationGeometry = PersistedLabelGeometry & ManualConnectorGeometry

export interface FractionPoint {
  x: number
  y: number
}

export const DRAWN_ANNOTATION_ID = /^[A-Za-z][A-Za-z0-9_.-]*$/

/**
 * CSS custom properties are intentionally parsed strictly. `getComputedStyle`
 * returns an empty string for absent properties, and invalid generated CSS must
 * fall back to authored props rather than creating a NaN SVG path.
 */
export function readUnitFraction(value: string | undefined, min = 0, max = 1): number | undefined {
  if (value === undefined)
    return undefined
  const trimmed = value.trim()
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed))
    return undefined
  const result = Number(trimmed)
  return Number.isFinite(result) && result >= min && result <= max ? result : undefined
}

export function readPersistedLabelGeometry(style: CSSStyleDeclaration): PersistedAnnotationGeometry {
  return {
    x: readUnitFraction(style.getPropertyValue('--da-label-x')),
    y: readUnitFraction(style.getPropertyValue('--da-label-y')),
    // A zero-width label is not useful, and rejecting it gives malformed CSS
    // the same safe fallback as the other values.
    width: readUnitFraction(style.getPropertyValue('--da-label-width'), 0.02, 1),
    x1: readUnitFraction(style.getPropertyValue('--da-connector-x1')),
    y1: readUnitFraction(style.getPropertyValue('--da-connector-y1')),
    x2: readUnitFraction(style.getPropertyValue('--da-connector-x2')),
    y2: readUnitFraction(style.getPropertyValue('--da-connector-y2')),
  }
}

/** Convert a persisted slide fraction to the local SVG coordinate system. */
export function slideFractionToLocal(fraction: number, axis: 'x' | 'y', slide: ViewportBox, overlay: ViewportBox, canvas: LocalCanvas): number {
  const slidePoint = axis === 'x' ? slide.left + slide.width * fraction : slide.top + slide.height * fraction
  const overlayStart = axis === 'x' ? overlay.left : overlay.top
  const overlaySize = axis === 'x' ? overlay.width : overlay.height
  const canvasSize = axis === 'x' ? canvas.width : canvas.height
  return (slidePoint - overlayStart) * canvasSize / overlaySize
}

/** Convert a local SVG coordinate back to a fraction of the concrete slide. */
export function localToSlideFraction(point: number, axis: 'x' | 'y', slide: ViewportBox, overlay: ViewportBox, canvas: LocalCanvas): number {
  const overlayStart = axis === 'x' ? overlay.left : overlay.top
  const overlaySize = axis === 'x' ? overlay.width : overlay.height
  const canvasSize = axis === 'x' ? canvas.width : canvas.height
  const slideStart = axis === 'x' ? slide.left : slide.top
  const slideSize = axis === 'x' ? slide.width : slide.height
  return (overlayStart + point * overlaySize / canvasSize - slideStart) / slideSize
}

/**
 * Reconcile a save response without replacing pointer movement that happened
 * while the request was in flight. The writer rounds values to its canonical
 * CSS precision, but only fields that still equal the sent snapshot may be
 * replaced with that rounded value.
 */
export function reconcileSavedDraft(current: PersistedAnnotationGeometry | undefined, sent: PersistedAnnotationGeometry, persisted: PersistedAnnotationGeometry): PersistedAnnotationGeometry | undefined {
  if (!current)
    return current
  const reconciled = { ...current }
  for (const key of Object.keys(sent) as (keyof PersistedAnnotationGeometry)[]) {
    if (current[key] === sent[key] && persisted[key] !== undefined)
      reconciled[key] = persisted[key]
  }
  return reconciled
}

/** True when all local preview values are now represented by persisted CSS. */
export function draftMatchesPersisted(draft: PersistedAnnotationGeometry | undefined, persisted: PersistedAnnotationGeometry) {
  return !!draft && Object.entries(draft).every(([key, value]) => persisted[key as keyof PersistedAnnotationGeometry] === value)
}

/**
 * Snap each axis independently. This permits a connector endpoint to align
 * with a vertical guide without forcing its height to an unrelated point.
 * Callers provide only concrete slide fractions, making this independent of
 * nested SVG canvases and presentation scale.
 */
export function snapFractionPoint(point: FractionPoint, candidates: readonly FractionPoint[], threshold = 0.012): FractionPoint {
  const nearest = (value: number, axis: 'x' | 'y') => {
    let result = value
    let distance = threshold
    for (const candidate of candidates) {
      const candidateValue = candidate[axis]
      const nextDistance = Math.abs(value - candidateValue)
      if (nextDistance <= distance) {
        result = candidateValue
        distance = nextDistance
      }
    }
    return result
  }
  return { x: nearest(point.x, 'x'), y: nearest(point.y, 'y') }
}
