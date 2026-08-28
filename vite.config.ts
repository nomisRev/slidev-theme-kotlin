import { defineConfig } from 'vite'
// Keep the demo on the same package subpath that consuming decks use. This
// also exercises the package export during local development and builds.
import { drawnAnnotationEditor } from 'slidev-theme-kotlin/annotation-editor'

// Local demo only: enable the development-only endpoint that persists visual
// DrawnAnnotation edits to styles/drawn-annotations.generated.css.
export default defineConfig({
  plugins: [drawnAnnotationEditor()],
})
