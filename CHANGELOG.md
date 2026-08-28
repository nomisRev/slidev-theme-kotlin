# Changelog

## Unreleased

### Changed

- `DrawnAnnotation` geometry is now source-local: the development editor writes
  normalized `:geometry` directly to the annotation's Markdown opening tag.
  Geometry moves and copies with that source tag and works in builds and
  exports without an additional generated stylesheet.
- This is a deliberate breaking change. The former `id`, `labelX`, `labelY`,
  and `labelWidth` persistence APIs, generated-CSS writer, selector namespace,
  and global annotation-ID registry have been removed. Enable the opt-in
  development Vite plugin when visual editing is needed.
- Editor locators no longer embed the file revision or the `:geometry`
  binding, so a save keeps the selection, drafts, undo history and toolbar
  actions of every annotation on the slide; the client fetches revisions per
  file from `GET /__drawn-annotation-source`. Undo and Reset now return to the
  geometry the source actually holds, including hand-authored `:geometry`.

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
