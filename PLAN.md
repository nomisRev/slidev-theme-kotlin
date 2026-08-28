# DrawnAnnotation source-geometry merge plan

The editor persists geometry in each annotation's Markdown opening tag. There
is no annotation ID, generated stylesheet, output path, or global geometry
registry.

## Merge gates

### 1. Validate a real consuming deck

Validate `~/Developer/exposed-fundamentals` using a packed theme (`npm pack`),
not only a workspace dependency. Its Vite config should opt into the serving
plugin:

```ts
import { defineConfig } from 'vite'
import { drawnAnnotationEditor } from 'slidev-theme-kotlin/annotation-editor'

export default defineConfig({ plugins: [drawnAnnotationEditor()] })
```

Use annotations with no `id` or `:geometry`, then confirm a label, width, both
connector endpoints, and connector body edit add only a fixed-four-decimal
`:geometry` binding to the intended Markdown opening tag. Restart serving,
move/copy the tag, and verify source-local geometry remains with that tag.

### 2. Automated coverage

Keep unit coverage for normalized point/width conversion, document validation,
locator injection, deterministic tag patching (including self-closing tags),
and stale locator/revision rejection. The browser smoke test should use the
`/__drawn-annotation-source` endpoint and verify source HMR/reload rather than
CSS HMR.

Before merge, cover:

- keyboard moves, Shift moves, width-only left/right behavior, Escape, snapping;
- reset label/connector/all and undo snapshots;
- automatic/manual connector conversion;
- concurrent source revision conflict and explicit recovery;
- nested and Magic Move annotations retaining the transient locator;
- production build, PNG/PDF export, and GitHub Pages output containing source
  geometry but no toolbar, handles, locator attribute, or writer endpoint.

### 3. Manual accessibility and browser review

Review Chromium and Safari (and Firefox/iPad Safari when supported) for pointer
capture, SVG focus indication, keyboard behavior, presentation scale, nested
annotations, Magic Move, and slide transitions.

### 4. Release documentation

Document the `geometry` prop as concrete-slide fractions: label `x`/`width` and
connector x values use slide width; y values use slide height. Explain that the
serve-only locator is internal and that authors should commit the changed
Markdown. Add release notes for the breaking removal of `id`, `labelX`,
`labelY`, `labelWidth`, and generated-CSS persistence.

## Manual smoke test

1. Start a development deck with `drawnAnnotationEditor()` and open an
   annotation without geometry.
2. Edit label, width, endpoints, and connector body. Inspect the source: only
   its opening tag changes and the binding is formatted to four decimals.
3. Reload/restart and test two presentation scales.
4. Test Shift movement, snapping, Escape cancellation, reset, Undo, and a
   second browser conflict followed by Reload saved geometry.
5. Run `npm run build`, `npm run export`, and the consumer deck build. Confirm
   source-authored geometry renders and no editor UI or write endpoint remains.
