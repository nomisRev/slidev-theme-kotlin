# Fold InlineCompilerError onto the shared highlight mechanism, merge SmartCast and Warning, and absorb the CSS every deck copies

**Status:** open, deferred past 0.13.0 (decided 2026-09-16)
**Components:** `InlineCompilerError`, `SmartCast`, `Warning`, `code-highlight.ts`, `styles/layout.css`, `layouts/`, `Kodee.vue`, `slide-bottom.vue`

## Problem

Two reviews on 2026-09-16 (the theme, and kotlin-fundamentals against it)
found duplication that 0.13.0 ships as is:

- `InlineCompilerError.vue` re-implements what `code-highlight.ts` already
  has: `isFromStart`, `requestedOccurrence`, `MAGIC_MOVE_ANIMATING`,
  `findCodeHost`, the message-placement maths, the click registration block,
  the missing-target warning watcher, `isDevelopment`. It is the one
  highlight component not built on the shared mechanism, and the most used
  one (36 tags in kotlin-fundamentals).
- `SmartCast.vue` and `Warning.vue` are byte-identical apart from class names
  and colours (~40 lines).
- HTML-escape helpers ×4 (`static-content.ts`, `annotation-label-markdown.ts`,
  `analytics.ts`, `transformers.ts`); `slugify` ×2 with different fallbacks
  (`static-content.ts`, `kotlin-snippets.ts`); the `ATTRIBUTES` tag regex ×2;
  `kotlin-snippets.ts:387` hard-codes the generated-marker string instead of
  `GENERATED_MARKER`, so a change to the constant would stop
  `generatedFilesUnder` recognising Java files; `slide-bottom.vue` re-derives
  layout defaults by hand instead of `kodeeDefaultsForLayout`.
- All three fundamentals decks copy ~130 lines of the same stylesheet:
  1440-canvas typography (`.slidev-layout` padding, font size, h1 size,
  `li + li`, `pre` margins), the blockquote left rail (fighting Slidev's
  `layouts-base.css` box), cover/section/exercise heading styles, the
  `.lesson-number` eyebrow, the numbered agenda list, click and
  view-transition timings, reduced-motion and print rules, and a
  `--fundamentals-purple/pink/ink` palette under the same names. Their
  headmatters also repeat `canvasWidth: 1440`, `aspectRatio: 16/9`,
  `themeConfig.kodee: greeting`. The showcase runs on Slidev's 980 canvas,
  so the theme never sees what the decks see.
- 31 exercise slides and 11 section slides repeat the same class + `kodee`
  + `<div class="lesson-number">…</div>` markup (75 occurrences), which a
  `layout: exercise` / `layout: section` with an `eyebrow:` string would
  replace.
- Every deck patches Kodee's stacking (`.kodee-character { z-index: 0 }` and
  a sibling rule), reaching into a scoped class; the theme should own it for
  the per-slide layer.
- No table sizing token: the deck's only `<style>` blocks in 8,000 lines are
  `table { font-size }`.
- `--inline-compiler-error-message-size` is overridden inline on 4 of 36
  tags; the default (the code's size) is too big for long messages at 1440.
- `$$` multi-dollar string interpolation is repainted in the deck with a
  brittle `[style*=…]` selector; it needs a grammar or transformer fix.
- Fonts: kotlin-fundamentals bundles 2.3 MB of JetBrains TTFs with
  `fonts.provider: none`; the sibling decks do not and render Inter for
  visitors. Either the theme ships the faces (check the JetBrains Sans
  licence first) or documents the recipe.
- `RemoteControl.vue` + `setup/routes.ts` (phone remote) and `FillImage.vue`
  in kotlin-fundamentals are generic; the remote imports four Slidev
  internals, so moving it makes the theme own that coupling.

## Work

- [ ] `InlineCompilerError` on `useCodeHighlight` (keep its multi-line
      squiggles and grace timer); merge `SmartCast`/`Warning` into one
      component or one shared class + variable.
- [ ] One `escapeHtml`, one `slugify`, one `ATTRIBUTES`; use
      `GENERATED_MARKER` in the Java writer; `slide-bottom.vue` via
      `kodeeDefaultsForLayout`.
- [ ] Move the shared deck CSS into the theme as custom properties
      (CLAUDE.md rule), put the showcase on a 1440 canvas so it is visible,
      then delete it from the three decks.
- [ ] `layout: section` and `layout: exercise` with an `eyebrow:` frontmatter
      string.
- [ ] Kodee stacking rule in the theme; `--table-font-size`; a smaller
      default for `--inline-compiler-error-message-size` or a documented
      deck-level override.
- [ ] `$$` string highlighting; fonts decision; decide on `RemoteControl`
      and `FillImage`.

## Acceptance

- [ ] kotlin-fundamentals, exposed-fundamentals and ktor-fundamentals build
      with their copied stylesheet blocks removed and look the same.
- [ ] `npm test` and `npm run build` pass; the showcase renders on 1440.
