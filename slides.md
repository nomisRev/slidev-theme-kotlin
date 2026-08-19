---
theme: ./
highlighter: shiki
transition: view-transition
---

# Kotlin Slidev Theme

## A compact showcase of Kotlin-ready slides

`slidev-theme-kotlin`

---
layout: intro
kodee:
  variant: greeting
  size: large
  position: featured
---

# Meet Kodee

The Kotlin mascot is built into every theme layout.

- Choose a mascot variant per slide
- Move it between featured and corner positions
- Use view transitions for a smooth hand-off

---
kodee:
  variant: greeting
  size: small
  position: corner
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
kodee:
  variant: wink
  size: small
  position: corner
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
kodee:
  variant: jumping
  size: small
  position: corner
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
kodee:
  variant: heart
  size: small
  position: corner
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
kodee:
  variant: wave
  size: large
  position: featured
---

# Ready to present Kotlin

## Install the theme and make it your own

`npm install slidev-theme-kotlin`
