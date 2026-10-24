/**
 * Key-sequence matcher: "g" then "h", or a single key like "c".
 *
 * A tiny state machine, no DOM and no timers of its own — the caller passes the
 * event time, so a pending prefix expires on its own without a setTimeout and the
 * whole thing is trivially testable.
 */

export const SEQUENCE_TIMEOUT_MS = 1500

export interface SequenceDef {
  id: string
  /** Normalised keys (see `normalizeKey`): ['g', 'h'] or ['c'] or ['?']. */
  keys: string[]
}

export type FeedResult =
  | { type: 'match'; id: string }
  /** A valid prefix of at least one sequence: wait for the next key. `next` lists what can follow. */
  | { type: 'pending'; prefix: string[]; next: string[] }
  | { type: 'none' }

/** Letters compare lowercase (so Shift+G works like g); every other key keeps its own name ('?', '/', 'Enter'). */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

export class SequenceMatcher {
  private prefix: string[] = []
  private lastAt = 0

  constructor(private defs: SequenceDef[], private timeoutMs = SEQUENCE_TIMEOUT_MS) {}

  /** Swap the definitions (e.g. when the grupo-mode flag arrives). Drops any pending prefix. */
  setDefs(defs: SequenceDef[]) {
    this.defs = defs
    this.reset()
  }

  reset() {
    this.prefix = []
    this.lastAt = 0
  }

  get pendingPrefix(): string[] {
    return this.prefix
  }

  feed(rawKey: string, now: number): FeedResult {
    const key = normalizeKey(rawKey)
    if (this.prefix.length && now - this.lastAt > this.timeoutMs) this.reset()

    let result = this.step([...this.prefix, key])
    // A wrong follow-up key ("g" then "z") cancels the sequence, but the key itself may
    // start a new one (e.g. "g" "g"): retry from a clean state.
    if (result.type === 'none' && this.prefix.length) {
      this.reset()
      result = this.step([key])
    }

    if (result.type === 'pending') {
      this.prefix = result.prefix
      this.lastAt = now
    } else {
      this.reset()
    }
    return result
  }

  private step(seq: string[]): FeedResult {
    const exact = this.defs.find(d => sameKeys(d.keys, seq))
    const longer = this.defs.filter(d => d.keys.length > seq.length && startsWith(d.keys, seq))
    // An exact match wins unless a longer sequence shares the prefix — then we wait for it.
    if (exact && longer.length === 0) return { type: 'match', id: exact.id }
    if (longer.length > 0) {
      return { type: 'pending', prefix: seq, next: Array.from(new Set(longer.map(d => d.keys[seq.length]))) }
    }
    return { type: 'none' }
  }
}

function sameKeys(a: string[], b: string[]) {
  return a.length === b.length && a.every((k, i) => k === b[i])
}
function startsWith(a: string[], prefix: string[]) {
  return prefix.every((k, i) => a[i] === k)
}
