import { defineTransformersSetup } from '@slidev/types'
import { codeWindowIcon } from './code-window-icon'

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

export default defineTransformersSetup(() => ({
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
