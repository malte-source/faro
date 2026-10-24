import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_ATTEMPTS,
  UploadHttpError,
  __resetOutboxForTests,
  backoffMs,
  classifySendError,
  dueItems,
  markInFlight,
  outboxAdd,
  outboxGet,
  outboxList,
  outboxMarkRetry,
  outboxRemove,
  outboxRetryNow,
  subscribeOutbox,
  type OutboxItem,
} from './outbox'

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  clientId: 'a', kind: 'text', text: 'hola', createdAt: 1000, attempts: 0, nextAttemptAt: 0, lastError: null, failed: false, ...over,
})

describe('backoffMs', () => {
  it('grows and then plateaus at 10 minutes', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([5_000, 15_000, 45_000, 120_000, 300_000, 600_000])
    expect(backoffMs(20)).toBe(600_000)
    expect(backoffMs(0)).toBe(5_000)
  })
})

describe('dueItems', () => {
  it('returns only items that are due, not failed and not in flight, oldest first', () => {
    const items = [
      item({ clientId: 'late', createdAt: 3, nextAttemptAt: 50 }),
      item({ clientId: 'old', createdAt: 1, nextAttemptAt: 0 }),
      item({ clientId: 'waiting', createdAt: 2, nextAttemptAt: 500 }),
      item({ clientId: 'gaveup', createdAt: 4, failed: true }),
      item({ clientId: 'busy', createdAt: 5 }),
    ]
    expect(dueItems(items, 100, new Set(['busy'])).map(i => i.clientId)).toEqual(['old', 'late'])
  })
})

describe('classifySendError', () => {
  it('retries when there is no HTTP status (network down, aborted)', () => {
    expect(classifySendError(new TypeError('Failed to fetch'))).toBe('retry')
    expect(classifySendError(undefined)).toBe('retry')
  })
  it('retries timeouts, rate limits, 5xx and an expired session', () => {
    for (const httpStatus of [408, 425, 429, 500, 502, 503, 504, 401]) {
      expect(classifySendError({ data: { httpStatus } })).toBe('retry')
    }
  })
  it('reports refusals the server understood', () => {
    expect(classifySendError({ data: { httpStatus: 400 } })).toBe('fatal')
    expect(classifySendError({ data: { httpStatus: 404 } })).toBe('fatal')
    expect(classifySendError({ data: { httpStatus: 403, code: 'FORBIDDEN' } })).toBe('fatal') // plan without AI
  })
  it('treats a bare 403 from Storage as an expired signed URL → retry, but 413/415 as fatal', () => {
    expect(classifySendError(new UploadHttpError(403))).toBe('retry')
    expect(classifySendError(new UploadHttpError(413))).toBe('fatal')
    expect(classifySendError(new UploadHttpError(415))).toBe('fatal')
    expect(classifySendError(new UploadHttpError(503))).toBe('retry')
  })
  it('reads the status from the tRPC error shape too', () => {
    expect(classifySendError({ shape: { data: { httpStatus: 500 } } })).toBe('retry')
    expect(classifySendError({ shape: { data: { httpStatus: 400 } } })).toBe('fatal')
  })
})

describe('outbox storage (memory backend)', () => {
  beforeEach(() => __resetOutboxForTests())

  it('adds, lists oldest first, gets and removes', async () => {
    const a = await outboxAdd({ kind: 'text', text: 'primero' })
    await new Promise(r => setTimeout(r, 2))
    const b = await outboxAdd({ kind: 'audio', mime: 'audio/mp4', durationSec: 12 })
    expect((await outboxList()).map(i => i.clientId)).toEqual([a.clientId, b.clientId])
    expect((await outboxGet(b.clientId))?.mime).toBe('audio/mp4')
    await outboxRemove(a.clientId)
    expect((await outboxList()).map(i => i.clientId)).toEqual([b.clientId])
  })

  it('keeps the clientId it was given (the idempotency key survives retries)', async () => {
    const x = await outboxAdd({ kind: 'text', text: 'x', clientId: '11111111-1111-4111-8111-111111111111' })
    expect(x.clientId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('a failed attempt backs off and counts; offline waits without counting', async () => {
    const x = await outboxAdd({ kind: 'text', text: 'x' })
    await outboxMarkRetry(x.clientId, new Error('boom'))
    let cur = await outboxGet(x.clientId)
    expect(cur?.attempts).toBe(1)
    expect(cur?.lastError).toBe('boom')
    expect(cur!.nextAttemptAt).toBeGreaterThan(Date.now())

    await outboxMarkRetry(x.clientId, new Error('offline'), { offline: true })
    cur = await outboxGet(x.clientId)
    expect(cur?.attempts).toBe(1) // unchanged
    expect(cur?.failed).toBe(false)
  })

  it('gives up after MAX_ATTEMPTS and a manual retry resets it', async () => {
    const x = await outboxAdd({ kind: 'text', text: 'x' })
    for (let i = 0; i < MAX_ATTEMPTS; i++) await outboxMarkRetry(x.clientId, new Error('nope'))
    expect((await outboxGet(x.clientId))?.failed).toBe(true)
    await outboxRetryNow(x.clientId)
    const cur = await outboxGet(x.clientId)
    expect(cur?.failed).toBe(false)
    expect(cur?.attempts).toBe(0)
    expect(cur!.nextAttemptAt).toBeLessThanOrEqual(Date.now())
  })

  it('notifies subscribers on every change and stops after unsubscribe', async () => {
    let calls = 0
    const off = subscribeOutbox(() => { calls++ })
    const x = await outboxAdd({ kind: 'text', text: 'x' })
    await outboxMarkRetry(x.clientId, new Error('e'))
    await outboxRemove(x.clientId)
    expect(calls).toBe(3)
    off()
    await outboxAdd({ kind: 'text', text: 'y' })
    expect(calls).toBe(3)
  })

  it('in-flight items are skipped by the flusher', async () => {
    const x = await outboxAdd({ kind: 'text', text: 'x' })
    markInFlight(x.clientId)
    const items = await outboxList()
    const { inFlightIds } = await import('./outbox')
    expect(dueItems(items, Date.now() + 1, inFlightIds())).toHaveLength(0)
  })
})
