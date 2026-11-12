#!/usr/bin/env node
// Serves a built deck (`slidev build`) on the local network and relays
// navigation from a phone remote to every open display. No internet needed.
//
// Reading is open to whoever can reach the server: the slides, the speaker
// notes in the bundle, and the current slide number. Driving the deck needs
// the write secret, which only ever leaves this process inside the remote
// URL and QR code printed below.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { dirname, extname, resolve, sep } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { encode } from 'uqr'

const usage = `Usage: slidev-kotlin-present [dist] [--port 4174] [--new-secret]

  dist            the built deck to serve (default: ./dist)
  --port, -p      port to listen on (default: $PORT or 4174)
  --new-secret    replace the saved write secret, invalidating old remote links
`

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'port': { type: 'string', short: 'p' },
    'new-secret': { type: 'boolean' },
    'help': { type: 'boolean', short: 'h' },
  },
})
if (flags.help) {
  process.stdout.write(usage)
  process.exit(0)
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const dist = resolve(process.cwd(), positionals[0] ?? 'dist')
const root = await realpath(dist).catch(() => fail(`No built deck at ${dist}. Run \`slidev build\` first.`))
const indexFile = resolve(root, 'index.html')
const headTag = /<head[^>]*>/

/** The deck's Vite base, read from the entry script the build wrote. */
function baseOf(html) {
  const base = /<script type="module"[^>]*\ssrc="([^"]*?)assets\//.exec(html)?.[1]
  return base?.startsWith('/') ? base : '/'
}

const firstIndex = await readFile(indexFile, 'utf8').catch(() => fail(`No index.html in ${dist}. Run \`slidev build\` first.`))
if (!headTag.test(firstIndex))
  fail(`${indexFile} has no <head>; cannot enable the remote.`)
const base = baseOf(firstIndex)

/**
 * The write secret survives a restart, so a phone that is already connected
 * keeps working after the server is restarted mid-rehearsal.
 */
async function loadSecret() {
  const file = resolve(process.cwd(), 'node_modules/.cache/slidev-kotlin-present/secret')
  if (!flags['new-secret']) {
    const saved = (await readFile(file, 'utf8').catch(() => '')).trim()
    if (/^[\w-]{20,}$/.test(saved))
      return saved
  }
  const secret = randomBytes(16).toString('base64url')
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${secret}\n`, { mode: 0o600 })
  }
  catch {
    process.stderr.write('Could not save the write secret; remote links will change on restart.\n')
  }
  return secret
}

const secret = Buffer.from(await loadSecret())
// Changes on every start: lets tests and clients tell a restart from a blip.
const instance = randomBytes(8).toString('hex')

function authorized(header) {
  const given = Buffer.from(/^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '')
  return given.length === secret.length && timingSafeEqual(given, secret)
}

const roles = new Set(['remote', 'display', 'viewer'])
/** Open event streams and the role each one announced. */
const clients = new Map()
/** The last state a remote sent, replayed to displays that connect later. */
let latest

function broadcast(text) {
  for (const client of clients.keys())
    client.write(text)
}

function broadcastPeers() {
  const count = role => [...clients.values()].filter(value => value === role).length
  broadcast(`event: peers\ndata: ${JSON.stringify({ displays: count('display'), remotes: count('remote') })}\n\n`)
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm',
}

/** Safari only plays video from a server that answers byte-range requests. */
function rangeOf(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (!match || (!match[1] && !match[2]))
    return undefined
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  return start <= end && start < size ? { start, end } : undefined
}

async function readBody(req, limit = 65536) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit)
      return undefined
  }
  return body
}

function validState(state) {
  return state !== null && typeof state === 'object'
    && Number.isInteger(state.page) && state.page >= 1
    && Number.isInteger(state.clicks) && state.clicks >= 0
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)
    res.setHeader('Cache-Control', 'no-store')

    if (!pathname.startsWith(base)) {
      if (pathname === '/' || `${pathname}/` === base)
        res.writeHead(302, { Location: `${base}${url.search}` }).end()
      else
        res.writeHead(404).end()
      return
    }
    const path = `/${pathname.slice(base.length)}`

    if (path === '/__remote/session') {
      if (req.method !== 'GET') { res.writeHead(405).end(); return }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ instance, state: latest ?? null }))
      return
    }
    if (path === '/__remote/events') {
      if (req.method !== 'GET') { res.writeHead(405).end(); return }
      const role = url.searchParams.get('role')
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive' })
      res.write(': connected\n\n')
      clients.set(res, roles.has(role) ? role : 'viewer')
      broadcastPeers()
      if (latest)
        res.write(`data: ${JSON.stringify(latest)}\n\n`)
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000)
      res.on('close', () => {
        clients.delete(res)
        clearInterval(heartbeat)
        broadcastPeers()
      })
      return
    }
    if (path === '/__remote/state') {
      if (req.method !== 'POST') { res.writeHead(405).end(); return }
      if (!authorized(req.headers.authorization)) { res.writeHead(403).end(); return }
      const body = await readBody(req)
      if (body === undefined) { res.writeHead(413).end(); return }
      const state = JSON.parse(body)
      if (!validState(state)) { res.writeHead(400).end(); return }
      latest = { page: state.page, clicks: state.clicks }
      broadcast(`data: ${JSON.stringify(latest)}\n\n`)
      res.writeHead(204).end()
      return
    }

    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return }
    if (path === '/index.html' || !extname(path)) {
      // Read per request: a rebuild replaces the hashed assets it points to.
      const html = (await readFile(indexFile, 'utf8')).replace(headTag, head =>
        `${head}<script>window.__slidevKotlinPresent=${JSON.stringify({ instance })}</script>`)
      res.writeHead(200, { 'Content-Type': types['.html'] })
      res.end(req.method === 'HEAD' ? undefined : html)
      return
    }
    const file = await realpath(resolve(root, `.${path}`))
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return }
    const info = await stat(file)
    if (!info.isFile()) { res.writeHead(404).end(); return }
    const headers = { 'Content-Type': types[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes' }
    const range = rangeOf(req.headers.range, info.size)
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`
      headers['Content-Length'] = range.end - range.start + 1
    }
    else {
      headers['Content-Length'] = info.size
    }
    res.writeHead(range ? 206 : 200, headers)
    if (req.method === 'HEAD')
      res.end()
    else
      createReadStream(file, range).on('error', () => res.destroy()).pipe(res)
  }
  catch (error) {
    if (!res.headersSent)
      res.writeHead(error.code === 'ENOENT' ? 404 : 400)
    res.end()
  }
})

/**
 * Two QR rows per terminal line, in fixed black on white so the code scans
 * the same on a light and on a dark terminal theme.
 */
function qr(text) {
  const { data, size } = encode(text, { ecc: 'L', border: 2 })
  const lines = []
  for (let y = 0; y < size; y += 2) {
    let line = ''
    for (let x = 0; x < size; x++) {
      const top = data[y][x]
      const bottom = y + 1 < size && data[y + 1][x]
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
    }
    lines.push(`  \u001B[30;107m${line}\u001B[0m`)
  }
  return lines.join('\n')
}

// VPN tunnels, virtual machine bridges and Apple's peer-to-peer links have an
// address too, but a phone on the Wi-Fi cannot reach the laptop through them.
const virtualInterface = /^(?:utun|tun|tap|ppp|ipsec|wg|tailscale|zt|awdl|llw|bridge|docker|veth|vmnet|vboxnet|vEthernet)/i

function lanAddresses() {
  const found = []
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal)
        found.push({ name, address: address.address })
    }
  }
  const physical = found.filter(({ name }) => !virtualInterface.test(name))
  // Better a code that may not work than none, should the pattern be wrong.
  return physical.length > 0 ? physical : found
}

const port = Number(flags.port ?? process.env.PORT ?? 4174)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  fail(`Invalid port: ${flags.port ?? process.env.PORT}`)

server.on('error', (error) => {
  fail(error.code === 'EADDRINUSE'
    ? `Port ${port} is in use. Stop the other server or pass --port.`
    : `Could not start the server: ${error.message}`)
})

server.listen(port, '0.0.0.0', () => {
  const out = [`Display  http://localhost:${port}${base}`, '']
  const addresses = lanAddresses()
  if (addresses.length === 0)
    out.push('No network address found: connect to Wi-Fi or a phone hotspot, then restart.')
  for (const { name, address } of addresses) {
    const remote = `http://${address}:${port}${base}?k=${secret}`
    out.push(`Remote   ${remote}  (${name})`, '', qr(remote), '')
  }
  out.push('Scan a code with the phone, on the same network. The link carries the write secret:',
    'whoever has it can drive the slides. `--new-secret` replaces it.')
  process.stdout.write(`${out.join('\n')}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const client of clients.keys())
      client.destroy()
    server.close(() => process.exit(0))
  })
}
