/**
 * Undo queue — the framework-free core behind `toast.undo(...)`.
 *
 * Every entry is a short window (6 s by default) in which the user can take an
 * action back. Two flavours share one mechanism:
 *
 *  - "applied, can be reverted": the change already happened (task completed,
 *    status changed). `onUndo` performs the inverse. `onCommit` is not needed.
 *  - "delayed, can be cancelled": a destructive action (delete) is held back.
 *    Nothing has happened yet; `onCommit` performs it when the window closes
 *    without an undo, `onUndo` just releases the held-back state.
 *
 * Leaving the window by any other road counts as accepting the action:
 * the timer running out, the user dismissing the toast, the queue overflowing,
 * or the page being hidden (`flushAll`). Only an explicit undo cancels.
 *
 * No React, no DOM: timers go through `globalThis.setTimeout` at call time so
 * tests can drive it with fake timers.
 */

export const DEFAULT_UNDO_MS = 6000
/** More than this many windows open at once: the oldest is accepted early. */
export const MAX_OPEN_UNDOS = 3

export interface UndoOptions {
  /** Revert the action (or release a held-back one). */
  onUndo?: () => void | Promise<void>
  /** Run when the window closes WITHOUT an undo. Use it to delay destructive actions. */
  onCommit?: () => void | Promise<void>
  /** Window length in ms. */
  duration?: number
  /** Secondary line under the title. */
  description?: string
}

export interface UndoEntry {
  id: number
  title: string
  description?: string
  duration: number
  startedAt: number
}

interface Internal extends UndoEntry {
  onUndo?: UndoOptions['onUndo']
  onCommit?: UndoOptions['onCommit']
  timer: ReturnType<typeof setTimeout>
}

type Listener = (entries: UndoEntry[]) => void

function run(fn: (() => void | Promise<void>) | undefined, label: string) {
  if (!fn) return
  try {
    const out = fn()
    if (out && typeof (out as Promise<void>).catch === 'function') {
      ;(out as Promise<void>).catch(err => console.error(`[undo] ${label} failed`, err))
    }
  } catch (err) {
    console.error(`[undo] ${label} failed`, err)
  }
}

export class UndoQueue {
  private items: Internal[] = []
  private listeners = new Set<Listener>()
  private nextId = 1

  /** Open an undo window. Returns its id. */
  push(title: string, opts: UndoOptions = {}): number {
    const id = this.nextId++
    const duration = opts.duration ?? DEFAULT_UNDO_MS
    const item: Internal = {
      id,
      title,
      description: opts.description,
      duration,
      startedAt: Date.now(),
      onUndo: opts.onUndo,
      onCommit: opts.onCommit,
      timer: globalThis.setTimeout(() => this.commit(id), duration),
    }
    this.items.push(item)
    // Too many windows at once: accept the oldest instead of stacking toasts forever.
    while (this.items.length > MAX_OPEN_UNDOS) this.commit(this.items[0].id)
    this.emit()
    return id
  }

  /** Take the action back. Returns false when the window was already closed. */
  undo(id: number): boolean {
    const item = this.take(id)
    if (!item) return false
    run(item.onUndo, 'onUndo')
    this.emit()
    return true
  }

  /** Undo the most recent open window (⌘Z). */
  undoLatest(): boolean {
    const last = this.items[this.items.length - 1]
    return last ? this.undo(last.id) : false
  }

  /** Accept the action now (toast dismissed, timer ran out). */
  commit(id: number): boolean {
    const item = this.take(id)
    if (!item) return false
    run(item.onCommit, 'onCommit')
    this.emit()
    return true
  }

  /** Accept everything still open — used when the page is being hidden or closed. */
  flushAll(): void {
    for (const item of [...this.items]) this.commit(item.id)
  }

  entries(): UndoEntry[] {
    return this.items.map(({ id, title, description, duration, startedAt }) => ({ id, title, description, duration, startedAt }))
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private take(id: number): Internal | undefined {
    const idx = this.items.findIndex(i => i.id === id)
    if (idx === -1) return undefined
    const [item] = this.items.splice(idx, 1)
    globalThis.clearTimeout(item.timer)
    return item
  }

  private emit() {
    const snapshot = this.entries()
    for (const fn of this.listeners) fn(snapshot)
  }
}

/** The app-wide queue behind `toast.undo`. */
export const undoQueue = new UndoQueue()
