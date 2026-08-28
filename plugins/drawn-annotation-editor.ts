import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

export interface DrawnAnnotationLabelGeometry { x: number, y: number, width?: number }
export interface DrawnAnnotationGeometryPatch {
  label?: DrawnAnnotationLabelGeometry | null
  connector?: { start: { x: number, y: number }, end: { x: number, y: number } } | null
}
export interface DrawnAnnotationEditorOptions {}

const MAX_BODY_BYTES = 64 * 1024
const component = '<DrawnAnnotation'
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16)
const fraction = (value: unknown, min = 0) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= 1

/** Validate the only document shape the development writer accepts. */
export function validateGeometryPatch(value: unknown): DrawnAnnotationGeometryPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('geometry patch must be an object')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => key !== 'label' && key !== 'connector')) throw new Error('geometry patch has an unknown property')
  const point = (value: unknown, name: string) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`)
    const item = value as Record<string, unknown>
    if (Object.keys(item).some(key => key !== 'x' && key !== 'y') || !fraction(item.x) || !fraction(item.y)) throw new Error(`${name} must contain x and y fractions from 0 to 1`)
    return { x: item.x, y: item.y }
  }
  const result: DrawnAnnotationGeometryPatch = {}
  if (input.label !== undefined) {
    if (input.label === null) result.label = null
    else {
      const label = point(input.label, 'label') as DrawnAnnotationLabelGeometry
      const source = input.label as Record<string, unknown>
      if (Object.keys(source).some(key => key !== 'x' && key !== 'y' && key !== 'width') || (source.width !== undefined && !fraction(source.width, .02))) throw new Error('label width must be a fraction from 0.02 to 1')
      if (source.width !== undefined) label.width = source.width as number
      result.label = label
    }
  }
  if (input.connector !== undefined) {
    if (input.connector === null) result.connector = null
    else {
      const connector = input.connector as Record<string, unknown>
      if (Object.keys(connector).some(key => key !== 'start' && key !== 'end')) throw new Error('connector has an unknown property')
      result.connector = { start: point(connector.start, 'connector.start'), end: point(connector.end, 'connector.end') }
    }
  }
  return result
}

function format(value: number) { return value.toFixed(4) }
export function serializeGeometry(geometry: DrawnAnnotationGeometryPatch) {
  const parts: string[] = []
  if (geometry.label) parts.push(`label: { x: ${format(geometry.label.x)}, y: ${format(geometry.label.y)}${geometry.label.width === undefined ? '' : `, width: ${format(geometry.label.width)}`} }`)
  if (geometry.connector) parts.push(`connector: { start: { x: ${format(geometry.connector.start.x)}, y: ${format(geometry.connector.start.y)} }, end: { x: ${format(geometry.connector.end.x)}, y: ${format(geometry.connector.end.y)} } }`)
  return `{ ${parts.join(', ')} }`
}

interface Tag { start: number, end: number, text: string }
/** Finds opening component tags while respecting quoted Vue bindings. */
export function findDrawnAnnotationTags(source: string): Tag[] {
  const tags: Tag[] = []
  for (let start = source.indexOf(component); start >= 0; start = source.indexOf(component, start + component.length)) {
    let quote = ''; let braces = 0; let end = start + component.length
    for (; end < source.length; end++) {
      const char = source[end]
      if (quote) { if (char === quote && source[end - 1] !== '\\') quote = ''; continue }
      if (char === '"' || char === "'") { quote = char; continue }
      if (char === '{') braces++; else if (char === '}') braces--; else if (char === '>' && braces === 0) { end++; break }
    }
    if (end <= source.length) tags.push({ start, end, text: source.slice(start, end) })
  }
  return tags
}

function locator(file: string, tag: Tag, revision: string) { return Buffer.from(JSON.stringify({ file, start: tag.start, end: tag.end, fingerprint: hash(tag.text), revision })).toString('base64url') }
function decodeLocator(value: unknown) {
  if (typeof value !== 'string') throw new Error('a source locator is required')
  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!data || typeof data.file !== 'string' || !Number.isInteger(data.start) || !Number.isInteger(data.end) || typeof data.fingerprint !== 'string') throw new Error()
    if (typeof data.revision !== 'string') throw new Error()
    return data as { file: string, start: number, end: number, fingerprint: string, revision: string }
  } catch { throw new Error('invalid source locator') }
}

/** Add the opaque serve-only locator without modifying authored source. */
export function injectDrawnAnnotationLocators(source: string, file: string) {
  const tags = findDrawnAnnotationTags(source)
  let result = source
  for (const tag of [...tags].reverse()) {
    const value = locator(file, tag, hash(source))
    result = `${result.slice(0, tag.end - 1)} :__drawn-annotation-locator="${value}"${result.slice(tag.end - 1)}`
  }
  return result
}

function geometryBinding(tag: string) {
  const start = tag.search(/\s:geometry\s*=/)
  if (start < 0) return undefined
  const value = tag.indexOf('{', start)
  if (value < 0) throw new Error('geometry binding must contain an object literal')
  let depth = 0
  let quote = ''
  for (let index = value; index < tag.length; index++) {
    const character = tag[index]
    if (quote) {
      if (character === quote && tag[index - 1] !== '\\') quote = ''
      continue
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue }
    if (character === '{') depth++
    else if (character === '}' && --depth === 0) {
      // `:geometry` is a Vue bound attribute, normally quoted around the
      // object literal. Consume that closing quote with the binding so a
      // replacement cannot leave an extra quote in the opening tag.
      return { start, end: tag[index + 1] === '"' || tag[index + 1] === "'" ? index + 2 : index + 1 }
    }
  }
  throw new Error('geometry binding is incomplete')
}

/** Patch exactly one opening tag, preserving every unrelated character. */
export function patchDrawnAnnotationTag(tag: string, patch: DrawnAnnotationGeometryPatch) {
  // The writer owns only its binding. Existing source geometry is intentionally
  // replaced by the validated editor snapshot, never evaluated as JavaScript.
  const existing = geometryBinding(tag)
  const empty = !patch.label && !patch.connector
  if (existing)
    return empty ? `${tag.slice(0, existing.start)}${tag.slice(existing.end)}` : `${tag.slice(0, existing.start)} :geometry="${serializeGeometry(patch)}"${tag.slice(existing.end)}`
  if (empty)
    return tag
  // Vue permits self-closing component tags. Insert before the slash rather
  // than turning `<DrawnAnnotation />` into malformed markup.
  const close = /\/\s*>$/.test(tag) ? tag.lastIndexOf('/') : tag.length - 1
  return `${tag.slice(0, close)} :geometry="${serializeGeometry(patch)}"${tag.slice(close)}`
}

async function requestBody(request: any): Promise<unknown> {
  const chunks: Buffer[] = []; let length = 0
  for await (const chunk of request) { length += chunk.length; if (length > MAX_BODY_BYTES) throw new Error('request body is too large'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('request body must be JSON') }
}
function json(response: any, status: number, body: unknown) { response.statusCode = status; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(JSON.stringify(body)) }

export function drawnAnnotationEditor(_options: DrawnAnnotationEditorOptions = {}) {
  let root = ''; let writes = Promise.resolve()
  const serialized = <T>(operation: () => Promise<T>) => { const result = writes.then(operation, operation); writes = result.then(() => undefined, () => undefined); return result }
  return {
    name: 'slidev-theme-kotlin:drawn-annotation-editor', apply: 'serve' as const,
    configResolved(config: { root: string }) { root = resolve(config.root) },
    transform(code: string, id: string) {
      // Vite can append query parameters to module IDs. They describe the
      // module request, not a pathname and must never become part of a writer
      // locator.
      const pathname = id.split('?', 1)[0]
      if (!pathname.endsWith('.md') || !findDrawnAnnotationTags(code).length) return null
      const absolute = resolve(pathname); const file = relative(root, absolute)
      if (file.startsWith('..') || file === '') return null
      return { code: injectDrawnAnnotationLocators(code, file), map: null }
    },
    configureServer(server: { middlewares: { use: (handler: Function) => void } }) {
      server.middlewares.use(async (request: any, response: any, next: Function) => {
        if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/__drawn-annotation-source') return next()
        if (request.method === 'GET') return json(response, 200, { ok: true })
        if (request.method !== 'POST') return json(response, 405, { error: 'use POST' })
        try {
          const payload = await requestBody(request) as { locator?: unknown, expectedRevision?: unknown, geometry?: unknown }
          const result = await serialized(async () => {
            const token = decodeLocator(payload.locator); const path = resolve(root, token.file)
            if (relative(root, path).startsWith('..')) throw new Error('source file must stay under the Vite root')
            const source = await readFile(path, 'utf8'); const revision = hash(source)
            if (payload.expectedRevision !== revision) return { status: 409, body: { error: 'source changed; reload before saving', revision, recovery: 'Reload saved geometry before retrying.' } }
            const tag = source.slice(token.start, token.end)
            if (hash(tag) !== token.fingerprint || !tag.startsWith(component)) return { status: 409, body: { error: 'annotation source changed; refusing stale locator', revision, recovery: 'Reload the slide and select the annotation again.' } }
            const geometry = validateGeometryPatch(payload.geometry)
            const nextSource = `${source.slice(0, token.start)}${patchDrawnAnnotationTag(tag, geometry)}${source.slice(token.end)}`
            const temporary = `${path}.${randomUUID()}.tmp`
            try { await writeFile(temporary, nextSource, 'utf8'); await rename(temporary, path) } finally { await unlink(temporary).catch(() => {}) }
            return { status: 200, body: { geometry, revision: hash(nextSource) } }
          })
          return json(response, result.status, result.body)
        } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : 'unable to save annotation geometry' }) }
      })
    },
  }
}
