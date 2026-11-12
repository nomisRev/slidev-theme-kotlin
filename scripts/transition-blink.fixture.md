---
theme: ./
highlighter: shiki
transition: __TRANSITION__
themeConfig:
  kodee: false
---

<!-- @formatter:off -->

# Transition blink fixture

Every chain below keeps its annotated lines where they are and only appends
code under them. Nothing that is annotated moves, so nothing may blink.

---

# suspend

```kotlin no-compile
suspend fun program() {
  val events = events() // [!suspend]
  events.process() // [!suspend]
}
```

---
magic-move
---

# suspend

```kotlin no-compile
suspend fun program() {
  val events = events() // [!suspend]
  events.process() // [!suspend]
  println("done")
}

suspend fun other() = Unit
```

---

# lambda hints

```kotlin no-compile
fun Application.module() = routing { // [!this Routing]
  get("/") { call.respondText("ok") } // [!this RoutingContext]
  transaction { // [!context Transaction]
    insert()
  }
}
```

---
magic-move
---

# lambda hints

```kotlin no-compile
fun Application.module() = routing { // [!this Routing]
  get("/") { call.respondText("ok") } // [!this RoutingContext]
  transaction { // [!context Transaction]
    insert()
  }
  println("done")
}

fun other() = Unit
```

---

# type hint

```kotlin no-compile
object Users : Table() {
  val name = varchar("name", 50) // [!type name Column<String>]
}
```

---
magic-move
---

# type hint

```kotlin no-compile
object Users : Table() {
  val name = varchar("name", 50) // [!type name Column<String>]
  val age = integer("age")
}

fun other() = Unit
```

---

# smart cast

```kotlin no-compile
fun render(result: Result) = when (result) {
  is Success -> respond(result.user) // [!smartcast result]
  is Failure -> fail(result.error) // [!smartcast result smart cast to `Failure`]
}
```

---
magic-move
---

# smart cast

```kotlin no-compile
fun render(result: Result) = when (result) {
  is Success -> respond(result.user) // [!smartcast result]
  is Failure -> fail(result.error) // [!smartcast result smart cast to `Failure`]
  else -> error("unreachable")
}

fun other() = Unit
```

---

# warning

```kotlin no-compile
data class Post(
  val tags: Array<String>, // [!warning tags Property with 'Array' type]
)
```

---
magic-move
---

# warning

```kotlin no-compile
data class Post(
  val tags: Array<String>, // [!warning tags Property with 'Array' type]
  val title: String,
)

fun other() = Unit
```

---

# compiler error

```kotlin
fun total(): Int {
  return "three" // [!error "three" Type mismatch: `String` but `Int` was expected]
}
```

---
magic-move
---

# compiler error

```kotlin
fun total(): Int {
  return "three" // [!error "three" Type mismatch: `String` but `Int` was expected]
}

fun other() = Unit
```

---

# inline value

```kotlin no-compile
fun main() {
  val numbers = listOf(1, 2, 3) // [!value numbers numbers: [1, 2, 3]]
}
```

---
magic-move
---

# inline value

```kotlin no-compile
fun main() {
  val numbers = listOf(1, 2, 3) // [!value numbers numbers: [1, 2, 3]]
  println(numbers)
}

fun other() = Unit
```

---

# drawn annotation

<DrawnAnnotation type="underline" text="fun main" label="the entry point" />
<DrawnAnnotation type="circle" text="println" />

```kotlin no-compile
fun main() {
  println("hello")
}
```

---
magic-move
---

# drawn annotation

<DrawnAnnotation type="underline" text="fun main" label="the entry point" />
<DrawnAnnotation type="circle" text="println" />

```kotlin no-compile
fun main() {
  println("hello")
  println("world")
}

fun other() = Unit
```

---

# everything together

<DrawnAnnotation type="underline" text="suspend fun" label="a suspending handler" />

```kotlin no-compile
suspend fun Application.users() = routing { // [!this Routing]
  val result = insertUser(body) // [!suspend]
  when (result) {
    is Success -> respond(result.user) // [!smartcast result]
  }
}
```

---
magic-move
---

# everything together

<DrawnAnnotation type="underline" text="suspend fun" label="a suspending handler" />

```kotlin no-compile
suspend fun Application.users() = routing { // [!this Routing]
  val result = insertUser(body) // [!suspend]
  when (result) {
    is Success -> respond(result.user) // [!smartcast result]
    AlreadyExists -> fail(UserAlreadyExists)
  }
  audit() // [!suspend]
}
```

---

# classic block

<SuspendGutter :lines="[2]">
<TypeHint :line="1" receiver="Routing">
<SmartCast :line="3" text="result">

````md magic-move
```kotlin
suspend fun Application.users() = routing {
  val result = insertUser(body)
  if (result is Success) respond(result.user)
}
```

```kotlin
suspend fun Application.users() = routing {
  val result = insertUser(body)
  if (result is Success) respond(result.user)
  audit()
}
```
````

</SmartCast>
</TypeHint>
</SuspendGutter>

---

# classic block, overlays

<DrawnAnnotation type="underline" text="fun total" label="stays put">
<InlineCompilerError text="&quot;three&quot;" message="Type mismatch">
<InlineValue :line="1" text="fun total" value="total: 3">

````md magic-move
```kotlin
fun total(): Int {
  return "three"
}
```

```kotlin
fun total(): Int {
  return "three"
}

fun other() = Unit
```
````

</InlineValue>
</InlineCompilerError>
</DrawnAnnotation>

---

# lines that move

<DrawnAnnotation type="circle" text="insertUser" />

```kotlin no-compile
suspend fun Application.users() = routing { // [!this Routing]
  val result = insertUser(body) // [!suspend]
  if (result is Success) respond(result.user) // [!smartcast result smart cast]
}
```

---
magic-move
---

# lines that move

<DrawnAnnotation type="circle" text="insertUser" />

```kotlin no-compile
suspend fun Application.users() = routing { // [!this Routing]
  val body = receive<User>() // [!suspend]
  log(body)
  val result = insertUser(body) // [!suspend]
  if (result is Success) respond(result.user) // [!smartcast result smart cast]
}
```

---

# annotations that come and go

<DrawnAnnotation type="underline" text="fun main" label="only on the first slide" />

```kotlin no-compile
fun main() {
  println("hello") // [!value println only here]
}
```

---
magic-move
---

# annotations that come and go

<DrawnAnnotation type="circle" text="println" label="only on the second slide" />

```kotlin no-compile
fun main() {
  println("hello")
  val numbers = listOf(1, 2, 3) // [!value numbers numbers: [1, 2, 3]] [!suspend]
}
```

---

# drawn annotation, same saved geometry

<DrawnAnnotation type="underline" text="fun main" label="the entry point" :geometry="{ label: { x: 0.45, y: 0.6 } }" />

```kotlin no-compile
fun main() {
  println("hello")
}
```

---
magic-move
---

# drawn annotation, same saved geometry

<DrawnAnnotation type="underline" text="fun main" label="the entry point" :geometry="{ label: { x: 0.45, y: 0.6 } }" />

```kotlin no-compile
fun main() {
  println("hello")
  println("world")
}

fun other() = Unit
```

---

# drawn annotation, label placed elsewhere

<DrawnAnnotation type="underline" text="fun main" label="the entry point" :geometry="{ label: { x: 0.45, y: 0.6 } }" />

```kotlin no-compile
fun main() {
  println("hello")
}
```

---
magic-move
---

# drawn annotation, label placed elsewhere

<DrawnAnnotation type="underline" text="fun main" label="the entry point" :geometry="{ label: { x: 0.6, y: 0.75 } }" />

```kotlin no-compile
fun main() {
  println("hello")
  println("world")
}

fun other() = Unit
```

---

# end
