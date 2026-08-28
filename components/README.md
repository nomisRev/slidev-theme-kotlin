# `DrawnAnnotation`

One generic, hand-drawn annotation. It marks something on the slide — an
element, or an exact piece of text inside a code block — and, if you want,
connects that mark to another element or to a text label.

````html
<DrawnAnnotation type="circle" text="fun main" label="every program starts here" :at="1">

```kotlin
fun main() {
    println("My first Kotlin program!")
}
```

</DrawnAnnotation>
````

Everything is measured in the slide's own coordinate system, so annotations
keep their proportions in the presenter view, in exports, and at any window
size. Nothing is ever drawn on a guess: an annotation that cannot find what it
should mark stays off the slide and [says why on the console](#when-nothing-appears).

## What to mark

| prop | default | meaning |
| --- | --- | --- |
| `type` | `underline` | short form of `source-type`; kept for existing annotations |
| `source-type` | `type` | source shape: `underline`, `circle`, `box`, `strike-through`, or `none` |
| `selector` | `[data-annotate]` | element inside the slot to mark |
| `text` | – | exact text inside the slot to mark instead of an element |
| `occurrence` | `1` | which occurrence of `text`, 1-based |
| `multiline` | – | mark every visual line of the match; on by default for `underline` and `strike-through` |
| `padding` | `4` | space between the marked box and the stroke, in slide pixels |

`text` is the way to reach a token inside a code block, where there is no
element to point a selector at. It works in plain Shiki blocks and in
`magic-move` blocks alike, and the mark follows the token while Magic Move
animates it. When the text is not part of the current Magic Move step, the
annotation stays hidden.

## What to point at

| prop | default | meaning |
| --- | --- | --- |
| `label` | – | text to write next to the mark |
| `target` | – | selector of another element to connect the mark to |
| `target-x`, `target-y` | `50`, `50` | point inside the target, as a percentage of its box |
| `target-radius` | `3` | size of the mark at that point, as a percentage of the target's width |
| `target-type` | `circle` | target shape, independently set to `underline`, `circle`, `box`, `strike-through`, or `none` |
| `target-mark` | `true` | show the default target circle when `target-type` is omitted |
| `connect` | `true` | draw the leader line between the mark and its destination |
| `arrow` | `false` | arrow head at the end of the leader line |
| `curve` | `0.12` | curvature of the leader line, as a fraction of its length |

Percentages keep annotations on screenshots independent of the rendered size.
Giving both a `target` and a `label` connects the mark to the target and writes
the label next to it.

## Where the label goes

A label is placed out of the slide's normal flow. Its automatic fallback is
intentionally small and deterministic: `auto` chooses below a mark in the
upper half of the slide and above one in the lower half; an explicit
`placement` chooses that side. The result is constrained to the slide margin
and wraps only when its natural width cannot fit. It does **not** scan the
slide, future click states, or other annotations for obstacles. This prevents
unrelated content and click changes from moving an already composed label.

Use `label-x`, `label-y`, and `label-width` for a fixed authored position, or
the development visual editor for the same geometry persisted as normalized
CSS. A saved editor value wins over the matching Markdown prop. The legacy
`clearance` and `avoid-selector` props are accepted for compatibility but no
longer affect placement.

| prop | default | meaning |
| --- | --- | --- |
| `placement` | `auto` | fallback side: `up`, `down`, `left`, `right`, or automatic vertical choice |
| `label-x`, `label-y` | – | label centre as a percentage of the concrete slide; disables automatic placement for that axis |
| `label-width` | – | maximum width in slide pixels before wrapping |
| `gap` | `28` | distance between the mark and automatically placed label, in slide pixels |
| `clearance` | `16` | deprecated; has no effect |
| `avoid-selector` | – | deprecated; has no effect |

## When it is drawn

| prop | default | meaning |
| --- | --- | --- |
| `at` | next click | click that draws the mark and its leader line; takes part in Slidev's click ordering like `v-click` |
| `label-at` | `at` | click that writes the label |
| `until` | – | click that takes the annotation away again; exclusive, like the end of a `v-click` range |
| `on` | – | `at` and `until` in one, for an annotation that belongs to a single click |
| `sequential` | `true` | nested annotations sharing a click draw one after the other |
| `insert` | `false` | give the annotation [a click of its own](#inside-a-magic-move-block) inside a Magic Move block |
| `wait` | `true` | hold the drawing back until the annotated element has stopped moving |
| `track` | `true` | keep the annotation glued to elements that move |

### Source, line, target, then label

A connector is drawn in three distinct stages: the source mark finishes first,
then the leader line reaches its destination, then the target mark is drawn.
The source and target shapes can be selected independently with `source-type`
and `target-type`. A same-click label waits for those strokes; `label-at` can
give the label a later click instead, in which case it starts writing as soon
as that click is reached.

```html
<DrawnAnnotation
  source-type="circle"
  selector="[data-a]"
  target="[data-b]"
  target-type="none"
  arrow
  :at="1"
  label="B follows from A"
  :label-at="2"
>
  <div class="card">Element <b data-a>A</b> is annotated first</div>
  <div class="card">And the line is drawn to element <b data-b>B</b></div>
</DrawnAnnotation>
```

Click 1 circles **A** and draws the line to **B**, click 2 writes the label, and
`target-type="none"` leaves **B** itself unannotated.

### Two marks on one click

Two annotations nested on the *same* click are drawn one after the other: the
inner one starts once the one around it has finished, so "point at it, then
circle it" is a single reveal rather than two clicks. Set `:sequential="false"`
on the inner one to have both drawn at the same time.

### Taking it away again

`until` takes the whole annotation away again, so it only belongs to the steps
it describes. It is exclusive, like the end of a `v-click` range: `:at="1"
:until="2"` keeps the annotation on screen for click 1 alone. This matters
inside a Magic Move block whose later steps no longer contain the annotated
text — the mark is drawn on the step that has it, and is gone before the step
that does not.

```html
<DrawnAnnotation type="underline" text="val greeting" label="read-only" :at="1" :until="2">
```

Almost every annotation belongs to its own click alone, so `on` says that in
one prop: `:on="1"` is `:at="1" :until="2"`.

```html
<DrawnAnnotation type="underline" text="val greeting" label="read-only" :on="1">
```

Click `0` is the slide's initial state, before the first click, so `:on="0"`
shows an annotation immediately and removes it on click 1.

The end counts from the label's click when `label-at` puts the label after the
mark, so a label is never taken away before it has been read. Give `at` and
`until` separately whenever the annotation should stay on screen for more than
one click; `on` next to an explicit `at` or `until` wins, and is reported as a
mistake.

## Inside a Magic Move block

By default an annotation shares its click with whatever else that click does,
so on a Magic Move block it is drawn on the very step that morphs into place.
`insert` gives it a step of its own instead: the block keeps its own clicks,
but every step from `at` onwards is pushed one click later, so the annotation
gets a click where the code stands still.

```html
<DrawnAnnotation type="underline" text="val greeting" label="read-only" insert :on="2">
```

With three code steps that reads: click 1 morphs to the second step, click 2
underlines `val greeting` on it, click 3 takes the annotation away and morphs
to the third step.

Annotations keep counting in the slide's own clicks — the number in the URL —
even inside such a block, so a second annotation nested in it annotates the
third step with `:at="3"`. In return, an annotation inside an `insert` block
has to be given plain numbers: `+1` and the rest of Slidev's automatic ordering
are not available there.

`wait` (on by default) holds the drawing back until the annotated element has
stopped moving, so a mark is never drawn across a Magic Move step or a slide
transition that is still travelling. It waits on the actual finite animations
running in the slot rather than guessing their duration; this also catches
Magic Move fading new tokens in where they already belong. It only delays the
entrance: an annotation that is already on screen stays on screen through the
next step. Set `:wait="false"` to draw as soon as the click arrives.

## Visual-editor geometry

`id` is an optional stable, deck-wide identity for a `DrawnAnnotation`. It is
required by the development-only visual editor for annotations with a label or
connector, but annotations without one (including source-only marks) continue
to render normally. Use CSS-safe IDs matching
`[A-Za-z][A-Za-z0-9_.-]*`:

```html
<DrawnAnnotation id="nullable-return-label" text="String?" label="nullable return type" :on="2">
```

The renderer already accepts generated geometry on that element. A matching CSS
rule can override individual label properties; unitless values are fractions of
the concrete `.slidev-layout` root, so they survive presentation scaling and a
nested annotation canvas. Generated values take precedence over `label-x`,
`label-y`, and `label-width`; absent or malformed values safely fall back to
those props.

```css
[data-drawn-annotation-id="nullable-return-label"] {
  --da-label-x: 0.7125;
  --da-label-y: 0.1864;
  --da-label-width: 0.1944;
}
```

The generated stylesheet is deck-owned rather than theme-owned: create
`styles/drawn-annotations.generated.css` with the generated-file header, import
it once from the consuming deck's global stylesheet, and ensure that stylesheet
is loaded by the deck. Enable the writer in the consuming deck's
`vite.config.ts` with `drawnAnnotationEditor()` from
`slidev-theme-kotlin/annotation-editor`; the complete setup is in the root
[README](../README.md#visual-drawnannotation-editor). With the writer plugin configured,
press **Alt+Shift+A** (or use the global **Edit annotations** toolbar) in a
development deck. Click and drag a visible identified label to move it; select
it and drag its right handle to set its maximum width. In edit mode, labels,
the label width handle, and connector endpoint handles are keyboard focusable:
focus one, then use the arrow keys to nudge it (`Shift` for larger steps). The
width handle adjusts maximum width; connector endpoints and its body can
likewise be dragged; endpoints snap to slide edge/centre guides
and the annotation's source, target, and label ports. Hold `Alt` to temporarily
disable snapping. The first connector drag materializes the currently automatic
route as two manual endpoints. Pointer release saves through the local writer;
a pause in a long drag saves a draft too, and local saves are serialized so they
cannot conflict with each other. The toolbar can reset the selected annotation or all
saved annotation geometry, and explicitly switch a selected connector between
its manual frozen route and automatic attached route. **Cmd/Ctrl+Z** restores the latest completed save
for the selected annotation. If another browser advances the writer revision,
the failed save leaves the current draft visible for inspection; choose
**Reload saved geometry** to intentionally discard drafts and continue from
the other browser's saved revision. Missing or duplicate IDs disable saving,
and a deck without the writer plugin reports its configuration error instead
of entering an editor that cannot save.

## How it looks

| prop | default | meaning |
| --- | --- | --- |
| `id` | – | stable deck-wide ID for generated editor geometry; must match `[A-Za-z][A-Za-z0-9_.-]*` when supplied |
| `options` | – | [rough.js options](https://github.com/rough-stuff/rough/wiki#options), passed straight to the library that draws every stroke |
| `iterations` | `2` | how many times each shape is drawn over itself — the sketchy redraw |
| `color` | `--drawn-annotation-color` | stroke and label colour, any CSS colour; the variable falls back to the text colour |
| `stroke-width` | `2` | stroke width, in slide pixels |
| `duration` | `800` | how long drawing one stage takes, in milliseconds |

Out of the box a mark looks exactly like Slidev's own `v-mark`: the defaults
are Rough Notation's — a 2px stroke, roughness 1.5, every shape drawn twice,
800&nbsp;ms drawn stroke by stroke — and `options` overrides the rough.js
layer of that recipe: `:options="{ roughness: 2.6 }"` makes the strokes
wobblier, `:options="{ roughness: 0, bowing: 0 }"` (with `:iterations="1"`)
turns them into clean geometric lines. Colour and stroke width are the
exception — they are set through `color` and `stroke-width`, as in Rough
Notation itself, because they are applied in CSS, which is what animates the
drawing. The one departure: Rough Notation rolls a random seed, but here the
randomness is always seeded from the annotation's own props, so a mark keeps
its shape while it follows a Magic Move transition; pass `seed` in `options`
to pick one by hand.

The default colour is the `--drawn-annotation-color` CSS variable, which this
deck points at the theme purple in `style.css`. The variable is read where it
is used, so any scope can redefine it — a single slide's class as well as
`:root` — and where nobody defines it the strokes follow the surrounding
text, which is Rough Notation's own default. An explicit `color` prop beats
all of this. When the token points at another variable, give it a hard
fallback (`var(--fundamentals-purple, #7954f6)`): a token that resolves
invalid makes the strokes vanish instead of falling back.

The label's typography is themeable the same way, from `:root` or any
narrower scope:

| CSS variable | default | meaning |
| --- | --- | --- |
| `--drawn-annotation-color` | text colour | stroke and label colour |
| `--drawn-annotation-label-font` | `'JetBrains Sans'`, slide sans font | label font family |
| `--drawn-annotation-label-size` | `28px` | label font size, in slide pixels |
| `--drawn-annotation-label-weight` | `800` | label font weight |

## Dropping it into a theme

The component is self-contained: it talks to Slidev only through the public
`@slidev/client` context, and `vue` and `@vueuse/core` already ship with
Slidev. To move it into a theme:

1. copy `DrawnAnnotation.vue` into the theme's `components/` directory, where
   Slidev auto-registers it for every deck that uses the theme;
2. add `roughjs` to the theme's `dependencies` — it draws every stroke;
3. define `--drawn-annotation-color` (and, if wanted, the label variables
   above) in the theme's styles to pick the theme-wide default look.

Nothing in the component reads deck-specific layout state: every colour,
font and duration flows in through props or CSS variables. Automatic placement
uses only the marked box, requested side, and concrete slide bounds; final
composition belongs in explicit props or saved editor geometry.

## When nothing appears

An annotation that cannot be drawn stays off the slide and says why on the
browser console, once, prefixed `[DrawnAnnotation]`. The warnings wait until
the annotation's click has been reached and the slide has stopped moving, so a
Magic Move step that legitimately does not contain the text never causes one.

- **Text … was not found in the slot** — `text` has to match the rendered text
  exactly, spaces included. Inside a Magic Move block it also has to be part of
  the step the annotation is drawn on.
- **Text … matches only N times** — `occurrence` asks for a later match than
  the slide has; lower it, or make the text long enough to be unique.
- **Selector … matched nothing inside the slot** — put the attribute (by
  default `data-annotate`) on the element to mark, or use `text` for code.
- **Target … matched nothing on the slide** — the `target` selector found no
  element to connect to.
- **… must be a plain click number** — with `insert`, and on annotations
  nested inside one, the annotation resolves clicks itself, so Slidev's `+1`
  ordering is not available.
- **`on` is `at` and `until` in one** — drop the separate `at` / `until` when
  `on` is given; they are ignored.

# `InlineCompilerError`

`<InlineCompilerError>` places an IntelliJ-style squiggle under a compiler
error and anchors its message beside the relevant code. Wrap exactly one fenced
code block; the component supports ordinary Shiki fences and `magic-move`
blocks, and remains hidden when its target is not part of the current step.

````md
<InlineCompilerError text="userName" message="Unresolved reference: userName" :on="1">

```kotlin
println(userName)
```

</InlineCompilerError>
````

## Target

Give `text` to mark an exact rendered fragment, even when Shiki split it across
syntax-token spans. `occurrence` selects its one-based occurrence (default
`1`). Add `line` to limit the text search to that one-based source line.

Alternatively, give only `line` to underline the line's non-whitespace code.
A target on an empty line cannot be displayed. In development, a missing,
ambiguous, or invalid target produces a console warning after Magic Move has had
time to settle.

| prop | required | meaning |
| --- | --- | --- |
| `message` | yes | diagnostic text shown beside the code and announced to screen readers |
| `text` | one of `text` or `line` | exact rendered code text to underline |
| `line` | one of `text` or `line` | one-based line number; also narrows a `text` search |
| `occurrence` | no | one-based match of `text` to underline; defaults to `1` |

## Click timing

The timing props match Slidev's click ranges. No timing prop (or `at="0"`)
shows the diagnostic from the initial slide state. `at` reveals it, and `until`
hides it at its first exclusive click. Relative values such as `"+1"` are
supported.

Use `on` for a diagnostic that belongs to one click: `:on="2"` is equivalent
to `:at="2" :until="3"`; `:on="0"` shows it only before the first click.
`on` takes precedence over `at` and `until` when both forms are supplied.

The diagnostic waits for a Magic Move transition to finish before it appears,
then recalculates its position as code, fonts, or slide scale change. In print
mode it is shown synchronously so exports capture it.
