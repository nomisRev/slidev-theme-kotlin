#!/usr/bin/env node
/**
 * `slidev-kotlin-snippets [entry.md] [--check]`
 *
 * Generate one compilable Kotlin file per Kotlin fence of a deck (see
 * `setup/kotlin-snippets.ts`), under the directory and package named by
 * `themeConfig.snippets` in the deck's headmatter. `--check` writes nothing
 * and exits non-zero when the files on disk are missing, stale, or no longer
 * produced, for CI. The entry defaults to `slides.md` in the working
 * directory.
 */
import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { injectPreparserExtensionLoader, load } from '@slidev/parser/fs'

const args = process.argv.slice(2)
const check = args.includes('--check')
const positional = args.filter(arg => !arg.startsWith('--'))
if (args.includes('--help') || args.includes('-h') || positional.length > 1) {
  console.log('Usage: slidev-kotlin-snippets [entry.md] [--check]')
  process.exit(positional.length > 1 ? 1 : 0)
}

const entry = resolve(positional[0] ?? 'slides.md')
if (!existsSync(entry)) {
  console.error(`[slidev-theme-kotlin] no such entry: ${entry}`)
  process.exit(1)
}
const userRoot = dirname(entry)

// The theme's setup modules are TypeScript, compiled by Vite when Slidev
// runs them. jiti (a dependency of @slidev/cli) does the same for this CLI.
const jiti = createJiti(import.meta.url)
const { collectSnippetFiles, resolveSnippetSettings, syncSnippetFiles } = await jiti.import('../setup/kotlin-snippets.ts')
const preparser = (await jiti.import('../setup/preparser.ts')).default

// Slidev registers the theme's preparser (the bare `magic-move` separator)
// when it loads a deck; do the same so slides split exactly as they present.
injectPreparserExtensionLoader((roots, headmatter, filepath, mode) => preparser({ filepath, headmatter, mode }))
const data = await load({ roots: [userRoot], userRoot }, entry)

const settings = resolveSnippetSettings(data.headmatter.themeConfig)
if (!settings) {
  console.error('[slidev-theme-kotlin] set `themeConfig.snippets` in the headmatter (`true`, or `{ dir, package, imports }`) to generate Kotlin snippets')
  process.exit(1)
}

const files = collectSnippetFiles(data.slides, userRoot, settings)
const result = syncSnippetFiles(userRoot, settings, files, { check })
const dir = relative(process.cwd(), resolve(userRoot, settings.dir)) || '.'
if (check) {
  const stale = [...result.written.map(path => `  stale or missing: ${path}`), ...result.removed.map(path => `  no longer produced: ${path}`)]
  if (stale.length) {
    console.error(`[slidev-theme-kotlin] snippets in ${dir} are out of date; run \`slidev-kotlin-snippets\`:\n${stale.join('\n')}`)
    process.exit(1)
  }
  console.log(`[slidev-theme-kotlin] snippets: ${files.length} files in ${dir} are up to date`)
}
else {
  console.log(`[slidev-theme-kotlin] snippets: ${files.length} files in ${dir} (${result.written.length} written, ${result.removed.length} removed, ${result.unchanged.length} unchanged)`)
}
