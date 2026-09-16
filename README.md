# Slidev Theme Kotlin

A [Slidev](https://sli.dev) theme designed for Kotlin presentations, featuring the Kodee mascot with smooth animations and Kotlin-optimized syntax highlighting.

## Overview

This theme provides a professional presentation template tailored for Kotlin developers. It includes:

- **Kodee Mascot Integration**: Animated Kodee character with multiple variants (greeting, wink, wave, jumping, sitting, drinking, heart, in-love, welcome, winter, tiny)
- **Magic Move Animations**: Smooth transitions for Kodee between slides with configurable size and position
- **Magic Move between slides**: Link slides with a `magic-move` separator and their code windows morph across the slide boundary, including several parallel snippets per slide
- **Kotlin Syntax Highlighting**: Custom Shiki configuration optimized for Kotlin code
- **Multiple Layouts**: Pre-built layouts including default, cover, and intro
- **Kotlin Branding**: Official Kotlin logos for both light and dark modes
- **JetBrains Fonts**: Prefers locally installed JetBrains Sans and JetBrains Mono, with Inter and Google-hosted JetBrains Mono fallbacks
- **Drawn annotations**: Click-aware, hand-drawn marks, labels, and connectors for elements and code
- **Inline compiler diagnostics**: IntelliJ-style squiggles and messages for static and Magic Move code blocks

## Requirements

- **Node.js**: >= 20.12.0
- **Package Manager**: npm (or pnpm with shamefully-hoist=true)

## Installation

Install the theme in your Slidev project:

```bash
npm install slidev-theme-kotlin
```

## Usage

### Visual annotation editor (development)

Enable the optional, development-only source writer in the consuming deck's
`vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { drawnAnnotationEditor } from 'slidev-theme-kotlin/annotation-editor'

export default defineConfig({
  plugins: [drawnAnnotationEditor()],
})
```

Open Slidev's annotation editor (or press **Alt+Shift+A**) to start a frozen
edit session on the current slide and click state: Slidev navigation — arrow
keys, space, page keys, click-to-navigate, swipes — is paused until you leave
the editor. Drag a visible label, its width handle, or a connector control, or
nudge the selected control with the arrow keys (**Shift** for larger steps);
every change stays a local draft, so nothing is written mid-gesture. **Done
editing annotations** commits all changed drafts as normalized `:geometry`
bindings on exactly the edited `DrawnAnnotation` tags, then exits. **Esc**
cancels in stages — an active drag, then the selection, then (after a
confirmation) the whole session, discarding its drafts. One toolbar control
hides or shows the connector (writing `:connect` into the tag where the
deck's default differs, see `themeConfig.drawnAnnotation.connect`), one
switches it between manual and automatic routing, another curves or
straightens it with a draggable quadratic control point, and **Reset
annotation** or **Reset slide** removes the saved geometry of one annotation
or of every annotation on the slide. Source revisions are checked, so a
conflicting commit fails without overwriting anyone: the drafts stay visible,
and you either fix and press Done again or choose **Reload saved geometry** to
discard them. The locator, toolbar, and write endpoint exist only while Vite
serves the deck; builds and exports render saved geometry without editor code.

While serving, an annotation that cannot find what it should mark (a `text`
that no longer matches the fence, an unmatched `selector` or `target`, an
`occurrence` past the last match, or an `InlineCompilerError` whose diagnostic
is not shown) also puts a red chip in the top-left corner of its slide, next to
the warning it prints on the console. Hover the chip for the full message. The
chip appears only once the annotation's click has been reached and the slide
has settled, so a Magic Move step that does not yet contain the text never
flags one, and it disappears again when the target turns up. Builds, exports,
the presenter view, and print mode never render it.

### Basic Setup

Add the theme to your slides' frontmatter:

```yaml
---
theme: kotlin
transition: fade
---

# Your Presentation Title
```

### Code icons

Code fences are rendered as one IntelliJ Light/Darcula editor surface without a
title bar. A compact identity icon is placed in its top-right corner and follows
the presentation color scheme:

````md
```kotlin
fun main() = println("Hello")
```

```kts gradle
plugins { kotlin("jvm") }
```

```yaml toolchain
product: jvm/app
```

```xml maven
<artifactId>demo</artifactId>
```

```sql
SELECT * FROM presentations;
```
````

`kotlin`, `kt`, and `kts` use the Kotlin icon; each with a `gradle`, `jdbc`,
or `r2dbc` modifier uses the Gradle, JDBC, or R2DBC identity respectively.
`yaml toolchain`, `java`, `bash`, `xml maven`, and `sql` use the Amper, Java,
Terminal, Maven, and PostgreSQL icons respectively. All other fences remain plain
code surfaces.

A `console` fence is program output, not code: it renders as a flat panel in
the colours of IntelliJ's Run tool window, without the editor's outline and
shadow, marked with the green run icon. Put it under the Kotlin fence whose
output it shows:

````md
```kotlin
println([1, 2, 3].map { it + 1 })
```

```console
[2, 3, 4]
```
````

To show a value next to the line that produces it instead, as the debugger
does, wrap the fence in [`InlineValue`](components/README.md#inlinevalue).

The identity border colours are exposed as theme variables and can be
customized from a deck stylesheet. Each variable has a light and dark-mode
value:

```css
:root {
  --code-window-kotlin-color: #834df0;
  --code-window-gradle-color: #6c707e;
  --code-window-amper-color: #087cfa;
  --code-window-java-color: #e66d17;
  --code-window-terminal-color: #6c707e;
  --code-window-maven-color: #3574f0;
  --code-window-postgresql-color: #336791;
  --code-window-jdbc-color: #f59e0b;
  --code-window-r2dbc-color: #06b6d4;

  /* The `console` output panel. */
  --code-window-output-background: #f7f8fa;
  --code-window-output-color: #2b2d30;
}

html.dark {
  --code-window-kotlin-color: #a571e6;
  --code-window-output-background: #1e1f22;
  --code-window-output-color: #bcbec4;
  /* Override any of the other dark-mode values as needed. */
}
```

### Folded imports

A snippet on a slide reads best without its imports, but a snippet that
carries them is complete: it compiles as written, a snippet checker such as
Knit can verify it, and the deck's handout (see below) shows a reader which
package every symbol comes from. So write the imports, and the theme folds
them away:

````md
```kotlin
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

fun numbers(): Flow<Int> = flowOf(1, 2, 3)
```
````

On the slide, the code window shows only `fun numbers()…`; the handout and
`llms-full.txt` print the fence in full.

When an example needs more than imports — a table definition, a helper the
example calls — put a `// Example` comment where the example starts.
Everything above it leaves the slide, and so does the marker line itself:

````md
```kotlin
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

fun numbers(): Flow<Int> = flowOf(1, 2, 3)

// Example: reuse the flow above without showing it
fun doubled(): Flow<Int> = numbers().map { it * 2 }
```
````

The window shows `fun doubled()…`. The comment is ordinary Kotlin, so the
fence still compiles as written (see the snippet checker below), and the
handout keeps it. A description after the colon is optional.

Details:

- Kotlin, Java, and Scala fences (`kotlin`, `kt`, `kts`, `java`, `scala`)
  fold. Without a marker, only a block of `import` lines at the top of the
  fence counts, and a `package` line or `@file:` annotation before it stays
  visible. With a marker, everything above it folds. Only the first
  `// Example` line in a fence counts, and only when there is code above it.
- Line numbers, `{1|2-3}` highlight ranges, and annotation targets all
  count from the first line of real code, so folding never shifts them.
- Cross-slide Magic Move chains and classic ````md magic-move```` blocks fold
  too, step by step.
- Add `show-imports` to a fence (`` ```kotlin show-imports ``) when the slide
  is about the imports themselves, or set `themeConfig: { foldImports: false }`
  in the headmatter to keep every import visible.

### Code sizing

Every code window uses one font size calculated from the slide canvas width. By
default, a full-width window fits 80 monospace characters. Override the column
count once in the deck's stylesheet, or narrower on a single slide class:

```css
:root {
  --code-window-columns: 72;
}
```

The calculation accounts for the standard layout and code padding. A custom
layout with different horizontal spacing can override
`--code-window-inline-space`. To bypass column-based sizing entirely, set an
explicit `--code-window-font-size`, for example `1.25rem`.

### Magic Move between slides

Slidev's classic Magic Move animates code inside one slide, on clicks. This
theme additionally supports morphing code **across slides**: put `magic-move`
in the separator between two slides and their code windows animate from one to
the next when you navigate.

````md
# My Slide

```kotlin
class Person
```

---
magic-move
---

# My Slide

```kotlin
class Person(val name: String)
```
````

Details:

- The separator links the slide it precedes to the one before it, so the last
  slide of a chain needs no marker. Any number of slides can be chained by
  repeating the `magic-move` separator.
- Code windows pair up **by position**: the first fence of a slide morphs into
  the first fence of the next, the second into the second, and so on. Several
  parallel snippets (say Kotlin next to SQL) each animate independently.
- Everything outside the code fences is a normal slide — headings, prose, and
  layout can change freely and follow the deck's regular slide transition.
- With a slide transition such as `fade`, the departing slide's copy of the
  window is hidden for the length of the transition, so only the arriving
  window is visible while its tokens morph and its box resizes to the new
  code. Prefer `fade` over `view-transition`: with `transition:
  view-transition`, Slidev 52 switches its slideshow container between a
  `div` and a `TransitionGroup` whenever a click is followed by a slide
  change, which remounts every preloaded slide of the deck and stalls the
  frame for 150 ms or more on each such navigation. If you do use
  `view-transition`, the code windows of both slides are paired through the
  View Transitions API instead.
- Navigating backward plays the animation in reverse. Deep links, the
  overview, and PDF/PNG exports render each slide's own step statically.
- Fence metadata still works: the code-window identity icons, `[Title]`
  labels, and `{lines:true}` line numbers apply per chain. Per-click line
  highlighting works too — `` ```kotlin {1|2-3} `` registers clicks on that
  slide and steps through the ranges before navigation moves on, exactly like
  one step of a classic Magic Move block. Snippet imports (`<<< @/...`) do
  not participate in chains.
- `magicMove: true` in the slide's YAML frontmatter is equivalent to the bare
  `magic-move` separator and can be combined with other frontmatter keys.

### Using Kodee Mascot

Enable Kodee once for the whole deck with `themeConfig`:

```yaml
---
theme: kotlin
themeConfig:
  kodee: greeting
---
```

Kodee then uses layout-aware defaults: `small` in the bottom-right corner on regular slides, and `large`/`featured` on `cover` and `intro` slides. Override only the variant when a slide needs a different expression:

```yaml
---
kodee: wink
---
```

Use `kodee: false` to hide the mascot on one slide. The original object form remains available when you need complete control:

```yaml
---
kodee:
  variant: greeting
  size: large
  position: featured
---
```

#### Kodee Configuration Options

- **variant**: Choose from available Kodee images
  - `greeting` - Kodee waving hello
  - `wink` - Kodee winking
  - `wave` - Kodee waving
  - `jumping` - Kodee jumping with joy
  - `sitting` - Kodee sitting down
  - `drinking` - Kodee with a drink
  - `heart` - Kodee with a heart
  - `in-love` - Kodee in love
  - `welcome` - Kodee welcoming
  - `winter` - Kodee in winter attire
  - `tiny` - Tiny Kodee

- **size**: Control Kodee's size
  - `small` - 200x200px (regular-layout default)
  - `medium` - 320x320px
  - `large` - 600x600px (500x500px for wave variant; cover/intro default)

- **position**: Control Kodee's placement
  - `corner` - Bottom right corner (regular-layout default)
  - `featured` - Prominently displayed (cover/intro default)
  - `custom` - Use with `x` and `y` coordinates

#### Custom Positioning

For precise control, use custom positioning:

```yaml
---
kodee:
  variant: greeting
  position: custom
  x: 100
  y: 200
  scale: 1.2
---
```

### Using DrawnAnnotation

`<DrawnAnnotation>` is auto-registered for every deck using the theme. It can mark an element with a selector or exact text inside a Shiki or Magic Move code block, then connect that mark to a label or another element. Labels accept safe Markdown: backticked inline code and `>` quotes use the local-first JetBrains Mono stack.

````md
<DrawnAnnotation type="circle" text="fun main" label="program entry point" :on="1">

```kotlin
fun main() = println("Hello, Kotlin!")
```

</DrawnAnnotation>
````

The full prop reference, timing behavior, and troubleshooting guide are in [`components/README.md`](components/README.md). The bundled [`slides.md`](slides.md) includes working examples of code annotations, connectors, labels, sequential reveals, and Magic Move integration.

### Using InlineCompilerError

`<InlineCompilerError>` is auto-registered for every deck using the theme. Wrap one code block to underline a source line or exact text with an IntelliJ-style diagnostic; it follows both static Shiki blocks and Magic Move steps.

````md
<InlineCompilerError text="userName" message="Unresolved reference: userName" :on="1">

```kotlin
println(userName)
```

</InlineCompilerError>
````

See [`components/README.md`](components/README.md#inlinecompilererror) for the target and click-timing props.

#### IntelliJ formatting

IntelliJ recognizes only the first YAML block in a Markdown file as frontmatter. To keep later Slidev frontmatter intact when using **Reformat Code**, enable formatter tags and stop formatting after the deck headmatter:

```ini
# .editorconfig
[*.md]
ij_formatter_tags_enabled = true
```

```md
---
theme: kotlin
---

<!-- @formatter:off -->
```

The theme's example deck includes this guard.

## Static handout, `llms.txt`, and hash-mode links

A Slidev build is a single-page app: without JavaScript its `index.html`
contains nothing but the title. Search engines render JavaScript for the root
URL at best, and AI crawlers (GPTBot, ClaudeBot, CCBot, …) render none, so the
code on your slides never reaches them. Every `slidev build` on this theme
therefore also writes, next to the app:

- `handout/index.html` and `handout/<section>.html` — one page per source
  file (`src:` lesson), with every slide's title, prose, and highlighted code,
  each linking back to the live slide. A single-file deck gets one page.
- `llms.txt` and `llms-full.txt` — the [llmstxt.org](https://llmstxt.org)
  convention that coding agents and AI crawlers look for: an index, and the
  full Markdown of the deck with complete code snippets (folded imports
  expanded).
- `sitemap.xml` — only when the deck's public URL is known.
- `robots.txt` — only when that URL is the root of its host and `public/`
  ships none. Crawlers read `robots.txt` at the host root alone, so a deck
  served from a sub-path (a GitHub project page, a folder of your blog) gets
  no file; add `Sitemap: <siteUrl>sitemap.xml` to the host's own
  `robots.txt` instead, as the build reminds you.

The handout and `llms-full.txt` form one outline: the deck, then each
section, then each slide, with a slide's own headings placed below its
title. The handout pages carry a description, canonical URL, Open Graph
tags, and the deck's `lang` from the headmatter (`en` when unset).

The built `index.html` (and the `404.html` copied from it) is made
self-describing too: `rel="alternate"` links to the handout and
`llms-full.txt`, a plain-text `<meta name="description">` from the headmatter
`info` (replacing the one Slidev renders from the raw Markdown), and a short
paragraph linking to the same files as visible text, hidden as soon as the
app has mounted. That paragraph is ordinary markup rather than `<noscript>`,
which many text extractors drop, so a crawler that renders no JavaScript
still finds the content from the root URL. With `siteUrl` set the page also
carries the canonical URL and a `rel="sitemap"` link.

Theme markup is translated, not dropped: a `DrawnAnnotation` with a `label`
becomes a quoted note about the code it points at, an `InlineCompilerError`
becomes its diagnostic, Magic Move blocks become their steps, and
`<<< @/file#region` snippet imports are inlined.

Give the deck its public URL so links, the sitemap, and `llms.txt` are
absolute, and opt out of notes or the whole feature if you need to:

```yaml
themeConfig:
  siteUrl: https://example.github.io/my-deck/
  handout:
    notes: false   # leave presenter notes out (default: included)
  # handout: false # disable the static content entirely
```

## Analytics

Decks can count pageviews with [GoatCounter](https://www.goatcounter.com),
which sets no cookies and stores no personal data, so it needs no consent
banner. Give the headmatter the endpoint of your GoatCounter site, or just
its code:

```yaml
themeConfig:
  analytics:
    goatcounter: https://mysite.goatcounter.com/count   # or: mysite
```

Every `slidev build` then adds `count.js` to the deck, and the theme sends
one pageview per slide, recorded as `<base>/<slide number>` with the slide's
title, so the dashboard's path list doubles as a per-slide drop-off curve.
Clicks within a slide, the presenter and overview views, notes, print, and
export are never counted. Handout pages carry the tag too and count under
their own URL. `slidev dev`, exports, and screenshots send nothing:
`count.js` ignores localhost and headless browsers by itself.

Every deck on one host can share one GoatCounter site, since paths carry the
deck's base. Add `#toggle-goatcounter` to a deck's URL to stop counting your
own visits in that browser.

## Compiling the snippets

A Kotlin fence on a slide is a fragment: it carries its imports (folded away,
see above) but no package, and it may mix declarations with bare statements.
`slidev-kotlin-snippets` turns Kotlin and Java fences into source files, in the
spirit of [KotlinX Knit](https://github.com/Kotlin/kotlinx-knit), so a Gradle
module can compile the deck's code against the real libraries and a stale slide
fails the build instead of the talk.

Turn it on in the headmatter and run the CLI from the deck:

```yaml
themeConfig:
  snippets:
    dir: src/main/kotlin/presentation/snippets   # default: src/main/kotlin/snippets
    javaDir: src/main/java/presentation/snippets  # default: src/main/java/snippets
    package: presentation.snippets               # default: snippets
    imports:                                     # added to every file
      - presentation.support.*
```

```bash
npx slidev-kotlin-snippets            # writes the files, removes stale ones
npx slidev-kotlin-snippets --check    # exits 1 when they are out of date (CI)
npx slidev-kotlin-snippets talk.md    # another entry than slides.md
```

Each Kotlin fence becomes `<dir>/<section>/<slide>-<title>.kt`; each Java
fence becomes `<javaDir>/<section>/<slide>-<title>.java`. Files have a package,
`<package>.<section>.slide<n>`, so every step of a Magic Move chain can declare
its own `object Talks`. A Java and Kotlin fence on the same slide deliberately
share that package, allowing Java ↔ Kotlin interop examples to compile. Inside
the file:

- the fence's imports come first, after the `imports` from the config. Keep
  the tables, types, and values the slides use without defining them in a
  hand-written package and star-import it; a fence that defines its own
  `Talks` shadows the shared one, because a declaration in the file's own
  package wins over a star import.
- Kotlin top-level declarations (`fun`, `val`, `object`, `class`, ... with
  their annotations, modifiers, and `context(...)` lines) stay top-level, and
  bare statements such as `Talks.selectAll()` are wrapped in `suspend fun main()`.
  A Kotlin `package` line is dropped; `@file:` annotations move above the package.
- Java fences are emitted as Java compilation units with the generated package
  and imports; they must therefore contain declarations rather than bare
  statements. Their own `package` line is replaced. A fence declaring a public
  top-level Java type is named after that type (as Java requires); otherwise it
  uses the slide-based filename.
- a slide with several fences in the same language tells them apart by their
  first meta word (`jdbc`, `r2dbc`) or a letter.

Not every fence is meant to compile. Add `no-compile` to a fence that sketches
library internals or an intermediate step (`` ```kotlin no-compile ``); the flag
is stripped before Slidev sees it. Fences inside an `InlineCompilerError` are
skipped automatically, since the slide shows the diagnostic on purpose, and so
are `gradle` build-script fences.

Wire it into Gradle so `./gradlew check` also fails on stale sources:

```kotlin
val snippetsCheck by tasks.registering(Exec::class) {
    commandLine("npx", "slidev-kotlin-snippets", "--check")
}
tasks.check { dependsOn(snippetsCheck) }
```

### Deep links on GitHub Pages

GitHub Pages has no single-page-app rewrite, so a history-mode deep link such
as `/my-deck/12` is answered by the copied `404.html` with a 404 status. Build
with Slidev's hash router instead:

```bash
slidev build --base /my-deck/ --router-mode hash
```

Links then look like `/my-deck/#/12` and always resolve. The theme adds a small
script to hash-mode builds that forwards old `/my-deck/12` links (and
`presenter/…`, `overview`, `notes`, `print`, `export`) to their hash
equivalent, so links shared before the switch keep working.

## Development

### Available Scripts

```bash
# Start development server with example presentation
npm run dev

# Build the example presentation for production
npm run build

# Export presentation to PDF
npm run export

# Export every slide and click state as PNG screenshots
npm run screenshot

# Export one slide; --click is zero-based (0 is the initial state)
npm run export:slide -- --slide 12 --click 3

# Render this working tree against HEAD and open the generated visual review
npm run visual:review
```

### Exporting One Slide

`npm run export:slide` is an AI-agent-friendly wrapper around `slidev export`. It writes one PNG rather than a directory of all exported pages:

```bash
# Initial state of slide 12
npm run export:slide -- --slide 12

# State after the third click of slide 12
npm run export:slide -- --slide 12 --click 3 --output artifacts/slide-12-click-3.png

# Use another deck entry
npm run export:slide -- --entry path/to/talk.md --slide 4 --click 0
```

`--slide` is one-based. `--click` is optional and zero-based, so `--click 0` is the initial slide state, `--click 1` is the state after one click, and so on. Without `--output`, screenshots are written under `.slidev/exports/`, which is ignored by Git. Run `npm run export:slide -- --help` for timeout, wait, and dark-mode options.

### Running the Slides

The repository includes `slides.md`, a compact presentation demonstrating the theme's layouts, Kotlin highlighting, Kodee animations, magic moves, and click animations:

```bash
npm run dev
```

This will open the example presentation in your browser with hot-reload enabled.

## Project Structure

```
.
├── components/                   # Vue components
│   ├── DrawnAnnotation.vue        # Hand-drawn marks, labels, and connectors
│   ├── InlineCompilerError.vue    # Inline code diagnostics
│   ├── Kodee.vue                  # Main Kodee mascot component with animations
│   └── KodeeWrapper.vue           # Wrapper component for Kodee integration
├── slide-bottom.vue     # Per-slide Kodee layer shared by every layout
├── layouts/            # Slidev layout templates
│   ├── cover.vue       # Cover slide layout
│   ├── default.vue     # Default slide layout
│   └── intro.vue       # Introduction slide layout
├── assets/             # Bundled theme assets
│   └── kodee-*.svg     # Kodee mascot variants (11 variants)
├── public/             # Static assets
│   └── kotlin-logo*.svg # Kotlin logos (light/dark modes)
├── setup/              # Slidev setup files
│   ├── shiki.ts        # Syntax highlighting configuration for Kotlin
│   ├── transformers.ts # Cross-slide Magic Move and import folding passes
│   ├── analytics.ts    # GoatCounter tag and per-slide pageviews
│   ├── code-imports.ts # Folded imports: fence scanning and source edits
│   ├── static-content.ts       # Handout, llms.txt, sitemap generation
│   ├── hash-route-redirect.ts  # Old history-mode links → hash routes
│   └── vite-plugins.ts # Registers the two build plugins above
├── styles/             # Theme styles
│   ├── index.ts        # Style entry point
│   └── layout.css      # Layout styles
├── .pi/extensions/inspect-shiki-token-scopes.ts # Local Pi tool for inspecting Shiki token scopes
├── slides.md           # Example presentation used for local development and GitHub Pages
├── package.json        # Package configuration and dependencies
└── LICENSE             # Apache License 2.0
```

## Environment Variables

<!-- TODO: Document any environment variables if needed -->

No environment variables are currently required for this theme.

## Visual regression review

Visual review starts a temporary Slidev server and uses Playwright Chromium to
capture every settled click state from Slidev's normal presenter/player route
(`/<slide>?clicks=<click>`), rather than the print-export `?print=clicks` route.
It renders the current working tree and a Git revision with the same browser,
compares every PNG with `pixelmatch`, and writes a three-column
base/current/diff page. When the local
`~/Developer/kotlin-fundamentals` consumer deck is available, its baseline is
rendered from its clean `HEAD` and its current capture includes its working-tree
changes, with each capture linked to the corresponding theme revision.
Screenshots are not committed: the chosen Git revision is the baseline, so
accepting an intentional visual change is simply reviewing it and committing
that change.

```bash
# Compare the working tree with the last commit.
npm run visual:review

# Compare a branch with its integration base.
npm run visual:review -- --base origin/main

# Use in automation when any visual difference should fail the command.
npm run visual:check -- --base origin/main
```

Open the `file://.../.visual/review/index.html` path printed by the command.
The `.visual/` directory contains disposable base/current captures and diffs
and is ignored by Git. `npm run screenshot` is the non-comparison escape hatch
when raw PNGs are all that is needed.

The visual exporter requires the Chromium binary supplied by
`playwright-chromium`. If dependency installation is configured not to run
package install scripts, download it once with:

```bash
npx playwright install chromium
```

`npm run lint` validates the deck's frontmatter and Kodee configuration; `npm
run build` runs that lint before building the Slidev deck.

## Configuration

### Theme Defaults

The theme is configured with the following defaults in `package.json`:

```json
{
  "slidev": {
    "colorSchema": "both",
    "defaults": {
      "fonts": {
        "sans": "Inter",
        "mono": "JetBrains Mono"
      }
    }
  }
}
```

## Layouts

The theme provides three layouts:

1. **default** - Standard slide layout with optional Kodee
2. **cover** - Cover slide for presentation title
3. **intro** - Introduction slide layout

Use layouts by specifying them in slide frontmatter:

```yaml
---
layout: cover
---

# Presentation Title
```

## Dependencies

### Runtime Dependencies
- `@shikijs/magic-move` (4.4.3) - Code-token morphing for Magic Move
- `@slidev/types` (52.19.1) - Slidev type definitions
- `roughjs` (4.6.6) - Hand-drawn SVG paths for `DrawnAnnotation`

### Development Dependencies
- `@slidev/cli` (52.19.1) - Slidev command-line interface

## Contributing

<!-- TODO: Add contribution guidelines -->

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

## Credits

- **Kodee Mascot**: Official Kotlin mascot by JetBrains
- **Kotlin Logos**: Official Kotlin branding by JetBrains
- **Slidev**: Presentation framework by [Anthony Fu](https://github.com/antfu)

## Links

- [Slidev Documentation](https://sli.dev)
- [Kotlin Official Website](https://kotlinlang.org)
- [Package on npm](https://www.npmjs.com/package/@nomisrev/slidev-theme-kotlin)

---

Made with ❤️ for the Kotlin community
