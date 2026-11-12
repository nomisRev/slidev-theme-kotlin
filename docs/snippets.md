# Compiling the snippets

A Kotlin fence on a slide is a fragment: it carries its imports (folded away
on the slide) but no package, and it may mix declarations with bare
statements. `slidev-kotlin-snippets` turns Kotlin and Java fences into source
files, in the spirit of [KotlinX Knit](https://github.com/Kotlin/kotlinx-knit),
so a Gradle module can compile the deck's code against the real libraries. A
stale slide then fails the build instead of the talk.

## Setup

Turn it on in the headmatter:

```yaml
themeConfig:
  snippets:
    dir: src/main/kotlin/presentation/snippets   # default: src/main/kotlin/snippets
    javaDir: src/main/java/presentation/snippets  # default: src/main/java/snippets
    package: presentation.snippets               # default: snippets
    imports:                                     # added to every file
      - presentation.support.*
```

Run the CLI from the deck:

```bash
npx slidev-kotlin-snippets            # writes the files, removes stale ones
npx slidev-kotlin-snippets --check    # exits 1 when they are out of date (CI)
npx slidev-kotlin-snippets talk.md    # another entry than slides.md
```

Wire it into Gradle so `./gradlew check` also fails on stale sources:

```kotlin
val snippetsCheck by tasks.registering(Exec::class) {
    commandLine("npx", "slidev-kotlin-snippets", "--check")
}
tasks.check { dependsOn(snippetsCheck) }
```

## Which fences are skipped

- Add `no-compile` to a fence that sketches library internals or an
  intermediate step: `` ```kotlin no-compile ``. The flag is removed before
  the slide is rendered.
- A fence inside an `InlineCompilerError`, or with an `[!error …]` code mark,
  is skipped: the slide shows the diagnostic on purpose.
- `gradle` build-script fences are skipped.

## Where the files go

Each Kotlin fence becomes `<dir>/<section>/<slide>-<title>.kt`, and each Java
fence `<javaDir>/<section>/<slide>-<title>.java`.

Every file has the package `<package>.<section>.slide<n>`, so each step of a
Magic Move chain can declare its own `object Talks`. A Java and a Kotlin
fence on the same slide share that package on purpose, so Java ↔ Kotlin
interop examples compile.

A slide with several fences in the same language tells them apart by their
first meta word (`jdbc`, `r2dbc`) or a letter.

## What is in a file

**Imports.** The fence's imports come first, after the `imports` from the
config. Keep the tables, types, and values that the slides use without
defining them in a hand-written package, and star-import it. A fence that
defines its own `Talks` shadows the shared one, because a declaration in the
file's own package wins over a star import.

**Kotlin.** Top-level declarations (`fun`, `val`, `object`, `class`, … with
their annotations, modifiers, and `context(...)` lines) stay top-level. Bare
statements such as `Talks.selectAll()` are wrapped in `suspend fun main()`. A
`package` line is dropped, and `@file:` annotations move above the package.

**Java.** A Java fence is emitted as a compilation unit with the generated
package and imports, so it must contain declarations rather than bare
statements. Its own `package` line is replaced.

- A fence that declares a public top-level type is named after that type, as
  Java requires. Otherwise it uses the slide-based filename.
- When a later slide of the same section declares a public type that an
  earlier slide already declared, its file goes in a directory named after
  the slide, so both compile.
