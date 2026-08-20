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
