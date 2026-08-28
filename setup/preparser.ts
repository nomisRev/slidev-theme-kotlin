import { definePreparserSetup } from '@slidev/types'
import { normalizeMagicMoveSeparators } from './magic-move-between'

/**
 * Support linking slides with a bare `magic-move` separator:
 *
 * ```md
 * ---
 * magic-move
 * ---
 * ```
 *
 * YAML would parse that frontmatter as the string "magic-move" instead of an
 * object, so rewrite it to `magicMove: true` before the deck is split into
 * slides. The rewrite is line-for-line to keep source locations intact.
 */
export default definePreparserSetup(() => [
  {
    name: 'kotlin-theme:magic-move-between',
    transformRawLines(lines) {
      normalizeMagicMoveSeparators(lines)
    },
  },
])
