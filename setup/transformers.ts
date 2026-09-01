import type { CodeblockTransformContext } from '@slidev/types'
import { defineCodeblockTransformer, defineTransformersSetup } from '@slidev/types'
import { toKeyedTokens } from '@shikijs/magic-move/core'
import lz from 'lz-string'
import { codeWindowIcon } from './code-window-icon'
import { extractTopLevelFences, resolveChain } from './magic-move-between'
import type { ParsedFence } from './magic-move-between'

// Magic Move serialises Shiki tokens instead of its regular HAST output, so the
// Shiki transformer cannot put the code-window icon class on it. Add the class
// as a fallthrough attribute on Slidev's ShikiMagicMove component instead.
const magicMove = /^(`{4,})(?:md|markdown) magic-move(?<suffix>[^\r\n]*)\r?\n(?<body>[\s\S]*?)^\1\s*$/gm
const magicMoveOptions = /^(?<before>\s*(?:\[[^\]]*\])?\s*)(?<options>\{[^}\r\n]*\})?(?<after>\s*)$/
const innerFence = /^```([\w'-]+)(?:[ \t]+([^\r\n]*))?\r?$/gm

function iconForMagicMove(body: string) {
  const fences = [...body.matchAll(innerFence)]
  const icons = fences.map(([, language, meta = '']) => codeWindowIcon(language, meta))

  // One wrapper represents every step. Only show an identity when it remains
  // true for all of them; a Java-to-Kotlin walkthrough must not claim either.
  if (!icons.length || icons.some(icon => !icon) || !icons.every(icon => icon === icons[0]))
    return
  return icons[0]
}

function withIconClass(options: string | undefined, icon: string) {
  const className = `'code-window-icon--${icon}'`
  if (!options)
    return `{ class: ${className} }`

  // Keep a class explicitly supplied by the deck author. Vue normalises this
  // array when the attribute falls through to ShikiMagicMove's root element.
  return `{ ...(${options}), class: [(${options}).class, ${className}] }`
}

/**
 * Escape a value for a double-quoted HTML attribute. Vue's template compiler
 * decodes entities in attribute values, so quotes inside fence titles or
 * options (`[Bob's file.kt]`, `{at:"+2"}`) survive instead of terminating the
 * attribute and breaking the slide's markup.
 */
function attributeValue(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * Duplicate identical fences on one slide would all match the same
 * `findIndex` result, sharing one nav-key (duplicate view-transition-names
 * cancel the transition) and morphing every copy like the first. Slidev
 * transforms a slide's fences in document order within each compile pass, so
 * a cycling cursor per (slide, fence identity) assigns each duplicate its own
 * position on every pass, including HMR re-compiles.
 */
const duplicateFenceCursor = new Map<string, number>()

/**
 * Cross-slide Magic Move: replace every top-level code fence of a slide that
 * belongs to a `magic-move` chain (see `magic-move-between.ts`) with a
 * `<MagicMoveBetween>` component. The component receives every step of the
 * chain precompiled, pinned at this slide's step, and animates the tokens
 * when the presentation navigates between the chained slides.
 */
const magicMoveBetween = defineCodeblockTransformer(async (ctx: CodeblockTransformContext) => {
  const { info, code, fence, slide, options } = ctx
  if (fence !== 3 || !slide)
    return
  const slides = options.data.slides
  const chain = resolveChain(slides, slide.index)
  if (!chain)
    return

  const fencesPerSlide = [] as ParsedFence[][]
  for (let i = chain.start; i <= chain.end; i++)
    fencesPerSlide.push(extractTopLevelFences(slides[i].content))

  // Locate the fence being rendered among this slide's fences. Its position
  // decides which fences of the neighbouring slides it morphs to and from.
  const own = fencesPerSlide[slide.index - chain.start]
  const codeKey = code.replace(/\r?\n$/, '')
  let matches = own.map((f, index) => index).filter(index => own[index].code === codeKey && own[index].info === info)
  if (!matches.length)
    matches = own.map((f, index) => index).filter(index => own[index].code === codeKey)
  if (!matches.length)
    return
  let groupIndex = matches[0]
  if (matches.length > 1) {
    const cursorKey = `${slide.index}|${info}|${codeKey}`
    const cursor = duplicateFenceCursor.get(cursorKey) ?? 0
    duplicateFenceCursor.set(cursorKey, cursor + 1)
    groupIndex = matches[cursor % matches.length]
  }

  const steps = [] as ParsedFence[]
  const stepPages = [] as number[]
  let ownStep = -1
  fencesPerSlide.forEach((fences, slideOffset) => {
    const f = fences[groupIndex]
    if (!f)
      return
    if (slideOffset === slide.index - chain.start)
      ownStep = steps.length
    steps.push(f)
    // The 1-based page each step belongs to. A chain slide without a fence at
    // this position contributes no step, so page adjacency alone cannot tell
    // the component which step a navigation actually came from.
    stepPages.push(chain.start + slideOffset + 1)
  })
  if (steps.length < 2 || ownStep < 0)
    return

  const { utils: { shiki, shikiOptions }, data: { config } } = options
  const compiled = await Promise.all(steps.map(async (f) => {
    const stepOptions = { ...shikiOptions, lang: f.lang }
    const { tokens, bg, fg, rootStyle, themeName } = await shiki.codeToTokens(f.code, stepOptions as any)
    const lineNumbers = f.lines ?? config.lineNumbers
    const theme = 'themes' in stepOptions ? stepOptions.themes : (stepOptions as any).theme
    return {
      ...toKeyedTokens(f.code, tokens, JSON.stringify([f.lang, theme]), lineNumbers),
      bg,
      fg,
      rootStyle,
      themeName,
      lang: f.lang,
    }
  }))

  // One component represents every step, so only claim a code-window identity
  // when it holds for all of them (same rule as classic magic-move blocks).
  const icons = steps.map(f => codeWindowIcon(f.lang, f.meta))
  const icon = icons.every(i => i && i === icons[0]) ? icons[0] : undefined

  const ownFence = own[groupIndex]
  const attrs = [
    `steps-lz="${lz.compressToBase64(JSON.stringify(compiled))}"`,
    `:step="${ownStep}"`,
    `:step-pages="${attributeValue(JSON.stringify(stepPages))}"`,
    // Shared across the chain so the View Transitions API pairs the old and
    // new code windows instead of cross-fading them with the page.
    `nav-key="magic-move-between-${chain.start}-${groupIndex}"`,
    `:title="${attributeValue(JSON.stringify(ownFence.title ?? ''))}"`,
  ]
  // `{1|2-3}` highlight ranges step through on clicks within this slide, just
  // like they do for one step of a classic magic-move block.
  if (ownFence.ranges.length)
    attrs.push(`:step-ranges="${attributeValue(JSON.stringify(ownFence.ranges))}"`)
  // Fence options (`{at:2, duration:500}`) become props, like the options of
  // a classic magic-move block.
  if (ownFence.optionsRaw)
    attrs.unshift(`v-bind="${attributeValue(ownFence.optionsRaw)}"`)
  if (icon)
    attrs.push(`class="code-window-icon--${icon}"`)
  return `<MagicMoveBetween ${attrs.join(' ')} />`
})

export default defineTransformersSetup(() => ({
  codeblocks: [magicMoveBetween],
  pre: [({ s }) => {
    const source = s.toString()
    for (const block of source.matchAll(magicMove)) {
      const icon = iconForMagicMove(block.groups?.body ?? '')
      const suffix = block.groups?.suffix ?? ''
      const options = suffix.match(magicMoveOptions)
      if (!icon || !options || block.index === undefined)
        continue

      const headerEnd = block[0].search(/\r?\n/)
      const start = block.index + headerEnd - suffix.length
      const replacement = `${options.groups?.before ?? ''}${withIconClass(options.groups?.options, icon)}${options.groups?.after ?? ''}`
      if (suffix)
        s.overwrite(start, start + suffix.length, replacement)
      else
        s.appendLeft(start, replacement)
    }
  }],
}))
