'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isInteractiveTarget, shouldIgnoreShortcut } from './guards'
import { moveFocus, resolveFocus, type FocusState } from './list-focus'
import { isOverlayOpen } from './overlay'
import { useShortcuts } from './shortcuts-store'

/** Ring drawn on the row that holds the keyboard focus (inset so overflow-hidden cards don't clip it). */
export const ROW_FOCUS_RING = 'ring-2 ring-inset ring-signal'

export interface ListNavigationHandlers<T> {
  /** Enter: open the row. */
  onOpen?: (row: T) => void
  /** e: edit the row (falls back to onOpen). */
  onEdit?: (row: T) => void
  /** x: toggle done on the row. */
  onToggle?: (row: T) => void
}

// Several lists can be mounted at once (a page plus a panel). Only the most recently mounted one answers j/k/x/e.
const activeLists: symbol[] = []

/**
 * Keyboard navigation for a list of rows: `j` / `k` move a focus ring, `x` toggles done,
 * `e` edits, `Enter` opens, `Esc` drops the ring. Nothing is focused until the first key
 * press, so mouse and touch users never see a ring.
 *
 * Rows opt in with `rowProps(id)` (a data attribute used to scroll the row into view and
 * an `aria-current`) and `focusedId === row.id` for the ring class.
 */
export function useListNavigation<T extends { id: string }>(
  rows: T[],
  handlers: ListNavigationHandlers<T>,
  enabled = true,
) {
  const globallyEnabled = useShortcuts(s => s.enabled)
  const active = enabled && globallyEnabled

  const [focus, setFocus] = useState<FocusState | null>(null)
  const ids = useMemo(() => rows.map(r => r.id), [rows])
  const focusedId = useMemo(() => resolveFocus(ids, focus), [ids, focus])

  // Latest values for the key listener (assigned after render, read only inside events).
  const latest = useRef({ rows, ids, focusedId, handlers })
  useEffect(() => { latest.current = { rows, ids, focusedId, handlers } })

  const [token] = useState(() => Symbol('list'))

  useEffect(() => {
    if (!active) return
    const mine = token
    activeLists.push(mine)

    const onKey = (e: KeyboardEvent) => {
      if (activeLists[activeLists.length - 1] !== mine) return
      const isMove = e.key === 'j' || e.key === 'k'
      if (shouldIgnoreShortcut(e, { overlayOpen: isOverlayOpen(), allowRepeat: isMove })) return
      const { rows: currentRows, ids: currentIds, focusedId: current, handlers: h } = latest.current
      const row = current ? currentRows.find(r => r.id === current) : undefined

      if (isMove) {
        if (currentIds.length === 0) return
        e.preventDefault()
        const next = moveFocus(currentIds, current, e.key === 'j' ? 1 : -1)
        if (next) setFocus({ id: next, index: currentIds.indexOf(next) })
        return
      }
      if (!row) return
      if (e.key === 'x' && h.onToggle) {
        e.preventDefault()
        h.onToggle(row)
      } else if (e.key === 'e' && (h.onEdit || h.onOpen)) {
        e.preventDefault()
        ;(h.onEdit ?? h.onOpen)?.(row)
      } else if (e.key === 'Enter' && h.onOpen && !isInteractiveTarget(e.target as HTMLElement | null)) {
        e.preventDefault()
        h.onOpen(row)
      } else if (e.key === 'Escape') {
        setFocus(null)
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const i = activeLists.lastIndexOf(mine)
      if (i !== -1) activeLists.splice(i, 1)
    }
  }, [active, token])

  // Keep the focused row on screen while moving with the keyboard.
  useEffect(() => {
    if (!focusedId) return
    const el = document.querySelector(`[data-row-id="${CSS.escape(focusedId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusedId])

  const rowProps = useCallback(
    (id: string) => ({
      'data-row-id': id,
      'aria-current': focusedId === id ? ('true' as const) : undefined,
    }),
    [focusedId],
  )

  return { focusedId, rowProps }
}
