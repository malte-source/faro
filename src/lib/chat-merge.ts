/**
 * Pure helpers for incremental chat polling.
 *
 * Instead of re-downloading the 60 latest messages every few seconds, the open
 * channel asks the server only for what changed since the previous answer
 * (`chat.messages({ after })`) and merges it into the cached page by id.
 *
 * What the server's delta can and cannot see: new messages, edits, deletions, new
 * reactions and new thread replies (it returns their parent with a fresh reply
 * count). It cannot see a reaction being REMOVED — no timestamp survives a delete —
 * so the full page is re-fetched on a slower timer to repair that drift.
 */

/**
 * The next delta asks from a little BEFORE the previous answer's `asOf`: `asOf` is the app server's
 * clock and `created_at` is Postgres's, and a row can commit just after the previous queries ran.
 * Merging by id is idempotent, so re-receiving a few rows costs almost nothing.
 */
export const DELTA_OVERLAP_MS = 10_000

export function deltaCursor(asOf: string, overlapMs: number = DELTA_OVERLAP_MS): string {
  const t = Date.parse(asOf)
  if (Number.isNaN(t)) return asOf
  return new Date(t - overlapMs).toISOString()
}

interface Timed { id: string; createdAt: string }

/** Oldest first; ties by id so the order is stable. ISO strings from one source compare correctly as text. */
function byCreatedAt(a: Timed, b: Timed): number {
  if (a.createdAt < b.createdAt) return -1
  if (a.createdAt > b.createdAt) return 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Merge changed/new rows into the current list by id: an existing id is replaced, an unknown id is
 * added, everything stays sorted oldest → newest. Returns the SAME array when nothing actually
 * changed — nothing came in, or only rows identical to the ones we already hold (the overlap window
 * re-sends the last few seconds on every poll) — so React skips the re-render.
 */
export function mergeById<T extends Timed>(current: readonly T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return current as T[]
  const map = new Map<string, T>()
  for (const row of current) map.set(row.id, row)
  let changed = false
  for (const row of incoming) {
    const have = map.get(row.id)
    // Same server shaping → same key order, so a JSON comparison is a reliable, cheap equality.
    if (!have || JSON.stringify(have) !== JSON.stringify(row)) changed = true
    map.set(row.id, row)
  }
  if (!changed) return current as T[]
  return Array.from(map.values()).sort(byCreatedAt)
}

/** Thread variant: the root is always replaced (its reply count and reactions move), replies are merged. */
export function mergeThread<R extends Timed, M extends Timed>(
  current: { root: R; replies: M[] },
  incoming: { root: R; replies: M[] },
): { root: R; replies: M[] } {
  return { root: incoming.root, replies: mergeById(current.replies, incoming.replies) }
}
