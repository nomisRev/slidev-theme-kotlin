# DrawnAnnotation rewrite plan (superseded)

The earlier rewrite proposal described persisted annotation IDs, manual
`labelX`/`labelY`/`labelWidth` props, and generated CSS. That design has been
superseded and must not be used by consumers.

The implemented design persists normalized geometry directly in each
`DrawnAnnotation` Markdown opening tag through its `:geometry` binding. See
[the source-geometry editor guide](drawn-annotation-visual-editor-plan.md),
the [component reference](../components/README.md), and the current
[merge plan](../PLAN.md) for the supported API and release checks.
