# Show missing annotation targets on the slide in development

**Status:** fixed (unreleased)
**Components:** `DrawnAnnotation`, `InlineCompilerError`
**Found in:** slidev-theme-kotlin 0.12.1, while exporting kotlin-fundamentals

## Problem

When an annotation cannot find what it should mark, it stays off the slide and
explains why once on the browser console, prefixed `[DrawnAnnotation]` or
`[InlineCompilerError]`. That is the right behaviour for a published deck, but
while authoring it is too quiet: the author is looking at the slide, not at the
console, and a mark that silently never appears reads as "the click has not
happened yet" rather than "the text is wrong".

Concrete case: kotlin-fundamentals lesson 2 has

```md
<DrawnAnnotation text="text.isBlank()" ... >
```

whose text no longer matches the fence below it. Nothing on the slide hints at
this. The warning only surfaced because a PNG export happened to log it:

```
[DrawnAnnotation] Text "text.isBlank()" was not found in the slot. It has to
match the rendered text exactly — and inside a Magic Move block, be part of the
step the annotation is drawn on.
```

## Proposal

In development mode only, render a small, unmistakable error marker on the
slide whenever DrawnAnnotation's `explainMissing()` or its connector `target`
warning (a separate site, outside `explainMissing`) fires, or one of the
"diagnostic is not shown" `console.warn` branches in InlineCompilerError does.
Keep the console message as is; the on-slide marker is an addition, not a
replacement.

- A compact chip, a red outlined pill in the slide's top-left, showing the
  component name and the first sentence of the warning:
  `DrawnAnnotation: Text "text.isBlank()" was not found in the slot.` The short
  form is derived from the console message, not a second string to maintain.
  Several failures on one slide stack vertically.
- Hover reveals the full message that the console already prints.
- Each annotation is its own component, so stacking needs a shared surface:
  the components report into a reactive map in
  `components/drawn-annotation/editor-store.ts`, and one renderer,
  `DrawnAnnotationProblems.vue`, is mounted from `global-top.vue` through the
  same development-only dynamic import as the editor toolbar. That import is
  what keeps the chip's code and strings out of a built deck.
- Gate the renderer on the same four-part guard the toolbar uses:
  `import.meta.env.MODE === 'development'` together with `hasPrimarySlide`,
  `!isPresenter`, and `!isPrintMode` from `useNav()`. Mode alone is not enough:
  `import.meta.env.DEV` stays true in Slidev's build renderer, and the CLI
  export runs through a development-mode server (see the comment in
  `DrawnAnnotationEditorToolbar.vue`), which is exactly why the warning in this
  report surfaced during an export in the first place.
- Respect the existing timing: only after `missingIsAnError` is true (current
  slide, settled, click reached, within range), so a Magic Move step that
  legitimately lacks the text never flags an error, exactly as the console
  warning behaves today. InlineCompilerError keeps its 1500 ms grace timer.
- Unlike a console line, a chip must retract: it goes away when the text or
  element turns up after all, when the props change, and when the component
  unmounts. Only problems reported by the slide currently shown are rendered,
  because Slidev mounts the neighbouring slides ahead of time.
- Align InlineCompilerError's warnings on the mode check too, so both
  components share one development boundary.

## Acceptance

- [x] In `slidev` dev mode, an annotation with an unmatched `text`, `selector`,
      `occurrence`, or `target` shows a visible error chip on that slide.
- [x] `InlineCompilerError` shows the same chip for its "diagnostic is not
      shown" cases.
- [x] The chip carries enough text to fix the mistake without opening the
      console; the full message is available on hover.
- [x] `slidev build`, `slidev export`, `export:slide`, the presenter view, and
      print mode never render the chip.
- [x] A Magic Move step that does not yet contain the text does not trigger it.
- [x] `scripts/assert-production-annotation-editor.mjs`, which `npm run build`
      runs, fails when the chip's class name or its accessible label reaches
      `dist`. No deliberately broken showcase slide: it would add a warning to
      every `npm run screenshot` run.
