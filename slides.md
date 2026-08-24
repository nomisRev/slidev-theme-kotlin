---
theme: ./
highlighter: shiki
transition: view-transition
themeConfig:
  kodee: greeting
---

<!-- @formatter:off -->

# Kotlin Slidev Theme

## A compact showcase of Kotlin-ready slides

`slidev-theme-kotlin`

---
layout: intro
---

# Meet Kodee

The Kotlin mascot is built into every theme layout.

- Choose a mascot variant per slide
- Move it between featured and corner positions
- Use view transitions for a smooth hand-off

---

# Kotlin-first code highlighting

```kotlin
sealed interface Result<out T> {
    data class Success<T>(val value: T) : Result<T>
    data class Failure(val message: String) : Result<Nothing>
}

fun greet(name: String): Result<String> =
    Result.Success("Hello, $name!")
```

---
kodee: false
---

# Kotlin and Gradle fence aliases

<div class="grid grid-cols-3 gap-4 text-sm">
<div>

## `kotlin`

```kotlin
fun main() = println("Kotlin")
```

## `kotlin gradle`

```kotlin gradle
plugins { kotlin("jvm") }
```

</div>
<div>

## `kt`

```kt
val answer = 42
```

## `kt gradle`

```kt gradle
repositories { mavenCentral() }
```

</div>
<div>

## `kts`

```kts
val language = "Kotlin"
```

## `kts gradle`

```kts gradle
kotlin { jvmToolchain(21) }
```

</div>
</div>

---
kodee: false
---

# Tooling fence identities

<div class="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
<div>

## `yaml toolchain`

```yaml toolchain
product: jvm/app
```

## `java`

```java
record User(String name) {}
```

</div>
<div>

## `bash`

```bash
./gradlew test
```

## `xml maven`

```xml maven
<artifactId>demo</artifactId>
```

</div>
</div>

---
kodee: wink
---

# Magic Move for code walkthroughs

````md magic-move
```kotlin
fun <T> List<T>.secondOrNull(): T? = null
```

```kotlin
fun <T> List<T>.secondOrNull(): T? =
    if (size >= 2) this[1] else null
```

```kotlin{2}
fun <T> List<T>.secondOrNull(): T? =
    getOrNull(1)
```
````

---
kodee:
  variant: jumping
  size: large
  position: featured
---

# Animate your story

Kodee can change expression, size, and placement from one slide to the next.

---
kodee: jumping
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

The theme works with Slidev's standard click animations.

</div>

---
layout: two-cols-header
kodee: heart
---

# Compose layouts with familiar Slidev syntax

::left::

## Theme features

- Kotlin branding
- Shiki highlighting
- Kodee animations
- Cover and intro layouts

::right::

```kotlin
val theme = Theme(
    language = "Kotlin",
    mascot = "Kodee",
    slides = "Slidev"
)
```

---
layout: cover
kodee: wave
---

# Ready to present Kotlin

## Install the theme and make it your own

`npm install slidev-theme-kotlin`

---
kodee: sitting
---

# Sit down with Kotlin

Build calm, readable APIs with concise language features.

---
kodee: drinking
---

# Take a Kotlin break

A small expression can still say a lot.

---
kodee: in-love
---

# Fall in love with null safety

Use Kotlin's type system to make invalid states harder to represent.

---
kodee: welcome
---

# Welcome to the Kotlin ecosystem

From server-side services to multiplatform apps, Kotlin meets you where you are.

---
kodee: winter
---

# Kotlin works in every season

Keep your code expressive as your project grows.

---
kodee: tiny
---

# Even tiny Kodee joins in

Every bundled mascot variant is ready to use in your slides.

---
kodee: false
---

# Drawn annotations

`DrawnAnnotation` is bundled with the theme: it can mark an element or exact code text, then explain it with a label or connector.

---
kodee: false
---

# Annotate Kotlin code

<DrawnAnnotation type="circle" text="fun main" label="the entry point of every Kotlin program" :on="1">

```kotlin [Main.kt]
fun main() {
    println("Hello, Kotlin!")
}
```

</DrawnAnnotation>

---
kodee: false
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

<div>Element <b data-source>A</b> is annotated and the arrow lands on <b data-target>B</b>.</div>

</DrawnAnnotation>

---
kodee: false
---

# Four ways to mark something

<DrawnAnnotation type="underline" selector="[data-underline]" :at="1">
<DrawnAnnotation type="circle" selector="[data-circle]" :at="2">
<DrawnAnnotation type="box" selector="[data-box]" :at="3">
<DrawnAnnotation type="strike-through" selector="[data-strike]" :at="4">

- An <b data-underline>underline</b> is the default and quietest mark.
- A <b data-circle>circle</b> emphasizes one thing.
- A <b data-box>box</b> frames an entire phrase.
- A <b data-strike>strike-through</b> crosses out what no longer holds.

</DrawnAnnotation>
</DrawnAnnotation>
</DrawnAnnotation>
</DrawnAnnotation>

---
kodee: false
---

# Labels find room automatically

<DrawnAnnotation type="underline" selector="[data-pinned]" label="pinned by hand" :label-x="78" :label-y="18" :at="1">
<DrawnAnnotation type="underline" selector="[data-quiet]" label="named without a line" :connect="false" placement="right" :at="2">
<DrawnAnnotation type="circle" selector="[data-auto]" label="placed automatically, clear of the other content" :at="3">

> You can <b data-pinned>put a label</b> where you want it.
>
> Or have it <b data-quiet>written on its own</b> with no leader line.
>
> Otherwise it finds <b data-auto>its own place</b> on the slide.

</DrawnAnnotation>
</DrawnAnnotation>
</DrawnAnnotation>

---
kodee: false
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
kodee: false
---

# Sequential marks share one click

<DrawnAnnotation type="circle" selector="[data-circled]" :at="1">
<DrawnAnnotation type="underline" selector="[data-underlined]" :at="1">

The <b data-circled>circle</b> is drawn first; the <b data-underlined>underline</b> follows on the same click.

</DrawnAnnotation>
</DrawnAnnotation>

---
kodee: false
---

# Control the sketch

<DrawnAnnotation type="box" selector="[data-clean]" :options="{ roughness: 0, bowing: 0 }" :iterations="1" placement="right" label="clean geometric strokes" :at="1">
<DrawnAnnotation type="circle" selector="[data-wobbly]" :options="{ roughness: 2.6, seed: 12 }" :stroke-width="4" :duration="1600" color="#eb55e6" placement="right" label="wobblier, slower, and pink" :at="2">

- Any <b data-clean>rough.js option</b> passes straight through.
- Turn <b data-wobbly>roughness up</b> and set the colour, width, and duration yourself.

</DrawnAnnotation>
</DrawnAnnotation>

---
kodee: false
---

# Compiler diagnostics: static code

<InlineCompilerError :line="3" message="Type mismatch: inferred type is String but Int was expected">

```kotlin
fun retryAfter(attempt: Int): Int {
    val delay: Int = "later"
    return attempt + delay
}
```

</InlineCompilerError>

---
kodee: false
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
kodee: false
---

# Compiler diagnostics follow Magic Move

<InlineCompilerError text="displayName" message="Unresolved reference: displayName" :on="1">

````md magic-move
```kotlin
fun welcome(user: User) = user.name
```

```kotlin
fun welcome(user: User) = displayName
```

```kotlin
fun welcome(user: User) = user.displayName
```
````

</InlineCompilerError>

---
kodee: false
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
kodee: false
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
kodee: false
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
kodee: false
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
kodee: false
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
