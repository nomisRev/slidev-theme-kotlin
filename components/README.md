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
| `text` | – | exact text inside the slot to mark instead of an element; `\n` continues the match on the next source line |
| `occurrence` | `1` | which occurrence of `text`, 1-based |
| `line` | – | one-based source line of a code block to search on; occurrences are counted on that line only |
| `multiline` | – | mark every visual line of the match; on by default for `underline` and `strike-through` |
| `padding` | `4` | space between the marked box and the stroke, in slide pixels |

`text` is the way to reach a token inside a code block, where there is no
element to point a selector at. It works in plain Shiki blocks and in
`magic-move` blocks alike, and the mark follows the token while Magic Move
animates it. When the text is not part of the current Magic Move step, the
annotation stays hidden.

A short token that repeats — `email` on three lines, `Long` on two — is
reached either by counting (`occurrence="3"`) or by naming the line
(`:line="5"`), whichever reads better; both count from the code block's
first line of real code, after any folded imports. `line` is the first line
of the match when `text` spans several lines (written with `\n`, indentation
included), and a slide with more than one code block numbers each from one.

## What to point at

| prop | default | meaning |
| --- | --- | --- |
| `label` | – | Markdown text to write next to the mark; inline code and quotes use the mono stack |
| `target` | – | selector of another element to connect the mark to |
| `target-x`, `target-y` | `50`, `50` | point inside the target, as a percentage of its box |
| `target-radius` | `3` | size of the mark at that point, as a percentage of the target's width |
| `target-type` | `circle` | target shape, independently set to `underline`, `circle`, `box`, `strike-through`, or `none` |
| `target-mark` | `true` | show the default target circle when `target-type` is omitted |
| `connect` | `true` | draw the leader line between the mark and its destination; unset, the slide's `drawnAnnotation.connect` frontmatter decides, then `themeConfig.drawnAnnotation.connect` |
| `arrow` | `false` | arrow head at the end of the leader line |
| `curve` | `0.12` | curvature of the leader line, as a fraction of its length |

Percentages keep annotations on screenshots independent of the rendered size.

A deck that places most labels by hand rarely wants a leader line. Turn it off
once in the headmatter instead of writing `:connect="false"` on every tag, and
override per slide or per tag where a line does help:

```yaml
---
theme: kotlin
themeConfig:
  drawnAnnotation:
    connect: false
---
```

```yaml
---
drawnAnnotation:
  connect: true   # this slide draws its leaders again
---
```

```html
<DrawnAnnotation text="suspend" label="pauses here" :connect="true" />
```
Giving both a `target` and a `label` connects the mark to the target and writes
the label next to it.

`label` is a small, safe Markdown subset rendered by the theme itself (embedded
HTML is escaped): backticks render semantic inline `<code>`, a label beginning
with `>` renders a block quote, `**strong**` and `*emphasis*` work, and `\n`
breaks the line. Inline code and quotes use the theme's local-first JetBrains
Mono stack instead of the label's sans face:

```md
<DrawnAnnotation selector="[data-class]" label="The `class MyClass` declaration">

<span data-class>MyClass</span>

</DrawnAnnotation>

<DrawnAnnotation selector="[data-quote]" label="> I am a quote in markdown">

<span data-quote>Quote</span>

</DrawnAnnotation>
```

## Where the label goes

A label is placed out of the slide's normal flow. Automatic placement is
deterministic: `auto` prefers below a mark in the upper half of the slide and
above one in the lower half, then falls back to the other sides; an explicit
`placement` is a contract and never drifts to another side. Candidates stay
clear of the slide's laid-out content (text, images, code blocks — including
v-click content that is laid out but still hidden, so a label never sits
where the slide is about to grow), of the annotation's own mark, of labels
placed by earlier annotations on the slide, and of anything matched by
`avoid-selector`, each kept at `clearance` distance; when the natural width
cannot be placed clear, the label wraps into the free space. Nothing is
guessed: only what the browser has laid out is measured.

Use a `:geometry` binding for a fixed authored position, or let the
development visual editor write the same normalized source geometry. Geometry
wins over automatic placement and is never moved by obstacles.

| prop | default | meaning |
| --- | --- | --- |
| `placement` | `auto` | preferred side: `up`, `down`, `left`, `right`, or automatic vertical choice with fallbacks |
| `geometry.label` | – | label centre (`x`, `y`) and optional maximum `width`, each normalized to concrete slide width/height |
| `geometry.connector` | – | manual `start`/`end` points, optionally with a quadratic `control`, normalized to the concrete slide |
| `gap` | `28` | distance between the mark and automatically placed label, in slide pixels |
| `clearance` | `16` | space an automatic label keeps from its obstacles, in slide pixels |
| `avoid-selector` | – | extra elements an automatic label must not cover |

## When it is drawn

An annotation with neither `at` nor `on` is part of the initial slide state;
it does not add a click. Give `at` or `on` to create a reveal, using Slidev's
native `v-click` click-ordering semantics.

| prop | default | meaning |
| --- | --- | --- |
| `at` | – | click that draws the mark and its leader line; when omitted, the annotation is visible in the initial state. An explicit value takes part in Slidev's click ordering like `v-click` |
| `label-at` | `at` | click that writes the label |
| `until` | – | click that takes the annotation away again; exclusive, like the end of a `v-click` range |
| `on` | – | `at` and `until` in one, for an annotation that belongs to a single click |
| `sequential` | `true` | nested annotations sharing a click draw one after the other |
| `insert` | `false` | give the annotation [a click of its own](#inside-a-magic-move-block) inside a Magic Move block |
| `passive` | `false` | observe an existing `v-click` / `v-clicks` step at `at` without registering an additional click |
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

Set `passive` when nearby `v-click` or `v-clicks` content already owns the
annotation's `at` step. The annotation observes that existing step and does not
register another click marker, so it draws only after the reveal has settled.

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

`geometry` is the source-local public geometry prop. Its values are fractions
of the concrete `.slidev-layout`, so it survives presentation scaling and a
nested annotation canvas:

```html
<DrawnAnnotation text="String?" label="nullable return type" :on="2"
  :geometry="{ label: { x: 0.7125, y: 0.1864, width: 0.1944 } }">
```

No annotation ID or generated stylesheet is used. Enable
`drawnAnnotationEditor()` in the consuming deck's `vite.config.ts`; while
serving it injects a transient source locator and the editor rewrites only this
opening tag's `:geometry` binding and its `:connect` binding. The
locator is not part of authored Markdown
or production output. With the writer configured, press **Alt+Shift+A** (or use
the global **Edit annotations** toolbar) in a development deck.

Editing is a deliberate frozen session. Entering edit mode locks the deck on
the current slide and click state: Slidev's keyboard shortcuts are suspended
through its public shortcut lock, and click-to-navigate, the nav controls, and
touch swipes are blocked until the session ends, so no input can move the deck
out from under an edit. Every geometry change made during the session — drags
and keyboard nudges alike — stays a shared local draft; the Markdown source is
never written mid-gesture, which means no HMR remount and no replayed
annotation entrance animation while the author is working.

Click and drag a visible label to move it; select it and drag its right handle
to set its maximum width. Labels, the label width handle, and the connector
endpoint and curve handles are keyboard focusable: focus one, then use the
arrow keys to nudge it (`Shift` for larger steps) — arrow keys always edit the
selected control and never navigate while the session is active. The width
handle adjusts maximum width; connector endpoints, its quadratic control
point, and its body can likewise be dragged (a body drag or nudge translates
endpoints and control point as one rigid polygon). **Hide connector** and
**Show connector** write a `:connect` binding only where the wanted state
differs from the slide's or deck's `drawnAnnotation.connect` default, and
remove the binding when it matches, so a deck that hides leaders by default
gets `:connect="true"` on the one tag that shows one; the routing and curve
controls below act on a drawn connector only. One toolbar control
switches the selected connector between its two states: the first connector
drag (or the **Make connector manual** button) materializes the currently
automatic route — endpoints and the control point that preserves its visible
curve — as a draft like any other edit, and **Use automatic connector**
removes the manual connector geometry, control point included, so the route
follows its target and label again. A second toolbar control curves and
straightens the manual connector: **Curve connector** gives a straight
connector a control point on its chord midpoint (a draft — the rendered route
does not jump when the handle appears), and **Straighten connector** removes
the control point while the endpoints stay put.

**Done editing annotations** is the commit boundary: it writes every draft
that differs from the saved source, one annotation at a time in the order they
were first edited, and exits the session once all writes finish. A failed
write — a revision conflict because another author changed the file, say —
never discards anything: the session stays open, the failing drafts stay
visible, and the status names the failure and the recovery paths (fix and
press Done again, or **Reload saved geometry** to deliberately discard the
drafts and adopt the saved source). **Esc** cancels in stages: an active drag
first (restoring the pre-drag draft), then the current selection, then — after
a confirmation whenever unsaved changes exist — the whole session, discarding
its drafts without writing. There is no undo: re-drag what went wrong, or
reset. Removing saved geometry is the one exception to draft-only editing — a
draft can only overlay the source, not delete from it — so **Reset
annotation** (the selected tag loses its `:geometry` binding), **Reset slide**
(every annotation on the current slide does, after a confirmation), **Use
automatic connector**, **Straighten connector** (when the source holds the
control point), and the **Hide/Show connector** toggle write immediately. A
deck without the writer plugin reports its configuration error instead of
entering an editor that cannot save.

## How it looks

| prop | default | meaning |
| --- | --- | --- |
| `geometry` | – | optional source-local normalized `{ label, connector }` geometry; the development editor writes this binding into the opening tag |
| `options` | – | [rough.js options](https://github.com/rough-stuff/rough/wiki#options), passed straight to the library that draws every stroke |
| `iterations` | `2` | how many times each shape is drawn over itself — the sketchy redraw |
| `color` | `--drawn-annotation-color` | stroke and label colour, any CSS colour; the variable falls back to the text colour |
| `stroke-width` | `2` | stroke width, in slide pixels |
§| `duration` | `500` | how long drawing one stage takes, in milliseconds |

Out of the box a mark looks exactly like Slidev's own `v-mark`: the defaults
are Rough Notation's — a 2px stroke, roughness 1.5, every shape drawn twice,
stroke by stroke — and `options` overrides the rough.js layer of that recipe:
`:options="{ roughness: 2.6 }"` makes the strokes wobblier,
`:options="{ roughness: 0, bowing: 0 }"` (with `:iterations="1"`) turns them
into clean geometric lines. Colour and stroke width are the exception — they
are set through `color` and `stroke-width`, as in Rough Notation itself,
because they are applied in CSS, which is what animates the drawing. Two
departures: a stage draws in 500&nbsp;ms rather than Rough Notation's
800&nbsp;ms, keeping the hand-drawn pace aligned with Magic Move and page
transitions; and Rough Notation rolls a random seed, but here the randomness
is always seeded from the annotation's own props, so a mark keeps its shape
while it follows a Magic Move transition; pass `seed` in `options` to pick one
by hand.

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
| `--drawn-annotation-code-font` | Slidev's local-first JetBrains Mono stack | inline-code and quote font family |
| `--drawn-annotation-label-size` | `28px` | label font size, in slide pixels |
| `--drawn-annotation-label-weight` | `800` | label font weight |

## Dropping it into a theme

The component talks to Slidev through the public `@slidev/client` context —
plus one internal constant, `injectionClicksContext` from
`@slidev/client/constants.ts`, which `insert` needs in order to shift a Magic
Move block's clicks — and `vue` and `@vueuse/core` already ship with Slidev.
To move it into a theme:

1. copy `DrawnAnnotation.vue`, `code-text-match.ts` (the text matching it
   shares with `InlineCompilerError`), and `annotation-label-markdown.ts` into
   the theme's `components/` directory, where Slidev auto-registers the
   component for every deck that uses the theme;
2. add `roughjs` and `markdown-it` to the theme's `dependencies` — they draw
   the strokes and safely render Markdown labels respectively;
3. define `--drawn-annotation-color` (and, if wanted, the label variables
   above) in the theme's styles to pick the theme-wide default look, and copy
   the `.annotation-label-content` rules from `styles/layout.css`, which zero
   the paragraph margins and put inline code in the mono stack.

Nothing in the component reads deck-specific layout state: every colour,
font and duration flows in through props or CSS variables. Automatic placement
measures only what the browser has laid out on the slide — content boxes, the
marked box, earlier labels, the requested side, and concrete slide bounds;
final composition belongs in explicit props or saved editor geometry.

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

A diagnostic can cover several lines: write the line break into `text` as
`\n` (or a real newline in a bound string), indentation included, exactly as
the code renders. Every line the match covers gets its own squiggle, and the
message sits after the line the match starts on, as IntelliJ places its
inline diagnostics. With `line`, that is the first line of the match.

````md
<InlineCompilerError text="when (state) {\n  is Loading -> spinner()\n}" message="'when' expression must be exhaustive">
````

Alternatively, give only `line` to underline the line's non-whitespace code.
A target on an empty line cannot be displayed. In development, a missing,
ambiguous, or invalid target produces a console warning after Magic Move has had
time to settle.

| prop | required | meaning |
| --- | --- | --- |
| `message` | yes | diagnostic shown beside the code and announced to screen readers; the same Markdown as a `DrawnAnnotation` label, so `` `Int` `` renders inline code and `\n` breaks the line |
| `text` | one of `text` or `line` | exact rendered code text to underline; `\n` continues it on the next line |
| `line` | one of `text` or `line` | one-based line number; also narrows a `text` search to that line (the first line of a multi-line match) |
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

## Styling

| CSS variable | default | meaning |
| --- | --- | --- |
| `--inline-compiler-error-color` | IntelliJ's error reds | colour of the squiggle, the dot, and the message |
| `--inline-compiler-error-message-size` | the annotated code's font size | message font size |

Both are read where they are used, so any scope can redefine them — a single
slide's class as well as `:root`.

# `SmartCast`

`<SmartCast>` paints IntelliJ's smart-cast green behind an exact piece of code
— the receiver a null check or `is` check just narrowed, from `String?` to
`String` or `Supertype` to `Subtype`. Wrap exactly one fenced code block; the
component supports ordinary Shiki fences and `magic-move` blocks, and stays
off the slide when its target is not part of the current step.

````md
<SmartCast text="nullable.length">

```kotlin
val nullable: String? = null
val length =
  if (nullable != null) nullable.length
  else -1
```

</SmartCast>
````

Unlike `DrawnAnnotation` and `InlineCompilerError`, which draw an independent
mark positioned over the code, `SmartCast` paints the background of the
matched token elements themselves. A same element's background always renders
behind its own text, so this needs no position tracking, and it travels with
Magic Move for free — the highlight is the moving token's own style, not a box
following it.

## Target

Give `text` to mark an exact rendered fragment, even when Shiki split it
across syntax-token spans. `occurrence` selects its one-based occurrence
(default `1`). Add `line` to limit the text search to that one-based source
line. `\n` in `text` continues the match on the next line, as for
`InlineCompilerError`.

| prop | required | meaning |
| --- | --- | --- |
| `text` | yes | exact rendered code text to paint green |
| `line` | no | one-based line number that narrows a `text` search (the first line of a multi-line match) |
| `occurrence` | no | one-based match of `text` to paint; defaults to `1` |
| `message` | no | text shown after the end of the match's first line, as for `Warning`; the same Markdown as a `DrawnAnnotation` label, so `` `Int` `` renders inline code and `\n` breaks its line |

In development, a missing, ambiguous, or invalid target produces a console
warning after Magic Move has had time to settle.

## Click timing

The timing props match Slidev's click ranges. No timing prop (or `at="0"`)
shows the highlight from the initial slide state. `at` reveals it, and `until`
hides it at its first exclusive click. Relative values such as `"+1"` are
supported.

Use `on` for a highlight that belongs to one click: `:on="2"` is equivalent to
`:at="2" :until="3"`; `:on="0"` shows it only before the first click. `on`
takes precedence over `at` and `until` when both forms are supplied.

## Styling

| CSS variable | default | meaning |
| --- | --- | --- |
| `--smart-cast-color` | IntelliJ's smart-cast green (`#dcf8df`) | highlight background colour |
| `--smart-cast-message-color` | a darker green (`#3b7a45`) | colour of an optional `message` and its dot |
| `--smart-cast-message-size` | the annotated code's font size | message font size |

Read where it is used, so any scope can redefine it — a single slide's class
as well as `:root`.

# `Warning`

`<Warning>` paints IntelliJ's warning yellow behind an exact piece of code —
the `Array` property a data class compares by reference, the parameter a
function never reads. It is `SmartCast` in another colour: the same props, the
same exact-text match across Shiki tokens, the same travel with Magic Move.
Wrap exactly one fenced code block.

````md
<Warning text="val tags: Array<String>" message="Property with 'Array' type in a 'data' class: it is recommended to override 'equals()' and 'hashCode()'">

```kotlin
data class Tags(val key: String, val tags: Array<String>)
```

</Warning>
````

`message` is optional: with it, the warning's text sits after the end of the
line the match starts on, as `InlineCompilerError` places its diagnostics,
and waits for a Magic Move step to settle before it appears. Without it,
`Warning` paints the background and nothing else. Code the slide shows broken
on purpose belongs under `InlineCompilerError` instead: the Kotlin snippet CLI
skips those fences, while a fence under `Warning` still compiles and is still
generated.

## Target and click timing

Exactly as for `SmartCast`: `text` (with `\n` for a multi-line match),
`line`, `occurrence`, and `at` / `until` / `on`. `message` is the same
Markdown as a `DrawnAnnotation` label: `` `Int` `` renders inline code and
`\n` breaks its line.

## Styling

| CSS variable | default | meaning |
| --- | --- | --- |
| `--warning-color` | IntelliJ Light's warning yellow (`#faf4d7`) | highlight background colour |
| `--warning-message-color` | a darker warning ochre (`#9a7b0f`) | colour of the message and its dot |
| `--warning-message-size` | the annotated code's font size | message font size |

Read where it is used, so any scope can redefine it — a single slide's class
as well as `:root`.

# `TypeHint`

`<TypeHint>` draws IntelliJ's inlay hint for a lambda with receiver: the grey
`this: HTML` pill the IDE renders right after the `{` that opens the lambda.
A `context(...)` block gets the IDE's other shape, `context(Clock)` with no
`this:`, since it supplies a context without changing the receiver. It
exists for DSL slides, where what each block brings into scope is the whole
lesson, and it draws nothing else — no highlight, no squiggle. Wrap exactly
one fenced code block; nest one wrapper per hint.

````md
<TypeHint :line="1" receiver="HTML">
<TypeHint :line="2" receiver="BODY" :at="1">

```kotlin
html {
  body {
    p { +"Hello" }
  }
}
```

</TypeHint>
</TypeHint>
````

````md
<TypeHint :line="2" context="Clock.System">

```kotlin
fun liveTalks(talks: List<Talk>): List<Talk> =
  context(Clock.System) {
    talks.filter { it.isLive() }
  }
```

</TypeHint>
````

The hint is the message of `SmartCast` and `Warning` in another shape: the
same exact-text match across Shiki tokens, the same placement after the end
of the line the match starts on, the same wait for a Magic Move step to
settle. Because `{` usually ends its line in a DSL, "after the line" is
"after the brace", as in the IDE. When code follows the brace on the same
line (`body { }`), the pill sits after that code instead of covering it.

## Target

`text` defaults to `{`, so a hint normally names only its `line` and its
`receiver` or `context`. Give `text` (with `\n` for a multi-line match) and
`occurrence` when the brace is not the anchor you want, exactly as for
`SmartCast`.

| prop | required | meaning |
| --- | --- | --- |
| `receiver` | one of the two | the lambda's receiver type; rendered as `this: <receiver>` |
| `context` | one of the two | what a `context(...)` block supplies; rendered as `context(<context>)` |
| `line` | no | one-based line number that narrows the `text` search |
| `text` | no | exact rendered code the pill follows; defaults to `{` |
| `occurrence` | no | one-based match of `text` on that line; defaults to `1` |

## Click timing

Exactly as for `SmartCast`: `at`, `until`, and `on`.

## Styling

| CSS variable | default | meaning |
| --- | --- | --- |
| `--type-hint-color` | IntelliJ Light's hint grey (`#6c707e`), Darcula's (`#8c8c8c`) in dark mode | text colour |
| `--type-hint-background` | IntelliJ Light's hint background (`#ebecf0`), Darcula's (`#3c3f41`) in dark mode | pill background |
| `--type-hint-size` | 85% of the annotated code's font size | pill font size |

The pill uses the code font. Read where they are used, so any scope can
redefine them — a single slide's class as well as `:root`.

# `InlineValue`

`<InlineValue>` draws IntelliJ's debugger inline value: the grey
`numbers: [1, 2, 3]` the IDE writes after a line while it is paused there. It
is for output slides where each line has its own result and the reader's eye
should never leave the line. It draws nothing else — no highlight, no squiggle,
no panel. Wrap exactly one fenced code block; nest one wrapper per value.

````md
<InlineValue text="println(numbers)" value="numbers: [1, 2, 3]">
<InlineValue :line="5" text="[1, 2, 3]" value="[2, 3, 4]">

```kotlin
val numbers = [1, 2, 3]
println(numbers)

[1, 2, 3].map { it + 1 }
```

</InlineValue>
</InlineValue>
````

`value` is written as given: `name: value` reads as the debugger labels a
variable, a bare `[2, 3, 4]` suits an expression that names nothing. It is
`SmartCast`'s message in the editor's own font and colour: the same exact-text
match across Shiki tokens, the same placement after the end of the line the
match starts on, the same wait for a Magic Move step to settle.

When every line of a ```` ```console ```` fence maps to one line of code the
wrapper replaces the fence; when the output is one block (a stack trace, a
table) keep the fence, which the theme renders as a run panel.

## Target

`text` names the line. Give `line` when the same text appears more than once,
and `occurrence` when it repeats on that line, exactly as for `SmartCast`.

| prop | required | meaning |
| --- | --- | --- |
| `value` | yes | the text shown after the line |
| `text` | yes | exact rendered code on the line; `\n` continues the match on the next line |
| `line` | no | one-based line number that narrows the `text` search |
| `occurrence` | no | one-based match of `text` on that line; defaults to `1` |

## Click timing

Exactly as for `SmartCast`: `at`, `until`, and `on`.

## Styling

| CSS variable | default | meaning |
| --- | --- | --- |
| `--inline-value-color` | the debugger's inline-value grey (`#787878`), on both schemes | text colour |
| `--inline-value-size` | the annotated code's font size | font size |

The value uses the code font. Read where they are used, so any scope can
redefine them — a single slide's class as well as `:root`.
