/**
 * Development-only Vite plugin that lets the DrawnAnnotation visual editor
 * persist `:geometry` bindings back into the authored Markdown.
 *
 * Plain JavaScript on purpose: the package export `./annotation-editor` is
 * loaded by Node itself when a consuming deck's `vite.config.ts` imports it —
 * Vite's config bundler externalizes resolved node_modules imports, and Node
 * refuses raw TypeScript under node_modules. The public types live in
 * `drawn-annotation-editor.d.ts` next to this file.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const MAX_BODY_BYTES = 64 * 1024
const component = '<DrawnAnnotation'
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16)
/**
 * Slidev never feeds a Markdown file through Vite as one module. Every slide is
 * its own virtual module, `<file>__slidev_<n>.md`, whose code is that slide's
 * content. The writer must always address the file the author edits.
 */
const slidevSlideModule = /__slidev_\d+\.md$/
const fraction = (value, min = 0) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= 1

/** Whether candidate is root itself or a descendant, without prefix ambiguity. */
function isWithinRoot(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

/** Validate the only document shape the development writer accepts. */
export function validateGeometryPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('geometry patch must be an object')
  const input = value
  if (Object.keys(input).some(key => key !== 'label' && key !== 'connector')) throw new Error('geometry patch has an unknown property')
  const point = (value, name, allowed = ['x', 'y']) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`)
    const item = value
    if (Object.keys(item).some(key => !allowed.includes(key)) || !fraction(item.x) || !fraction(item.y)) throw new Error(`${name} must contain x and y fractions from 0 to 1`)
    return { x: item.x, y: item.y }
  }
  const result = {}
  if (input.label !== undefined) {
    if (input.label === null) result.label = null
    else {
      const label = point(input.label, 'label', ['x', 'y', 'width'])
      const source = input.label
      if (Object.keys(source).some(key => key !== 'x' && key !== 'y' && key !== 'width') || (source.width !== undefined && !fraction(source.width, .02))) throw new Error('label width must be a fraction from 0.02 to 1')
      if (source.width !== undefined) label.width = source.width
      result.label = label
    }
  }
  if (input.connector !== undefined) {
    if (input.connector === null) result.connector = null
    else {
      const connector = input.connector
      if (Object.keys(connector).some(key => key !== 'type' && key !== 'start' && key !== 'control' && key !== 'end')) throw new Error('connector has an unknown property')
      // The write client mirrors serializeGeometry's own output, which tags a
      // curved connector with `type: 'quadratic'`. Accept exactly that tag so
      // the editor can round-trip the geometry it reads back from a source
      // binding; the persisted shape stays keyed on the control point alone.
      if (connector.type !== undefined && connector.type !== 'quadratic') throw new Error('connector type must be \'quadratic\'')
      const control = connector.control === undefined ? undefined : point(connector.control, 'connector.control')
      if (connector.type === 'quadratic' && !control) throw new Error('a quadratic connector requires a control point')
      result.connector = { start: point(connector.start, 'connector.start'), ...(control ? { control } : {}), end: point(connector.end, 'connector.end') }
    }
  }
  return result
}

function format(value) { return value.toFixed(4) }
export function serializeGeometry(geometry) {
  const parts = []
  if (geometry.label) parts.push(`label: { x: ${format(geometry.label.x)}, y: ${format(geometry.label.y)}${geometry.label.width === undefined ? '' : `, width: ${format(geometry.label.width)}`} }`)
  if (geometry.connector) {
    const { start, control, end } = geometry.connector
    parts.push(control
      ? `connector: { type: 'quadratic', start: { x: ${format(start.x)}, y: ${format(start.y)} }, control: { x: ${format(control.x)}, y: ${format(control.y)} }, end: { x: ${format(end.x)}, y: ${format(end.y)} } }`
      : `connector: { start: { x: ${format(start.x)}, y: ${format(start.y)} }, end: { x: ${format(end.x)}, y: ${format(end.y)} } }`)
  }
  return `{ ${parts.join(', ')} }`
}

/**
 * Regions where a tag is only shown, never rendered: fenced code blocks
 * (``` or ~~~, closed by a fence of the same character at least as long) and
 * HTML comments. Injecting there pastes a locator into a code sample, and
 * counting there shifts the ordinals of the real tags after it.
 */
function excludedRanges(source) {
  const ranges = []
  const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/
  let open
  for (let lineStart = 0; lineStart < source.length;) {
    const lineEnd = source.indexOf('\n', lineStart)
    const next = lineEnd < 0 ? source.length : lineEnd + 1
    const match = fence.exec(source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd))
    if (!open) {
      if (match) open = { marker: match[1], start: lineStart }
    }
    else if (match && match[1][0] === open.marker[0] && match[1].length >= open.marker.length && !match[2].trim()) {
      ranges.push([open.start, next]); open = undefined
    }
    lineStart = next
  }
  if (open) ranges.push([open.start, source.length])
  const inside = offset => ranges.some(([start, end]) => offset >= start && offset < end)
  for (let start = source.indexOf('<!--'); start >= 0; start = source.indexOf('<!--', start + 4)) {
    if (inside(start)) continue
    const close = source.indexOf('-->', start + 4)
    ranges.push([start, close < 0 ? source.length : close + 3])
    if (close < 0) break
  }
  return ranges
}

/**
 * Finds opening component tags while respecting quoted Vue bindings. The name
 * must end the tag name, so `<DrawnAnnotationEditorToolbar>` never matches,
 * and tags inside fenced code or comments are left to the reader.
 */
export function findDrawnAnnotationTags(source) {
  const tags = []
  const excluded = excludedRanges(source)
  for (let start = source.indexOf(component); start >= 0; start = source.indexOf(component, start + component.length)) {
    if (!/[\s/>]/.test(source[start + component.length] ?? '')) continue
    if (excluded.some(([from, to]) => start >= from && start < to)) continue
    let quote = ''; let braces = 0; let end = start + component.length; let closed = false
    for (; end < source.length; end++) {
      const char = source[end]
      if (quote) { if (char === quote && source[end - 1] !== '\\') quote = ''; continue }
      if (char === '"' || char === '\'') { quote = char; continue }
      if (char === '{') braces++; else if (char === '}') braces--; else if (char === '>' && braces === 0) { end++; closed = true; break }
    }
    // During an edit the source can end inside a tag or quoted binding. It is
    // not a tag until its closing `>` arrives on a later HMR pass.
    if (closed) tags.push({ start, end, text: source.slice(start, end) })
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
function encodeLocator(value) { return Buffer.from(JSON.stringify(value)).toString('base64url') }
function decodeLocator(value) {
  if (typeof value !== 'string') throw new Error('a source locator is required')
  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString())
    if (!data || typeof data.file !== 'string' || typeof data.fingerprint !== 'string') throw new Error()
    if (!Number.isInteger(data.ordinal) || data.ordinal < 0 || !Number.isInteger(data.line)) throw new Error()
    return { file: data.file, fingerprint: data.fingerprint, ordinal: data.ordinal, line: data.line }
  } catch { throw new Error('invalid source locator') }
}
/** The tag's identity: its text without the writer-owned `:geometry` binding. */
export function fingerprintDrawnAnnotationTag(tag) {
  let binding
  // A malformed binding cannot be patched later anyway; fingerprint it as is.
  try { binding = geometryBinding(tag) } catch {}
  return hash(binding ? `${tag.slice(0, binding.start)}${tag.slice(binding.end)}` : tag)
}
function lineAt(source, offset) { let line = 1; for (let index = source.indexOf('\n'); index >= 0 && index < offset; index = source.indexOf('\n', index + 1)) line++; return line }
/** Where `tag`, found in `source` (a chunk of `fileSource`), sits in the file. */
function locateInFile(source, tag, fileSource, fileTags) {
  const occurrences = []
  for (let offset = fileSource.indexOf(source); offset >= 0; offset = fileSource.indexOf(source, offset + 1)) occurrences.push(offset)
  const fingerprint = fingerprintDrawnAnnotationTag(tag.text)
  const identical = fileTags.filter(candidate => fingerprintDrawnAnnotationTag(candidate.text) === fingerprint)
  // A verbatim chunk gives an exact position only when it occurs once. With
  // duplicate chunks, addressing the first matching tag would silently edit a
  // different slide, so use only a fingerprint that identifies one file tag.
  const match = occurrences.length === 1
    ? identical.find(candidate => candidate.start === occurrences[0] + tag.start)
    : identical.length === 1 ? identical[0] : undefined
  return match && { fingerprint, ordinal: identical.indexOf(match), line: lineAt(fileSource, match.start) }
}

/**
 * Add the opaque serve-only locator without modifying authored source.
 *
 * The attribute is deliberately static: a bound `:__drawn-annotation-locator`
 * would make Vue evaluate the base64 token as a JavaScript expression, so the
 * component would receive `undefined` instead of the locator.
 */
export function injectDrawnAnnotationLocators(source, file, fileSource = source) {
  const fileTags = findDrawnAnnotationTags(fileSource)
  let result = source
  for (const tag of findDrawnAnnotationTags(source).reverse()) {
    const location = locateInFile(source, tag, fileSource, fileTags)
    // A tag the writer could not find again stays a plain, non-editable annotation.
    if (!location) continue
    const value = encodeLocator({ file, ...location })
    const at = tag.start + attributeInsertionPoint(tag.text)
    result = `${result.slice(0, at)} __drawn-annotation-locator="${value}"${result.slice(at)}`
  }
  return result
}

/**
 * Where a new attribute goes in an opening tag. Vue permits self-closing
 * component tags; insert before the slash rather than splitting `/>` into
 * malformed markup that swallows the rest of the slide.
 */
function attributeInsertionPoint(tag) {
  return /\/\s*>$/.test(tag) ? tag.lastIndexOf('/') : tag.length - 1
}

/**
 * The span of the `:geometry` binding, including its closing quote. Only an
 * object literal can be replaced safely: for any other expression the first
 * `{` belongs to some later attribute, and replacing up to its `}` would
 * delete that attribute.
 */
function geometryBinding(tag) {
  const match = /\s:geometry\s*=\s*(["']?)\s*\{/.exec(tag)
  const start = tag.search(/\s:geometry\s*=/)
  if (start < 0) return undefined
  if (!match || match.index !== start) throw new Error('`:geometry` must be an object literal to be edited')
  const opening = match[1]
  const value = start + match[0].length - 1
  let depth = 0
  let quote = ''
  for (let index = value; index < tag.length; index++) {
    const character = tag[index]
    if (quote) {
      if (character === quote && tag[index - 1] !== '\\') quote = ''
      continue
    }
    if (character === '"' || character === '\'' || character === '`') { quote = character; continue }
    if (character === '{') depth++
    else if (character === '}' && --depth === 0) {
      // Consume the closing quote with the binding so a replacement cannot
      // leave an extra quote in the opening tag.
      if (!opening) return { start, end: index + 1 }
      const close = tag.indexOf(opening, index + 1)
      if (close < 0 || tag.slice(index + 1, close).trim()) throw new Error('`:geometry` must be an object literal to be edited')
      return { start, end: close + 1 }
    }
  }
  throw new Error('geometry binding is incomplete')
}

/** Patch exactly one opening tag, preserving every unrelated character. */
export function patchDrawnAnnotationTag(tag, patch) {
  // The writer owns only its binding. Existing source geometry is intentionally
  // replaced by the validated editor snapshot, never evaluated as JavaScript.
  const existing = geometryBinding(tag)
  const empty = !patch.label && !patch.connector
  if (existing)
    return empty ? `${tag.slice(0, existing.start)}${tag.slice(existing.end)}` : `${tag.slice(0, existing.start)} :geometry="${serializeGeometry(patch)}"${tag.slice(existing.end)}`
  if (empty)
    return tag
  const close = attributeInsertionPoint(tag)
  return `${tag.slice(0, close)} :geometry="${serializeGeometry(patch)}"${tag.slice(close)}`
}

async function requestBody(request) {
  const chunks = []; let length = 0
  for await (const chunk of request) { length += chunk.length; if (length > MAX_BODY_BYTES) throw new Error('request body is too large'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('request body must be JSON') }
}
function json(response, status, body) { response.statusCode = status; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(JSON.stringify(body)) }

/** The current revision of every transformed Markdown file, for the client's `expectedRevision`. */
async function currentRevisions(root, files) {
  const revisions = {}
  for (const file of files) {
    try { revisions[file] = hash(await readFile(resolve(root, file), 'utf8')) } catch {}
  }
  return revisions
}

export function drawnAnnotationEditor(_options = {}) {
  let root = ''; let writes = Promise.resolve()
  // Files that received locators. Their revisions live outside the locator so
  // a write never invalidates the locators of the annotations it rewrites.
  const files = new Set()
  const serialized = (operation) => { const result = writes.then(operation, operation); writes = result.then(() => undefined, () => undefined); return result }
  return {
    name: 'slidev-theme-kotlin:drawn-annotation-editor', apply: 'serve',
    configResolved(config) { root = resolve(config.root) },
    transform(code, id) {
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
      let fileSource
      try { fileSource = readFileSync(absolute, 'utf8') } catch { return null }
      const file = relative(root, absolute)
      files.add(file)
      return { code: injectDrawnAnnotationLocators(code, file, fileSource), map: null }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/__drawn-annotation-source') return next()
        if (request.method === 'GET') return json(response, 200, { ok: true, revisions: await currentRevisions(root, files) })
        if (request.method !== 'POST') return json(response, 405, { error: 'use POST' })
        try {
          const payload = await requestBody(request)
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
