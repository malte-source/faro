import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRecent, formatWhen, pushRecent, readRecent } from './format'

describe('formatWhen', () => {
  const now = new Date(2026, 9, 24, 15, 0) // 24 oct 2026, local time

  it('hoy / ayer / hace N d', () => {
    expect(formatWhen(new Date(2026, 9, 24, 1, 0).toISOString(), now)).toBe('hoy')
    expect(formatWhen(new Date(2026, 9, 23, 23, 0).toISOString(), now)).toBe('ayer')
    expect(formatWhen(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toBe('hace 4 d')
  })

  it('older dates show day and month, with the year only when it is not this one', () => {
    expect(formatWhen(new Date(2026, 8, 3, 9, 0).toISOString(), now)).toMatch(/3 sep/)
    expect(formatWhen(new Date(2025, 8, 3, 9, 0).toISOString(), now)).toMatch(/2025/)
  })

  it('a bad date is blank, a future date is "hoy"', () => {
    expect(formatWhen('nope', now)).toBe('')
    expect(formatWhen(new Date(2026, 9, 26, 9, 0).toISOString(), now)).toBe('hoy')
  })
})

describe('recent searches', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the latest 5, most recent first, without case-insensitive duplicates', () => {
    for (const q of ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis']) pushRecent(q)
    expect(readRecent()).toEqual(['seis', 'cinco', 'cuatro', 'tres', 'dos'])
    pushRecent('DOS')
    expect(readRecent()).toEqual(['DOS', 'seis', 'cinco', 'cuatro', 'tres'])
  })

  it('ignores trivial queries and survives corrupt storage', () => {
    pushRecent(' a ')
    expect(readRecent()).toEqual([])
    store.set('faro:recent-searches', '{not json')
    expect(readRecent()).toEqual([])
    store.set('faro:recent-searches', JSON.stringify(['ok', 3, null]))
    expect(readRecent()).toEqual(['ok'])
  })

  it('clearRecent empties it', () => {
    pushRecent('presupuesto')
    clearRecent()
    expect(readRecent()).toEqual([])
  })

  it('never throws when storage is blocked', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } } })
    expect(() => { pushRecent('algo'); clearRecent() }).not.toThrow()
    expect(readRecent()).toEqual([])
  })
})
