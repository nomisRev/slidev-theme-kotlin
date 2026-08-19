# Changelog

## 0.0.9

### Fixed

- Bundle Kodee SVG variants with the theme instead of serving them from the theme package's `public/` directory.

  Previously, `Kodee.vue` generated runtime URLs such as `/theme/kodee-welcome.svg` and relied on Slidev to copy a consuming theme's `public/` directory into the presentation output. That copying behavior did not work with newer Slidev/Vite versions (including Slidev 52.19 and Vite 8), so consumer builds omitted `dist/theme/kodee-*.svg`; Kodee images then returned 404s in the browser.

  Kodee assets now live in `assets/` and are imported by Vite at build time. Consumer presentations receive emitted, fingerprinted asset URLs, independent of Slidev's theme-public-directory copying behavior.

### Packaging

- Added an npm `files` allowlist so the bundled mascot assets are always included in the published theme package.
