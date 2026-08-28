# Slidev Theme Kotlin

A [Slidev](https://sli.dev) theme designed for Kotlin presentations, featuring the Kodee mascot with smooth animations and Kotlin-optimized syntax highlighting.

## Overview

This theme provides a professional presentation template tailored for Kotlin developers. It includes:

- **Kodee Mascot Integration**: Animated Kodee character with multiple variants (greeting, wink, wave, jumping, sitting, drinking, heart, in-love, welcome, winter, tiny)
- **Magic Move Animations**: Smooth transitions for Kodee between slides with configurable size and position
- **Kotlin Syntax Highlighting**: Custom Shiki configuration optimized for Kotlin code
- **Multiple Layouts**: Pre-built layouts including default, cover, and intro
- **Kotlin Branding**: Official Kotlin logos for both light and dark modes
- **JetBrains Fonts**: Uses Inter for sans-serif and JetBrains Mono for code
- **Drawn annotations**: Click-aware, hand-drawn marks, labels, and connectors for elements and code
- **Inline compiler diagnostics**: IntelliJ-style squiggles and messages for static and Magic Move code blocks

## Requirements

- **Node.js**: >= 18.0.0
- **Package Manager**: npm (or pnpm with shamefully-hoist=true)

## Installation

Install the theme in your Slidev project:

```bash
npm install slidev-theme-kotlin
```

## Usage

### Visual annotation editor (development)

The optional editor writer is a Vite development plugin. It writes only
normalized annotation geometry to `styles/drawn-annotations.generated.css`; it
is not included in builds or exports. Enable it from the consuming deck's
`vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { drawnAnnotationEditor } from 'slidev-theme-kotlin/annotation-editor'

export default defineConfig({
  plugins: [drawnAnnotationEditor()],
})
```

The generated stylesheet is imported by the theme. The plugin exposes a local
`GET`/`POST /__drawn-annotations` endpoint used by the visual editor,
validates IDs and unit-fraction label/connector geometry, rejects stale
revisions, and atomically rewrites that one file. In development, press
**Alt+Shift+A**, then drag a visible identified label (or its selected width
handle), connector body, or connector endpoint. Connector endpoints snap to
slide edge/centre guides and the annotation's source, target, and label ports;
hold `Alt` while dragging to place freely. Arrow keys nudge whichever control
was selected: labels move their label, endpoint handles move that endpoint, and
a connector body moves the complete line (`Shift` makes larger steps). The
toolbar can undo completed saves or return a connector to its automatic
attached route. Configure a
different generated file beneath the deck
root with `drawnAnnotationEditor({ output: 'styles/my-annotations.css' })` and
import that file from the deck stylesheet.

### Basic Setup

Add the theme to your slides' frontmatter:

```yaml
---
theme: kotlin
transition: view-transition
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

```kotlin jdbc
val database = Database.connect("jdbc:postgresql://localhost/example")
```

```kotlin r2dbc
val database = R2dbcDatabase.connect("r2dbc:postgresql://localhost/example")
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

`kotlin`, `kt`, and `kts` use the Kotlin icon. Kotlin fences with the `jdbc` or
`r2dbc` modifier use matching text badges and border colours; the `gradle` modifier
uses the Gradle icon. `yaml toolchain`, `java`, `bash`, `xml maven`, and `sql` use the
Amper, Java, Terminal, Maven, and PostgreSQL icons respectively. All other fences
remain plain code surfaces.

The identity border colours are exposed as theme variables and can be
customized from a deck stylesheet. Each variable has a light and dark-mode
value:

```css
:root {
  --code-window-kotlin-color: #834df0;
  --code-window-jdbc-color: #f59e0b;
  --code-window-r2dbc-color: #06b6d4;
  --code-window-gradle-color: #6c707e;
  --code-window-amper-color: #087cfa;
  --code-window-java-color: #e66d17;
  --code-window-terminal-color: #6c707e;
  --code-window-maven-color: #3574f0;
  --code-window-postgresql-color: #336791;
}

html.dark {
  --code-window-kotlin-color: #a571e6;
  /* Override any of the other dark-mode values as needed. */
}
```

### Code sizing

Every code window uses one font size calculated from the slide canvas width. By
default, a full-width window fits 68 monospace characters. Override the column
count once in the deck's stylesheet:

```css
:root {
  --code-window-columns: 72;
}
```

The calculation accounts for the standard layout and code padding. A custom
layout with different horizontal spacing can override
`--code-window-inline-space`. To bypass column-based sizing entirely, set an
explicit `--code-window-font-size`, for example `1.25rem`.

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

`<DrawnAnnotation>` is auto-registered for every deck using the theme. It can mark an element with a selector or exact text inside a Shiki or Magic Move code block, then connect that mark to a label or another element.

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
│   └── shiki.ts        # Syntax highlighting configuration for Kotlin
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
- `@slidev/types` (^52.2.5) - Slidev type definitions
- `roughjs` (^4.6.6) - Hand-drawn SVG paths for `DrawnAnnotation`

### Development Dependencies
- `@slidev/cli` (^52.2.5) - Slidev command-line interface

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
