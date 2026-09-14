/** Public types for the development-only DrawnAnnotation source writer. */

export interface DrawnAnnotationLabelGeometry { x: number, y: number, width?: number }
export interface DrawnAnnotationGeometryPatch {
  label?: DrawnAnnotationLabelGeometry | null
  connector?: {
    /** Present on curved connectors, mirroring `serializeGeometry`'s output. */
    type?: 'quadratic'
    start: { x: number, y: number }
    control?: { x: number, y: number }
    end: { x: number, y: number }
  } | null
}
export interface DrawnAnnotationEditorOptions {}

export interface DrawnAnnotationTag { start: number, end: number, text: string }

export declare function validateGeometryPatch(value: unknown): DrawnAnnotationGeometryPatch
export declare function serializeGeometry(geometry: DrawnAnnotationGeometryPatch): string
export declare function findDrawnAnnotationTags(source: string): DrawnAnnotationTag[]
export declare function fingerprintDrawnAnnotationTag(tag: string): string
export declare function injectDrawnAnnotationLocators(source: string, file: string, fileSource?: string): string
/** `geometry` replaces the `:geometry` binding; `connect` writes that `:connect` literal, or removes the binding when `null`. Either may be omitted to leave that binding alone. */
export declare function patchDrawnAnnotationTag(tag: string, geometry?: DrawnAnnotationGeometryPatch, connect?: boolean | null): string
export declare function drawnAnnotationEditor(options?: DrawnAnnotationEditorOptions): {
  name: string
  apply: 'serve'
  configResolved: (config: { root: string }) => void
  transform: (code: string, id: string) => { code: string, map: null } | null
  configureServer: (server: { middlewares: { use: (handler: Function) => void } }) => void
}
