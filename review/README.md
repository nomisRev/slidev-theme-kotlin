# DrawnAnnotation positioning review evidence

This directory contains the rendered states and human feedback used to plan the `DrawnAnnotation` positioning and routing rewrite.

## Canonical files

- `drawn-annotation-review.json` — unchanged human review export (`drawn-annotation-placement-review/v2`).
- `manifest.json` — source annotation opening tags and rendered-state inventory used by the review page.
- `index.html` — original local drawing/review interface.
- `theme/`, `kotlin-fundamentals/`, `exposed-fundamentals/` — reviewed PNG states.

The canonical JSON was copied from `/Users/simonvergauwen/Downloads/drawn-annotation-review.json` after review. SHA-256:

```text
800b83143ad59b1988a99538652a0a81b7e917524ce8c1f73bae83d38d1d6360
```

The original local source deck revisions observed while strengthening the rewrite plan were:

```text
kotlin-fundamentals: 87ecf01
exposed-fundamentals: f105018
```

These revisions document provenance; regenerate fixtures with explicit commit metadata if either deck changes. The theme source is this repository and should be recorded by commit when the curated regression baseline is created.

## Important limitations

The raw review is evidence, not yet a direct automated oracle:

- freehand regions and routes do not identify an annotation when a state contains several;
- regions are approximate preferred areas, not exact required polygons;
- current source/label boxes and logical connector geometry were not captured;
- some checkbox summaries disagree with the drawn ink;
- notes naming a technology (JDBC, R2DBC) refer to the annotation related to it, not to the code-window identity badges;
- the per-record `validPlacementArea`/`label`/`connector` booleans are per-aspect "this is OK" verdicts; where they disagree with the overall verdict they classify what is wrong (placement versus connector);
- `exposed-fundamentals/008-09` was judged from the development server because its captured image was incorrect.

Before automated assertions are derived, curated fixtures must add stable annotation IDs, map feedback to those IDs, and define tolerant fixture-specific placement/route checks. See `docs/drawn-annotation-rewrite-plan.md`.
