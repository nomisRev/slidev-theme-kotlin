# Changelog

## Unreleased

### Removed

- The three Kotlin logo files under `public/`: nothing in the theme referenced them, and the README no longer lists them as a feature.

### Fixed

- `SmartCast` and `Warning` follow the colour scheme: in dark mode the token background is Darcula's smart-cast green (`#294436`) and warning olive (`#52503a`) instead of the IntelliJ Light tints, which left Darcula's grey code nearly unreadable on a pastel bar, and the messages brighten to `#7bc47f` and `#d4b44a`. The same variables (`--smart-cast-color`, `--warning-color`, and the `-message-color` pair) still override both schemes, as `TypeHint` already did.

## 0.13.0

### Added

- `InlineCompilerError` underlines a diagnostic that spans several lines: `\n` in `text` (or a real newline in a bound string) continues the match on the next source line, indentation included, every line of the match gets its own squiggle, and the message sits after the line the match starts on, as IntelliJ places its inline diagnostics. `line` then names the first line of the match. `SmartCast` and `DrawnAnnotation` accept the same `\n` in `text`.
- `DrawnAnnotation` takes `line`, like `InlineCompilerError` and `SmartCast`: the one-based source line of a code block to search `text` on, with `occurrence` counted on that line only. A repeated token is reached by naming its line instead of counting its occurrences. A slide with several code blocks numbers each from one, and a match never straddles two blocks.
- The text search the three components share lives in `code-text-match.ts`: one segmenter for static Shiki and Magic Move blocks that stamps every segment with its source line, line-scoped and multi-line matching, the trimmed range of a line, and the merge of a range's client rects into visual lines. `InlineCompilerError` and `SmartCast` no longer carry their own copies, and the module has unit tests.
- `Warning` paints IntelliJ's warning yellow (`#faf4d7`, `--warning-color`) behind an exact piece of code, for the `Array` property of a data class or a parameter nobody reads. It takes `SmartCast`'s props (`text`, `line`, `occurrence`, `at` / `until` / `on`) and follows Magic Move the same way. An optional `message` sits after the end of the match's first line, where `InlineCompilerError` puts its diagnostics, in `--warning-message-color` and `--warning-message-size`; `SmartCast` accepts the same `message`. The mechanism both share now lives in `code-highlight.ts`, and each component only names its class and colours. The Kotlin snippet CLI keeps generating a fence under `Warning`, unlike one under `InlineCompilerError`.
- `InlineCompilerError`, `Warning`, and `SmartCast` render `message` as the same safe Markdown as a `DrawnAnnotation` label: `` `Int` `` is inline code in the mono stack, `\n` breaks the line as before, and HTML stays escaped. `annotation-label-markdown.ts` now renders all four, and the label CSS moved from `DrawnAnnotation`'s scoped styles into the theme stylesheet so every component shares it.
- `TypeHint` draws IntelliJ's inlay hint for a lambda with receiver: the grey `this: HTML` pill after the `{` on `line`, for DSL slides. `text` defaults to `{`, `receiver` names the type, `context` instead renders a `context(...)` block's hint as `context(Clock)` without `this:`, and the click props are `SmartCast`'s. It is the shared `code-highlight.ts` mechanism with painting turned off (`highlightClass` is now optional), so the pill follows Magic Move the way a `Warning` message does and sits after the line's last token when code follows the brace. Colours and size come from `--type-hint-color`, `--type-hint-background`, and `--type-hint-size`, with Darcula values under `html.dark`.
- A ```` ```console ```` fence renders as program output instead of a second editor window: a flat panel in the colours of IntelliJ's Run tool window (`--code-window-output-background`, `--code-window-output-color`, with new-UI dark values under `html.dark`), without the editor's outline and shadow, marked with the green run icon (`run.svg`) where a Kotlin fence shows its logo. Shiki's shell-session colouring is neutralised so output is one colour. Decks that already put a `console` fence under their Kotlin fences get the panel without a slide change.
- `InlineValue` draws IntelliJ's debugger inline value: the grey `numbers: [1, 2, 3]` after the line named by `text` (and `line` / `occurrence`), for output slides where each line has its own result. `value` is shown as written, and the click props are `SmartCast`'s. It is the shared `code-highlight.ts` mechanism with painting turned off, like `TypeHint`, in the code font at the code's size; `--inline-value-color` and `--inline-value-size` restyle it.
- `themeConfig.drawnAnnotation.connect: false` hides every `DrawnAnnotation` leader line in a deck, for decks that place their labels by hand; a slide's `drawnAnnotation.connect` frontmatter overrides the deck and a tag's `:connect` binding overrides both. The editor's **Hide connector** / **Show connector** toggle knows that default: it writes `:connect="true"` or `:connect="false"` only where the wanted state differs from it, and removes the binding when it matches. The source writer accepts `connect: null` to remove the binding; it owns that binding next to `:geometry`, and a tag's locator ignores both. The routing and curve controls are disabled while the connector is hidden.
- Folded imports: a leading block of `import` lines in a Kotlin, Java, or Scala fence leaves the code window on the slide, on ordinary fences, cross-slide Magic Move chains, and classic Magic Move blocks alike. Line numbers, highlight ranges, and annotation targets count from the first line of real code. `show-imports` on a fence or `themeConfig.foldImports: false` keeps imports visible. A `// Example` comment line (optionally `// Example: description`) folds everything above it instead, helper declarations included; the marker line leaves the slide too. The handout, `llms-full.txt`, and generated Kotlin sources keep the fence complete.
- Static content on every `slidev build`: a crawlable `handout/` (one page per source file, with highlighted code, Open Graph tags, the deck's `lang`, and links back to each slide), `llms.txt` and `llms-full.txt`, plus `sitemap.xml` when `themeConfig.siteUrl` is set and `robots.txt` when that URL is the root of its host (elsewhere the build prints the `Sitemap:` line to add to the host's own `robots.txt`). Slide headings sit below their slide's title, so the handout and `llms-full.txt` read as one outline. The built `index.html` links to the handout and `llms-full.txt` (`rel="alternate"`, a paragraph of visible links that the app hides once mounted, a plain-text description in place of Slidev's, and the canonical URL and sitemap once `siteUrl` is known), so crawlers that render no JavaScript find the content from the root URL. `themeConfig.handout: false` disables it; `handout.notes: false` leaves presenter notes out.
- `slidev-kotlin-snippets`, a CLI that writes one compilable Kotlin file per Kotlin fence of a deck (in the spirit of KotlinX Knit): each file gets its own package, the fence's imports plus the `themeConfig.snippets.imports` a deck shares, top-level declarations as written, and bare statements wrapped in `suspend fun main()`. `--check` fails when the files are stale, for CI. `no-compile` on a fence skips it, as does an `InlineCompilerError` wrapper; the flag is stripped from the rendered fence like `show-imports`, whether or not imports fold. `@slidev/parser` and `jiti`, which the CLI runs on, are now dependencies of the theme.
- Java fences now generate compilable `.java` files under `themeConfig.snippets.javaDir` (default `src/main/java/snippets`). Java and Kotlin fences on the same slide use the same generated package so interop examples compile together. A later slide of the same section that declares a public type an earlier slide already declared (two interop slides each showing `public class Person`) gets a directory named after the slide, `Person.java` inside, instead of a numbered file javac rejects.
- GoatCounter analytics: `themeConfig.analytics.goatcounter` (an endpoint or a site code) adds `count.js` to the built deck and its handout pages, and the theme sends one pageview per slide (`<base>/<slide number>` with the slide's title) instead of one per load, skipping clicks, presenter, overview, notes, print, and export views.
- Hash-mode builds (`slidev build --router-mode hash`) get a script forwarding old history-mode deep links such as `/deck/12` to `/deck/#/12`, so links shared before the switch keep working on hosts without a single-page-app rewrite.
- Development-only problem chips: while Vite serves the deck, a `DrawnAnnotation` whose `text`, `selector`, `occurrence`, or `target` matches nothing, an `InlineCompilerError` whose diagnostic is not shown, and a `SmartCast`, `Warning`, `TypeHint`, or `InlineValue` whose `text` is not found, put a red chip in the top-left corner of their slide next to the console warning they already print. The chip follows the warning's timing (current slide, settled, click reached), withdraws when the target turns up, and never appears in builds, exports, the presenter view, or print mode. `InlineCompilerError`'s console warnings now gate on Vite's explicit development mode like `DrawnAnnotation`'s editor, instead of `import.meta.env.DEV`.
- Annotation editing is a frozen session: entering the editor locks Slidev navigation (shortcuts, click-to-navigate, nav controls, swipes) on the current slide and click, every drag and arrow-key nudge stays a local draft, and **Done editing annotations** commits all changed drafts in one write phase; a failed write keeps the drafts and the session. **Esc** cancels in stages (drag, selection, then the session after a confirmation).
- Quadratic connector editing: the first edit of an automatic leader keeps its visible curve as a persisted control point, which renders as a draggable, keyboard-nudgeable handle with a dashed control-polygon guide. **Curve connector** and **Straighten connector** add or remove the control point from the toolbar, and the connector's hit target follows the rendered curve.
- **Reset slide** in the editor toolbar removes the saved geometry of every annotation on the current slide, after a confirmation.

### Fixed

- `DrawnAnnotation` settles only on the slide on screen when it mounts. Slidev mounts every slide of the deck, and a whole-show remount mounts them all again, so each annotation walked the document's running animations twice at mount time for slides nobody was looking at — on a deck with a few hundred annotations, that many document-wide walks per remount. Becoming current settles as before.
- `DrawnAnnotation` marks on text are trimmed to the font's ink, cap height to descender, instead of the line's full content area. JetBrains Mono reserves 1.32em per line while its glyphs span about 0.9em, so a mark drawn from the text rect floated away from the letters and, in a code block, into the neighbouring lines; automatically placed labels and routed leaders measure from the trimmed box too, so they sit a little closer to the code.
- A committed annotation draft is dropped once Slidev has recompiled the Markdown that holds it. The commit re-seeded the draft with what the writer saved, and nothing ever cleared it, so a later hand edit of the tag's `:geometry` binding stayed invisible in the browser and **Reload saved geometry** asked to discard changes that were already saved.
- The static handout and `llms-full.txt` translate `SmartCast`, `Warning`, `TypeHint`, and `InlineValue` into notes, as they already did `DrawnAnnotation` and `InlineCompilerError`. The four fell through to the generic tag strip, which cannot cross the `<` of a generic inside an attribute, so `<Warning text="names: List<String>">` left half a tag in the prose; a `message` or `value` was dropped either way.
- The JDBC and R2DBC code-window badges read `--font-sans`, which Slidev's UnoCSS preset never defines, and rendered in the browser's generic sans-serif; they read `--slidev-font-sans`. The slide's bottom rule hard-coded a purple one shade off the theme primary and now uses `--slidev-theme-primary`.
- A `console` fence inside a cross-slide Magic Move chain renders as the output panel like a static one; the panel's rules only matched the class on a static fence's `<code>`, not the one the chain transformer puts on the wrapper.
- `scripts/lint-slides.mjs` calls `@slidev/parser`'s `load` with its current signature and registers the theme's preparser, so a deck with root-absolute `src:` entries lints and chain slides' frontmatter is read as written; `scripts/visual-review.mjs` looks for the kotlin-fundamentals deck next to the theme instead of at an old path.
- `Kodee`'s unknown-variant warning gates on Vite's explicit development mode like every other development-only message.
- The npm tarball no longer ships the theme's test files.
- `Warning` and `SmartCast` no longer eat the last glyph of a token when a match spans several Shiki tokens: each painted token reached `0.15em` into its neighbour through a negative margin, and the later token's background painted over the earlier one's text (`println` read `printlr`, `String?` read `Strinq`). The highlight now sits flush with the text and square, as IntelliJ paints it, so adjacent tokens join into one bar.
- `InlineCompilerError` resolves its target once per DOM state instead of once per animation frame, the way `DrawnAnnotation` already did: while Magic Move moves retained tokens, or a resize or font load moves boxes, the range found before is reused and only its client rects are read again; a replaced child or edited text drops it. The search itself was already cheap (tens of microseconds on a deck-sized code window), so this removes work rather than a visible stutter — on the kotlin-fundamentals deck a Magic Move step spends about 25 ms of scripting in the annotation components over its whole transition, and the frame a key press drops is spent in Slidev's navigation and Shiki's per-token measurements, not in the text search.
- Kodee is drawn once for the whole slideshow, in a `global-bottom` layer that follows the current slide's `kodee` frontmatter, instead of once per slide. Under a slide transition such as `fade`, a per-slide mascot faded out with the old page while an identical one faded in with the new, a blink on every navigation; the deck-wide mascot stays put and only remounts (replaying its entrance) when the slide asks for a different picture, size or place. Print and export render the layer per printed slide; the overview and the presenter's next-slide preview keep a per-slide mascot. `Kodee` now takes `viewTransition` as a prop instead of reading the slide context, and the `kodee` value resolution lives in `kodee-props.ts`.
- Cross-slide Magic Move renders through a renderer that gathers the running animations once per step instead of asking the browser once per token. Shiki's renderer waits for every token with `getAnimations()`, which the browser answers by walking every running animation in the document, so a window of 138 tokens with three transitions each cost about 50 ms of one frame; the theme's `BatchedMagicMoveRenderer` (a subclass of the public `MagicMoveRenderer`) brings that to about 5 ms. On the kotlin-fundamentals deck the longest frame gap on a chain step went from 134 ms to 67 ms and no keypress stalls for 100 ms any more.
- Cross-slide Magic Move under a slide transition such as `fade`: the departing slide's copy of the code window is hidden for the length of the transition instead of cross-fading over the arriving window's morph, and the arriving window's box resizes from the first frame instead of after Shiki's default delay. The fade itself no longer touches the morphing window: Slidev's `fade` transitions the opacity of the whole slide root, so the window blinked out with the departing slide and faded back in halfway through its own animation. On a slide whose window is morphing, the root now stays opaque and only the content around the window cross-fades (the heading, annotations, Kodee, and any code window without a counterpart on the neighbouring slide); slides outside a chain fade as before. The README now recommends `fade` over `view-transition`, which makes Slidev 52 remount every preloaded slide whenever a click is followed by a slide change.
- Cross-slide Magic Move ships its precompiled steps as plain JSON (`steps-json`) instead of an lz-string payload. The lz string was already compressed, so gzip could not shrink it, and every slide of a chain carries the whole chain: on the kotlin-fundamentals deck the 173 payloads made up 1.1 MB of the 1.7 MB the built deck's JavaScript transferred, where the same steps as entity-escaped JSON gzip to a third of that. `JSON.parse` is also about ten times faster than the decode was (10 ms against 100 ms for every payload of that deck), so `MagicMoveBetween` parses each instance's own copy instead of sharing decoded steps, which also keeps `syncTokenKeys`'s in-place key rewrites from leaking between the windows of a chain. `lz-string` is no longer a dependency of the theme.
- The transformer highlights each step of a chain once per build or dev server instead of once per fence of the chain: every chain slide compiles all N steps, so a chain of N slides asked Shiki N² times, on every reload of a chain slide as well.
- `DrawnAnnotation` labels and the `message` of `InlineCompilerError`, `SmartCast`, and `Warning` are rendered by a small renderer of their own instead of markdown-it. The parser and its linkifier were the largest thing the theme added to the browser bundle (88 KB of JavaScript, 35 KB gzipped), loaded by every slide with an annotation, to render a label of a few words. The subset is what labels used: paragraphs, `>` quotes, fenced code, backticked inline code, `**strong**` or `__strong__`, `*emphasis*` or `_emphasis_` (an underscore inside a word stays text), and `\n` line breaks, with embedded HTML escaped. What markdown-it also accepted and no label in the decks used is now plain text: lists, headings, links and bare URLs, thematic breaks, backslash escapes, and HTML entities. The output keeps markdown-it's shape, so the label CSS is unchanged too. markdown-it remains a build-time dependency for the static handout.
- `DrawnAnnotation` imports only rough.js's generator, from `roughjs/bin/generator`, which is the copy Slidev's own `v-mark` already ships. `import rough from 'roughjs'` resolved to the library's separate bundled file, so built decks carried rough.js twice, together with the canvas and SVG renderers the component never uses.
- Code-window icons moved from the theme's `public/` directory to `assets/code-window/` and the stylesheet references them relatively. `url('/kotlin.svg')` only worked in a deck that had copied the icons into its own `public/`: Slidev copies a theme's `public/` to `dist/theme/`, never to the root, and Vite does not apply `--base` to a root-absolute URL it cannot find in the deck's public directory. Vite now bundles the icons like the Kodee artwork (see 0.0.9).
- `InlineCompilerError` skips its sync on slides that are not current. Every slide of the deck stays mounted, and each sync scanned the document's animations before checking whether anything was visible, so a whole-slideshow remount ran that scan once per diagnostic in the deck. Becoming current already schedules a full sync. `DrawnAnnotation` and `InlineCompilerError` also ask the document for its animations once per pass instead of once for the slide's subtree and once for the view transition's pseudo-elements, since the browser answers a subtree query by walking every animation in the document anyway.
- `SmartCast`, `Warning`, `TypeHint`, and `InlineValue` coalesce mutation and resize observer bursts into one sync per frame, as `InlineCompilerError` does: a Magic Move step flips classes on every token in several batches, and each sync walked the block, wrote classes, and forced a layout for the message.
- The theme's `index.html` opens connections to Google Fonts (`preconnect`) before the stylesheet Slidev links to is requested.
- `@slidev/parser` and `@slidev/types` accept any 52.x release (`^52.19.1`) instead of one exact version. A deck on a newer Slidev otherwise installed a second parser, whose slide slicing the preparser then had to agree with.
- The preparser no longer parses every slide's YAML to find slide boundaries; the boundaries come from the line scan, and Slidev parses the frontmatter itself right after.
- The published package includes `global-bottom.vue`, which draws the deck-wide Kodee, and the new `index.html`.
- The Shiki `v-mark` transformer and the development source transform skip fences and slide modules without a mark or an annotation before running their regexes; the static handout compiles its component regexes once.
- `scripts/test-annotation-editor.mjs` finds its fixture slide by its label instead of a hard-coded page number, which a slide added above it kept moving; `scripts/visual-review.mjs` reads the base revision's archive with a buffer large enough for the repository.
- `DrawnAnnotation` no longer re-searches the slide's text on every animation frame. While a Magic Move step or a slide transition moves the annotated text, the match found before the step is reused and only its client rects are read again; the search runs once per click, resize, or code-block mutation instead. The search itself no longer walks every text node's ancestors: an ignored subtree (the overlay, a token on its way out) is pruned once at its root. On a slide with three annotations over a cross-slide Magic Move this took the scripting of one navigation from about 150 ms to about 20 ms, most of which is Magic Move itself. Each measurement pass also reads the overlay's and the slide's client rects once, rather than once per coordinate conversion.
- `DrawnAnnotation` registered two window `keydown` listeners per mounted annotation, in built decks too, so every key press on a large deck ran several hundred handlers. One listener now serves the annotations of an open edit session, and only while it is open.
- `MagicMoveBetween` added its three `::view-transition-*` rules to the document once per code window; the windows of a chain now share one style element.
- `InlineCompilerError` walked a Magic Move block one TreeWalker per token span on every mutation; it walks the block once.
- `DrawnAnnotation` marks and `InlineCompilerError` diagnostics no longer redraw when Slidev rebuilds the slide they are on. Slidev's slideshow container changes shape on the first click after a view transition (and back on the next slide-to-slide navigation), which unmounts and remounts every loaded slide, so ink that was already on screen fell off the slide and animated in again on a click that changed nothing, and the slide being left rebuilt just before the browser snapshotted it. An instance that is unmounted while its ink is visible now hands that ink to the instance replacing it, through the same hand-off that already carries ink across a cross-slide Magic Move, and the replacement shows it complete in the same render pass, with no entrance animation. Ink that was not on screen before still animates in as usual.
- The development-only **Edit annotations** launcher no longer appears in PNG exports: `slidev export` renders through a development server, and the launcher only hid itself for print media. It now also stays out of the presenter view.
- A `DrawnAnnotation` tag that is byte-identical to one on another slide (the same `text` and `label`, as on the "before" and "after" slides of a cross-slide Magic Move chain) is editable again. The editor plugin used to receive slides only after Slidev had rendered their Markdown, so no line of the file could be found again and a tag was located by its identity alone, which such duplicates do not have. The plugin now runs ahead of Slidev's Markdown rendering, receives a slide as written, and locates a tag by the widest run of verbatim lines around it, which normally takes in the slide title; the identity fallback remains for a tag those lines cannot pin down.
- The launcher drops keyboard focus after a click: Slidev ignores its shortcuts while a button is focused, so leaving the editor with **Esc** used to leave the arrow keys dead until the author clicked somewhere else.
- A Kotlin `${...}` template reads as code, as IntelliJ shows it: the `${` and `}` take the escape colour that `$name` already had, and the expression between them the editor foreground. The grammar scopes the template as `meta.template.expression` with its own begin and end punctuation, and neither palette had a rule for those, so the whole template stayed string green while `$name` next to it turned blue. Both palettes now name the three scopes.

### Changed

- Default code windows to 80 monospace columns instead of 68. Decks keep overriding `--code-window-columns` from their stylesheet.
- The annotation editor has no undo any more: the per-gesture history, its **Undo** button and **Cmd/Ctrl+Z** are gone. Re-drag what went wrong, or reset. A cancelled drag (Esc, or a pointer the browser interrupts) still snaps back to where it started.
- The editor toolbar's **Reset label** and **Reset label & connector** buttons are replaced by one **Reset annotation**, which removes the selected tag's whole `:geometry` binding; **Use automatic connector** is the one way back to the automatic route and removes the whole `connector` geometry, control point included. Resets, **Use automatic connector**, **Straighten connector** on a saved control point, and the connector toggle write immediately, since a draft cannot remove saved geometry.

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
