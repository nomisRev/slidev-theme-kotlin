# DrawnAnnotation positioning redesign — review analysis

**Source:** `review/drawn-annotation-review.json`  
**Reviewed component:** `components/DrawnAnnotation.vue`  
**Coordinate system:** 1440 × 810, origin at top-left.  
**Purpose:** turn the completed visual review into requirements and a testable redesign plan. This is an analysis report, not an implementation specification for an exact learned geometry model. Product and implementation decisions made after this analysis are authoritative in `docs/drawn-annotation-rewrite-plan.md`.

## 1. Executive conclusion

The current system succeeds at **collision avoidance in simple, single-label layouts** but its placement policy is too local and too strongly vertical. The review consistently treats the large empty regions to the **right of code/content** as valuable annotation space, and expects multiple simultaneous annotations to be composed deliberately there. The current `auto` policy starts from only the source's vertical half of the slide (`down` above the midpoint, `up` below it), then treats right/left as expensive fallbacks. That is the opposite of a large part of the supplied feedback.

The redesign should therefore be a **slide-level, candidate-and-score layout solver**:

1. model usable empty regions (including intentionally usable blank code-window body),
2. generate `right`, `down`, and `up` candidates together for `auto` rather than deciding a vertical side first; retain `left` as a strict explicit placement only,
3. score visual relationship, whitespace utilisation, future-click stability, clearance, and connector quality,
4. solve annotations visible together as one batch, and
5. route leaders through the resulting layout using obstacle-aware paths.

Do not optimise solely for non-overlap. Several bad examples appear collision-free but are rejected because the label is on the wrong side, wastes the right-hand space, appears to belong to another item, or produces an unclear connector.

## 2. Dataset inventory and coverage

| Measure | Count |
| --- | ---: |
| Review records / rendered states | 181 |
| `Good` verdicts | 90 |
| `Bad` verdicts | 24 |
| Verdict supplied | 114 (63%) |
| Records explicitly marked as invalid / no annotation | 51 |
| Records with any review ink, route, or note | 153 |
| Records with valid-area ink | 92 |
| Records with desired connector ink | 38 |
| Records with a traced current connector | 0 meaningful traces |

Breakdown by deck:

| Deck | States | Good | Bad | Explicitly invalid |
| --- | ---: | ---: | ---: | ---: |
| Theme | 41 | 18 | 2 | 13 |
| Kotlin fundamentals | 95 | 44 | 17 | 28 |
| Exposed fundamentals | 45 | 28 | 5 | 10 |

The review-page introduction says it contains “167 rendered states from 61 slides with at least one label”, while the export has **181 keys**. That is not necessarily wrong—the export also contains states judged to have no relevant annotation—but the difference means counts should be interpreted as review-record counts, not a clean annotation-level dataset.

### Directional evidence

The ink denotes **areas that are acceptable**, not a single chosen label centre. The table below counts state-side pairs (157); the export contains 168 individual area strokes (up 28, right 70, down 69, left 1):

| Accepted-side ink | Areas | Good states containing the side | Bad states containing the side |
| --- | ---: | ---: | ---: |
| Down | 68 | 58 | 9 |
| Right | 62 | 39 | 21 |
| Up | 26 | 16 | 10 |
| Left | 1 | 1 | 0 |

This is not a side-preference distribution: one state can contain several labels and several acceptable sides. It nevertheless gives clear design signals:

- `down` and `right` are the dominant usable regions;
- `right` appears disproportionately in rejected states because it is often the **requested correction**;
- `left` is almost never desired (one area only);
- `up` is valid in specific open header/top regions, not as a generic fallback.

## 3. What the review says

### 3.1 Strong signals

1. **Prefer meaningful free space, especially code-window interior/right space.**
   - `exposed-fundamentals/008-09`: the `ReferenceOption` explanation belongs in the unused right side of the code window, rather than below it.
   - `kotlin-fundamentals/033-05`: “use more of the empty space on the right in the code window”.
   - `kotlin-fundamentals/029-02` and `043-02`: placement should use or move further into right-side space.
   - This validates the existing decision *not* to turn an entire code surface into a solid obstacle. Preserve that capability, but represent usable code-body whitespace explicitly rather than treating it as an accidental gap.

2. **Auto placement must assess every direction, not infer a vertical side from source Y.**
   - `theme/033-02`: `up` or `right` would have been better, including when considering the next annotation.
   - `kotlin-fundamentals/031-04`: “right is the auto choice here”; it should be somewhat lower.
   - `kotlin-fundamentals/045-01`: right is preferred over down.
   - `kotlin-fundamentals/064-01`: right is a saner default, while up is acceptable.
   - `kotlin-fundamentals/033-02`: the nominal right placement lands in an up region, so semantic direction alone is insufficient—the final box must have an appropriate spatial relation to its source.

3. **A valid placement is a region, not a fixed offset.**
   Review circles are broad, irregular regions. They commonly encode a preference such as “right and slightly below”, “the lower blank body of this code window”, or “this open header band”. A redesign must score many candidate centres/boxes in the region; it should not attempt to reproduce the freehand outline literally.

4. **Simultaneous annotations need coordinated composition and a readable order.**
   - `exposed-fundamentals/008-05`: put several labels beneath each other on the right to make connector order clear.
   - `kotlin-fundamentals/059-01`: four desired regions/routes for a two-annotation state; the reviewer explicitly asks whether the intended multiple paths are understood.
   - `kotlin-fundamentals/060-02`, `theme/038-02`–`038-04`, and `exposed-fundamentals/030-01`/`037-01` also raise colour differentiation for simultaneous annotations.
   - Current placement is sequential and DOM-order dependent: later labels avoid earlier labels, but there is no joint choice of a column, ordering, routing lanes, or visual grouping.

5. **The visible state is not enough; choose positions stable under the next click.**
   - `theme/033-02` explicitly rejects a location in part because a second annotation appears on the next click.
   - The component currently excludes `.slidev-vclick-hidden` from `scanObstacles`, so future content does not affect the current placement. This produces layouts that are locally clear and immediately become poor.

6. **Connectors are part of placement quality.**
   The requested routes show that the reviewer expects a clear source-to-label association, not merely a curve which happens not to intersect text. Poor source exit point, unclear path, and unnecessary text crossings are all called out:
   - `theme/028-02`: connector overlaps text unnecessarily.
   - `kotlin-fundamentals/033-05`: connector start point is weird.
   - `kotlin-fundamentals/045-01`: a down placement has no connector; right is best.
   - `theme/041-02`: the arrow is oversized for a short connector.

### 3.2 Cases that remain good

The 90 `Good` verdicts establish constraints worth retaining:

- clearance from rendered text, media, cards, and earlier labels is generally valuable; the reviewed implementation modelled title/tab chrome, but that chrome has since been removed from the theme and is not part of the rewrite contract;
- a down placement can be correct when there is a deliberate line break / lower whitespace (`kotlin-fundamentals/006-01`);
- strict manual side props are useful, and the directional demo states are broadly accepted; the agreed contract therefore retains explicit `left` while omitting it from `auto`;
- a label may use code-body whitespace;
- labels should wrap only when necessary rather than defaulting to a narrow column;
- difficult or dense multi-annotation states may be best solved manually with colour/connector choices rather than aggressive automatic routing (`theme/038-02`–`038-03`).

## 4. Current algorithm versus findings

| Current behaviour | Consequence in the review | Redesign implication |
| --- | --- | --- |
| `auto` chooses down/up based on whether source centre is above/below slide centre; right then left are later fallback directions. | Ignores available right-hand space and gives poor vertical choices. | Generate and rank right/down/up together. Give right-side whitespace a real score, not a hard fallback penalty. Keep left available only when explicitly requested. |
| Candidate grid uses gap plus independent lateral offsets, then clamps boxes to bounds. | A candidate nominally from one side can be visually located in another side’s area; boundary clamping creates distorted relationships. | Reject or heavily penalise candidates whose centre/attachment direction is no longer consistent after clamping. Generate bound-aware candidates directly. |
| Score is overlap-dominant (`overlap * 6`), then gap/lateral/order. | Collision-free but semantically poor positions win. | Add relationship, empty-region utilisation, connector, reading-order, and future-stability terms; treat overlap as a hard constraint when a clear candidate exists. |
| Obstacles are DOM boxes/text fragments, with code body intentionally mostly open. | Good basis, but “empty code space” is implicit and unstable. | Keep obstacle semantics, then derive explicit free-space regions / code-body lanes. |
| Only visible click content is scanned. | Current placement can conflict with later annotations/content. | Add a `stability: 'current' | 'known-future'` mode that reserves future-click geometry already measurably represented in the DOM. Arbitrary future Magic Move/conditional geometry cannot be guaranteed and needs diagnostics or author reservations. |
| Labels are placed one at a time; only earlier labels obstruct later ones. | No jointly chosen column/stack/lane for simultaneous labels. | Group currently visible labels by click/state, solve candidates jointly, and minimise crossings and inconsistent order. |
| Leaders are sampled cubic Béziers; obstacles are chiefly text/media and only a small set of exits is tried. | Unnecessary crossings and odd exits; cannot express the deliberate multi-turn/parallel routes drawn in review. | Use obstacle-aware polyline/visibility routing first, then round/roughen it; allocate lanes for a group. |

## 5. Determinism is a non-negotiable requirement

The current implementation has stable RoughJS seeds, but that only stabilises the *appearance of a path after its geometry is chosen*. It does **not** make placement deterministic. Placement is measured and written independently by each component from `ResizeObserver`, animation-frame tracking, mutations, image/font completion, click changes, and mount timing.

With one label this generally converges. With multiple labels it is path-dependent:

- each annotation reads other `.annotation-label.is-placed` boxes from the live DOM;
- it only avoids labels deemed earlier by click/DOM order, while each component can measure before or after another component has updated its own box;
- `fitLabel()` temporarily changes `max-width` to measure candidates, then later commits a width/position; other measurements can observe a previous or newly committed layout depending on frame ordering;
- geometry is intentionally refreshed while transitions, fonts, images, and Magic Move mutate the rendered layout; a measurement can therefore be taken from different intermediate states;
- cache lifetime is one animation frame and the first annotation that scans the slide establishes the shared scan for that frame. This is efficient, but it is a timing mechanism, not a coordinated placement transaction.

Thus the effective input is not just slide DOM + props; it is also the order/timing of observer callbacks. This can produce different candidate availability, label wrapping, and consequently different leaders for the same settled slide. A solver which moves labels after they have appeared is especially problematic in a presentation: it makes review screenshots irreproducible and can make a label visibly jump.

### Deterministic redesign constraints

1. **Separate measurement from commit.** In one scheduler pass, snapshot all geometry needed for a slide state before any label position/width is written. Compute from immutable local data; commit every chosen label and route together in one animation frame.
2. **Solve at slide/group scope, not per component.** A registry keyed by slide and stable annotation ID should collect active annotations, then produce one layout result. Component mount order and observer callback order must not be tie-breakers.
3. **Use stable identities and stable tie-breakers.** Add/use an explicit annotation ID; otherwise derive a stable document-order ID once. Sort candidates and equal-cost solutions by fixed tuple (direction rank, region/coordinate quantisation, annotation ID), never by insertion timing.
4. **Quantise solver geometry.** Convert measured local boxes to a small fixed increment (for example 0.5 or 1 slide pixel) before candidate generation/scoring, and use an epsilon for score equality. This prevents imperceptible font/subpixel changes from flipping a tie.
5. **Commit only settled results by default.** During Magic Move, the mark may track its source, but label placement should either use the last committed layout or recompute only under an explicit tracking policy. Do not continuously re-solve because a transient frame changes a score by a pixel.
6. **Version every layout input.** The scheduler should hash/state-version slide dimensions, relevant obstacle boxes, visible click set, annotation props, and measured label sizes. Identical versions must return the same stored result; an input change schedules exactly one new transaction.
7. **Test repeatability.** Render each fixture repeatedly from cold mount, backward/forward navigation, different viewport scales, and with delayed font/image loading. Assert identical chosen side, quantised label box, route ports, and route waypoint list after settling.

Determinism should be an acceptance gate before tuning placement weights: repeated settled renders with identical inputs must yield identical geometry.

## 6. Proposed positioning model

### Inputs

Per annotation: mark box, label’s measured sizes at candidate widths, placement constraint, label/connector settings, click range, and author overrides. Per slide state: rendered obstacles, usable code-body regions, annotations visible now, and (when stability applies) next/future-state obstacles.

### Candidate generation

1. Compute free rectangles/regions from the slide bounds minus hard obstacles, with clearance applied.
2. Add anchor-relative candidates in **right, down, and up** for `auto`, plus code-body candidates when the source and available blank code body make that relationship plausible. Generate **left** only for an explicit left placement.
3. Generate centres at region centres, region edges nearest the source, and an adaptive grid. Respect label width/wrapping in each candidate; do not rely on post-hoc clamping.
4. Preserve the meaning of an explicit `placement`: it is a hard directional constraint unless the API deliberately adds an opt-in fallback mode.
5. For `auto`, do not generate left candidates. Preserve `placement="left"` as a strict author request for the valid exceptional case.

### Single-label score

Use normalised, inspectable terms—not magic directional ordering:

```text
score =
  hardOverlapPenalty
+ clearancePenalty
+ directionRelationPenalty
+ distancePenalty
+ connectorCost
+ regionWastePenalty
+ edgeCrowdingPenalty
+ futureConflictPenalty
+ preferencePrior
```

Recommended interpretations:

- **hard overlap / clearance:** reject candidates overlapping hard obstacles; use soft cost only when no feasible candidate exists;
- **direction relation:** candidate must actually be up/right/down/left of the mark and attach on the facing label edge; penalise excess cross-axis drift but allow a deliberate slight downward-right placement;
- **distance:** prefer short leaders, not merely a small scalar `gap` at any lateral offset;
- **connector cost:** length, obstacle intersections, sharp turns, crossing other leaders, and a source exit that points away from the label;
- **region waste:** reward a label that uses a large coherent empty region rather than a tiny accidental gap;
- **future conflict:** penalise a candidate becoming occupied by labels/content that will coexist later;
- **preference prior:** weakly prefer right/down patterns shown by the review; never let it override a clear geometric fit.

### Multi-label solve

For annotations visible at one state, take the top *K* feasible candidates per label and choose the minimum-cost combination. A bounded exhaustive/beam search is sufficient for the expected small group sizes. Add pairwise costs for label overlap/clearance, leader crossing, inconsistent source-to-label ordering, and unaligned labels that are clearly intended as a right-side stack.

For a shared empty region on the right, produce a column: align label left/right edges or centres, preserve source vertical order, and assign parallel leader lanes. This directly addresses the `008-05` and `059-01` feedback.

### Connector router

Route after choosing label boxes:

1. choose source and label attachment ports based on their relative positions;
2. test direct segment first;
3. if blocked, route through a sparse visibility graph / orthogonal-or-diagonal waypoint graph around inflated obstacles;
4. score route length, crossings, turns, port-direction mismatch, and intersections with other leaders;
5. round corners / convert the selected polyline to a gentle path, then draw it with RoughJS;
6. scale arrow head by leader length and cap it (the short-arrow issue is a separate visual parameter, but belongs in route rendering).

For a target element, retain the target point semantics, but route to it through the same port/obstacle system.

## 7. API and author-control recommendations

Keep `placement`, `label-x`, `label-y`, `label-width`, `clearance`, `gap`, `avoid-selector`, and `connect`. Add only controls that expose genuine author intent the solver cannot infer:

- `placement="auto"` remains default and evaluates right/down/up; explicit up/right/down/left sides stay strict.
- `placement-fallback` (opt-in) could allow an explicit side to use alternatives when impossible; do not silently violate explicit `right`/`down`.
- `stability="current" | "future"` for whether future click content reserves space. Default `future` when the annotation survives into those clicks; allow `current` for intentional transient labels.
- `layout-group` / `group` for annotations meant to compose together, and `group-layout="auto" | "stack-right" | "stack-down"` for a reliable author escape hatch.
- `connector="auto" | "none" | "direct" | "routed"`; dense same-colour cases should be able to disable connectors, as the review suggests.
- `color-group` or automatic palette cycling **only for simultaneous, independent annotations**. Do not change a label’s author-provided colour or colours that intentionally signal related items.
- A diagnostics attribute/dev overlay to display candidate score terms, selected region, obstacles, ports, and rejected candidates. This is essential for reviewing a heuristic solver.

## 8. Validation plan

### Turn this review into a regression suite

1. Retain the export unchanged as the raw human evidence.
2. Create a compact fixture manifest for every `Bad` state and representative `Good` state. Each fixture needs annotation IDs, mark boxes, label boxes/sizes, click visibility, and obstacle geometry captured from the browser.
3. Convert each valid-area stroke to a polygon (or reviewer-confirmed bounding/region polygon). A candidate passes a placement fixture when the **label centre or sufficient label area** lies in an accepted region and respects the associated annotation identity.
4. Use the desired connector strokes as qualitative route targets: compare source/end association, obstacle crossings, route length, and direction/turn class—not pixel-for-pixel freehand similarity.
5. Re-export the 24 bad states and all multi-label states after each solver change. Visual approval remains the final oracle.

### Suggested acceptance checks

- No hard obstacle overlap where an accepted free candidate exists.
- Explicit side placements retain their directional relationship after boundary handling.
- In the review’s code-heavy fixtures, labels preferentially use open right/code-body regions when those are accepted.
- Persistent labels do not need to jump on later clicks solely to avoid newly shown content.
- Same-state label groups neither overlap nor make leaders cross unless no feasible alternative exists.
- Leaders do not intersect text/media/labels except at their own source/destination; direct routes win when clear.
- Short leaders use visibly smaller arrows.

## 9. Data limitations and clarifications needed before treating this as training/evaluation data

The qualitative requirements are already strong enough to start a solver redesign. Exact geometric fitting is blocked by the following issues:

1. **No annotation identity on ink.** A state can contain several annotations, areas, and routes, but `validAreas[]` and `desiredConnectors[]` do not identify which annotation each belongs to. `059-01` and `008-05` are especially ambiguous. The redesign test fixtures need `annotationId` (or source text/occurrence) on every area and route.
2. **No captured current geometry.** The schema supports `current.connectors`, but its only two populated `current` objects contain empty connector arrays. It does not export source boxes, current label boxes, final label widths, current leader path, or annotation IDs. That makes it impossible to calculate current-versus-desired error automatically.
3. **Checkboxes and ink disagree in 22 records.** The `up/right/down/left` booleans and the sides of `validAreas` disagree (for example `theme/030-03`, `kotlin-fundamentals/059-01`, `exposed-fundamentals/008-05`). Treat the drawn areas as the stronger spatial evidence; clarify whether the checkboxes were intended as an independent summary or were simply not maintained.
4. **Verdict coverage is incomplete.** After excluding the 51 explicitly invalid states, 16 records lack a verdict. Two are materially useful despite having no verdict: `kotlin-fundamentals/060-02` and `exposed-fundamentals/008-05` have proposed areas/routes; the remainder without feedback may simply not contain a label. Please confirm whether unmarked relevant states mean “not reviewed” or “acceptable”.
5. **Area semantics are not formal.** It is unclear whether a valid circle means the label centre must be inside it, the entire label must fit in it, or it is a loose direction/region suggestion. The report assumes it means an acceptable label region/centre, but this should be confirmed.
6. **Connector direction is implicit.** The route point order probably records drawing order, but it is not guaranteed to identify source → label. Export explicit `fromAnnotationId`, `to: 'label' | targetId`, start/end ports, and whether the route is a desired path or merely a route corridor.
7. **Snapshot/render mismatch.** `exposed-fundamentals/008-09` notes that the exported image did not render correctly and judgment came from the dev server. Mark it as a manual-only fixture or re-export it before using it as a pixel/geometry regression.

### Post-review clarifications (2026-08-27, confirmed with the reviewer)

- Notes naming a technology refer to the **annotation related to it**, not to window chrome: "jdbc is rendered on the code window border" (`exposed-fundamentals/022-01`) means the JDBC-related label straddles the 1px window border. This is evidence for a code-window-border obstacle rule, now locked in the rewrite plan.
- The per-record `validPlacementArea`/`label`/`connector` booleans are per-aspect "this is OK" verdicts. Their disagreements with the overall verdict are usable evidence — notably three `Good` states with `connector: false` (`kotlin-fundamentals/048-03`, `053-01`, `exposed-fundamentals/008-02`) and `exposed-fundamentals/039-03` (`Good`, `label` and `validPlacementArea` false, "not sure why so far away").
- The single `left` valid area comes from a slide that deliberately centres content and places the annotation to its left — an extreme edge case that motivates strict explicit `left` and nothing more.
- The item-3 disagreement count (22) is definition-dependent; a plain side-checkbox-versus-ink comparison yields 16. Regenerate such counts by script when building fixtures.
- Of the §7 recommendations, the plan adopted `stability`, `layout-group`/`group-layout`, and diagnostics; palette cycling became the locked coexisting-rotation decision; multi-source annotations (one label over several marked elements, one solver-chosen connector) were added; `placement-fallback` and a `connector` mode prop were rejected — `connect` already disables, and strict sides stay strict.

The three ambiguous states are resolved by the reviewer as follows:

- **`exposed-fundamentals/008-05`** (previously no verdict): the drawn right area belongs to the `CASCADE, SET_NULL, …` annotation. Its current label rendered too low on the slide and straddling the code-window border — a second instance of the border-straddling defect from `022-01`. It should sit entirely inside the code window, close to the annotated code. The state's other label was fine.
- **`kotlin-fundamentals/060-02`** (previously no verdict): the two right-side areas, circled one below the other inside the code window, map to two sequential annotated lines — the top area to the first line, the bottom area to the second. The first label was placed fine but its connector was bad; the second label was drawn too far up, landing close to the first line and confusing the association, and should move down. Direct evidence for the source-to-label ordering and association costs.
- **`kotlin-fundamentals/059-01`** (`Bad`): two annotated elements/groups are visible at once, each with its own areas — not one shared right column. The top annotation is boxed in by surrounding code: it must go below everything (down is the best position) or tuck into the right-bottom. The second annotated element (`name`) should be placed up/right close to itself, in the open code-window space beside it.

## 10. Recommended re-export schema

A small schema upgrade would make the next review directly actionable:

```json
{
  "state": { "slide": "…", "click": 3, "width": 1440, "height": 810 },
  "annotations": [{
    "id": "slide-8:ReferenceOption:2",
    "sourceBox": [x, y, width, height],
    "currentLabelBox": [x, y, width, height],
    "currentPlacement": "down",
    "currentConnector": [[x, y], "…"],
    "visibleUntil": 5
  }],
  "feedback": [{
    "annotationId": "slide-8:ReferenceOption:2",
    "verdict": "Bad",
    "acceptedRegions": [{ "side": "right", "polygon": [[x, y], "…"] }],
    "desiredConnector": { "from": "source", "to": "label", "points": [[x, y], "…"] },
    "notes": "…"
  }]
}
```

Keep the existing freehand polygons—they are valuable. The crucial additions are annotation identity, captured current layout, click lifetime, and unambiguous region/route semantics.

## 11. Implementation priority

1. **Build the deterministic slide-level transaction:** immutable measurement snapshot, stable annotation identities, fixed tie-breakers, and atomic commit. Add repeatability tests first.
2. **Fix candidate generation and scoring:** right/down/up auto candidates plus strict explicit left; bound-aware placement; score actual relationship and free-space region quality.
3. **Add bounded future-click stability:** reserve measurable coexisting DOM and explicit author-reserved regions; diagnose future states whose geometry is unavailable rather than guessing.
4. **Jointly solve same-state labels:** right-side column/stack and no-crossing leader constraints.
5. **Replace Bézier-only routing with obstacle-aware routing:** ports, waypoints, route score, then aesthetic smoothing.
6. **Add diagnostics and fixture capture:** only then tune weights against the reviewed states.
7. **Add palette/group behaviour and arrow scaling:** valuable polish, but not a substitute for geometric correctness.
