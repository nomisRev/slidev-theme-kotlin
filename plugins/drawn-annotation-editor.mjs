/**
 * Development-only Vite plugin that lets the DrawnAnnotation visual editor
 * persist `:geometry` and `:connect` bindings back into the authored
 * Markdown.
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
const locatorAttribute = '__drawn-annotation-locator'
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
 * (``` or ~~~, closed by a fence of the same character at least as long),
 * indented code blocks, inline code spans, and HTML comments. Injecting there
 * pastes a locator into a code sample, and counting there shifts the ordinals
 * of the real tags after it.
 */
function excludedRanges(source) {
  const ranges = []
  const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/
  let open
  let indented
  let previousBlank = true
  for (let lineStart = 0; lineStart < source.length;) {
    const lineEnd = source.indexOf('\n', lineStart)
    const next = lineEnd < 0 ? source.length : lineEnd + 1
    const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd)
    const blank = !line.trim()
    if (open) {
      const match = fence.exec(line)
      if (match && match[1][0] === open.marker[0] && match[1].length >= open.marker.length && !match[2].trim()) {
        ranges.push([open.start, next]); open = undefined
      }
    }
    else if (indented && (blank || /^ {4}/.test(line))) {
      // Blank lines join indented chunks into one block; only a code line
      // extends the excluded range, matching markdown-it's trailing-blank rule.
      if (!blank) indented.end = next
    }
    else {
      if (indented) { ranges.push([indented.start, indented.end]); indented = undefined }
      const match = fence.exec(line)
      if (match) { open = { marker: match[1], start: lineStart } }
      // An indented chunk is code only where it cannot continue a preceding
      // paragraph or HTML block, both of which markdown-it ends at a blank line.
      else if (previousBlank && !blank && /^ {4}/.test(line)) { indented = { start: lineStart, end: next } }
    }
    previousBlank = blank
    lineStart = next
  }
  if (open) ranges.push([open.start, source.length])
  if (indented) ranges.push([indented.start, indented.end])
  const inside = offset => ranges.some(([start, end]) => offset >= start && offset < end)
  for (let start = source.indexOf('<!--'); start >= 0; start = source.indexOf('<!--', start + 4)) {
    if (inside(start)) continue
    const close = source.indexOf('-->', start + 4)
    ranges.push([start, close < 0 ? source.length : close + 3])
    if (close < 0) break
  }
  // Inline code spans: a backtick run closes at the next run of the same
  // length. markdown-it parses inline content per paragraph, so a span never
  // crosses a blank line; an unmatched run stays literal text.
  const runs = [...source.matchAll(/`+/g)]
    .filter(match => !inside(match.index))
    .map(match => [match.index, match.index + match[0].length])
  for (let index = 0; index < runs.length; index++) {
    const [start, end] = runs[index]
    const close = runs.findIndex(([closeStart, closeEnd], at) => at > index
      && closeEnd - closeStart === end - start
      && !/\n[ \t]*\r?\n/.test(source.slice(end, closeStart)))
    if (close < 0) continue
    ranges.push([start, runs[close][1]])
    index = close
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
      // Attribute values have no escape character in HTML or Vue templates: a
      // matching quote always closes the value, even after a backslash.
      if (quote) { if (char === quote) quote = ''; continue }
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
 * `:geometry` and `:connect` bindings, the only parts of the tag the writer
 * rewrites.
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
/** The tag's identity: its text without the writer-owned `:geometry` and `:connect` bindings. */
export function fingerprintDrawnAnnotationTag(tag) {
  let identity = tag
  for (const binding of [geometryBinding, connectBinding]) {
    let span
    // A malformed binding cannot be patched later anyway; fingerprint it as is.
    try { span = binding(identity) } catch {}
    if (span) identity = `${identity.slice(0, span.start)}${identity.slice(span.end)}`
  }
  return hash(identity)
}
function lineAt(source, offset) { let line = 1; for (let index = source.indexOf('\n'); index >= 0 && index < offset; index = source.indexOf('\n', index + 1)) line++; return line }
function occurrencesOf(needle, haystack) {
  const offsets = []
  for (let offset = haystack.indexOf(needle); offset >= 0; offset = haystack.indexOf(needle, offset + 1)) offsets.push(offset)
  return offsets
}
/**
 * The tag's exact offset in the file, when the chunk pins it down.
 *
 * The chunk Slidev hands over need not occur in the file as a whole: a slide
 * chunk is trimmed and has no frontmatter, and a transform that runs ahead of
 * this one may have rewritten a line of it. Grow a window of whole lines from
 * the tag, upward and then downward, as far as it still occurs verbatim in
 * the file; the widest such window usually takes in the slide's title, which
 * tells two slides with identical tags apart. When it occurs once, the tag's
 * position inside it is its position in the file. Two verbatim occurrences
 * mean the window could name a different slide, so there is no exact
 * position.
 */
function exactOffset(source, tag, fileSource) {
  let start = source.lastIndexOf('\n', tag.start - 1) + 1
  const lineEnd = source.indexOf('\n', tag.end - 1)
  let end = lineEnd < 0 ? source.length : lineEnd + 1
  if (!fileSource.includes(source.slice(start, end))) return undefined
  for (let up = source.lastIndexOf('\n', start - 2) + 1; start > 0; up = source.lastIndexOf('\n', up - 2) + 1) {
    // A chunk opening with a blank line: the search above `start` finds that
    // newline again and would never move.
    if (up >= start || !fileSource.includes(source.slice(up, end))) break
    start = up
  }
  for (let down = source.indexOf('\n', end); end < source.length; down = source.indexOf('\n', down + 1)) {
    const next = down < 0 ? source.length : down + 1
    if (!fileSource.includes(source.slice(start, next))) break
    end = next
    if (down < 0) break
  }
  const occurrences = occurrencesOf(source.slice(start, end), fileSource)
  return occurrences.length === 1 ? occurrences[0] + (tag.start - start) : undefined
}
/** Where `tag`, found in `source` (a chunk of `fileSource`), sits in the file. */
function locateInFile(source, tag, fileSource, fileTags) {
  const fingerprint = fingerprintDrawnAnnotationTag(tag.text)
  const identical = fileTags.filter(candidate => fingerprintDrawnAnnotationTag(candidate.text) === fingerprint)
  // An exact position must coincide with a file tag of the same identity.
  // Without one, addressing the first matching tag would silently edit a
  // different slide, so use only a fingerprint that identifies one file tag.
  const offset = exactOffset(source, tag, fileSource)
  const match = offset !== undefined
    ? identical.find(candidate => candidate.start === offset)
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
export function injectDrawnAnnotationLocators(source, file, fileSource = source, fileTags = findDrawnAnnotationTags(fileSource)) {
  let result = source
  for (const tag of findDrawnAnnotationTags(source).reverse()) {
    // Vite can run the transform twice on one module; a tag that already
    // carries a locator keeps it.
    if (tag.text.includes(locatorAttribute)) continue
    const location = locateInFile(source, tag, fileSource, fileTags)
    // A tag the writer could not find again stays a plain, non-editable annotation.
    if (!location) continue
    const value = encodeLocator({ file, ...location })
    const at = tag.start + attributeInsertionPoint(tag.text)
    result = `${result.slice(0, at)} ${locatorAttribute}="${value}"${result.slice(at)}`
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
      // Inside the binding the quotes delimit JavaScript strings, where a
      // quote is escaped by an odd number of preceding backslashes only.
      if (character === quote) {
        let backslashes = 0
        while (tag[index - 1 - backslashes] === '\\') backslashes++
        if (backslashes % 2 === 0) quote = ''
      }
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

/**
 * The span of a `:connect` binding the writer may rewrite: a boolean literal,
 * quoted either way. Any other expression belongs to the author.
 */
function connectBinding(tag) {
  const start = tag.search(/\s:connect\s*=/)
  if (start < 0) return undefined
  const match = /\s:connect\s*=\s*(["'])\s*(true|false)\s*\1/.exec(tag.slice(start))
  if (!match) throw new Error('`:connect` must be a boolean literal to be edited')
  return { start, end: start + match[0].length, value: match[2] === 'true' }
}

/** Replace or remove one writer-owned binding, or add it before the tag's close. */
function replaceBinding(tag, existing, text) {
  if (existing) return `${tag.slice(0, existing.start)}${text}${tag.slice(existing.end)}`
  if (!text) return tag
  const close = attributeInsertionPoint(tag)
  return `${tag.slice(0, close)}${text}${tag.slice(close)}`
}

/**
 * Patch exactly one opening tag, preserving every unrelated character. The
 * writer owns only its bindings: existing source geometry is replaced by the
 * validated editor snapshot, never evaluated as JavaScript, and `connect`
 * writes that boolean as the `:connect` literal, or removes the binding when
 * `null`, so the slide's or deck's `drawnAnnotation.connect` default applies
 * again. The editor decides which, since only it knows that default. Either
 * part may be omitted to leave that binding alone.
 */
export function patchDrawnAnnotationTag(tag, geometry, connect) {
  let result = tag
  if (geometry !== undefined) {
    const empty = !geometry.label && !geometry.connector
    result = replaceBinding(result, geometryBinding(result), empty ? '' : ` :geometry="${serializeGeometry(geometry)}"`)
  }
  if (connect !== undefined)
    result = replaceBinding(result, connectBinding(result), connect === null ? '' : ` :connect="${connect}"`)
  return result
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
  // Every slide of a deck is its own Vite module, so one reload transforms the
  // same Markdown file once per slide. Scanning it for tags is the expensive
  // part; key the scan on the exact content so an edit invalidates it.
  const fileTagsCache = new Map()
  const cachedFileTags = (absolute, source) => {
    const entry = fileTagsCache.get(absolute)
    if (entry && entry.source === source) return entry.tags
    const tags = findDrawnAnnotationTags(source)
    fileTagsCache.set(absolute, { source, tags })
    return tags
  }
  const serialized = (operation) => { const result = writes.then(operation, operation); writes = result.then(() => undefined, () => undefined); return result }
  return {
    name: 'slidev-theme-kotlin:drawn-annotation-editor', apply: 'serve',
    // Slidev's Markdown plugin is itself a `pre` plugin, and Slidev appends
    // its plugins after the deck's `vite.config.ts` plugins, so `pre` puts
    // this transform ahead of it: it receives a slide's Markdown as written
    // (Slidev's `slide.content`) instead of the rendered Vue template, where
    // sibling tags share a line with the rendered fence and no line of the
    // file can be found again. Should the order ever change, the fingerprint
    // fallback in `locateInFile` still applies.
    enforce: 'pre',
    configResolved(config) { root = resolve(config.root) },
    transform(code, id) {
      // Vite can append query parameters to module IDs. They describe the
      // module request, not a pathname and must never become part of a writer
      // locator.
      const pathname = id.split('?', 1)[0].replace(slidevSlideModule, '')
      // Most slide modules carry no annotation: a substring test keeps the
      // tag scan, the file read and the locator pass off every one of those.
      if (!pathname.endsWith('.md') || !code.includes('<DrawnAnnotation') || !findDrawnAnnotationTags(code).length) return null
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
      return { code: injectDrawnAnnotationLocators(code, file, fileSource, cachedFileTags(absolute, fileSource)), map: null }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/__drawn-annotation-source') return next()
        if (request.method === 'GET') return json(response, 200, { ok: true, revisions: await currentRevisions(root, files) })
        if (request.method !== 'POST') return json(response, 405, { error: 'use POST' })
        try {
          const payload = await requestBody(request)
          const result = await serialized(async () => {
            if (Object.keys(payload).some(key => key !== 'locator' && key !== 'expectedRevision' && key !== 'geometry' && key !== 'connect'))
              throw new Error('source writer payload has an unknown property')
            if (typeof payload.expectedRevision !== 'string')
              throw new Error('an expected source revision is required')
            if (payload.connect !== undefined && payload.connect !== null && typeof payload.connect !== 'boolean')
              throw new Error('connect must be a boolean, or null to remove the binding')
            if (payload.geometry === undefined && payload.connect === undefined)
              throw new Error('nothing to write: provide geometry or connect')
            const token = decodeLocator(payload.locator); const path = resolve(root, token.file)
            if (!isWithinRoot(root, path) || path === root) throw new Error('source file must stay under the Vite root')
            const source = await readFile(path, 'utf8'); const revision = hash(source)
            if (payload.expectedRevision !== revision) return { status: 409, body: { error: 'source changed; reload before saving', revision, recovery: 'Reload saved geometry before retrying.' } }
            const tag = findDrawnAnnotationTags(source).filter(candidate => fingerprintDrawnAnnotationTag(candidate.text) === token.fingerprint)[token.ordinal]
            if (!tag) return { status: 409, body: { error: 'annotation source changed; refusing stale locator', revision, recovery: 'Reload the slide and select the annotation again.' } }
            const geometry = payload.geometry === undefined ? undefined : validateGeometryPatch(payload.geometry)
            const nextSource = `${source.slice(0, tag.start)}${patchDrawnAnnotationTag(tag.text, geometry, payload.connect)}${source.slice(tag.end)}`
            const temporary = `${path}.${randomUUID()}.tmp`
            try { await writeFile(temporary, nextSource, 'utf8'); await rename(temporary, path) } finally { await unlink(temporary).catch(() => {}) }
            return { status: 200, body: { ...(geometry ? { geometry } : {}), ...(payload.connect === undefined ? {} : { connect: payload.connect }), revision: hash(nextSource) } }
          })
          return json(response, result.status, result.body)
        } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : 'unable to save annotation geometry' }) }
      })
    },
  }
}
