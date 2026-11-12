import { reactive } from 'vue'

/**
 * What the `slidev-kotlin-present` server knows about this page, for the
 * remote's status line. `enabled` stays false in `slidev dev` and on a static
 * host, where Slidev's own sync is in charge.
 */
export const remoteConnection = reactive({
  /** The page was served by `slidev-kotlin-present`. */
  enabled: false,
  /** The event stream to the server is open. */
  connected: false,
  /** This page was opened from the remote link and may drive the deck. */
  canWrite: false,
  /** The server refused this page's write secret. */
  rejected: false,
  /** Displays currently following the remote. */
  displays: 0,
})
