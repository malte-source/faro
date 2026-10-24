import { undoQueue } from '@/lib/undo-queue'
import { usePendingDeletes } from '@/stores/pending-deletes'

/**
 * The two undo flows for tasks, shared by every list and the detail panel so they
 * behave (and read) the same everywhere:
 *
 *  - status change / completion: applied right away, "Deshacer" puts the previous
 *    status back;
 *  - delete: held back — the row is hidden at once, the real delete runs only if the
 *    undo window closes untouched (no confirm dialog needed: undo replaces it).
 */

export const TASK_STATUS_LABEL: Record<string, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  done: 'Listo',
  canceled: 'Cancelado',
}

export interface StatusChange {
  title: string
  from: string
  to: string
  /** Performs a status change (the caller's own mutation, so its cache handling is kept). */
  apply: (status: string) => void | Promise<void>
}

/** Apply `to` now and open an undo window that restores `from`. No-op when nothing changes. */
export function changeStatusWithUndo({ title, from, to, apply }: StatusChange): number | null {
  if (from === to) return null
  void apply(to)
  const label = to === 'done' ? 'Tarea completada' : `Estado: ${TASK_STATUS_LABEL[to] ?? to}`
  return undoQueue.push(label, { description: title, onUndo: () => apply(from) })
}

export interface DeleteRequest {
  id: string
  title: string
  /** Performs the real delete and refreshes the caches. Runs only if the undo window is not used. */
  commit: () => Promise<void>
  /** The real delete failed (the row comes back). */
  onCommitError?: (err: unknown) => void
}

/** Hide the task now, delete it for real in 6 s unless the user undoes it. */
export function deleteWithUndo({ id, title, commit, onCommitError }: DeleteRequest): number {
  const pending = usePendingDeletes.getState()
  pending.hide(id)
  return undoQueue.push('Tarea borrada', {
    description: title,
    onUndo: () => pending.show(id),
    onCommit: async () => {
      try {
        await commit()
      } catch (err) {
        onCommitError?.(err)
      } finally {
        // Success: the refreshed list no longer has the task. Failure: the row returns.
        pending.show(id)
      }
    },
  })
}
