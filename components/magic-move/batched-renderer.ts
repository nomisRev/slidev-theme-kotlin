import type { KeyedTokensInfo, MagicMoveRenderOptions } from '@shikijs/magic-move/types'
import { syncTokenKeys, toKeyedTokens } from '@shikijs/magic-move/core'
import { MagicMoveRenderer } from '@shikijs/magic-move/renderer'
import { computed, defineComponent, h, nextTick, onMounted, ref, renderList, watch } from 'vue'

/**
 * Shiki's renderer waits for a token's transitions with `el.getAnimations()`,
 * once per token, right after starting three transitions on every token. The
 * browser answers each call by walking every running animation in the
 * document, so a window of 138 tokens costs 138 × 414 checks: about 50 ms of
 * the frame, which is most of the stutter on the larger chain slides. This
 * renderer walks the running animations once per render and hands every
 * token its own share.
 */
export class BatchedMagicMoveRenderer extends MagicMoveRenderer {
  private readonly root: HTMLElement
  private animationsByTarget: Map<Element, Animation[]> | undefined

  constructor(target: HTMLElement, options?: MagicMoveRenderOptions) {
    super(target, options)
    this.root = target
  }

  private animationsFor(el: Element): Animation[] {
    if (!this.animationsByTarget) {
      const byTarget = new Map<Element, Animation[]>()
      for (const animation of this.root.getAnimations({ subtree: true })) {
        const target = (animation.effect as KeyframeEffect | null)?.target
        if (!target)
          continue
        const list = byTarget.get(target)
        if (list)
          list.push(animation)
        else
          byTarget.set(target, [animation])
      }
      this.animationsByTarget = byTarget
      // `render` invokes every registered waiter in one synchronous loop right
      // after its reflow; the shared snapshot is dropped as soon as that loop
      // has finished.
      queueMicrotask(() => this.animationsByTarget = undefined)
    }
    return this.animationsByTarget.get(el) ?? []
  }

  // Upstream declares this method private, but `render` calls it through the
  // instance, so an override takes effect. Same contract as upstream: returns
  // a factory that, once invoked, resolves when the element's animations end,
  // and can be resolved early through `promise.resolve` when the next render
  // interrupts this one.
  // @ts-expect-error private in the upstream declaration
  private registerTransitionEnd(el: HTMLElement, cb: () => void) {
    return () => {
      let resolved = false
      let resolve = () => {}
      const promise = Promise.race([
        Promise.allSettled(this.animationsFor(el).map(animation => animation.finished)).then(() => cb()),
        new Promise<void>((_resolve) => {
          resolve = () => {
            if (resolved)
              return
            resolved = true
            cb()
            _resolve()
          }
        }),
      ]) as Promise<unknown> & { resolve: () => void }
      promise.resolve = resolve
      return promise
    }
  }
}

/**
 * `ShikiMagicMoveRenderer` from `@shikijs/magic-move/vue`, on the batched
 * renderer. The upstream component constructs its renderer itself, so this
 * is the same component with that one line changed.
 */
export const BatchedMagicMoveRendererComponent = defineComponent({
  name: 'BatchedMagicMoveRenderer',
  props: {
    animate: { type: Boolean, default: true },
    tokens: { type: Object as () => KeyedTokensInfo, required: true },
    previous: { type: Object as () => KeyedTokensInfo, required: false },
    options: { type: Object as () => MagicMoveRenderOptions },
  },
  emits: ['end', 'start'],
  setup(props, { emit }) {
    const container = ref<HTMLElement>()
    let isMounted = false
    onMounted(() => {
      container.value!.innerHTML = ''
      isMounted = true
      const renderer = new BatchedMagicMoveRenderer(container.value!)
      watch(() => props.tokens, async (tokens) => {
        Object.assign(renderer.options, props.options)
        if (props.animate) {
          if (props.previous)
            renderer.replace(props.previous)
          await nextTick()
          const process = renderer.render(tokens)
          await nextTick()
          emit('start')
          await process
          emit('end')
        }
        else {
          renderer.replace(tokens)
        }
      }, { immediate: true })
    })
    return () => h(
      'pre',
      { ref: container, class: 'shiki-magic-move-container' },
      // Initial tokens for SSR and the first paint, as upstream renders them.
      isMounted
        ? undefined
        : renderList(props.tokens.tokens, (token) => {
            if (token.content === '\n')
              return h('br', { key: token.key })
            return h('span', {
              style: [{ color: token.color }, token.htmlStyle],
              class: ['shiki-magic-move-item', token.htmlClass],
              key: token.key,
            }, token.content)
          }),
    )
  },
})

/** `ShikiMagicMovePrecompiled` from `@shikijs/magic-move/vue`, on the batched renderer. */
export const MagicMovePrecompiled = defineComponent({
  name: 'MagicMovePrecompiled',
  props: {
    steps: { type: Array as () => KeyedTokensInfo[], required: true },
    step: { type: Number, default: 0 },
    animate: { type: Boolean, default: true },
    options: { type: Object as () => MagicMoveRenderOptions, default: () => ({}) },
  },
  emits: ['start', 'end'],
  setup(props, { emit }) {
    const EMPTY = toKeyedTokens('', [])
    let previous = EMPTY
    const result = computed(() => {
      const res = syncTokenKeys(previous, props.steps[Math.min(props.step, props.steps.length - 1)], props.options)
      previous = res.to
      return res
    })
    return () => h(BatchedMagicMoveRendererComponent, {
      tokens: result.value.to,
      previous: result.value.from,
      options: props.options,
      animate: props.animate,
      onStart: () => emit('start'),
      onEnd: () => emit('end'),
    })
  },
})
