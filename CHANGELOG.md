# Changelog

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
