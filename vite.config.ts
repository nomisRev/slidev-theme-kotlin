import { defineConfig } from 'vite'
import { drawnAnnotationEditor } from './annotation-editor.ts'

// Local demo only: enable the development-only endpoint that persists visual
// DrawnAnnotation edits to styles/drawn-annotations.generated.css.
export default defineConfig({
  plugins: [drawnAnnotationEditor()],
})
