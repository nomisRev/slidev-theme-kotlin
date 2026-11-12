---
theme: ./
highlighter: shiki
transition: fade
title: Regression fixtures
---

<!-- @formatter:off -->

# Regression fixtures

Edge cases that `npm run visual:review` captures next to `slides.md`. This deck is not published.

---

# Kotlin and Gradle fence aliases

## `kotlin`

```kotlin
fun main() = println("Kotlin")
```

---

# Kotlin and Gradle fence aliases

## `kotlin gradle`

```kotlin gradle
plugins { kotlin("jvm") }
```

---

# Kotlin and Gradle fence aliases

## `kt`

```kt
val answer = 42
```

---

# Kotlin and Gradle fence aliases

## `kt gradle`

```kt gradle
repositories { mavenCentral() }
```

---

# Kotlin and Gradle fence aliases

## `kts`

```kts
val language = "Kotlin"
```

---

# Kotlin and Gradle fence aliases

## `kts gradle`

```kts gradle
kotlin { jvmToolchain(21) }
```

---

# Tooling fence identities

## `yaml toolchain`

```yaml toolchain
product: jvm/app
```

---

# Tooling fence identities

## `java`

```java
record User(String name) {}
```

---

# Tooling fence identities

## `bash`

```bash
./gradlew test
```

---

# Tooling fence identities

## `xml maven`

```xml maven
<artifactId>demo</artifactId>
```

---

# Tooling fence identities

## `sql`

```sql
SELECT * FROM presentations;
```

---

# Sequential marks share one click

<DrawnAnnotation type="circle" selector="[data-circled]" :at="1">
<DrawnAnnotation type="underline" selector="[data-underlined]" :at="1">

The <b data-circled>circle</b> is drawn first; the <b data-underlined>underline</b> follows on the same click.

</DrawnAnnotation>
</DrawnAnnotation>

---

# Compiler diagnostics: exact and repeated text

<InlineCompilerError text="accountId" :occurrence="2" message="Unresolved reference: accountId" :on="1">

```kotlin
val accountId = request.accountId
val audit = accountId.toString()
println(accountId)
```

</InlineCompilerError>

The second occurrence is the diagnostic target; the first two clicks leave the code untouched.

---

# Compiler diagnostics: several lines

<InlineCompilerError text="when (state) {\n    Loading -> spinner()\n    is Content -> state.text\n  }" message="'when' expression must be exhaustive.\nAdd the 'is Error' branch or an 'else' branch" :on="1">

```kotlin
fun render(state: UiState): String =
  when (state) {
    Loading -> spinner()
    is Content -> state.text
  }
```

</InlineCompilerError>

`\n` in `text` continues the match on the next source line, indentation included; each line gets its own squiggle and the message sits after the first.

---

# Explicit label sides are directional

<DrawnAnnotation type="circle" selector="[data-up]" placement="up" label="up stays above" :on="1">
<DrawnAnnotation type="circle" selector="[data-right]" placement="right" label="right stays right" :on="2">
<DrawnAnnotation type="circle" selector="[data-down]" placement="down" label="down stays below" :on="3">
<DrawnAnnotation type="circle" selector="[data-left]" placement="left" label="left stays left" :on="4">

<div style="margin: 230px 180px; display: grid; grid-template-columns: repeat(2, 180px); gap: 70px; text-align: center">
  <b data-up>up</b><b data-right>right</b><b data-left>left</b><b data-down>down</b>
</div>

</DrawnAnnotation>
</DrawnAnnotation>
</DrawnAnnotation>
</DrawnAnnotation>

---

# Automatic labels share the free space

<DrawnAnnotation selector="[data-first]" type="underline" placement="auto" label="first annotation" avoid-selector="[data-reserved]" :at="1" :until="5">
<DrawnAnnotation selector="[data-second]" type="circle" placement="auto" label="second annotation remains clear" :at="2" :until="5">
<DrawnAnnotation selector="[data-third]" type="box" placement="auto" label="third annotation has a longer label that may wrap" :at="3" :until="5">

<div class="grid grid-cols-2 gap-10">
<div>

- A <b data-first>persistent first label</b> starts the discussion.
- A <b data-second>second label</b> overlaps it in time.
- The <b data-third>third label</b> has the least room.

</div>
<div data-reserved style="border: 3px dashed var(--slidev-theme-primary, #7954f6); padding: 1.5rem">

### Reserved teaching space

`avoid-selector` keeps labels out of this arbitrary element.

</div>
</div>

</DrawnAnnotation>
</DrawnAnnotation>
</DrawnAnnotation>

---

# Later clicks are label obstacles

<DrawnAnnotation type="underline" selector="[data-source]" placement="auto" label="This label remains clear when the detail appears" :at="1" :until="4">

<div class="grid grid-cols-2 gap-12">
<div>

## Immutable configuration

The <b data-source>configuration value</b> is read once at startup.

</div>
<div>

<div v-click="2" class="card">

### Later detail

A later click introduces this explanation. A persistent label must not cover it.

</div>
</div>
</div>

</DrawnAnnotation>

---

# A label belongs to its Magic Move step

<DrawnAnnotation text="val token" placement="down" label="a read-only local value" :on="1">

````md magic-move [Session.kt]
```kotlin
fun session() = connect()
```

```kotlin
fun session(): String {
    val token = connect()
    return token
}
```

```kotlin
fun session(): String = connect()
```
````

</DrawnAnnotation>

---

# Leader lines do not become lassos

<DrawnAnnotation type="circle" text="remove" placement="down" label="remove only the matching entry" :on="1" arrow>

```kotlin
fun prune(values: MutableList<String>, remove: String) {
    values.remove(remove)
    println("removed $remove")
}
```

</DrawnAnnotation>

The requested down placement is deliberate: it must remain below the source or fail cleanly, never drift into the code panel.

---

# Smart casts

<SmartCast text="nullable.length" :at="1">

```kotlin
val nullable: String? = null
val length =
  if (nullable != null) nullable.length
  else -1
```

</SmartCast>

Every decoration is also a component, for when it should appear on a click.

---

# Warnings

<Warning text="greeting" message="Variable 'greeting' is never used" :at="1">

```kotlin
fun greet(name: String) {
    val greeting = "Hello"
    println("Hello, $name!")
}
```

</Warning>

The yellow background marks the code, and the message sits after the line.

---

# Compiler errors

<InlineCompilerError :line="2" message="Type mismatch: inferred type is `String` but `Int` was expected">

```kotlin
fun retryAfter(attempt: Int): Int {
    val delay: Int = "later"
    return attempt + delay
}
```

</InlineCompilerError>

Point at a line, or at the exact text that is wrong.

---

# Type hints name the receiver

<TypeHint :line="1" receiver="HTML">
<TypeHint :line="2" receiver="BODY" :at="1">
<TypeHint :line="3" receiver="P" :at="2">

```kotlin
html {
  body {
    p {
      +"Hello"
    }
  }
}
```

</TypeHint>
</TypeHint>
</TypeHint>

The grey `this:` pill makes a DSL readable for people who have not seen it before.

---

# Labels find their own place

<DrawnAnnotation type="underline" selector="[data-pinned]" label="placed near its mark" :at="1">
<DrawnAnnotation type="underline" selector="[data-quiet]" label="named without a line" :connect="false" placement="right" :at="2">
<DrawnAnnotation type="circle" selector="[data-auto]" label="or dragged where you want it" :at="3">

> A label <b data-pinned>lands next to its mark</b> by default.
>
> It can be <b data-quiet>written on its own</b>, with no line to the mark.
>
> And the visual editor lets you <b data-auto>drag it anywhere</b> on the slide.

</DrawnAnnotation>
</DrawnAnnotation>
</DrawnAnnotation>

---

# Connect two elements

<DrawnAnnotation
  source-type="circle"
  selector="[data-source]"
  target="[data-target]"
  :target-mark="false"
  arrow
  label="B follows from A"
  :at="1"
  :label-at="2"
>

<div>Element <b data-source>A</b> is circled and the arrow lands on <b data-target>B</b>.</div>

</DrawnAnnotation>

The arrow is drawn on the first click, its label on the second.

---

# Annotate a Magic Move step

<DrawnAnnotation type="underline" text="val greeting" label="read-only; its type is inferred" insert :on="2">

````md magic-move [Main.kt]
```kotlin [Main.kt]
fun main() {
    println("Hello, Kotlin!")
}
```

```kotlin [Main.kt]
fun main() {
    val greeting = "Hello, Kotlin!"
    println(greeting)
}
```

```kotlin [Main.kt]
fun main() {
    val greeting = "Hello, Kotlin!"
    println(greeting.uppercase())
}
```
````

</DrawnAnnotation>

---

# Pick one of several matches

When the text repeats, name its line instead of counting every earlier match.

<DrawnAnnotation type="box" text="$remove" :line="3" placement="down" label="`line` names the line to search" :at="1">
<DrawnAnnotation type="circle" text="remove" :line="2" occurrence="2" placement="down" label="`occurrence` counts on that line" :at="2">

```kotlin
fun prune(values: MutableList<String>, remove: String) {
    values.remove(remove)
    println("removed $remove")
}
```

</DrawnAnnotation>
</DrawnAnnotation>

---

# Control the sketch

<DrawnAnnotation type="box" selector="[data-clean]" :options="{ roughness: 0, bowing: 0 }" :iterations="1" placement="right" label="`roughness: 0`" :at="1">
<DrawnAnnotation type="circle" selector="[data-wobbly]" :options="{ roughness: 2.6, seed: 12 }" :stroke-width="4" :duration="1600" color="#eb55e6" placement="right" label="wobblier, slower, and pink" :at="2">

Any rough.js option passes straight through, for <b data-clean>clean lines</b>

<div class="mt-16">

Or turn the roughness up, and set the colour, width, and duration <b data-wobbly>yourself</b>

</div>

</DrawnAnnotation>
</DrawnAnnotation>

---

# Reveal details as you present

<div v-click>

```kotlin
val language = "Kotlin"
```

</div>

<div v-click="2">

```kotlin
val message = "Hello, $language!"
```

</div>

<div v-click="3">

Slidev's click animations work as they always do.

</div>

---

# Magic Move between slides

Put `magic-move` in the separator between two slides and the code morphs across them.

```kotlin
class Person
```

---
magic-move
---

# Magic Move between slides

Each step is a full slide, so the title and the text can change with the code.

```kotlin
class Person(val name: String)
```

---
magic-move
---

# Magic Move between slides

Line highlighting such as `{all|2}` still steps through on clicks.

```kotlin {all|2}
class Person(val name: String) {
    fun introduce() = println("I am $name")
}
```
