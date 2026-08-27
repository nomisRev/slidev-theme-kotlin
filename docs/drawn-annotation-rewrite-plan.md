# DrawnAnnotation positioning and routing rewrite plan

**Status:** architecture and product decisions agreed; implementation has not started.  
**Evidence:** `docs/drawn-annotation-positioning-review.md`, `review/drawn-annotation-review.json`, and `review/manifest.json`.  
**Scope:** replace positioning, obstacle measurement, slide-level coordination, and connector routing. Preserve the existing source-marking, Slidev click, animation, Magic Move, target, RoughJS, and accessibility behaviour.  
**Primary review gates:** annotation-specific geometry regression tests, curated visual review across all three decks, then manual browser/iPad review.

## 1. Locked decisions

| Topic | Decision |
| --- | --- |
| Automatic directions | `auto` evaluates `right`, `down`, and `up` together. It never generates `left`, reducing policy ambiguity and candidate count. |
| Explicit left placement | `placement="left"` remains supported as a strict author request. |
| Infeasible automatic or explicit placement | Keep the label visible in the deterministic least-bad position and emit a structured development warning. Never silently hide it. |
| Explicit placement | `up`, `right`, `down`, and `left` are directional contracts and may not silently fall back to another side. |
| Manual coordinates | They are hard author overrides. If one axis is omitted, use the source centre on that axis. Do not relocate the result; warn when it overlaps hard content or leaves the safe area. Freeze the resolved box when revealed, like an automatic label. |
| Label motion | Once revealed, a label does not move until it disappears. A moving source can update its mark and the source-facing portion of its leader only. |
| Full slides | Keep the annotation visible at the deterministic least-bad result and warn. The author then chooses a manual location, shorter label, reserved region, different reveal, or another presentation solution. |
| Code windows | The code-window background is usable label and route space. Rendered code/text remains an obstacle. The theme no longer has code title/tab chrome, so no special title-strip model is required. Custom consumer chrome can be reserved with `avoid-selector`/`reserve-selector`. |
| Future content | Guarantee only current geometry and future geometry that is already measurably represented in the DOM. Do not claim knowledge of arbitrary future Magic Move or conditionally rendered states. Unknown future geometry is handled by diagnostics and author reservations. |
| Grouping | Colour never creates a layout group. Every annotation has an identity; an explicit group key and group layout express intentional composition. |
| Stable identity | Add optional `id`. Without it, derive a deterministic ID from authored source information and stable slide-local annotation marker order—not measured coordinates, mount time, or observer order. |
| Compatibility | Positioning and routing are rewritten. Existing source lookup, marks, timing props, nested sequencing, click insertion, transitions, Magic Move, targets, RoughJS options, and accessibility remain supported. |
| Reviewed regions | Freehand regions mean an approximate preferred area, not an exact polygon or learned geometry target. |
| Readiness | Pre-measure on preloaded slides and during existing transitions/drawing stages. Never blank or delay the slide itself. If geometry is still incomplete at the label reveal deadline, use the best available snapshot, freeze it, and diagnose the incomplete inputs. |

## 2. Goals and non-goals

### Goals

1. Deterministic geometry for identical settled inputs.
2. Better use of coherent right-side and code-body whitespace.
3. Strict and testable explicit-side semantics.
4. Atomic coordination of labels revealed together.
5. Stable progressive layouts in which an already visible label never jumps.
6. Clear source-to-label association and obstacle-aware connectors.
7. Inspectable decisions: every selected candidate, fallback, and route has serialisable diagnostics.
8. A maintainable pure engine that can be tested without Slidev or a browser.

### Non-goals

- Inferring arbitrary future Vue or Magic Move states that are not in the DOM.
- Finding a mathematically optimal layout for unbounded annotation counts.
- Automatically reproducing freehand reviewer strokes pixel for pixel.
- Rewriting click registration, source text matching, mark animation, or accessibility.
- Eliminating the need for author direction on exceptionally dense slides.

## 3. Architectural boundary

The replacement has four layers:

```text
DOM / Slidev adapter
  existing click/source/animation behaviour + settled geometry measurement
        ↓
slide layout coordinator
  registry, shared slide-local layer, readiness, frozen state, transactions
        ↓
pure layout engine
  candidates, feasibility, score, combination solve, logical routes
        ↓
renderer
  consumes committed boxes/routes; applies animation and RoughJS appearance
```

Suggested files:

```text
components/drawn-annotation/
  types.ts              public/internal geometry and layout types
  geometry.ts           boxes, ports, segments, intersections, quantisation
  candidate.ts          deterministic width and position candidates
  score.ts              feasibility classes and inspectable score terms
  solve.ts              single/newly-revealed group solver
  route.ts              deterministic logical route selection
  coordinator.ts        slide registry, snapshots, freezing, atomic publication
  measure.ts            browser obstacle and hidden-label measurement adapter
  diagnostics.ts        serialisable warnings and debug records
components/DrawnAnnotation.vue
  retained Slidev lifecycle/source logic and thin integration with the modules
```

The pure engine must not access the DOM, Vue state, animation frames, `Date`, `performance`, `Math.random`, or registration order. It receives immutable, quantised input and returns immutable output.

### Shared slide-local rendering layer

Each slide coordinator owns one slide-local annotation layer and one hidden measurement host. Labels and leaders are portalled/teleported into this layer even when the component wrapping the source is nested in a positioned, transformed, or clipped component. Solver coordinates and CSS rendering coordinates therefore have the same origin.

The source slot remains where it was authored. Existing mark animation can either render through the shared layer or retain its component ownership, but all mark boxes and route endpoints handed to the solver are slide-local. The integration spike must prove nested-component and non-uniform presentation-scale cases before the architecture is considered complete.

## 4. Public positioning contract

```ts
type Placement = 'auto' | 'up' | 'right' | 'down' | 'left'
type GroupLayout = 'auto' | 'stack-right' | 'stack-down'
type Stability = 'current' | 'known-future'

interface PositioningProps {
  id?: string
  placement?: Placement
  labelX?: number
  labelY?: number
  labelWidth?: number
  gap?: number
  clearance?: number
  avoidSelector?: string
  reserveSelector?: string
  stability?: Stability
  layoutGroup?: string
  groupLayout?: GroupLayout
}
```

- `auto` generates only `right`, `down`, and `up` candidates.
- Explicit placements generate only candidates for the requested direction, including explicit `left`.
- `labelX` and `labelY` are percentages of the slide. Supplying either enters manual mode. A missing axis resolves once from the source centre.
- `labelWidth` remains a maximum, not a forced width.
- `avoidSelector` adds current-state hard placement obstacles.
- `reserveSelector` intentionally reserves matched measurable geometry across the annotation lifetime, including hidden elements when they have a meaningful laid-out box.
- `stability="known-future"` is the default for persistent labels and considers measurable future DOM. `current` opts out when the author wants only the reveal state considered.
- `layoutGroup` declares annotations that should compose as a set. It is never inferred.
- `groupLayout` provides the reliable escape hatch for an ordered right-side or downward stack. Non-`auto` group layout requires `layoutGroup` and emits a development warning otherwise.

All existing non-positioning props remain in the component contract. Before implementation, add a characterization checklist covering `text`, `selector`, `occurrence`, `multiline`, source/target mark types, target coordinates, `connect`, `arrow`, `curve`, `at`, `labelAt`, `until`, `on`, `insert`, `sequential`, `wait`, `track`, RoughJS options, and screen-reader announcements.

## 5. Identity and registration

`id` identifies exactly one annotation. Duplicate explicit IDs on a slide are an authoring error; IDs are never grouping keys.

Fallback IDs use this stable tuple:

```text
slide identity
+ source descriptor (`selector`, or `text` + occurrence)
+ label/target descriptor
+ click contract
+ stable annotation-marker ordinal in authored slide DOM order
```

Measured source coordinates are not part of identity because they can change across clicks, fonts, responsive layout, and Magic Move. A module counter, Vue instance UID, mount time, and observer order are also forbidden.

Explicit IDs are required for curated review fixtures and strongly recommended for layout groups and otherwise duplicate annotations. The resolved ID participates in deterministic tie-breaking and the default RoughJS seed; an explicit RoughJS seed still wins.

The coordinator registry is keyed by the actual slide root, not a global current-slide number, because Slidev can preload slides and print/export multiple slide instances.

## 6. Geometry and obstacle model

All engine geometry is in slide-local coordinates and quantised before solving. Start with 1 slide pixel and change only if repeatability or visual fixtures justify it.

A `Box` is `{ left, top, right, bottom }`; width, height, and centre are derived. DOM rectangles are converted relative to the slide root. Axis-aligned bounding boxes are acceptable for transformed content in the first implementation; unusual rotated content can opt into a reserved box.

### Obstacle classes

| Class | Label placement | Logical routing |
| --- | --- | --- |
| Rendered visible text fragments | hard | hard, inflated for stroke wobble |
| Code text | hard | hard |
| Images, videos, canvases, SVG illustrations | hard | hard |
| Cards, tables, block quotes | hard whole box by default | text/media hard; outer box configurable/soft unless explicitly reserved |
| Empty code-window body/background | permitted | permitted |
| Current/frozen labels | hard | hard |
| Other annotation marks and owned destinations | excluded/owned as appropriate | hard except at owned ports |
| `avoidSelector` boxes | hard in current state | hard |
| `reserveSelector` boxes | hard over measurable lifetime | hard |
| Known future coexisting content | hard when `known-future` | hard |
| Unknown future content | not guessed; diagnostic | not guessed; diagnostic |

The collector must determine semantic visibility rather than trusting non-zero DOM bounds alone. It excludes annotation-owned DOM, outgoing Magic Move snapshots, and non-displayed content. Hidden future `v-click` content may be collected only when the browser has already laid it out and its click interval is known.

Do not retain the current silent 600-element cap. Settled snapshots use a targeted text-node/media/block collector. If a safety limit is ultimately needed, truncation must be deterministic and surfaced as an infeasible/incomplete diagnostic.

## 7. Label measurement and readiness

The coordinator owns a hidden, laid-out measurement host under the slide root. It uses the same annotation classes, inherited CSS variables, typography, `text-wrap: balance`, and writing environment as the visible label. It is hidden with visibility/containment techniques, never `display: none`, and visible labels are never mutated to obtain measurements.

For each deterministic width cap, measurement returns the actual rendered width and height. Candidate caps include:

1. natural width;
2. explicit author maximum, when smaller;
3. a fixed, deduplicated descending set bounded by the slide safe width;
4. a documented readable minimum, adjusted for an unbreakable token.

The exact cap sequence is a tested policy constant, not a frame-dependent loop.

### Readiness without blank slides

Measurement work begins as soon as a preloaded slide has meaningful dimensions. It continues during page transition, Magic Move settling, source-mark drawing, and leader drawing—the time in which the label would not yet be visible anyway.

The coordinator never blocks slide navigation or hides slide content. The label freezes at its existing scheduled reveal deadline using the newest complete snapshot. If fonts/images are still pending, it uses the best available geometry and records `incomplete-fonts`, `incomplete-images`, or `unmeasurable-preload`. Late assets do not move an already visible label.

Direct navigation to a slide with an immediate label gets a normal next-frame measurement but no artificial blank-slide wait. Export mode waits through the existing Slidev export readiness path and has a dedicated integration test.

## 8. Deterministic transaction and online lifecycle

A transaction for one settled semantic state is:

```text
1. collect registrations for one concrete slide root
2. resolve stable IDs and visibility intervals
3. classify labels as ending, frozen, or newly revealing
4. snapshot current and measurable-known-future geometry before writes
5. measure candidate label sizes in the hidden host
6. quantise and build immutable solver input
7. solve newly revealing labels and all affected logical routes
8. publish one versioned immutable LayoutResult
9. commit every new label/route from that publication in the same render frame
```

Already revealed labels are immutable hard obstacles. Labels disappearing in this state are removed before solving newcomers. Labels revealed together are solved jointly. This is deliberately an online solver: it does not pretend it can rearrange frozen labels when a later click arrives.

For an explicit group whose later members are known before the first reveal, the coordinator may reserve deterministic stack slots. When future group source geometry is unknown, it can still reserve author-requested stack slots, but connector quality is evaluated only when each source exists. Diagnostics state when a group was planned with incomplete future sources.

### Movement and transitions

- Keep the last committed label box throughout transitions.
- Update source marks with their existing tracking behaviour.
- Keep the selected route topology, destination port, and intermediate lane points stable while the source moves.
- Update only the source endpoint and its first source-facing segment/control point during transient movement.
- Recompute a label position only after its previous visibility interval ended and a new semantic instance is revealed.

Every transaction has an input version derived from slide dimensions, quantised obstacles, annotation contracts, visibility state, measured label dimensions, and frozen results. Identical versions must return byte-equivalent canonical geometry JSON.

## 9. Candidate generation

Generate a bounded deterministic set per allowed direction:

- source-facing positions at fixed gaps;
- modest fixed cross-axis offsets;
- safe-edge positions;
- region/lane positions derived from large coherent free areas;
- explicit right-side and open code-body lane candidates;
- group stack slots;
- every measured width candidate.

Candidates are generated inside bounds rather than generated and then clamped. Clamping must never turn a nominal `right` candidate into a box that is spatially `up`.

Strict side relation is box-based. For example, a fully feasible right candidate satisfies:

```text
label.left >= source.right + requestedGap
```

When an explicit side is infeasible, fallback candidates first reduce the effective gap toward zero while preserving the requested side family. No candidate from another direction is generated. If even non-overlapping separation is impossible inside the safe area, keep the box visible, maximise its relationship to the requested side, and diagnose the separation deficit; `resolvedPlacement` remains the explicit request rather than pretending that an alternate side was chosen.

## 10. Feasibility and scoring

Do not encode hard policy entirely as one weighted sum. Compare candidates/combinations lexicographically:

```text
1. feasible versus infeasible
2. safe-area violation
3. explicit-side separation deficit
4. label-label overlap
5. hard-content overlap
6. clearance deficit
7. route hard intersections
8. aesthetic score
9. stable tie-break tuple
```

A feasible candidate always beats an infeasible candidate. When none is feasible, the same ordered violation vector chooses the deterministic least-bad result.

The inspectable aesthetic score contains normalised terms:

```text
connector length/turn cost
+ source-label distance
+ cross-axis drift
+ edge crowding
+ local free-space penalty
+ known-future coexistence penalty
+ weak direction prior
+ group alignment/order penalty
```

`right` and `down` may have weak auto priors; geometry and connector clarity must win. `left` has no auto prior because it is not generated automatically.

Ties within a documented epsilon use a fixed tuple, for example:

```text
direction rank (right, down, up; explicit left only when requested)
→ width rank
→ quantised top/left
→ resolved annotation ID
→ route rank
```

Score diagnostics retain every term, feasibility class, and rejection reason.

### Deterministic complexity limits

Retain the top `K` candidates per newly revealing label, then use bounded exhaustive search for small sets and deterministic beam search above that threshold. Constants and degradation behaviour are tested and included in diagnostics. Solver output may become less optimal under a limit but never timing-dependent.

Set performance budgets using representative snapshots rather than silently dropping obstacles. Initial target: a typical transaction with up to 6 new labels and 300 obstacles should finish comfortably within one presentation frame on a development laptop; exact budgets are fixed after the Phase 1 spike.

## 11. Multi-label and group composition

Every label revealed in the same state is solved together, whether grouped or not. Pairwise costs cover:

- overlap and clearance;
- route intersections;
- source-to-label ordering inversions;
- competition with frozen labels;
- ambiguous association;
- inconsistent alignment in an explicit group.

`layoutGroup` strengthens composition but does not isolate the group from other labels.

For `stack-right`:

- preserve authored/source vertical order when source geometry is known;
- align a common label edge or centre according to a fixed policy;
- reserve adequate vertical spacing;
- use deterministic parallel route lanes;
- keep frozen slots fixed as later members appear.

`stack-down` applies the analogous horizontal ordering. `groupLayout="auto"` permits alignment preferences without forcing one stack orientation.

## 12. Connector routing

All connectors—including target-only connectors with no label—register with the slide coordinator. Logical routes are solved against final label boxes, media/text obstacles, marks, and other routes revealed together.

### First route family

1. choose facing source and destination ports;
2. test a direct segment/gentle direct curve;
3. test fixed alternative ports when they materially reduce intersections;
4. score exact logical intersections, route length, wrong-way exits, and foreign-route crossings;
5. cap arrow size by the available final segment length.

### Constrained advanced family

Add only when reviewed fixtures require it:

- direct;
- one-bend horizontal-first;
- one-bend vertical-first;
- two-bend group lane.

Use exact segment/box intersection tests for logical routes. After selecting a polyline, round corners with a bounded radius inside its free corridor. Validate the rounded centreline again. Inflate route obstacles for stroke width and expected RoughJS wobble so aesthetic conversion does not reintroduce text crossings.

The existing `curve` prop remains meaningful for direct routes and bounded visual smoothing; it must not alter the selected logical topology or violate its corridor. Deterministic tests assert logical points and ports, not RoughJS-generated path strings.

## 13. Diagnostics and failure policy

Expose a development-only serialisable record per annotation while keeping the canonical result available to tests:

```ts
{
  version,
  annotationId,
  requestedPlacement,
  resolvedPlacement,
  labelBox,
  widthCap,
  frozen,
  feasible,
  readiness,
  futureKnowledge,
  violations,
  candidates: [{ box, side, widthCap, feasibility, scoreTerms, rejectedReason }],
  route: { kind, ports, points, scoreTerms, violations },
}
```

Warnings are deduplicated by annotation ID plus layout-input version, not animation frame. Messages recommend the relevant remedy: explicit side, manual coordinates, shorter label, group layout, `reserve-selector`, changed reveal, or disabled connector.

A debug overlay/console command can display obstacles, candidate boxes, selected ports, route corridors, frozen boxes, and score terms. This is required before heuristic weight tuning.

## 14. Evidence and fixture contract

The raw review export is stored unchanged at `review/drawn-annotation-review.json`. `review/manifest.json` retains the reviewed source annotations and slide states. Record the source deck commit next to every regenerated fixture set; the original review was based on the local theme plus Kotlin Fundamentals and Exposed Fundamentals decks.

Before the review data becomes an automated oracle:

1. add explicit IDs to curated source annotations;
2. attach each accepted region and desired route to an annotation ID;
3. re-export the known mismatched `exposed-fundamentals/008-09` state;
4. resolve materially useful no-verdict states;
5. record whether each fixture checks placement, route, both, or only manual visual quality;
6. translate approximate freehand regions into fixture-specific tolerances rather than treating their path pixels as exact boundaries.

For approximate regions, automated checks may use expected side plus tolerant box/region overlap or distance-to-region. The exact tolerance is stored per fixture. Label-centre inclusion alone is insufficient for a large label, while full polygon containment is too strict for loose freehand ink.

## 15. Test and review strategy

### Pure unit and property tests (Vitest)

- box, port, segment, corridor, and quantisation maths;
- exact overlap/clearance/intersection behaviour;
- auto generates right/down/up and never left;
- explicit left remains strict;
- bound-aware side relation;
- lexicographic feasibility and deterministic fallback;
- manual one-axis/two-axis contracts and diagnostics;
- width candidate generation and unbreakable labels;
- stable IDs/ties independent of registration order;
- frozen online lifecycle inputs;
- stack ordering and lane constraints;
- route topology, smoothing corridor, crossings, and arrow caps;
- randomised property tests for bounds, no-overlap invariants, and stable reorderings.

### Browser integration tests (Playwright)

- shared slide-local layer works from nested positioned/transformed components;
- visible labels are never mutated for measurement;
- one coordinator publication atomically updates labels revealed together;
- stable marker order, not mount callback order, resolves IDs;
- repeated cold mount and forward/back navigation return identical canonical geometry;
- preloading and transition-time measurement do not blank or delay slide content;
- delayed fonts/images use pre-render time and never move a visible label;
- direct-entry fallback produces diagnostics without hanging;
- visible labels remain fixed through later clicks and Magic Move;
- known hidden `v-click` geometry is reserved when requested;
- unknown future Magic Move geometry is reported rather than guessed;
- print/export mode produces settled annotations;
- target-only connectors participate in route coordination;
- live-region announcements and existing click sequencing remain unchanged.

### Annotation regression runner

Create a manifest-driven runner separate from the broad `scripts/visual-review.mjs`. It must:

- render exact deck/slide/zero-based-click fixtures;
- support theme, Kotlin Fundamentals, and Exposed Fundamentals;
- capture canonical geometry diagnostics alongside PNGs;
- repeat determinism fixtures several times;
- apply semantic constraints and approximate-region checks;
- generate current image, approved image, overlay, and diagnostics for manual review;
- work against repository-owned compact fixtures in CI;
- optionally run the full external decks at recorded Git commits.

The existing visual-review script remains useful for browsing all changed screenshots, but comparison with the old implementation is not an acceptance test. After manual approval, create a new rewrite baseline.

### Visual review set

Mandatory:

- all 24 originally bad states;
- all multi-label states;
- persistent/future-click states;
- Magic Move states;
- target-only connector states;
- code-body whitespace cases;
- strict directional examples including explicit left;
- nested-component and manual-position examples;
- a representative good-state regression set from every deck.

Final approval remains manual. iPad/Safari review checks label jumps, clipping, route association, code-window readability, font-metric differences, transition timing, and click-navigation performance.

## 16. Delivery phases and gates

### Phase 0 — contract, evidence, and characterization

1. Keep the raw evidence in the repository.
2. Reconcile component README, examples, defaults, and this contract.
3. Build the retained non-positioning behaviour matrix and characterization tests.
4. Add IDs and annotation mappings to the curated review manifest.
5. Include Exposed Fundamentals in the review tooling.
6. Define approximate-region tolerances and canonical geometry schema.

**Gate:** one non-contradictory public contract and an annotation-specific fixture manifest approved by the reviewer.

### Phase 1 — architecture spike

Prove seven end-to-end vertical slices:

1. automatic right/code-body placement;
2. strict down fallback near a boundary;
3. same-state right stack;
4. frozen label plus later label;
5. unknown future Magic Move geometry;
6. nested positioned component with shared slide-local rendering;
7. export/print capture.

**Gate:** coordinate ownership, readiness, freezing, and transaction lifecycle are demonstrated before broad implementation.

### Phase 2 — pure engine

Implement geometry, width candidates, strict side semantics, feasibility ordering, deterministic scoring, direct logical routes, and diagnostics.

**Gate:** comprehensive unit/property tests pass, including reordered inputs and infeasible fallbacks.

### Phase 3 — coordinator and single-label integration

Implement registry, IDs, hidden host, readiness, immutable snapshots, shared rendering layer, atomic publication, manual positions, and frozen state. Keep group search disabled initially.

**Gate:** repeatable geometry across cold mounts, navigation, scale, delayed assets, nested components, settled transitions, and export.

### Phase 4 — single-label visual tuning

Tune bounded all-direction auto placement and direct connectors against reviewed single-label fixtures.

**Gate:** curated single-label semantic checks pass and manual review accepts the bad-case corrections without unacceptable good-case regressions.

### Phase 5 — online multi-label and groups

Add joint solving of newly revealed labels, frozen-obstacle handling, explicit groups, stacks, and route lanes.

**Gate:** multi-label fixtures are deterministic, non-jumping, ordered, and visually accepted.

### Phase 6 — known-future reservations

Add measurable hidden-future collection, `stability`, reserved selectors, and incomplete-future diagnostics. Do not build an off-screen cloned Slidev runtime unless new evidence proves the bounded approach insufficient.

**Gate:** persistent-label fixtures behave correctly for supported future geometry and fail honestly for unsupported future geometry.

### Phase 7 — constrained route improvements and polish

Add bend/lane routes only for remaining connector failures, then finalise smoothing and arrow scaling.

**Gate:** connector review accepts association, crossings, exit points, route stability, and short-arrow behaviour on desktop and iPad.
