import { describe, expect, it } from 'vitest'
import { DELTA_OVERLAP_MS, deltaCursor, mergeById, mergeThread } from './chat-merge'
import { ACTIVE_POLL_MS, ACTIVE_WINDOW_MS, IDLE_POLL_MS, pickPollInterval } from './chat-polling'

const m = (id: string, createdAt: string, body = id) => ({ id, createdAt, body })

describe('mergeById', () => {
  const base = [m('a', '2026-10-24T10:00:00.000Z'), m('b', '2026-10-24T10:01:00.000Z')]

  it('returns the same array when nothing came in (no re-render)', () => {
    expect(mergeById(base, [])).toBe(base)
  })

  it('returns the same array when the incoming rows are identical to what we hold (overlap window)', () => {
    const again = [m('b', '2026-10-24T10:01:00.000Z')]
    expect(mergeById(base, again)).toBe(base)
  })

  it('appends new rows in chronological order', () => {
    const out = mergeById(base, [m('c', '2026-10-24T10:02:00.000Z')])
    expect(out.map(x => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('replaces an edited row in place instead of duplicating it', () => {
    const out = mergeById(base, [m('a', '2026-10-24T10:00:00.000Z', 'editado')])
    expect(out).toHaveLength(2)
    expect(out[0].body).toBe('editado')
  })

  it('is idempotent: receiving the overlap window twice changes nothing', () => {
    const delta = [m('b', '2026-10-24T10:01:00.000Z'), m('c', '2026-10-24T10:02:00.000Z')]
    const once = mergeById(base, delta)
    const twice = mergeById(once, delta)
    expect(twice.map(x => x.id)).toEqual(['a', 'b', 'c'])
    expect(twice).toEqual(once)
  })

  it('sorts a late-arriving older row into position and breaks ties by id', () => {
    const out = mergeById(base, [m('z0', '2026-10-24T10:00:30.000Z'), m('x', '2026-10-24T10:00:00.000Z')])
    expect(out.map(x => x.id)).toEqual(['a', 'x', 'z0', 'b'])
  })

  it('does not mutate its inputs', () => {
    const copy = JSON.parse(JSON.stringify(base))
    mergeById(base, [m('c', '2026-10-24T10:02:00.000Z')])
    expect(base).toEqual(copy)
  })
})

describe('mergeThread', () => {
  it('always takes the fresh root and merges only the changed replies', () => {
    const current = { root: m('r', '2026-10-24T09:00:00.000Z', 'viejo'), replies: [m('a', '2026-10-24T10:00:00.000Z')] }
    const incoming = { root: m('r', '2026-10-24T09:00:00.000Z', 'nuevo'), replies: [m('b', '2026-10-24T10:05:00.000Z')] }
    const out = mergeThread(current, incoming)
    expect(out.root.body).toBe('nuevo')
    expect(out.replies.map(x => x.id)).toEqual(['a', 'b'])
  })

  it('keeps existing replies when the delta has none', () => {
    const current = { root: m('r', '2026-10-24T09:00:00.000Z'), replies: [m('a', '2026-10-24T10:00:00.000Z')] }
    const out = mergeThread(current, { root: m('r', '2026-10-24T09:00:00.000Z'), replies: [] })
    expect(out.replies).toBe(current.replies)
  })
})

describe('deltaCursor', () => {
  it('looks back by the overlap window', () => {
    const asOf = '2026-10-24T10:00:30.000Z'
    expect(Date.parse(asOf) - Date.parse(deltaCursor(asOf))).toBe(DELTA_OVERLAP_MS)
  })

  it('accepts a custom overlap and returns an ISO string', () => {
    expect(deltaCursor('2026-10-24T10:00:30.000Z', 30_000)).toBe('2026-10-24T10:00:00.000Z')
  })

  it('leaves an unparseable cursor untouched rather than throwing', () => {
    expect(deltaCursor('not-a-date')).toBe('not-a-date')
  })
})

describe('pickPollInterval', () => {
  const live = { visible: true, focused: true, online: true, msSinceActivity: 1_000 }

  it('polls every 3 s while focused and recently active', () => {
    expect(pickPollInterval(live)).toBe(ACTIVE_POLL_MS)
  })

  it('slows to 8 s once the user has been idle for a minute', () => {
    expect(pickPollInterval({ ...live, msSinceActivity: ACTIVE_WINDOW_MS })).toBe(IDLE_POLL_MS)
    expect(pickPollInterval({ ...live, msSinceActivity: ACTIVE_WINDOW_MS - 1 })).toBe(ACTIVE_POLL_MS)
  })

  it('uses the idle rate when the window is visible but not focused', () => {
    expect(pickPollInterval({ ...live, focused: false })).toBe(IDLE_POLL_MS)
  })

  it('pauses when the tab is hidden or the device is offline', () => {
    expect(pickPollInterval({ ...live, visible: false })).toBe(false)
    expect(pickPollInterval({ ...live, online: false })).toBe(false)
  })
})
