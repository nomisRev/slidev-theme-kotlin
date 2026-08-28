import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const assets = join(process.cwd(), 'dist', 'assets')
const files = await readdir(assets, { recursive: true })
const jsFiles = files.filter(file => typeof file === 'string' && file.endsWith('.js'))

// The editor's browser client is the only code that knows the local writer
// endpoint. It must be absent from a built deck, not merely hidden by CSS.
const writerChunks = jsFiles.filter(file => file.includes('writer-client'))
const editorChunks = []
for (const file of jsFiles) {
  const contents = await readFile(join(assets, file), 'utf8')
  // The endpoint is the write capability; these UI strings ensure the global
  // development toolbar was not merely hidden with a production v-if.
  if (contents.includes('/__drawn-annotation-source')
    || contents.includes('drawn-annotation-toolbar')
    || contents.includes('Edit annotations'))
    editorChunks.push(file)
}

if (writerChunks.length || editorChunks.length) {
  const leaked = [...new Set([...writerChunks, ...editorChunks])]
  throw new Error(`production build contains DrawnAnnotation editor code: ${leaked.join(', ')}`)
}

console.log('✔ production build contains no DrawnAnnotation writer or toolbar')
