import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export interface DrawnAnnotationLabelGeometry { x: number, y: number, width?: number }
export interface DrawnAnnotationGeometryPatch {
  label?: DrawnAnnotationLabelGeometry | null
  connector?: { start: { x: number, y: number }, end: { x: number, y: number } } | null
}
export interface DrawnAnnotationEditorOptions {}

const MAX_BODY_BYTES = 64 * 1024
const component = '<DrawnAnnotation'
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16)
/**
 * Slidev never feeds a Markdown file through Vite as one module. Every slide is
 * its own virtual module, `<file>__slidev_<n>.md`, whose code is that slide's
 * content. The writer must always address the file the author edits.
 */
const slidevSlideModule = /__slidev_\d+\.md$/
const fraction = (value: unknown, min = 0) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= 1

/** Whether candidate is root itself or a descendant, without prefix ambiguity. */
function isWithinRoot(root: string, candidate: string) {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

/** Validate the only document shape the development writer accepts. */
export function validateGeometryPatch(value: unknown): DrawnAnnotationGeometryPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('geometry patch must be an object')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => key !== 'label' && key !== 'connector')) throw new Error('geometry patch has an unknown property')
  const point = (value: unknown, name: string, allowed = ['x', 'y']) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`)
    const item = value as Record<string, unknown>
    if (Object.keys(item).some(key => !allowed.includes(key)) || !fraction(item.x) || !fraction(item.y)) throw new Error(`${name} must contain x and y fractions from 0 to 1`)
    return { x: item.x, y: item.y }
  }
  const result: DrawnAnnotationGeometryPatch = {}
  if (input.label !== undefined) {
    if (input.label === null) result.label = null
    else {
      const label = point(input.label, 'label', ['x', 'y', 'width']) as DrawnAnnotationLabelGeometry
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

/**
 * A locator names one opening tag of the real Markdown file by content, never
 * by offset: the code Vite hands to `transform` is usually a slide chunk whose
 * offsets mean nothing in the file. `ordinal` separates identical tags,
 * `line` is only shown to the author.
 *
 * The locator is the key for every piece of editor state in the browser, so
 * it must survive the writer's own edits: it carries no file revision (the
 * client fetches that out of band), and the fingerprint ignores the
 * `:geometry` binding, the only part of the tag the writer rewrites.
 */
interface Locator { file: string, fingerprint: string, ordinal: number, line: number }
function encodeLocator(value: Locator) { return Buffer.from(JSON.stringify(value)).toString('base64url') }
function decodeLocator(value: unknown): Locator {
  if (typeof value !== 'string') throw new Error('a source locator is required')
  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!data || typeof data.file !== 'string' || typeof data.fingerprint !== 'string') throw new Error()
    if (!Number.isInteger(data.ordinal) || data.ordinal < 0 || !Number.isInteger(data.line)) throw new Error()
    return { file: data.file, fingerprint: data.fingerprint, ordinal: data.ordinal, line: data.line }
  } catch { throw new Error('invalid source locator') }
}
/** The tag's identity: its text without the writer-owned `:geometry` binding. */
export function fingerprintDrawnAnnotationTag(tag: string) {
  let binding: { start: number, end: number } | undefined
  // A malformed binding cannot be patched later anyway; fingerprint it as is.
  try { binding = geometryBinding(tag) } catch {}
  return hash(binding ? `${tag.slice(0, binding.start)}${tag.slice(binding.end)}` : tag)
}
function lineAt(source: string, offset: number) { let line = 1; for (let index = source.indexOf('\n'); index >= 0 && index < offset; index = source.indexOf('\n', index + 1)) line++; return line }
/** Where `tag`, found in `source` (a chunk of `fileSource`), sits in the file. */
function locateInFile(source: string, tag: Tag, fileSource: string, fileTags: Tag[]) {
  const chunk = fileSource.indexOf(source)
  const fingerprint = fingerprintDrawnAnnotationTag(tag.text)
  const identical = fileTags.filter(candidate => fingerprintDrawnAnnotationTag(candidate.text) === fingerprint)
  // The chunk is normally a verbatim slice of the file, so the tag's file
  // position is exact. Otherwise only an unambiguous tag can be addressed.
  const match = chunk >= 0 ? identical.find(candidate => candidate.start === chunk + tag.start) : identical.length === 1 ? identical[0] : undefined
  return match && { fingerprint, ordinal: identical.indexOf(match), line: lineAt(fileSource, match.start) }
}

/**
 * Add the opaque serve-only locator without modifying authored source.
 *
 * The attribute is deliberately static: a bound `:__drawn-annotation-locator`
 * would make Vue evaluate the base64 token as a JavaScript expression, so the
 * component would receive `undefined` instead of the locator.
 */
export function injectDrawnAnnotationLocators(source: string, file: string, fileSource = source) {
  const fileTags = findDrawnAnnotationTags(fileSource)
  let result = source
  for (const tag of findDrawnAnnotationTags(source).reverse()) {
    const location = locateInFile(source, tag, fileSource, fileTags)
    // A tag the writer could not find again stays a plain, non-editable annotation.
    if (!location) continue
    const value = encodeLocator({ file, ...location })
    result = `${result.slice(0, tag.end - 1)} __drawn-annotation-locator="${value}"${result.slice(tag.end - 1)}`
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

/** The current revision of every transformed Markdown file, for the client's `expectedRevision`. */
async function currentRevisions(root: string, files: Iterable<string>) {
  const revisions: Record<string, string> = {}
  for (const file of files) {
    try { revisions[file] = hash(await readFile(resolve(root, file), 'utf8')) } catch {}
  }
  return revisions
}

export function drawnAnnotationEditor(_options: DrawnAnnotationEditorOptions = {}) {
  let root = ''; let writes = Promise.resolve()
  // Files that received locators. Their revisions live outside the locator so
  // a write never invalidates the locators of the annotations it rewrites.
  const files = new Set<string>()
  const serialized = <T>(operation: () => Promise<T>) => { const result = writes.then(operation, operation); writes = result.then(() => undefined, () => undefined); return result }
  return {
    name: 'slidev-theme-kotlin:drawn-annotation-editor', apply: 'serve' as const,
    configResolved(config: { root: string }) { root = resolve(config.root) },
    transform(code: string, id: string) {
      // Vite can append query parameters to module IDs. They describe the
      // module request, not a pathname and must never become part of a writer
      // locator.
      const pathname = id.split('?', 1)[0].replace(slidevSlideModule, '')
      if (!pathname.endsWith('.md') || !findDrawnAnnotationTags(code).length) return null
      // Vite normally supplies absolute IDs, but resolving a relative ID from
      // the configured root keeps the locator correct for programmatic use.
      const absolute = isAbsolute(pathname) ? resolve(pathname) : resolve(root, pathname)
      if (!isWithinRoot(root, absolute) || absolute === root) return null
      // Every tag position comes from the file on disk, the only source the
      // writer will ever read back.
      let fileSource: string
      try { fileSource = readFileSync(absolute, 'utf8') } catch { return null }
      const file = relative(root, absolute)
      files.add(file)
      return { code: injectDrawnAnnotationLocators(code, file, fileSource), map: null }
    },
    configureServer(server: { middlewares: { use: (handler: Function) => void } }) {
      server.middlewares.use(async (request: any, response: any, next: Function) => {
        if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/__drawn-annotation-source') return next()
        if (request.method === 'GET') return json(response, 200, { ok: true, revisions: await currentRevisions(root, files) })
        if (request.method !== 'POST') return json(response, 405, { error: 'use POST' })
        try {
          const payload = await requestBody(request) as { locator?: unknown, expectedRevision?: unknown, geometry?: unknown }
          const result = await serialized(async () => {
            if (Object.keys(payload).some(key => key !== 'locator' && key !== 'expectedRevision' && key !== 'geometry'))
              throw new Error('source writer payload has an unknown property')
            if (typeof payload.expectedRevision !== 'string')
              throw new Error('an expected source revision is required')
            const token = decodeLocator(payload.locator); const path = resolve(root, token.file)
            if (!isWithinRoot(root, path) || path === root) throw new Error('source file must stay under the Vite root')
            const source = await readFile(path, 'utf8'); const revision = hash(source)
            if (payload.expectedRevision !== revision) return { status: 409, body: { error: 'source changed; reload before saving', revision, recovery: 'Reload saved geometry before retrying.' } }
            const tag = findDrawnAnnotationTags(source).filter(candidate => fingerprintDrawnAnnotationTag(candidate.text) === token.fingerprint)[token.ordinal]
            if (!tag) return { status: 409, body: { error: 'annotation source changed; refusing stale locator', revision, recovery: 'Reload the slide and select the annotation again.' } }
            const geometry = validateGeometryPatch(payload.geometry)
            const nextSource = `${source.slice(0, tag.start)}${patchDrawnAnnotationTag(tag.text, geometry)}${source.slice(tag.end)}`
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
