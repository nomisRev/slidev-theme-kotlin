# DrawnAnnotation source-geometry editor

**Status:** implemented as an opt-in, development-only editor. This document is
the design and operational guide for the source-local geometry model.

## Authoring model

An annotation needs no persistent identity or setup:

```md
<DrawnAnnotation
  text="Suspend"
  label="R2DBC is a reactive driver"
  on="0"
>
```

The editor writes only a normalized `:geometry` binding on that exact opening
tag:

```md
<DrawnAnnotation
  text="Suspend"
  label="R2DBC is a reactive driver"
  on="0"
  :geometry="{ label: { x: 0.6842, y: 0.3146, width: 0.2188 }, connector: { start: { x: 0.4221, y: 0.4729 }, end: { x: 0.6314, y: 0.3486 } } }"
>
```

All values are fractions of the concrete `.slidev-layout`:

- `label.x`, `label.width`, and connector `x` values use slide width.
- `label.y` and connector `y` values use slide height.
- `label.width` is optional; omitting it restores the natural label width.
- Values are written at fixed four-decimal precision.

Geometry therefore follows its source tag when an author moves or copies that
tag. It remains valid at Slidev/presenter scale, on viewport resize, and in
PNG, PDF, static builds, and deployed decks.

The public component input is:

```ts
interface DrawnAnnotationGeometry {
  label?: { x: number, y: number, width?: number }
  connector?: {
    start: { x: number, y: number }
    end: { x: number, y: number }
  }
}
```

`geometry` is the sole persistence input. The former `id`, `labelX`, `labelY`,
and `labelWidth` persistence APIs are intentionally not supported.

## Development editor

A deck opts into editing in its `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { drawnAnnotationEditor } from 'slidev-theme-kotlin/annotation-editor'

export default defineConfig({
  plugins: [drawnAnnotationEditor()],
})
```

While Vite serves Markdown, the plugin adds an opaque internal locator to each
transformed `DrawnAnnotation` tag. The locator contains the Markdown path
relative to the Vite root (mapped back from Slidev's per-slide virtual module
id), a fingerprint of the opening tag with its ordinal among identical tags,
and its line for display. The fingerprint ignores the `:geometry` binding and
the locator carries no file revision, so the writer's own saves never change
the locator: every piece of browser editor state (selection, drafts, undo
history, toolbar actions) is keyed by it and must survive a save, including
the autosaves during a long drag. Should a locator still change (a save
elsewhere in the file can move a tag to another line), the component migrates
that state to the new locator. The locator is never written to Markdown and is
not present in a production build. The toolbar displays a readable
file-and-line preview instead.

The source revision travels out of band: `GET /__drawn-annotation-source`
returns the current revision of every transformed Markdown file, and each
write response carries the file's new revision, so the client always sends
the expected revision of the file rather than of a single tag.

The writer endpoint exists only in Vite serve mode. It accepts the locator, the
expected source revision, and a validated normalized geometry document. Before
writing it verifies root containment, revision, and fingerprint; a
stale or mismatched locator returns `409` with recovery guidance instead of
changing another tag. The target Markdown file is rewritten atomically through
a temporary file and rename, with all unrelated source retained byte-for-byte.

There is deliberately no generated stylesheet, selector namespace, global ID
registry, or CSS HMR contract.

## Editing behavior

Open **Edit annotations** (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>)
in the normal development slide view. The editor is unavailable in presenter,
overview, print/export, and production views.

- Drag a label to set its position; drag its right handle to set width.
- Drag connector endpoints or its body to materialize a manual connector.
- Connector snapping includes slide guides plus the current source, target,
  and label ports. Hold <kbd>Alt</kbd> to disable snapping.
- Focus a selected control and use arrow keys to nudge it; use
  <kbd>Shift</kbd> for larger movement. The width handle responds to left and
  right only.
- <kbd>Escape</kbd> cancels an active drag. The toolbar can reset label,
  connector, or all geometry, restore an automatic connector, and undo the
  selected change with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>Z</kbd>.

Draft geometry remains visible while the source recompiles after a save. On a
revision conflict it is intentionally retained for inspection; use **Reload
saved geometry** to discard the draft and start from the latest source.

## Verification checklist

1. Start with a tag that has neither `id` nor `:geometry`; edit label position,
   width, endpoints, and connector body. Confirm that only `:geometry` changes.
2. Restart serving, then move and copy the source tag. Confirm geometry remains
   with the moved/copied tag.
3. Check the same geometry at two presentation scales, then test keyboard,
   Shift keyboard, snapping, Escape, undo, reset, and conflict recovery.
4. Check nested and Magic Move annotations preserve source tracking and click
   behavior.
5. Run a production build and PNG/PDF export. Confirm source geometry renders
   but no editor controls, locator attribute, or writer endpoint is emitted.
6. Validate an `npm pack` tarball in the Exposed consumer deck before release.
