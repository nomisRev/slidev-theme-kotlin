import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const assets = join(process.cwd(), 'dist', 'assets')
const files = await readdir(assets, { recursive: true })
const jsFiles = files.filter(file => typeof file === 'string' && file.endsWith('.js'))

// The editor's browser client is the only code that knows the local writer
// endpoint. It must be absent from a built deck, not merely hidden by CSS.
const writerChunks = jsFiles.filter(file => file.includes('writer-client'))
const endpointChunks = []
for (const file of jsFiles) {
  const contents = await readFile(join(assets, file), 'utf8')
  if (contents.includes('/__drawn-annotations'))
    endpointChunks.push(file)
}

if (writerChunks.length || endpointChunks.length) {
  const leaked = [...new Set([...writerChunks, ...endpointChunks])]
  throw new Error(`production build contains DrawnAnnotation writer code: ${leaked.join(', ')}`)
}

console.log('✔ production build contains no DrawnAnnotation writer client')
