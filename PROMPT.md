Can you build support for 'magic-move' between slides?
Currently, we do `current-state` but we would like instead like to do `new-supported-state`

<example id="current-state">

---

# My Slide

````md magic-move
```kotlin
class Person
```

```kotlin
class Person(val name: String)
```

```kotlin
class Person(val name: String) {
    fun introduce() = println("I am $name")
}
```
````

---

</example>

While it would be more flexible if we could do:

<example id="new-state">

---

# My Slide

```kotlin magic-move
class Person
```

---
magic-move
---

# My Slide

```kotlin magic-move
class Person(val name: String)
```

---
magic-move
---

# My Slide

```kotlin
class Person(val name: String) {
    fun introduce() = println("I am $name")
}
```

---

</example>

That way we could also do where we have two 'parallel' snippets.

<example id="new-state-double-snippet">

---

# My Slide

```kotlin
class Person
```
```sql
CREATE TABLE PERSON
```

---
magic-move
---

# My Slide

```kotlin
class Person(val name: String)
```
```sql
CREATE TABLE PERSON(
    name VARCHAR(255) NOT NULL
)
```

---
magic-move
---

# My Slide

```kotlin
class Person(val name: String) {
    fun introduce() = println("I am $name")
}
```
```sql
CREATE TABLE PERSON(
    name VARCHAR(255) NOT NULL
)
```

---

</example>

