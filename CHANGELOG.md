# Changelog

## Unreleased

### Added

- `themeConfig.drawnAnnotation.connect: false` hides every `DrawnAnnotation` leader line in a deck, for decks that place their labels by hand; a slide's `drawnAnnotation.connect` frontmatter overrides the deck and a tag's `:connect` binding overrides both. The editor's **Hide connector** / **Show connector** toggle knows that default: it writes `:connect="true"` or `:connect="false"` only where the wanted state differs from it, and removes the binding when it matches. The source writer accepts `connect: null` to remove the binding.
- Folded imports: a leading block of `import` lines in a Kotlin, Java, or Scala fence leaves the code window on the slide, on ordinary fences, cross-slide Magic Move chains, and classic Magic Move blocks alike. Line numbers, highlight ranges, and annotation targets count from the first line of real code. `show-imports` on a fence or `themeConfig.foldImports: false` keeps imports visible. A `// Example` comment line (optionally `// Example: description`) folds everything above it instead, helper declarations included; the marker line leaves the slide too. The handout, `llms-full.txt`, and generated Kotlin sources keep the fence complete.
- Static content on every `slidev build`: a crawlable `handout/` (one page per source file, with highlighted code, Open Graph tags, the deck's `lang`, and links back to each slide), `llms.txt` and `llms-full.txt`, plus `sitemap.xml` when `themeConfig.siteUrl` is set and `robots.txt` when that URL is the root of its host (elsewhere the build prints the `Sitemap:` line to add to the host's own `robots.txt`). Slide headings sit below their slide's title, so the handout and `llms-full.txt` read as one outline. The built `index.html` links to the handout and `llms-full.txt` (`rel="alternate"`, a paragraph of visible links that the app hides once mounted, a plain-text description in place of Slidev's, and the canonical URL and sitemap once `siteUrl` is known), so crawlers that render no JavaScript find the content from the root URL. `themeConfig.handout: false` disables it; `handout.notes: false` leaves presenter notes out.
- `slidev-kotlin-snippets`, a CLI that writes one compilable Kotlin file per Kotlin fence of a deck (in the spirit of KotlinX Knit): each file gets its own package, the fence's imports plus the `themeConfig.snippets.imports` a deck shares, top-level declarations as written, and bare statements wrapped in `suspend fun main()`. `--check` fails when the files are stale, for CI. `no-compile` on a fence skips it, as does an `InlineCompilerError` wrapper; the flag is stripped from the rendered fence like `show-imports`, whether or not imports fold. `@slidev/parser` and `jiti`, which the CLI runs on, are now dependencies of the theme.
- Java fences now generate compilable `.java` files under `themeConfig.snippets.javaDir` (default `src/main/java/snippets`). Java and Kotlin fences on the same slide use the same generated package so interop examples compile together.
- GoatCounter analytics: `themeConfig.analytics.goatcounter` (an endpoint or a site code) adds `count.js` to the built deck and its handout pages, and the theme sends one pageview per slide (`<base>/<slide number>` with the slide's title) instead of one per load, skipping clicks, presenter, overview, notes, print, and export views.
- Hash-mode builds (`slidev build --router-mode hash`) get a script forwarding old history-mode deep links such as `/deck/12` to `/deck/#/12`, so links shared before the switch keep working on hosts without a single-page-app rewrite.
- Development-only problem chips: while Vite serves the deck, a `DrawnAnnotation` whose `text`, `selector`, `occurrence`, or `target` matches nothing, and an `InlineCompilerError` whose diagnostic is not shown, put a red chip in the top-left corner of their slide next to the console warning they already print. The chip follows the warning's timing (current slide, settled, click reached), withdraws when the target turns up, and never appears in builds, exports, the presenter view, or print mode. `InlineCompilerError`'s console warnings now gate on Vite's explicit development mode like `DrawnAnnotation`'s editor, instead of `import.meta.env.DEV`.
- Annotation editing is a frozen session: entering the editor locks Slidev navigation (shortcuts, click-to-navigate, nav controls, swipes) on the current slide and click, every drag and arrow-key nudge stays a local draft, and **Done editing annotations** commits all changed drafts in one write phase; a failed write keeps the drafts and the session. **Esc** cancels in stages (drag, selection, then the session after a confirmation).
- Quadratic connector editing: the first edit of an automatic leader keeps its visible curve as a persisted control point, which renders as a draggable, keyboard-nudgeable handle with a dashed control-polygon guide. **Curve connector** and **Straighten connector** add or remove the control point from the toolbar, and the connector's hit target follows the rendered curve.
- **Hide connector** / **Show connector** in the editor toolbar: hiding writes `:connect="false"` into the selected tag, showing removes it again. The writer now owns that binding next to `:geometry`, and a tag's locator ignores both. The routing and curve controls are disabled while the connector is hidden.
- **Reset slide** in the editor toolbar removes the saved geometry of every annotation on the current slide, after a confirmation.

### Fixed

- `MagicMoveBetween` decodes each precompiled payload once per page and shares the result between instances. Slidev keeps every slide mounted and, with `transition: view-transition`, remounts all of them whenever a click is followed by a slide change (its slideshow container switches between a `div` and a `TransitionGroup`); a deck of 145 code windows spent about 50 ms per navigation decoding the same strings again.
- `DrawnAnnotation` no longer re-searches the slide's text on every animation frame. While a Magic Move step or a slide transition moves the annotated text, the match found before the step is reused and only its client rects are read again; the search runs once per click, resize, or code-block mutation instead. The search itself no longer walks every text node's ancestors: an ignored subtree (the overlay, a token on its way out) is pruned once at its root. On a slide with three annotations over a cross-slide Magic Move this took the scripting of one navigation from about 150 ms to about 20 ms, most of which is Magic Move itself. Each measurement pass also reads the overlay's and the slide's client rects once, rather than once per coordinate conversion.
- `DrawnAnnotation` registered two window `keydown` listeners per mounted annotation, in built decks too, so every key press on a large deck ran several hundred handlers. One listener now serves the annotations of an open edit session, and only while it is open.
- `MagicMoveBetween` added its three `::view-transition-*` rules to the document once per code window; the windows of a chain now share one style element.
- `InlineCompilerError` walked a Magic Move block one TreeWalker per token span on every mutation; it walks the block once.

- `DrawnAnnotation` marks and `InlineCompilerError` diagnostics no longer redraw when Slidev rebuilds the slide they are on. Slidev's slideshow container changes shape on the first click after a view transition (and back on the next slide-to-slide navigation), which unmounts and remounts every loaded slide, so ink that was already on screen fell off the slide and animated in again on a click that changed nothing, and the slide being left rebuilt just before the browser snapshotted it. An instance that is unmounted while its ink is visible now hands that ink to the instance replacing it, through the same hand-off that already carries ink across a cross-slide Magic Move, and the replacement shows it complete in the same render pass, with no entrance animation. Ink that was not on screen before still animates in as usual.
- The development-only **Edit annotations** launcher no longer appears in PNG exports: `slidev export` renders through a development server, and the launcher only hid itself for print media. It now also stays out of the presenter view.
- A `DrawnAnnotation` tag that is byte-identical to one on another slide (the same `text` and `label`, as on the "before" and "after" slides of a cross-slide Magic Move chain) is editable again. The editor plugin used to receive slides only after Slidev had rendered their Markdown, so no line of the file could be found again and a tag was located by its identity alone, which such duplicates do not have. The plugin now runs ahead of Slidev's Markdown rendering, receives a slide as written, and locates a tag by the widest run of verbatim lines around it, which normally takes in the slide title; the identity fallback remains for a tag those lines cannot pin down.
- The launcher drops keyboard focus after a click: Slidev ignores its shortcuts while a button is focused, so leaving the editor with **Esc** used to leave the arrow keys dead until the author clicked somewhere else.

### Changed

- Default code windows to 80 monospace columns instead of 68. Decks keep overriding `--code-window-columns` from their stylesheet.
- The annotation editor has no undo any more: the per-gesture history, its **Undo** button and **Cmd/Ctrl+Z** are gone. Re-drag what went wrong, or reset. A cancelled drag (Esc, or a pointer the browser interrupts) still snaps back to where it started.
- The editor toolbar's **Reset connector**, **Reset label** and **Reset selected** buttons are replaced by one **Reset annotation**, which removes the selected tag's whole `:geometry` binding; **Use automatic connector** is the one way back to the automatic route and removes the whole `connector` geometry, control point included. Resets, **Use automatic connector**, **Straighten connector** on a saved control point, and the connector toggle write immediately, since a draft cannot remove saved geometry.

## 0.12.1

### Fixed

- Preserve visible `DrawnAnnotation` marks and `InlineCompilerError` diagnostics across adjacent cross-slide Magic Move transitions when their targets remain in place. Matching ink now hands off without replaying its entrance animation, while moved or unrelated targets still animate normally.

## 0.12.0

### Added

- Support Magic Move between slides: a `magic-move` separator (or `magicMove: true` frontmatter) links consecutive slides, and their top-level code fences morph across the slide boundary in both navigation directions. Code windows pair up by position, so parallel snippets (for example Kotlin next to SQL) animate independently, and decks using `transition: view-transition` pair the code windows through the View Transitions API instead of cross-fading them.
- Support per-click line highlighting (`{1|2-3}`) and fence options (`{lines:true, at:2}`) on chained fences: the ranges register as clicks on their slide and step through before navigation moves on, matching classic Magic Move behaviour.
- Add a development-only visual annotation editor: `drawnAnnotationEditor()` (exported as `slidev-theme-kotlin/annotation-editor`) injects transient source locators while serving, and persists dragged label, width, and connector geometry as a normalized `:geometry` binding on exactly the edited `DrawnAnnotation` tag — with keyboard nudging, undo, revision-conflict detection, and reset controls. Builds and exports carry no editor code.
- Add the `geometry` prop to `DrawnAnnotation`: normalized source-local label and connector geometry, including quadratic Bézier connectors, that overrides automatic placement.
- Add `DrawnAnnotation`'s passive mode for observing a click already owned by nearby `v-click` / `v-clicks` content without registering an extra click step.
- Add JDBC and R2DBC identity badges and border colours for Kotlin code fences with the `jdbc` and `r2dbc` modifiers.

### Changed

- Make automatic `DrawnAnnotation` label placement deterministic: candidates prefer the requested side and stay clear of the slide's laid-out content (including still-hidden v-click content, so a label never sits where the slide is about to grow), of the annotation's own mark, of labels placed by earlier annotations, and of `avoid-selector` matches (kept at `clearance` distance), wrapping into free space when needed.
- **Breaking**: replace `DrawnAnnotation`'s `label-x` / `label-y` / `label-width` props with the normalized `geometry.label` binding.
- **Breaking**: a `DrawnAnnotation` without `at`/`on` is now part of the initial slide state instead of taking the next automatic click; give `at` or `on` for a reveal.
- Render `DrawnAnnotation` labels as safe Markdown; inline code and block quotes use the theme's local-first JetBrains Mono stack.

### Fixed

- Persist curved-connector edits: the source writer no longer rejects the `type: 'quadratic'` connector shape its own serializer emits.
- Ship `slidev-theme-kotlin/annotation-editor` as plain JavaScript with type declarations, so a consuming deck's `vite.config.ts` can load it under Node instead of failing on raw TypeScript inside node_modules.
- Keep a save conflict recoverable: after a 409 the write client no longer adopts the other author's revision, so a continuing drag cannot silently overwrite their edit.
- Persist a width-only first edit by materializing the label's current position, instead of silently dropping the width while reporting "Annotation saved".
- Translate a quadratic connector's control point with arrow-key body nudges, matching pointer body drags instead of distorting the saved curve.
- Match the Alt+Shift+A editor shortcut by physical key so it works on macOS, where Option+Shift+A composes "Å".
- Escape quotes in cross-slide Magic Move fence titles and options, so titles like `[Bob's file.kt]` and options like `{at:"+2"}` no longer break the slide markup.
- Morph cross-slide Magic Move from the correct step when a chain slide contributes no fence at a position, and give duplicate identical fences on one slide their own animation identity.
- Decode annotation source locators as UTF-8 in the browser, so decks with non-ASCII filenames can save geometry.
- Do not apply the code-chip background to inline Markdown code in `DrawnAnnotation` labels.

## 0.11.0

### Added

- Bundle `InlineCompilerError`, a click-aware inline diagnostic component that marks source lines or exact code text in static Shiki and Magic Move blocks.
- Add IntelliJ-style identity icons to code windows for Kotlin, Gradle, Amper, Java, terminal, Maven, and PostgreSQL fences, including Kotlin and Gradle fence aliases.
- Add `export:slide` for exporting an individual slide at an exact click state.
- Add visual regression review and check scripts for comparing the theme and consumer decks across revisions.

### Changed

- Make code-window icon border colours and column-based code sizing customizable through CSS variables.
- Improve `DrawnAnnotation` tracking, label placement, obstacle detection, and animation timing across Magic Move and view transitions.
- Update Slidev dependencies to 52.19.1 and require Node.js 20.12 or newer.

### Documentation

- Document inline compiler diagnostics, code-window icons and sizing, single-slide export, and visual regression review workflows.

## 0.10.0

### Added

- Bundle `DrawnAnnotation`, a click-aware, Rough.js-powered annotation component for marking elements or exact code text with circles, underlines, boxes, and strike-throughs.
- Support leader lines, target marks, automatic non-overlapping labels, sequential nested reveals, temporary click ranges, and Magic Move-aware tracking.
- Add complete component documentation and interactive examples to the theme showcase.

### Packaging

- Add `roughjs` as a runtime dependency required by `DrawnAnnotation`.

## 0.0.10

### Added

- Allow decks to enable Kodee once with `themeConfig.kodee`. A shared per-slide layer supports every layout: regular slides use a small bottom-right mascot, while cover and intro layouts use a large featured mascot.
- Support concise per-slide overrides such as `kodee: wink` and `kodee: false`, while retaining the full object configuration.
- Implement the documented `medium` Kodee size.
- Bundle `DrawnAnnotation`, a click-aware, Rough.js-powered annotation component for marking elements or exact code text with circles, underlines, boxes, and strike-throughs.
- Support leader lines, target marks, automatic non-overlapping labels, sequential nested reveals, temporary click ranges, and Magic Move-aware tracking.
- Add complete component documentation and interactive examples to the theme showcase.

### Packaging

- Add `roughjs` as a runtime dependency required by `DrawnAnnotation`.

## 0.0.9

### Fixed

- Bundle Kodee SVG variants with the theme instead of serving them from the theme package's `public/` directory.

  Previously, `Kodee.vue` generated runtime URLs such as `/theme/kodee-welcome.svg` and relied on Slidev to copy a consuming theme's `public/` directory into the presentation output. That copying behavior did not work with newer Slidev/Vite versions (including Slidev 52.19 and Vite 8), so consumer builds omitted `dist/theme/kodee-*.svg`; Kodee images then returned 404s in the browser.

  Kodee assets now live in `assets/` and are imported by Vite at build time. Consumer presentations receive emitted, fingerprinted asset URLs, independent of Slidev's theme-public-directory copying behavior.

### Packaging

- Added an npm `files` allowlist so the bundled mascot assets are always included in the published theme package.
