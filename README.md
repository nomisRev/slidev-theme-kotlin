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

## Requirements

- **Node.js**: >= 18.0.0
- **Package Manager**: npm (or pnpm with shamefully-hoist=true)

## Installation

Install the theme in your Slidev project:

```bash
npm install slidev-theme-kotlin
```

## Usage

### Basic Setup

Add the theme to your slides' frontmatter:

```yaml
---
theme: kotlin
transition: view-transition
---

# Your Presentation Title
```

### Using Kodee Mascot

Add Kodee to any slide by including the `kodee` configuration in the slide's frontmatter:

```yaml
---
kodee:
  variant: greeting
  size: large
  position: featured
---

# Your Slide Content
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
  - `small` - 200x200px (default)
  - `large` - 600x600px (500x500px for wave variant)
  - `medium` - TODO: Not yet implemented

- **position**: Control Kodee's placement
  - `corner` - Bottom right corner (default)
  - `featured` - Prominently displayed on slide
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

## Development

### Available Scripts

```bash
# Start development server with example presentation
npm run dev

# Build the example presentation for production
npm run build

# Export presentation to PDF
npm run export

# Export presentation as PNG screenshots
npm run screenshot
```

### Running the Example

The repository includes `example.md` demonstrating all theme features:

```bash
npm run dev
```

This will open the example presentation in your browser with hot-reload enabled.

## Project Structure

```
.
├── components/          # Vue components
│   ├── Kodee.vue       # Main Kodee mascot component with animations
│   └── KodeeWrapper.vue # Wrapper component for Kodee integration
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
├── debug.js            # Utility script for enumerating Shiki Kotlin tokens
├── example.md          # Example presentation demonstrating theme features
├── package.json        # Package configuration and dependencies
└── LICENSE             # Apache License 2.0
```

## Environment Variables

<!-- TODO: Document any environment variables if needed -->

No environment variables are currently required for this theme.

## Testing

<!-- TODO: Add test setup and instructions -->

No automated tests are currently configured for this theme.

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
