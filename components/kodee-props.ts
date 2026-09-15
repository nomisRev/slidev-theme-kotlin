/**
 * The Kodee mascot's public options, shared by `Kodee.vue` (as its props) and
 * `KodeeWrapper.vue` (as the shape of the `kodee` frontmatter / themeConfig
 * value), so the two contracts cannot drift apart.
 */
export interface KodeeProps {
  /** Mascot artwork name, with or without the `kodee-` prefix. */
  variant?: string
  size?: 'small' | 'medium' | 'large'
  position?: 'corner' | 'featured' | 'custom'
  /** Left offset in slide pixels; only used with `position: 'custom'`. */
  x?: number
  /** Top offset in slide pixels; only used with `position: 'custom'`. */
  y?: number
  scale?: number
}

export const KODEE_DEFAULTS: Required<Pick<KodeeProps, 'variant' | 'size' | 'position'>> = {
  variant: 'greeting',
  size: 'small',
  position: 'corner',
}

/**
 * Turns a `kodee` frontmatter or themeConfig value into mascot props, or
 * `null` when the slide shows no mascot. A slide-level value wins over the
 * deck-wide theme setting; `true` takes the defaults, a string names the
 * variant, and an object supplies any of the options.
 */
export function resolveKodeeConfig(configured: unknown, defaults: KodeeProps = KODEE_DEFAULTS): KodeeProps | null {
  if (configured === undefined || configured === null || configured === false)
    return null
  if (configured === true)
    return { ...defaults }
  if (typeof configured === 'string')
    return { ...defaults, variant: configured }
  if (typeof configured === 'object') {
    // Only the known options: anything else in the frontmatter object would
    // otherwise fall through `v-bind` onto the mascot's DOM element.
    const { variant, size, position, x, y, scale } = { ...defaults, ...(configured as KodeeProps) }
    return { variant, size, position, x, y, scale }
  }
  return null
}

/** The mascot is the same picture in the same place when this string is unchanged. */
export function kodeeIdentity(config: KodeeProps): string {
  return [config.variant, config.size, config.position, config.x, config.y, config.scale].join('|')
}

/** `cover` and `intro` slides show the mascot large beside the title. */
export function kodeeDefaultsForLayout(layout: string): KodeeProps {
  const featured = layout === 'cover' || layout === 'intro'
  return { ...KODEE_DEFAULTS, size: featured ? 'large' : 'small', position: featured ? 'featured' : 'corner' }
}

/** Slidev gives the first slide the `cover` layout without it being declared. */
export function slideLayout(frontmatter: Record<string, any> | undefined, page: number): string {
  return frontmatter?.layout ?? (page === 1 ? 'cover' : 'default')
}
