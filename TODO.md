# DrawnAnnotation source-geometry pivot

Replace the current ID + generated-CSS persistence model before merging the visual editor into the base theme. The goal is zero persistence setup or identity work for presentation authors.

## Target authoring experience

Authors write normal annotations with no ID:

```md
<DrawnAnnotation
  text="Suspend"
  label="R2DBC is a reactive driver"
  on="0"
>
```

After editing, the development tool writes normalized geometry directly into that annotation's source tag:

```md
<DrawnAnnotation
  text="Suspend"
  label="R2DBC is a reactive driver"
  on="0"
  :geometry="{
    label: { x: 0.6842, y: 0.3146, width: 0.2188 },
    connector: {
      start: { x: 0.4221, y: 0.4729 },
      end: { x: 0.6314, y: 0.3486 },
    },
  }"
>
```

- All persisted numbers are normalized fractions of the concrete Slidev slide: `0` is its left/top edge, `.5` its centre, and `1` its right/bottom edge.
- `label.width` is a fraction of slide width; label `x`/connector `x` values use slide width and `y` values use slide height.
- Geometry remains correct under Slidev scale, presenter scale, viewport resizing, build, PNG/PDF export, and GitHub Pages deployment.
- Moving or copying an annotation in Markdown moves/copies its geometry with it.
- Reset removes `label`, `connector`, or the complete `:geometry` binding from the opening tag.

## Public component API

Add one public prop:

```ts
interface DrawnAnnotationGeometry {
  label?: {
    x: number
    y: number
    width?: number
  }
  connector?: {
    start: { x: number, y: number }
    end: { x: number, y: number }
  }
}

geometry?: DrawnAnnotationGeometry
```

Hard-remove these legacy/public persistence APIs and all supporting code:

```ts
id?: string
labelX?: number
labelY?: number
labelWidth?: number
```

Also remove the generated-CSS persistence contract, CSS custom property reads, `data-drawn-annotation-id` selector attribute, missing/duplicate-ID diagnostics, and the global ID registry. Do not keep compatibility shims: this component remains in design and may make a clean breaking change.

Existing non-persistence layout props (`placement`, `gap`, `connect`, `curve`, etc.) remain as automatic/default rendering inputs.

## Development-only editor locator

The editor still needs to safely identify the exact Markdown opening tag that it is editing, but this is not a persisted annotation identity.

Extend the Vite plugin with a source transform that, while serving, injects an opaque transient locator for each `DrawnAnnotation` instance. It is derived from the Markdown file and opening-tag source range/fingerprint. It must:

- stay internal to transformed code/DOM and never be added to authored Markdown;
- identify the source file relative to the Vite root and the exact opening-tag range;
- be validated by the writer before a source mutation;
- reject stale/mismatched fingerprints rather than patching an unintended tag;
- never depend on Slidev page number or runtime mount order.

The toolbar should show a useful label/source preview, not an internal locator.

## Writer pivot

Replace the `/__drawn-annotations` generated-CSS writer with a narrow, development-only source-geometry writer.

It must:

- accept only an internal locator, expected revision, and validated normalized `label`/`connector` geometry patch;
- enforce project-root containment for every source file;
- atomically rewrite the target Markdown file through a temporary file + rename;
- preserve the rest of the file and patch only the relevant `DrawnAnnotation` opening tag;
- add/replace/remove one `:geometry` binding deterministically;
- use fixed four-decimal formatting;
- reject stale revisions with `409` and return clear recovery information;
- allow editor draft geometry to remain visible until Slidev HMR has recompiled the source;
- provide reset/undo through source geometry snapshots;
- expose no endpoint in production.

The persistent geometry is now the Markdown source itself. There is no generated CSS file, selector namespace, orphaned CSS rule, or CSS merge-conflict surface.

## Implementation sequence

1. Define `DrawnAnnotationGeometry` and conversion/validation helpers; characterize normalized width and coordinate conversion.
2. Update `DrawnAnnotation.vue` to consume `geometry` and drafts; remove `id`, label coordinate/width props, CSS reads, and ID diagnostics.
3. Refactor editor store and toolbar to use transient locators and readable source descriptions.
4. Implement source discovery/transform and safe tag patching in the Vite plugin.
5. Refactor the writer client for source geometry documents, revisions, reset, and undo.
6. Delete generated stylesheet imports/files and CSS writer tests.
7. Update the local theme fixture and `~/Developer/exposed-fundamentals` consumer fixture to require no IDs or generated stylesheet.
8. Rewrite README/component documentation and `PLAN.md` to describe source-local geometry.
9. Add/adjust unit, browser, and consumer-package tests.

## Required verification

- Start with an annotation containing no `id` and no geometry; edit label, width, endpoints, and connector body.
- Confirm only `:geometry` is written to the source opening tag.
- Restart development mode and confirm geometry remains.
- Move/copy the source annotation and confirm geometry moves/copies with it.
- Confirm label and connector geometry at two presentation scales.
- Confirm keyboard movement, Shift movement, undo, reset, Escape cancellation, snapping, and conflict recovery.
- Confirm nested/Magic Move annotations retain source tracking and click behavior.
- Confirm build, PNG/PDF export, and GitHub Pages output include source-authored geometry with no editor UI or writer endpoint.
- Validate a packed (`npm pack`) theme in the Exposed consumer deck before merge.
