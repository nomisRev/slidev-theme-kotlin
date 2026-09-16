# Release the theme so the decks can pick up the static content, snippets CLI, and analytics

**Status:** in progress (0.13.0 committed on `annotation-performance`, publish pending)
**Blocks:** exposed-fundamentals/issues/EXPF-001, kotlin-fundamentals/issues/KOTF-001, ktor-fundamentals/issues/KTORF-001, advanced-dsl-in-kotlin/issues/ADVDS-001

## Problem

Everything under `CHANGELOG.md` "Unreleased" (folded imports and the
`// Example` marker, the crawlable handout with `llms.txt`, `sitemap.xml`,
and the self-describing `index.html`, the `slidev-kotlin-snippets` CLI,
hash-route redirects, GoatCounter analytics) only exists in this working tree.
Every deck still depends on 0.12.1 or on `file:../slidedev-theme-kotlin`,
which does not resolve in a GitHub Action, so no deployed deck publishes a
sitemap and the blog already links to sitemaps that 404.

## Work

- [x] Review and commit the working tree (it also contains an unrelated,
      untracked `components/DrawnAnnotationProblems.vue`).
- [x] Bump the version (the CHANGELOG has new features and a changed default
      of 80 code columns, so 0.13.0) and move "Unreleased" under it.
- [ ] `npm publish`; confirm `bin`, `setup`, and `styles` are in the tarball
      and `npx slidev-kotlin-snippets` works from a consumer with pnpm too,
      now that `@slidev/parser` and `jiti` are dependencies.
- [ ] Deploy the showcase (`pages.yml` builds with `--router-mode hash` and
      the headmatter sets `siteUrl`) and verify
      `https://nomisrev.github.io/slidev-theme-kotlin/sitemap.xml`,
      `handout/`, and `llms-full.txt`. The showcase has no `info:` and no
      `themeConfig.analytics`; add both if the showcase should be
      described and counted like the decks.

## Acceptance

- [ ] A deck depending on the published version builds in CI and writes
      `handout/`, `llms.txt`, `llms-full.txt`, and `sitemap.xml`.
