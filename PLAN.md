# DrawnAnnotation visual editor — merge-readiness plan

This plan records the remaining work before the visual annotation editor is merged into the base Kotlin Slidev theme, plus the manual smoke-test procedure.

## Merge gates

### 1. Validate a real consuming deck

The editor has to work outside the theme repository. Validate it with a small consumer fixture/deck that:

- installs the current theme package (preferably from `npm pack`, not only a workspace link);
- enables the opt-in writer in `vite.config.ts`:

  ```ts
  import { defineConfig } from 'vite'
  import { drawnAnnotationEditor } from 'slidev-theme-kotlin/annotation-editor'

  export default defineConfig({
    plugins: [drawnAnnotationEditor()],
  })
  ```

- imports the same generated file configured for the plugin, for example:

  ```css
  @import './drawn-annotations.generated.css';
  ```

- proves edits write below the consuming deck root, not into the installed theme;
- covers a custom output path and rejects an output path outside the root;
- proves that a deck without the plugin reports the missing-writer error and cannot claim a save succeeded;
- builds and exports with saved geometry but no authoring controls or write capability.

`~/Developer/exposed-fundamentals` is configured as the first local consumer/UX fixture. It intentionally uses a local file dependency while developing; repeat the final gate with `npm pack` before release.

### 2. Extend automated coverage

Current unit tests cover serialization, validation, atomic revision-guarded writes, concurrent writes, and output-path containment. The Chromium browser smoke test covers pointer editing, keyboard label nudge, Cmd/Ctrl+Z, a stale conflict/reload, CSS HMR/reload, route stability, and production exclusion.

Add or verify these cases before merge:

- keyboard movement of connector endpoints and body, plus `Shift` large movement;
- keyboard resize from the width handle, including Up/Down being no-ops;
- Escape during a pointer drag both before and after its delayed autosave;
- reset label/connector/selected/all followed by Undo;
- automatic ↔ manual connector conversion followed by reload;
- duplicate and missing IDs show diagnostics and prevent saves for the unsafe annotation;
- controls are absent in presenter, overview, print, export, and production build modes;
- ideally, a two-browser-page conflict test in addition to the endpoint-level simulation;
- a regression test that one keyboard gesture produces one persistence attempt and never retries a rejected stale write.

### 3. Cross-browser and input review

Manually review at least Chromium and Safari desktop. Include Firefox if it is in the supported theme browser set, and iPad Safari if touch authoring is a target. Specifically inspect:

- SVG connector body/endpoint focusability and focus indication;
- pointer capture when a drag leaves the handle or slide;
- touch drag and scrolling interactions;
- Cmd+Z on macOS and Ctrl+Z elsewhere;
- CSS HMR timing while dragging and immediately after release;
- color scheme and zoom/presentation scaling;
- nested/transformed annotation content, Magic Move tracking, and click transitions.

### 4. Public API and release documentation

Before exposure in the base theme:

- document the stable, deck-wide `id` requirement for editing and its safe form: `[A-Za-z][A-Za-z0-9_.-]*`;
- state that annotations without IDs still render but cannot be edited/persisted;
- document that the generated CSS is tool-owned and should be committed;
- document the Vite-plugin and CSS-import requirements and a custom output path;
- decide whether a generated empty CSS starter file is shipped or must be created by consumers;
- add changelog/release notes for this opt-in authoring workflow;
- complete an authoring pass over curated annotations and commit the canonical generated CSS.

## Manual smoke test

### Consumer setup

In the consumer deck, install the local theme build and run:

```bash
cd ~/Developer/exposed-fundamentals
npm run dev
```

The deck includes `vite.config.ts`, imports `drawn-annotations.generated.css` from `style.css`, and imports `lessons/annotation-editor-smoke.md` as an isolated fixture slide. Navigate to that slide, then press **Alt+Shift+A** or select **Edit annotations**.

### Basic label persistence

1. Drag a visible label and verify it moves immediately without advancing the slide.
2. Release; wait for the saved status and inspect `drawn-annotations.generated.css`.
3. Reload the browser and verify the location remains.
4. Drag the label width handle. Verify wrapping changes and persists after reload.

### Connector editing and snapping

1. Drag each endpoint and verify its length/angle changes independently.
2. Drag the connector body and verify both endpoints translate as a rigid segment.
3. Drag near slide guides, the source mark, and label ports; verify snapping.
4. Hold `Alt` while dragging and verify snapping is disabled.
5. Switch the selected connector between manual and automatic. Verify automatic mode follows its source/label and both modes survive reload.

### Keyboard, undo, and accessibility

1. Focus/click a label and use arrow keys; use `Shift` for a larger move.
2. Focus the width handle and use Left/Right; Up/Down must not resize it.
3. Focus a connector endpoint and body; arrow keys must respectively move one endpoint or translate the segment.
4. Press Cmd+Z on macOS or Ctrl+Z elsewhere and verify the last completed edit is restored.
5. Tab through labels, width handles, endpoints, and connector bodies. Verify sensible accessible names and visible focus.

### Failure and recovery

1. Open the same deck in two browser windows.
2. Save a geometry change in window A.
3. Without reloading B, save a change to the same annotation in B.
4. Verify B reports a conflict rather than overwriting A.
5. Choose **Reload saved geometry**, accept the discard prompt, and verify B adopts A's saved geometry.
6. Temporarily remove `drawnAnnotationEditor()` from `vite.config.ts`, restart, and verify the editor says the writer is not configured and no file changes.

### Build/export boundary

Run:

```bash
npm run build
npm run export
```

Confirm saved geometry appears in generated output and neither toolbar, guides, handles, nor a writer endpoint appears. Also run the theme's isolated browser check from the theme repository:

```bash
npm run test:annotation-editor
```
