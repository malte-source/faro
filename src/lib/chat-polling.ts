/**
 * How often an open chat asks the server for news.
 *
 *   hidden tab or offline              → paused (an immediate refetch runs on focus / `online`)
 *   focused and acted in the last 60 s → 3 s   (a conversation in progress)
 *   anything else (idle, other window) → 8 s
 *
 * `FULL_REFRESH_MS` is the slow full-page refetch that repairs what a delta cannot show
 * (a removed reaction, a row missed by the clock skew window).
 */
export const ACTIVE_POLL_MS = 3_000
export const IDLE_POLL_MS = 8_000
export const ACTIVE_WINDOW_MS = 60_000
export const FULL_REFRESH_MS = 60_000
/** Sidebar/tab-bar badge: how often the unread total is refreshed (it also refreshes on focus). */
export const UNREAD_TOTAL_POLL_MS = 30_000

export interface PollContext {
  visible: boolean
  focused: boolean
  online: boolean
  /** Milliseconds since the last pointer / key / touch event. */
  msSinceActivity: number
}

export function pickPollInterval(ctx: PollContext): number | false {
  if (!ctx.visible || !ctx.online) return false
  if (ctx.focused && ctx.msSinceActivity < ACTIVE_WINDOW_MS) return ACTIVE_POLL_MS
  return IDLE_POLL_MS
}
