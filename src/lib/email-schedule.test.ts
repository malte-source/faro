import { describe, expect, it } from 'vitest'
import {
  decideDigestSend,
  dueWithin48h,
  localClock,
  localDayStartUtc,
  normalizeDigestHour,
  weekEndOf,
  weekdayOf,
  type DigestPrefsLite,
} from './email-schedule'

// America/Argentina/Buenos_Aires is UTC-3 all year (no DST) → deterministic.
const TZ = 'America/Argentina/Buenos_Aires'
// 2026-10-26 is a Monday; 2026-10-22 a Thursday.
const at = (iso: string) => new Date(iso)
const daily = (over: Partial<DigestPrefsLite> = {}): DigestPrefsLite => ({ email_digest: 'daily', digest_hour: 8, last_digest_at: null, ...over })

describe('localClock', () => {
  it('reads the date and hour in the person\'s timezone, not UTC', () => {
    // 2026-10-26 02:30 UTC = 2026-10-25 23:30 in Buenos Aires (Sunday)
    expect(localClock(at('2026-10-26T02:30:00Z'), TZ)).toEqual({ date: '2026-10-25', hour: 23, weekday: 0 })
    // 2026-10-26 11:00 UTC = 08:00 Monday
    expect(localClock(at('2026-10-26T11:00:00Z'), TZ)).toEqual({ date: '2026-10-26', hour: 8, weekday: 1 })
  })
  it('never reports hour 24 at midnight', () => {
    expect(localClock(at('2026-10-26T03:00:00Z'), TZ).hour).toBe(0)
  })
  it('falls back to UTC on a bad timezone instead of throwing', () => {
    expect(localClock(at('2026-10-26T11:00:00Z'), 'Mars/Olympus').hour).toBe(11)
  })
})

describe('weekdayOf / weekEndOf', () => {
  it('knows the calendar', () => {
    expect(weekdayOf('2026-10-22')).toBe(4)
    expect(weekdayOf('2026-10-26')).toBe(1)
  })
  it('ends the Monday→Sunday week on Sunday', () => {
    expect(weekEndOf('2026-10-26')).toBe('2026-11-01') // Monday → next Sunday
    expect(weekEndOf('2026-10-22')).toBe('2026-10-25') // Thursday
    expect(weekEndOf('2026-10-25')).toBe('2026-10-25') // Sunday is its own week end
  })
})

describe('decideDigestSend', () => {
  it('sends at the chosen local hour', () => {
    expect(decideDigestSend(daily(), at('2026-10-22T11:05:00Z'), TZ)).toEqual({ send: true }) // 08:05 local
  })

  it('does not send before the hour or after the grace hour', () => {
    expect(decideDigestSend(daily(), at('2026-10-22T10:55:00Z'), TZ)).toEqual({ send: false, reason: 'not_hour' }) // 07:55
    expect(decideDigestSend(daily(), at('2026-10-22T12:05:00Z'), TZ)).toEqual({ send: true }) // 09:05 = grace retry
    expect(decideDigestSend(daily(), at('2026-10-22T13:05:00Z'), TZ)).toEqual({ send: false, reason: 'not_hour' }) // 10:05
  })

  it('grace can be turned off (strict hour)', () => {
    expect(decideDigestSend(daily(), at('2026-10-22T12:05:00Z'), TZ, 0)).toEqual({ send: false, reason: 'not_hour' })
  })

  it('respects "off"', () => {
    expect(decideDigestSend(daily({ email_digest: 'off' }), at('2026-10-22T11:05:00Z'), TZ)).toEqual({ send: false, reason: 'off' })
  })

  it('never sends twice on the same LOCAL day, even across the UTC date change', () => {
    // sent at 08:00 local (11:00Z); the 09:00 run must skip
    const sent = daily({ last_digest_at: '2026-10-22T11:00:30Z' })
    expect(decideDigestSend(sent, at('2026-10-22T12:05:00Z'), TZ)).toEqual({ send: false, reason: 'already_today' })
    // yesterday's send does not block today's
    const yesterday = daily({ last_digest_at: '2026-10-21T11:00:30Z' })
    expect(decideDigestSend(yesterday, at('2026-10-22T11:05:00Z'), TZ)).toEqual({ send: true })
  })

  it('a send late in the local evening still counts as that local day', () => {
    // 23:30 local on the 21st = 02:30Z on the 22nd. Different UTC date, different local day from the 22nd morning.
    const lateYesterday = daily({ last_digest_at: '2026-10-22T02:30:00Z' })
    expect(decideDigestSend(lateYesterday, at('2026-10-22T11:05:00Z'), TZ)).toEqual({ send: true })
  })

  it('weekly goes out on the local Monday only', () => {
    const weekly = daily({ email_digest: 'weekly' })
    expect(decideDigestSend(weekly, at('2026-10-26T11:05:00Z'), TZ)).toEqual({ send: true }) // Monday 08:05
    expect(decideDigestSend(weekly, at('2026-10-27T11:05:00Z'), TZ)).toEqual({ send: false, reason: 'not_monday' })
    expect(decideDigestSend(weekly, at('2026-10-22T11:05:00Z'), TZ)).toEqual({ send: false, reason: 'not_monday' })
  })

  it('the Monday is decided in the person\'s timezone (Sunday night UTC+ is not Monday here)', () => {
    // 2026-10-26 02:00Z is still Sunday 23:00 in Buenos Aires
    const weekly = daily({ email_digest: 'weekly', digest_hour: 23 })
    expect(decideDigestSend(weekly, at('2026-10-26T02:05:00Z'), TZ)).toEqual({ send: false, reason: 'not_monday' })
  })

  it('digest_hour 23 has no grace past midnight', () => {
    expect(decideDigestSend(daily({ digest_hour: 23 }), at('2026-10-23T02:30:00Z'), TZ)).toEqual({ send: true }) // 23:30 on the 22nd
    expect(decideDigestSend(daily({ digest_hour: 23 }), at('2026-10-23T03:30:00Z'), TZ)).toEqual({ send: false, reason: 'not_hour' }) // 00:30 on the 23rd
  })
})

describe('localDayStartUtc', () => {
  it('is local midnight expressed in UTC', () => {
    expect(localDayStartUtc(at('2026-10-22T15:00:00Z'), TZ)).toBe('2026-10-22T03:00:00.000Z')
  })
})

describe('normalizeDigestHour / dueWithin48h', () => {
  it('clamps garbage to 8', () => {
    expect(normalizeDigestHour(6)).toBe(6)
    expect(normalizeDigestHour(0)).toBe(0)
    expect(normalizeDigestHour(24)).toBe(8)
    expect(normalizeDigestHour(-1)).toBe(8)
    expect(normalizeDigestHour('x')).toBe(8)
    expect(normalizeDigestHour(7.5)).toBe(8)
  })
  it('due within two days, overdue included, no date excluded', () => {
    expect(dueWithin48h('2026-10-22', '2026-10-22')).toBe(true)
    expect(dueWithin48h('2026-10-24', '2026-10-22')).toBe(true)
    expect(dueWithin48h('2026-10-25', '2026-10-22')).toBe(false)
    expect(dueWithin48h('2026-10-01', '2026-10-22')).toBe(true)
    expect(dueWithin48h(null, '2026-10-22')).toBe(false)
  })
})
