import { create } from 'zustand'

/**
 * Tasks whose deletion is being held back by an undo window (see src/lib/task-undo.ts).
 * Lists filter these ids out so the row disappears the moment the user deletes it, and
 * comes back untouched if they press "Deshacer".
 */
interface PendingDeletesState {
  ids: ReadonlySet<string>
  hide: (id: string) => void
  show: (id: string) => void
}

export const usePendingDeletes = create<PendingDeletesState>(set => ({
  ids: new Set<string>(),
  hide: id => set(s => (s.ids.has(id) ? s : { ids: new Set(s.ids).add(id) })),
  show: id =>
    set(s => {
      if (!s.ids.has(id)) return s
      const next = new Set(s.ids)
      next.delete(id)
      return { ids: next }
    }),
}))
