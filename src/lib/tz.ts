/**
 * Timezone-aware date helpers — centralised so every server path treats
 * "today" / "now" the same way, in the timezone of the calling user/org.
 *
 * THE PROBLEM
 * -----------
 * Cloud Run runs in UTC. Our users span Argentina (UTC-3) and Paraguay
 * (UTC-3) today, with global SaaS scale planned. For ~3 hours every night
 * the server's UTC "today" disagrees with the user's local "today", so
 * naive `new Date().toISOString().split('T')[0]` produces off-by-one bugs.
 *
 * THE FIX
 * -------
 * Every helper accepts an optional `tz` parameter. Calling code resolves
 * the user's effective TZ once (from `ctx.tz` in tRPC, from the org's
 * default in cron handlers) and threads it through.
 *
 * Backward-compat: helpers default to `DEFAULT_TZ` so any legacy call site
 * that hasn't been updated yet keeps working (just with the default TZ
 * instead of the caller's TZ).
 *
 * USAGE
 * -----
 *   import { todayInTZ } from '@/lib/tz'
 *   const today = todayInTZ(undefined, ctx.tz)        // tRPC: pass ctx.tz
 *   const today = todayInTZ(undefined, org.timezone)   // cron: per-org loop
 *
 * Formatters are cached per TZ — instantiation isn't free and we call this
 * dozens of times per request.
 */

/** Org-wide and SaaS-wide fallback when no other TZ info is available. */
export const DEFAULT_TZ = 'America/Argentina/Buenos_Aires'

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = dateFormatterCache.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dateFormatterCache.set(tz, fmt)
  }
  return fmt
}

/** Today's date (YYYY-MM-DD) in the given timezone. */
export function todayInTZ(now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  return dateFormatter(tz).format(now)
}

/** Yesterday in TZ. */
export function yesterdayInTZ(now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  return addDays(todayInTZ(now, tz), -1)
}

/** Add N days to a YYYY-MM-DD string. Pure string math — TZ-independent. */
export function addDays(isoDate: string, days: number): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return isoDate
  // Anchor at noon UTC to avoid DST/timezone shift accidents during +days math.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Inclusive day-difference between two YYYY-MM-DD strings. */
export function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00Z').getTime()
  const db = new Date(b + 'T12:00:00Z').getTime()
  return Math.round((db - da) / 86_400_000)
}

/**
 * Start (Monday 00:00 local) of the week containing `now`, expressed as an
 * ISO UTC datetime suitable for `gte` filters on TIMESTAMPTZ columns.
 */
export function startOfWeekUTC(now: Date = new Date(), tz: string = DEFAULT_TZ): string {
  const today = todayInTZ(now, tz)
  const probe = new Date(today + 'T12:00:00Z')
  const dow = probe.getUTCDay()
  const offsetToMon = (dow + 6) % 7
  const monday = addDays(today, -offsetToMon)
  return localDateAtToUTC(monday, 0, 0, tz)
}

/**
 * Convert a "wall-clock" date+time in TZ to a UTC ISO string.
 * Handles DST automatically by querying the actual offset for that instant.
 *
 *   localDateAtToUTC('2026-06-08', 0, 0, 'America/Argentina/Buenos_Aires')
 *   // → "2026-06-08T03:00:00.000Z"
 */
export function localDateAtToUTC(isoDate: string, hour: number, minute: number, tz: string = DEFAULT_TZ): string {
  const guess = new Date(`${isoDate}T${pad(hour)}:${pad(minute)}:00Z`)
  const offsetMin = tzOffsetMinutes(guess, tz)
  return new Date(guess.getTime() - offsetMin * 60_000).toISOString()
}

function tzOffsetMinutes(d: Date, tz: string): number {
  const tzString = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const utcString = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  return Math.round((partsToMs(tzString) - partsToMs(utcString)) / 60_000)
}

function partsToMs(parts: Intl.DateTimeFormatPart[]): number {
  const obj: Record<string, string> = {}
  for (const p of parts) obj[p.type] = p.value
  const hour = obj.hour === '24' ? 0 : Number(obj.hour)
  return Date.UTC(Number(obj.year), Number(obj.month) - 1, Number(obj.day), hour, Number(obj.minute))
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Compare a DATE column (YYYY-MM-DD) against today-in-TZ. */
export function dateStatusInTZ(
  isoDate: string | null | undefined,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): 'overdue' | 'today' | 'future' | 'none' {
  if (!isoDate) return 'none'
  const today = todayInTZ(now, tz)
  const d = isoDate.slice(0, 10)
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  return 'future'
}

/**
 * Quickly validate that a string is a real IANA timezone (e.g. accepted by
 * Intl). Use this before persisting a user-supplied TZ.
 */
export function isValidTZ(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * A curated list of common timezones for FARO's South-America-first market,
 * plus major hubs. Used by the settings TZ selector.
 */
export const COMMON_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires) · UTC-3' },
  { value: 'America/Asuncion',               label: 'Paraguay (Asunción) · UTC-3/-4' },
  { value: 'America/Montevideo',             label: 'Uruguay (Montevideo) · UTC-3' },
  { value: 'America/Santiago',               label: 'Chile (Santiago) · UTC-3/-4' },
  { value: 'America/Sao_Paulo',              label: 'Brasil (São Paulo) · UTC-3' },
  { value: 'America/La_Paz',                 label: 'Bolivia (La Paz) · UTC-4' },
  { value: 'America/Lima',                   label: 'Perú (Lima) · UTC-5' },
  { value: 'America/Bogota',                 label: 'Colombia (Bogotá) · UTC-5' },
  { value: 'America/Caracas',                label: 'Venezuela (Caracas) · UTC-4' },
  { value: 'America/Mexico_City',            label: 'México (CDMX) · UTC-6' },
  { value: 'America/New_York',               label: 'EE.UU. Este (Nueva York) · UTC-5/-4' },
  { value: 'America/Los_Angeles',            label: 'EE.UU. Oeste (Los Ángeles) · UTC-8/-7' },
  { value: 'Europe/Madrid',                  label: 'España (Madrid) · UTC+1/+2' },
  { value: 'Europe/London',                  label: 'Reino Unido (Londres) · UTC+0/+1' },
  { value: 'UTC',                            label: 'UTC' },
]
