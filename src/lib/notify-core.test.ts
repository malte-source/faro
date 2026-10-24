import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFS,
  buildPushPayload,
  decideDelivery,
  dedupeRecipients,
  inQuietHours,
  localMinutes,
  parseClock,
  type NotifyPrefs,
} from './notify-core'

const prefs = (over: Partial<NotifyPrefs> = {}): NotifyPrefs => ({ ...DEFAULT_PREFS, ...over })
const BA = 'America/Argentina/Buenos_Aires' // UTC-3, no DST

describe('dedupeRecipients', () => {
  it('removes duplicates, empties and the actor', () => {
    expect(dedupeRecipients(['a', 'b', 'a', null, undefined, 'c'], 'b')).toEqual(['a', 'c'])
  })
  it('keeps everyone when there is no actor', () => {
    expect(dedupeRecipients(['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('clock helpers', () => {
  it('parses HH:MM and HH:MM:SS, rejects junk', () => {
    expect(parseClock('22:30')).toBe(22 * 60 + 30)
    expect(parseClock('07:05:00')).toBe(7 * 60 + 5)
    expect(parseClock('25:00')).toBeNull()
    expect(parseClock('7pm')).toBeNull()
    expect(parseClock(null)).toBeNull()
  })
  it('reads local minutes in a zone', () => {
    // 2026-10-24T01:30:00Z is 22:30 the day before in Buenos Aires
    expect(localMinutes(new Date('2026-10-24T01:30:00Z'), BA)).toBe(22 * 60 + 30)
  })
})

describe('inQuietHours', () => {
  const night = { quiet_start: '22:00', quiet_end: '07:00' }
  it('wraps midnight', () => {
    expect(inQuietHours(night, new Date('2026-10-24T01:30:00Z'), BA)).toBe(true) // 22:30 local
    expect(inQuietHours(night, new Date('2026-10-24T08:00:00Z'), BA)).toBe(true) // 05:00 local
    expect(inQuietHours(night, new Date('2026-10-24T15:00:00Z'), BA)).toBe(false) // 12:00 local
  })
  it('handles a same-day window and an inclusive start / exclusive end', () => {
    const lunch = { quiet_start: '12:00', quiet_end: '14:00' }
    expect(inQuietHours(lunch, new Date('2026-10-24T15:00:00Z'), BA)).toBe(true) // 12:00
    expect(inQuietHours(lunch, new Date('2026-10-24T17:00:00Z'), BA)).toBe(false) // 14:00
  })
  it('is off when unset, malformed or equal', () => {
    const now = new Date('2026-10-24T01:30:00Z')
    expect(inQuietHours({ quiet_start: null, quiet_end: null }, now, BA)).toBe(false)
    expect(inQuietHours({ quiet_start: 'x', quiet_end: '07:00' }, now, BA)).toBe(false)
    expect(inQuietHours({ quiet_start: '22:00', quiet_end: '22:00' }, now, BA)).toBe(false)
  })
})

describe('decideDelivery', () => {
  const noon = new Date('2026-10-24T15:00:00Z')
  it('delivers by default, with no stored prefs', () => {
    expect(decideDelivery(null, 'mention', noon, BA)).toEqual({ store: true, push: true, reason: 'deliver' })
  })
  it('a muted kind is neither stored nor pushed', () => {
    expect(decideDelivery(prefs({ kinds: { mention: false } }), 'mention', noon, BA)).toEqual({ store: false, push: false, reason: 'kind_muted' })
    expect(decideDelivery(prefs({ kinds: { mention: false } }), 'dm', noon, BA).push).toBe(true)
  })
  it('push off keeps the inbox', () => {
    expect(decideDelivery(prefs({ push_enabled: false }), 'dm', noon, BA)).toEqual({ store: true, push: false, reason: 'push_disabled' })
  })
  it('quiet hours keep the inbox but drop the push', () => {
    const p = prefs({ quiet_start: '22:00', quiet_end: '07:00' })
    expect(decideDelivery(p, 'dm', new Date('2026-10-24T02:00:00Z'), BA)).toEqual({ store: true, push: false, reason: 'quiet_hours' })
  })
  it('an explicit true override does not mute', () => {
    expect(decideDelivery(prefs({ kinds: { dm: true } }), 'dm', noon, BA).push).toBe(true)
  })
})

describe('buildPushPayload', () => {
  it('clips long text and keeps links inside the app', () => {
    const p = buildPushPayload({ title: 'T'.repeat(200), body: 'B'.repeat(500), url: 'https://evil.example/x', kind: 'mention', unread: 3 })
    expect(p.title.length).toBeLessThanOrEqual(80)
    expect(p.body.length).toBeLessThanOrEqual(160)
    expect(p.url).toBe('/dashboard/bandeja')
    expect(p.unread).toBe(3)
  })
  it('keeps an in-app url and tags per entity so repeats replace each other', () => {
    const p = buildPushPayload({ title: 'Hola', url: '/dashboard/chat?c=1', kind: 'dm', entityId: 'abc', unread: 1200 })
    expect(p.url).toBe('/dashboard/chat?c=1')
    expect(p.tag).toBe('dm:abc')
    expect(p.unread).toBe(999)
    expect(p.body).toBe('')
  })
})
