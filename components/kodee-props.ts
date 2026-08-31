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
