import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tryConsume } from './rate-limit'

describe('rate-limit token bucket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Pin to a known timestamp so the bucket state is deterministic
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to maxBurst calls in a row', () => {
    const key = `t-burst-${Math.random()}`
    const opts = { tokensPerMinute: 1, maxBurst: 5 }
    for (let i = 0; i < 5; i++) {
      expect(tryConsume(key, opts)).toBe(true)
    }
    // 6th hits the limit
    expect(tryConsume(key, opts)).toBe(false)
  })

  it('refills over time at the configured rate', () => {
    const key = `t-refill-${Math.random()}`
    const opts = { tokensPerMinute: 2, maxBurst: 2 }
    // Burn the bucket
    expect(tryConsume(key, opts)).toBe(true)
    expect(tryConsume(key, opts)).toBe(true)
    expect(tryConsume(key, opts)).toBe(false)

    // Advance 30s — should refill 1 token (2/min × 0.5min)
    vi.advanceTimersByTime(30_000)
    expect(tryConsume(key, opts)).toBe(true)
    expect(tryConsume(key, opts)).toBe(false)
  })

  it('caps refill at maxBurst even after long idle', () => {
    const key = `t-cap-${Math.random()}`
    const opts = { tokensPerMinute: 10, maxBurst: 3 }
    expect(tryConsume(key, opts)).toBe(true)

    // Advance an hour — would refill 600 tokens uncapped, but max is 3
    vi.advanceTimersByTime(60 * 60_000)
    expect(tryConsume(key, opts)).toBe(true)
    expect(tryConsume(key, opts)).toBe(true)
    expect(tryConsume(key, opts)).toBe(true)
    expect(tryConsume(key, opts)).toBe(false)
  })

  it('isolates buckets by key', () => {
    const optsA = { tokensPerMinute: 1, maxBurst: 1 }
    const keyA = `t-isolate-a-${Math.random()}`
    const keyB = `t-isolate-b-${Math.random()}`
    expect(tryConsume(keyA, optsA)).toBe(true)
    expect(tryConsume(keyA, optsA)).toBe(false)
    // Different key should still have its own bucket
    expect(tryConsume(keyB, optsA)).toBe(true)
  })
})
