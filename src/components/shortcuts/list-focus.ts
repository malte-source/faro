/** Pure helpers for moving a keyboard focus ring across the rows of a list. */

/** Where the focus ring sits: the row id plus the position it had, so it can survive that row disappearing. */
export interface FocusState {
  id: string
  index: number
}

/** Next focus after pressing j (delta 1) or k (delta -1). The first press lands on the first/last row; edges don't wrap. */
export function moveFocus(ids: string[], current: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) return null
  const idx = current === null ? -1 : ids.indexOf(current)
  if (idx === -1) return delta === 1 ? ids[0] : ids[ids.length - 1]
  const next = Math.min(ids.length - 1, Math.max(0, idx + delta))
  return ids[next]
}

/**
 * The row that currently holds the focus. If the focused row is gone (a done task leaves the
 * list, a filter applies) the ring stays at the same position — on the row that took its
 * place, clamped to the end — instead of vanishing.
 */
export function resolveFocus(ids: string[], focus: FocusState | null): string | null {
  if (!focus || ids.length === 0) return null
  if (ids.includes(focus.id)) return focus.id
  return ids[Math.min(focus.index, ids.length - 1)]
}
