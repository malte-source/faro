import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeStatusWithUndo, deleteWithUndo } from './task-undo'
import { undoQueue, DEFAULT_UNDO_MS } from './undo-queue'
import { usePendingDeletes } from '@/stores/pending-deletes'

describe('task undo flows', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    undoQueue.flushAll()
    usePendingDeletes.setState({ ids: new Set() })
  })
  afterEach(() => { undoQueue.flushAll(); vi.useRealTimers() })

  describe('changeStatusWithUndo', () => {
    it('applies the new status at once and restores the old one on undo', () => {
      const apply = vi.fn()
      changeStatusWithUndo({ title: 'Pagar proveedores', from: 'in_progress', to: 'done', apply })
      expect(apply).toHaveBeenLastCalledWith('done')
      expect(undoQueue.entries()[0].title).toBe('Tarea completada')
      undoQueue.undoLatest()
      expect(apply).toHaveBeenLastCalledWith('in_progress')
      expect(apply).toHaveBeenCalledTimes(2)
    })

    it('names a non-completion change after the new status', () => {
      changeStatusWithUndo({ title: 't', from: 'todo', to: 'in_review', apply: vi.fn() })
      expect(undoQueue.entries()[0].title).toBe('Estado: En revisión')
    })

    it('does nothing when the status did not change', () => {
      const apply = vi.fn()
      expect(changeStatusWithUndo({ title: 't', from: 'done', to: 'done', apply })).toBeNull()
      expect(apply).not.toHaveBeenCalled()
      expect(undoQueue.entries()).toHaveLength(0)
    })

    it('does not touch the status again when the window just expires', () => {
      const apply = vi.fn()
      changeStatusWithUndo({ title: 't', from: 'todo', to: 'done', apply })
      vi.advanceTimersByTime(DEFAULT_UNDO_MS)
      expect(apply).toHaveBeenCalledTimes(1)
    })
  })

  describe('deleteWithUndo', () => {
    it('hides the task immediately and deletes only when the window closes', async () => {
      const commit = vi.fn().mockResolvedValue(undefined)
      deleteWithUndo({ id: 't1', title: 'Borrame', commit })
      expect(usePendingDeletes.getState().ids.has('t1')).toBe(true)
      vi.advanceTimersByTime(DEFAULT_UNDO_MS - 1)
      expect(commit).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(commit).toHaveBeenCalledTimes(1)
      await vi.runAllTimersAsync()
      expect(usePendingDeletes.getState().ids.has('t1')).toBe(false) // gone for real, released after the refresh
    })

    it('undo brings the row back and never deletes', () => {
      const commit = vi.fn().mockResolvedValue(undefined)
      deleteWithUndo({ id: 't2', title: 'x', commit })
      undoQueue.undoLatest()
      expect(usePendingDeletes.getState().ids.has('t2')).toBe(false)
      vi.advanceTimersByTime(DEFAULT_UNDO_MS * 2)
      expect(commit).not.toHaveBeenCalled()
    })

    it('a failed delete returns the row and reports the error', async () => {
      const boom = new Error('fallo')
      const onCommitError = vi.fn()
      deleteWithUndo({ id: 't3', title: 'x', commit: () => Promise.reject(boom), onCommitError })
      vi.advanceTimersByTime(DEFAULT_UNDO_MS)
      await vi.runAllTimersAsync()
      expect(onCommitError).toHaveBeenCalledWith(boom)
      expect(usePendingDeletes.getState().ids.has('t3')).toBe(false)
    })

    it('leaving the page (flushAll) still commits the delete', () => {
      const commit = vi.fn().mockResolvedValue(undefined)
      deleteWithUndo({ id: 't4', title: 'x', commit })
      undoQueue.flushAll()
      expect(commit).toHaveBeenCalledTimes(1)
    })
  })
})
