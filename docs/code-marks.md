# Code marks

A code mark is a trailing `// [!kind …]` comment inside a Kotlin fence. It
asks for an IDE decoration on the line it sits on:

````md
```kotlin
fun Application.users() = routing { // [!this Routing]
  route(Api.Users.create) { // [!this TypedRespondScope<CreateUser, User>]
    when (val result = insertUser(body)) {
      is Success -> respond(result.user) // [!smartcast result]
      AlreadyExists -> fail(UserAlreadyExists)
    }
  }
}
```
````

The comment never reaches the slide, the handout, or the generated Kotlin
sources. Because a mark sits on its line, it moves with that line through a
Magic Move chain, and you never count lines or nest closing tags.

## Kinds

| Mark | What appears |
| --- | --- |
| `[!smartcast TEXT]` | [`SmartCast`](../components/README.md#smartcast) on every occurrence of `TEXT` on the line |
| `[!warning TEXT MESSAGE]` | [`Warning`](../components/README.md#warning) on the first occurrence, with the message |
| `[!error TEXT MESSAGE]` | [`InlineCompilerError`](../components/README.md#inlinecompilererror); the fence stays out of the generated Kotlin |
| `[!this TYPE]` / `[!context TYPE]` | [`TypeHint`](../components/README.md#typehint) after the line's last `{` |
| `[!type NAME TYPE]` | `TypeHint` with the inferred type after `NAME` |
| `[!value TEXT VALUE]` | [`InlineValue`](../components/README.md#inlinevalue) after the line |
| `[!suspend]` | the [`SuspendGutter`](../components/README.md#suspendgutter) icon beside the line |

## Arguments

- The first argument is one word. Quote it with `"…"` or `` `…` `` when it
  holds spaces or brackets: `` [!error `["a", "bb"]` No `of` operator] ``.
- The last argument runs to the closing `]`, so a message or a type with
  spaces needs no quotes.
- Quotes and brackets inside a mark must balance.

## Options

`key=value` options right after the kind pass through as attributes of the
component:

```
[!smartcast on=1 result]
[!smartcast occurrence=3 user]
[!this occurrence=1 Routing]
[!error color=red email2 Unresolved reference]
```

## Several marks, and marks on their own line

- Several marks share one comment: `// [!context ResourceScope] [!suspend]`.
- A comment line that holds nothing but marks applies to the next code line
  and leaves the slide entirely. Use it for a diagnostic too long to sit
  after the code.

## Output panels

A `console` or `sql` fence that starts on the line right after the marked
Kotlin fence stays attached to it, as it would inside a hand-written wrapper.
Any other following fence stands on its own.

## What is not a mark

- A `[!…]` comment with a kind the theme does not know stays in the code.
  That includes Shiki's own `[!code …]` notation.
- A mark whose text is not on its line, or that does not parse, is reported
  on the console when the slide is built.
- Marks inside a classic ````md magic-move```` block are not supported. Wrap
  that block in the component instead; marks and components can be mixed in
  one deck.
