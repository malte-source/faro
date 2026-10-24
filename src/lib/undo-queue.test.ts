import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_UNDO_MS, MAX_OPEN_UNDOS, UndoQueue } from './undo-queue'

describe('UndoQueue', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('commits a delayed action when the window closes without an undo', () => {
    const q = new UndoQueue()
    const onCommit = vi.fn()
    q.push('Tarea borrada', { onCommit })
    vi.advanceTimersByTime(DEFAULT_UNDO_MS - 1)
    expect(onCommit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(q.entries()).toHaveLength(0)
  })

  it('undo cancels the commit and runs onUndo exactly once', () => {
    const q = new UndoQueue()
    const onCommit = vi.fn()
    const onUndo = vi.fn()
    const id = q.push('Tarea borrada', { onCommit, onUndo })
    expect(q.undo(id)).toBe(true)
    expect(q.undo(id)).toBe(false) // already closed
    vi.advanceTimersByTime(DEFAULT_UNDO_MS * 2)
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('an applied action (no onCommit) just closes when time runs out', () => {
    const q = new UndoQueue()
    const onUndo = vi.fn()
    q.push('Tarea completada', { onUndo })
    vi.advanceTimersByTime(DEFAULT_UNDO_MS)
    expect(onUndo).not.toHaveBeenCalled()
    expect(q.entries()).toHaveLength(0)
  })

  it('honours a custom duration', () => {
    const q = new UndoQueue()
    const onCommit = vi.fn()
    q.push('x', { onCommit, duration: 1000 })
    vi.advanceTimersByTime(999)
    expect(onCommit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('undoLatest reverts the most recent window only', () => {
    const q = new UndoQueue()
    const first = vi.fn()
    const second = vi.fn()
    q.push('a', { onUndo: first })
    q.push('b', { onUndo: second })
    expect(q.undoLatest()).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(q.undoLatest()).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
    expect(q.undoLatest()).toBe(false)
  })

  it('dismissing (commit) accepts immediately and cancels the timer', () => {
    const q = new UndoQueue()
    const onCommit = vi.fn()
    const id = q.push('x', { onCommit })
    expect(q.commit(id)).toBe(true)
    expect(onCommit).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(DEFAULT_UNDO_MS * 2)
    expect(onCommit).toHaveBeenCalledTimes(1) // never twice
  })

  it('accepts the oldest window early when too many are open', () => {
    const q = new UndoQueue()
    const commits = Array.from({ length: MAX_OPEN_UNDOS + 1 }, () => vi.fn())
    commits.forEach((c, i) => q.push(`t${i}`, { onCommit: c }))
    expect(commits[0]).toHaveBeenCalledTimes(1)
    expect(commits[1]).not.toHaveBeenCalled()
    expect(q.entries()).toHaveLength(MAX_OPEN_UNDOS)
  })

  it('flushAll commits everything still open (page hidden)', () => {
    const q = new UndoQueue()
    const a = vi.fn()
    const b = vi.fn()
    q.push('a', { onCommit: a })
    q.push('b', { onCommit: b })
    q.flushAll()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    expect(q.entries()).toHaveLength(0)
  })

  it('notifies subscribers with a snapshot on every change', () => {
    const q = new UndoQueue()
    const seen: number[] = []
    const off = q.subscribe(entries => seen.push(entries.length))
    const id = q.push('x', {})
    q.undo(id)
    off()
    q.push('y', {})
    expect(seen).toEqual([1, 0])
  })

  it('a throwing or rejecting callback never breaks the queue', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const q = new UndoQueue()
    const id1 = q.push('a', { onUndo: () => { throw new Error('boom') } })
    const id2 = q.push('b', { onCommit: () => Promise.reject(new Error('nope')) })
    expect(q.undo(id1)).toBe(true)
    expect(q.commit(id2)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(err).toHaveBeenCalledTimes(2)
    expect(q.entries()).toHaveLength(0)
    err.mockRestore()
  })
})
