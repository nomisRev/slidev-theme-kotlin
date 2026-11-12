import type { AppContext } from '@slidev/types'
import { addSyncMethod, disableBuiltinSync } from '@slidev/client/state/syncState.ts'
import { watch } from 'vue'
// @ts-ignore Slidev's virtual module, typed by @slidev/client's shim when it is loaded
import { slides } from '#slidev/slides'
import { remoteConnection } from '../remote/connection'

interface RemoteState { page: number, clicks: number }

const requestTimeout = 4000

/**
 * Navigation sync for a deck served by `slidev-kotlin-present` (see
 * `bin/present.mjs`). The server marks its pages with
 * `window.__slidevKotlinPresent`; without the mark this does nothing and
 * Slidev's own sync (the dev server, or tabs of one browser) stays in charge.
 *
 * One direction only: a presenter page opened from the remote link (it
 * carries the write secret as `?k=`) sends its position, every other page
 * follows. A display never sends, so a slide that is still transitioning on
 * the projector cannot echo an old position back over a newer tap.
 */
export function setupRemoteSync({ router }: AppContext) {
  if (typeof window === 'undefined')
    return
  if (!(window as Window & { __slidevKotlinPresent?: unknown }).__slidevKotlinPresent)
    return

  const endpoint = (name: string) => `${import.meta.env.BASE_URL}__remote/${name}`
  // The printed remote link is `<base>?k=<secret>`. Slidev carries the query
  // along on every navigation, so the route keeps it; with the hash router it
  // stays in the real query string, read once here.
  const entryKey = new URLSearchParams(location.search).get('k') ?? undefined
  const key = () => {
    const fromRoute = router.currentRoute.value.query.k
    return (typeof fromRoute === 'string' && fromRoute) || entryKey
  }
  const routeName = () => router.currentRoute.value.name
  const isWriter = () => routeName() === 'presenter' && !!key() && !remoteConnection.rejected
  const role = () => isWriter() ? 'remote' : routeName() === 'play' ? 'display' : 'viewer'

  async function session(): Promise<{ instance: string, state: RemoteState | null }> {
    const response = await fetch(endpoint('session'), { cache: 'no-store', signal: AbortSignal.timeout(requestTimeout) })
    if (!response.ok)
      throw new Error('Remote server unavailable')
    return response.json()
  }

  // The remote link opens the deck's root: join the talk where it is now,
  // so a phone that scans the code again mid-talk does not rewind the display.
  // Until it has, this page must not follow the display like a viewer: that
  // navigation would race the one below and could win.
  let joining = !!entryKey
  void (async () => {
    try {
      await router.isReady()
      if (!entryKey || routeName() === 'presenter')
        return
      const state = await session().then(result => result.state, () => null)
      await router.replace({
        path: `/presenter/${state?.page ?? 1}`,
        query: { k: entryKey, ...(state?.clicks ? { clicks: state.clicks } : {}) },
      })
    }
    finally {
      joining = false
    }
  })()

  remoteConnection.enabled = true
  disableBuiltinSync()
  addSyncMethod({
    init(channelKey) {
      if (!channelKey.endsWith(' - shared'))
        return

      let incoming: RemoteState | undefined
      let applying = false
      async function follow() {
        if (applying)
          return
        applying = true
        try {
          await router.isReady()
          while (incoming) {
            const target = incoming
            incoming = undefined
            const name = routeName()
            if (target.page > slides.value.length || (name !== 'play' && name !== 'presenter'))
              continue
            await router.replace({
              path: name === 'presenter' ? `/presenter/${target.page}` : `/${target.page}`,
              query: { ...router.currentRoute.value.query, clicks: target.clicks },
            })
          }
        }
        finally {
          applying = false
        }
      }

      let events: EventSource | undefined
      let connectedAs: string | undefined
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined
      let connecting = false
      let outgoing: string | undefined
      let pending: string | undefined
      let sending = false

      function reconnect() {
        remoteConnection.connected = false
        remoteConnection.displays = 0
        events?.close()
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined
            void connect()
          }, 1000)
        }
      }

      async function connect() {
        if (connecting)
          return
        connecting = true
        try {
          // The role comes from the route: before the first navigation has
          // resolved, a remote would pass for a viewer and follow the display.
          await router.isReady()
          // Ask before opening the stream, so a server that is still down
          // retries here instead of leaving a dead stream behind.
          await session()
          events?.close()
          const as = role()
          connectedAs = as
          remoteConnection.canWrite = isWriter()
          events = new EventSource(`${endpoint('events')}?role=${as}`)
          events.onopen = () => {
            remoteConnection.connected = true
            if (isWriter() && outgoing) {
              pending = outgoing
              void send()
            }
          }
          events.addEventListener('peers', (event) => {
            remoteConnection.displays = JSON.parse((event as MessageEvent).data).displays
          })
          events.onmessage = (event) => {
            if (!isWriter() && !joining) {
              incoming = JSON.parse(event.data)
              void follow()
            }
          }
          events.onerror = reconnect
        }
        catch {
          reconnect()
        }
        finally {
          connecting = false
          // The route settled on another role while the stream was opening.
          if (connectedAs && connectedAs !== role())
            reconnect()
        }
      }

      // Serialize writes so a slow request cannot overwrite a newer tap.
      async function send() {
        if (sending || !remoteConnection.connected)
          return
        sending = true
        try {
          while (pending && remoteConnection.connected) {
            const body = pending
            pending = undefined
            try {
              const response = await fetch(endpoint('state'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key()}` },
                body,
                signal: AbortSignal.timeout(requestTimeout),
              })
              if (response.status === 403) {
                // A rotated secret: retrying cannot help, the link is dead.
                remoteConnection.rejected = true
                remoteConnection.canWrite = false
                pending = outgoing = undefined
                return
              }
              if (!response.ok)
                throw new Error(`Remote sync: ${response.status}`)
            }
            catch {
              pending ??= body
              reconnect()
            }
          }
        }
        finally {
          sending = false
        }
      }

      void connect()
      // The role follows the route: the remote link lands on the root first,
      // and a display can be turned into a notes or overview page.
      watch(role, (next) => {
        if (connectedAs && next !== connectedAs)
          reconnect()
      })

      return (state, updating) => {
        if (updating || !isWriter())
          return
        // Send the click position the URL asks for, not the one Slidev has
        // clamped so far: stepping back onto a slide asks for its last click
        // before this page has mounted the slide and learned how many it has.
        // The display clamps for itself and shows the final state at once.
        const asked = Number(router.currentRoute.value.query.clicks)
        const clicks = Number.isInteger(asked) && asked > 0 ? asked : 0
        outgoing = pending = JSON.stringify({ page: +(state as unknown as RemoteState).page, clicks })
        void send()
      }
    },
  })
}
