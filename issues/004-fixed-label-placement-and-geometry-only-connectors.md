# Replace automatic label placement and connector routing with a fixed default and geometry-only connectors

**Status:** open, deferred past 0.13.0 (decided 2026-09-16)
**Components:** `DrawnAnnotation`, `DrawnAnnotationEditorToolbar`, `drawn-annotation/*`, `plugins/drawn-annotation-editor.mjs`, `scripts/test-annotation-editor.mjs`, both READMEs, the showcase `slides.md`

## Problem

kotlin-fundamentals turned every connector off (`themeConfig.drawnAnnotation.connect: false`)
and places its labels by hand: of 394 `DrawnAnnotation` tags, 137 carry
`:geometry` and none use `placement`, `gap`, `clearance`, `avoid-selector`,
`arrow`, `curve`, or a per-tag `:connect`. Of the hand-placed labels, 114 of
122 sit below-right of their mark. The code that exists only for automatic
placement and automatic routing is roughly 650–900 lines across
`DrawnAnnotation.vue` (3,118 lines today), `geometry.ts`, the editor store,
the toolbar and the writer, plus three toolbar buttons and a README section,
and none of it has a consumer in that deck.

Measured on the built deck (2026-09-16 investigation): automatic placement
costs a per-instance `querySelectorAll('*')` obstacle scan, one forced layout
and a 36-candidate loop **once per click at settle** — 2–8 ms on slides with
several auto-placed labels, spread over the transition's frames, never a
dropped frame. Automatic routing is already dead there because `connect` is
off. So this is a complexity and maintenance change, not a production
performance one, and the CHANGELOG entry must say so.

## Facts that shape the design

- `:geometry` is **not** target-relative: `label.x/y` are fractions of the
  `.slidev-layout` (`geometry.ts:14-21`). Every existing binding keeps its
  meaning under any redesign that keeps centre-anchored absolute fractions.
- The 162 kotlin-fundamentals labels **without** geometry are placed today
  centred under the mark and pushed down until they clear the code window,
  so they all land under the window. A naive "bottom-right of the mark"
  default would put ~55 of them on the next two lines of code (≈70 drags).
  A default of `top = max(mark.bottom, closest('pre').bottom) + gap`,
  `left = mark.right + gap`, clamped to the slide, reproduces today's result
  for practically all of them.
- Other decks (all on `file:../slidedev-theme-kotlin`): ktor-fundamentals has
  322 tags, 274 labels, 246 with geometry and **no** `connect` setting, so
  every one of its leaders is auto-routed today; exposed-fundamentals has 51
  manual connectors of which 16 are curved, ~37 auto-routed leaders and 17
  unplaced labels; the smaller talks have 2–34 unplaced labels each with
  auto-routed leaders; the showcase `slides.md` uses `placement=` 15 times,
  `avoid-selector` once, `arrow` twice.

## Open decisions (Simon's, not yet made)

- [ ] Do ktor-fundamentals' 274 automatic leaders disappear (connector drawn
      only when `geometry.connector` exists), or does a `connect: true` tag
      keep a ~15-line straight mark-edge→label-edge default?
- [ ] Straight connectors only (drops the control point, ~200 lines across
      `geometry.ts`, the writer tag `type: 'quadratic'`, the control handle
      and guide, two toolbar actions and ~6 tests; exposed-fundamentals'
      16 curves would straighten), or keep one control point?
- [ ] Which label default: bottom-right of the mark, or under the enclosing
      code window (see above)?

## Work (once decided)

- [ ] Delete automatic placement: `placedLabelRegistry`, the `placement`,
      `gap`, `clearance`, `avoidSelector` props, `resolvedPlacement`,
      `contentObstacleCache`, `fitLabel`'s width search, `placeLabel`'s
      candidates, `collectLabelObstacles`, `contentObstacles`,
      `publishPlacedLabel`, the `annotationLabelLayoutChange` watch and the
      store's layout-version coalescing.
- [ ] Delete automatic routing: `curve`, `arrow`, `connectorAutoControl`,
      `unitVector`, `leaderCurve`, `routeLeader`, `backOff`,
      `quadraticControlForCubic` (+ test), the auto branch of
      `paintDestinationInto`, `toggleConnectorAttachment`,
      `visibleConnectorFractions`' auto branch, **Make connector manual** /
      **Use automatic connector**, test steps 5/5b of the browser test.
- [ ] Replace **Hide connector** / **Show connector** with **Add connector** /
      **Remove connector**, seeding a straight mark-edge→label-edge draft
      (keep `edgePoint`); drop the `connect` prop,
      `themeConfig.drawnAnnotation.connect`, `inheritedConnect`, and the
      writer's `:connect` handling, or keep `connect` per the first decision.
- [ ] Keep: text/selector matching, marks, the ink hand-off, click/sequence/
      `insert` logic, `:geometry` with its absolute-fraction meaning,
      `measureLabel` for the natural and explicit widths, editor drag/nudge,
      **Reset annotation**, **Reset slide**, **Reload saved geometry**.
- [ ] Rewrite `components/README.md` "Where the label goes" and
      "Visual-editor geometry", the top-level README editor paragraph, and
      showcase `slides.md` lines ~510–860.
- [ ] Deck migration: strip kotlin-fundamentals' 10 dead `connector:`
      geometries (lesson-1.md:174,199; lesson-2.md:33,46,259;
      lesson-2-2.md:256,498,641,683; lesson-4.md:1376,1679) — they would
      start rendering if connectors become geometry-driven — and its
      `themeConfig.drawnAnnotation.connect` key; re-check exposed-fundamentals
      and ktor-fundamentals visually.

## Related cleanups found in the 2026-09-16 review (same area, do together)

- `DrawnAnnotation.vue` `mergeVisualLineBoxes` duplicates `code-text-match.ts`
  `mergeVisualLines`; `textRange` is a third segmenter next to
  `codeTextSegments`; `IGNORED_TEXT_SCOPES` is duplicated.
- The `watch(locator)` + `migrateAnnotationLocator` path (+2 tests) is
  unreachable in practice: a write remounts the slide.
- The cancelled-drag snapshot machinery (`restoreCancelledDrag`,
  `replaceLabelDraft`, `activeAnnotationGestures`, ~70 lines) is a one-step
  undo for Esc; the CHANGELOG documents it as kept deliberately — decide.
- The editor's drag/nudge/toolbar-bridge script (~470 lines) and its template
  and CSS ship in built decks, neutralised by constant-false computeds; the
  writer endpoint is correctly absent. `assert-production-annotation-editor.mjs`
  does not check for the editor strings.
- Missing-`target` chip is never withdrawn once reported
  (`paintDestinationInto` warns, only the source path clears).
- Transition-ink records never expire and accept distance 0, so a page can
  take its own stale record on a fresh reveal.
- `:track="false"` disables every per-click re-measure, not only tracking.
- Target-only annotations are not editable when `connect` defaults to false
  (`editorRelevant` is evaluated once at mount).
- Dead: `annotationLabelLayoutVersion`, `leaderCurve`'s `side`/`distance`,
  the `:data-click` attribute, `.drawn-annotation-toolbar__error`,
  `geometry.labelPlaced` (≡ `hasLabel && ready`), the print rule for the
  width handle, `_options` in the plugin.

## Acceptance

- [ ] `DrawnAnnotation.vue` is around 2,200–2,400 lines with no placement or
      routing search left; a label without geometry lands at the chosen
      default with zero measurement beyond its own size.
- [ ] kotlin-fundamentals renders identically (no label moves) after the
      migration above; the other decks are re-checked visually.
- [ ] `npm test`, `npm run build`, and `npm run test:annotation-editor` pass.
