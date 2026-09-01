/** Geometry shared by the annotation renderer and development editor. */
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

/**
 * Source-local geometry for a DrawnAnnotation.
 *
 * Every value is a fraction of the concrete `.slidev-layout`, rather than of
 * an annotation's (possibly nested) SVG overlay. This is deliberately the
 * public shape accepted by the component's `geometry` prop and persisted in a
 * Markdown `:geometry` binding.
 */
export interface DrawnAnnotationGeometry {
  label?: {
    x: number
    y: number
    width?: number
  }
  connector?: {
    start: FractionPoint
    end: FractionPoint
    /** Optional Bézier control point for a curved quadratic connector. */
    control?: FractionPoint
  }
}

/** The smallest useful source-authored label width, as a slide-width fraction. */
export const MIN_NORMALIZED_LABEL_WIDTH = 0.02

/** True only for finite coordinates inside the concrete slide. */
export function isNormalizedFraction(value: unknown, minimum = 0, maximum = 1): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

/**
 * Validate and clone geometry received from a Vue binding or editor request.
 * Unknown keys are rejected so a malformed source binding cannot silently
 * become a different persisted document shape. A label has a position as a
 * unit; a connector has both endpoints as a unit.
 */
export function validateDrawnAnnotationGeometry(value: unknown): DrawnAnnotationGeometry {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('geometry must be an object')

  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).some(key => key !== 'label' && key !== 'connector'))
    throw new Error('geometry has an unknown property')

  const geometry: DrawnAnnotationGeometry = {}
  if (candidate.label !== undefined) {
    const label = candidate.label
    if (!label || typeof label !== 'object' || Array.isArray(label))
      throw new Error('geometry.label must be an object')
    const fields = label as Record<string, unknown>
    if (Object.keys(fields).some(key => key !== 'x' && key !== 'y' && key !== 'width'))
      throw new Error('geometry.label has an unknown property')
    if (!isNormalizedFraction(fields.x) || !isNormalizedFraction(fields.y))
      throw new Error('geometry.label x and y must be finite fractions from 0 to 1')
    if (fields.width !== undefined && !isNormalizedFraction(fields.width, MIN_NORMALIZED_LABEL_WIDTH))
      throw new Error(`geometry.label width must be a finite fraction from ${MIN_NORMALIZED_LABEL_WIDTH} to 1`)
    geometry.label = { x: fields.x, y: fields.y, ...(fields.width === undefined ? {} : { width: fields.width }) }
  }

  if (candidate.connector !== undefined) {
    const connector = candidate.connector
    if (!connector || typeof connector !== 'object' || Array.isArray(connector))
      throw new Error('geometry.connector must be an object')
    const fields = connector as Record<string, unknown>
    const point = (input: unknown, name: string): FractionPoint => {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error(`geometry.connector.${name} must be an object`)
      const coordinates = input as Record<string, unknown>
      if (Object.keys(coordinates).some(key => key !== 'x' && key !== 'y')
        || !isNormalizedFraction(coordinates.x) || !isNormalizedFraction(coordinates.y))
        throw new Error(`geometry.connector.${name} must contain finite x and y fractions from 0 to 1`)
      return { x: coordinates.x, y: coordinates.y }
    }

    if (Object.keys(fields).every(key => key === 'start' || key === 'control' || key === 'end')) {
      geometry.connector = {
        start: point(fields.start, 'start'),
        ...(fields.control === undefined ? {} : { control: point(fields.control, 'control') }),
        end: point(fields.end, 'end'),
      }
    }
    // The writer serializes a curved connector with an explicit tag; a tagged
    // quadratic must carry its control point.
    else if (fields.type === 'quadratic'
      && Object.keys(fields).every(key => key === 'type' || key === 'start' || key === 'control' || key === 'end')) {
      geometry.connector = {
        start: point(fields.start, 'start'),
        control: point(fields.control, 'control'),
        end: point(fields.end, 'end'),
      }
    }
    else {
      throw new Error('geometry.connector must be `{ start, control?, end }` or a tagged quadratic')
    }
  }
  return geometry
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
  /** Quadratic Bézier control point, retained independently of its endpoints. */
  cx?: number
  cy?: number
}

export type PersistedAnnotationGeometry = PersistedLabelGeometry & ManualConnectorGeometry

export interface FractionPoint {
  x: number
  y: number
}

/** The two fraction endpoints of a manually positioned connector. */
export interface ConnectorEndpoints {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Optional quadratic control point. `cx` and `cy` are always moved together. */
  cx?: number
  cy?: number
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

/** Convert a normalized point between a concrete slide and a local SVG. */
export function slideFractionPointToLocal(point: FractionPoint, slide: ViewportBox, overlay: ViewportBox, canvas: LocalCanvas): FractionPoint {
  return {
    x: slideFractionToLocal(point.x, 'x', slide, overlay, canvas),
    y: slideFractionToLocal(point.y, 'y', slide, overlay, canvas),
  }
}

/** Convert a local SVG point to the concrete slide's normalized coordinates. */
export function localPointToSlideFraction(point: FractionPoint, slide: ViewportBox, overlay: ViewportBox, canvas: LocalCanvas): FractionPoint {
  return {
    x: localToSlideFraction(point.x, 'x', slide, overlay, canvas),
    y: localToSlideFraction(point.y, 'y', slide, overlay, canvas),
  }
}

/**
 * Translate a connector without ever changing its length or angle. Movement is
 * constrained as a whole at slide edges: independently clamping endpoint two
 * after endpoint one has hit an edge would silently turn a body drag into a
 * resize.
 */
export function translateConnector(connector: ConnectorEndpoints, dx: number, dy: number): ConnectorEndpoints {
  // A quadratic connector's complete control polygon must remain in bounds.
  // Bounding only its endpoints lets the control point hit an edge first and
  // then freeze there, silently changing the curve during a body movement.
  const hasControl = connector.cx !== undefined && connector.cy !== undefined
  const boundedDelta = (points: readonly number[], delta: number) => Math.max(
    Math.max(...points.map(point => -point)),
    Math.min(Math.min(...points.map(point => 1 - point)), delta),
  )
  const boundedX = boundedDelta([connector.x1, connector.x2, ...(hasControl ? [connector.cx!] : [])], dx)
  const boundedY = boundedDelta([connector.y1, connector.y2, ...(hasControl ? [connector.cy!] : [])], dy)
  return {
    x1: connector.x1 + boundedX,
    y1: connector.y1 + boundedY,
    x2: connector.x2 + boundedX,
    y2: connector.y2 + boundedY,
    ...(hasControl ? { cx: connector.cx! + boundedX, cy: connector.cy! + boundedY } : {}),
  }
}

/** Convert a fitted local-SVG label width to the persisted slide fraction. */
export function localLabelWidthToSlideFraction(localWidth: number, localCanvasWidth: number, overlayWidth: number, slideWidth: number) {
  return localWidth / localCanvasWidth * overlayWidth / slideWidth
}

/** Keep keyboard label-width edits within the same writer contract as drags. */
export function nudgeLabelWidth(width: number, delta: number) {
  return Math.max(.02, Math.min(1, width + delta))
}

/**
 * Apply a keyboard nudge without giving body movement different geometry
 * semantics than a pointer drag. In particular, independently clamping both
 * endpoints would shorten a body-selected connector at a slide edge.
 */
export function nudgeConnector(connector: ConnectorEndpoints, part: 'start' | 'end' | 'body', dx: number, dy: number): ConnectorEndpoints {
  if (part === 'body')
    return translateConnector(connector, dx, dy)

  const next = { ...connector }
  if (part === 'start') {
    next.x1 = Math.max(0, Math.min(1, next.x1 + dx))
    next.y1 = Math.max(0, Math.min(1, next.y1 + dy))
  }
  else {
    next.x2 = Math.max(0, Math.min(1, next.x2 + dx))
    next.y2 = Math.max(0, Math.min(1, next.y2 + dy))
  }
  return next
}
