import { addDays, localDateAtToUTC } from '@/lib/tz'

/**
 * When does someone's email digest go out? Pure functions (no DB, no clock reads) so the
 * scheduling rules — the part that could spam people — are unit-tested.
 *
 * The job runs HOURLY. For each person it asks `decideDigestSend` with their own timezone:
 *   - 'off'                       → never
 *   - local hour must be in [digest_hour, digest_hour + GRACE]  (the grace hour lets the next
 *                                   run retry a send that failed — the claim is released on failure)
 *   - 'weekly'                    → only on their local Monday
 *   - already sent on their local "today"  → no (this is also what stops overlapping runs;
 *                                   the DB claim in email-digest.ts makes it atomic)
 */

export const DIGEST_GRACE_HOURS = 1

export type DigestMode = 'off' | 'daily' | 'weekly'

export interface LocalClock {
  /** YYYY-MM-DD in the person's timezone. */
  date: string
  /** 0–23 */
  hour: number
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
}

/** Calendar day of week for a YYYY-MM-DD string (timezone-free). */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay()
}

export function localClock(now: Date, tz: string): LocalClock {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
    const date = `${get('year')}-${get('month')}-${get('day')}`
    return { date, hour: Number(get('hour')) % 24, weekday: weekdayOf(date) }
  } catch {
    const date = now.toISOString().slice(0, 10)
    return { date, hour: now.getUTCHours(), weekday: weekdayOf(date) }
  }
}

/** Sunday (end of the Monday→Sunday week) of the week containing `isoDate`. */
export function weekEndOf(isoDate: string): string {
  return addDays(isoDate, (7 - weekdayOf(isoDate)) % 7)
}

/** UTC instant of the person's local midnight today — rows with `last_digest_at` before it were not sent "today". */
export function localDayStartUtc(now: Date, tz: string): string {
  return localDateAtToUTC(localClock(now, tz).date, 0, 0, tz)
}

export interface DigestPrefsLite {
  email_digest: DigestMode
  digest_hour: number
  last_digest_at: string | null
}

export type DigestSkip = 'off' | 'not_hour' | 'not_monday' | 'already_today'
export type DigestDecision = { send: true } | { send: false; reason: DigestSkip }

export function decideDigestSend(
  prefs: DigestPrefsLite,
  now: Date,
  tz: string,
  graceHours: number = DIGEST_GRACE_HOURS,
): DigestDecision {
  if (prefs.email_digest === 'off') return { send: false, reason: 'off' }
  const clock = localClock(now, tz)
  if (prefs.email_digest === 'weekly' && clock.weekday !== 1) return { send: false, reason: 'not_monday' }
  if (clock.hour < prefs.digest_hour || clock.hour > prefs.digest_hour + graceHours) return { send: false, reason: 'not_hour' }
  if (prefs.last_digest_at && localClock(new Date(prefs.last_digest_at), tz).date === clock.date) {
    return { send: false, reason: 'already_today' }
  }
  return { send: true }
}

/** Valid hour 0–23, anything else falls back to 8. */
export function normalizeDigestHour(value: unknown): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 8
}

/** Is `due` today or within the next two calendar days (or already overdue)? "Due within 48 hours". */
export function dueWithin48h(due: string | null | undefined, todayIso: string): boolean {
  if (!due) return false
  return due <= addDays(todayIso, 2)
}
