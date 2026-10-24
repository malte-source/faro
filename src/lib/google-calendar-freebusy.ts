/**
 * Free/busy queries + slot-finding algorithm.
 *
 * Built on raw fetch (same as google-calendar.ts) to avoid the 60 MB
 * googleapis dependency.
 *
 * The freeBusy.query endpoint is special: it returns ONLY busy blocks (no
 * event details), and in Google Workspace it works org-wide by default —
 * any user in the same Workspace domain can see anyone else's busy times
 * without explicit calendar sharing. That's exactly the access level we need
 * (privacy-preserving + good enough to find slots).
 *
 * If a user is OUTSIDE the calling user's Workspace, the request silently
 * returns empty busy arrays for that calendar. The caller can detect this
 * and either skip them or fall back to assuming they're always free.
 */

const FREE_BUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'

export interface BusyBlock {
  /** ISO-8601 datetime (with timezone offset) */
  start: string
  /** ISO-8601 datetime (with timezone offset) */
  end: string
}

export interface FreeBusyResult {
  /** Per-calendar busy blocks, keyed by the calendar id (= email) */
  calendars: Record<string, { busy: BusyBlock[]; errors?: { domain: string; reason: string }[] }>
}

/**
 * Query free/busy for a list of calendars in a time window.
 *
 * Calendar identifiers are typically the user's primary email. The Google API
 * caps requests at 50 calendars × 90 days, so callers should chunk if needed.
 */
export async function getFreeBusy(
  accessToken: string,
  emails: string[],
  timeMin: Date,
  timeMax: Date,
  timeZone = 'America/Argentina/Buenos_Aires',
): Promise<FreeBusyResult> {
  if (!emails.length) return { calendars: {} }
  const res = await fetch(FREE_BUSY_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone,
      items: emails.map(id => ({ id })),
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Calendar freeBusy ${res.status}: ${text.slice(0, 300)}`)
  }
  return (await res.json()) as FreeBusyResult
}

// ── Slot-finding algorithm ────────────────────────────────────────────

export interface FreeSlot {
  /** ISO-8601 datetime (with TZ offset) */
  start: string
  /** ISO-8601 datetime (with TZ offset) */
  end: string
  /** Day-of-week label for the UI (Lun, Mar, ...) */
  dayLabel: string
}

export interface WorkHours {
  /** 0..23, inclusive */
  startHour: number
  /** 0..23, exclusive (e.g. 18 means slots can end at 18:00) */
  endHour: number
  /** Days of week to include. 0=Sun, 1=Mon, ... 6=Sat. Default Mon-Fri. */
  weekdays?: number[]
}

const DEFAULT_WORK: WorkHours = { startHour: 9, endHour: 18, weekdays: [1, 2, 3, 4, 5] }
const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

/**
 * Given busy intervals for one or more calendars, find time slots of
 * `durationMinutes` where EVERY calendar is free, within work hours, and
 * within the search window.
 *
 * Algorithm:
 *   1. Merge all calendars' busy arrays into one big sorted, merged list.
 *   2. For each weekday in the window, build the day's working window.
 *   3. Subtract busy blocks from that window → gaps.
 *   4. For each gap, emit consecutive slots of `durationMinutes` until the gap is used up.
 *
 * Returns up to `maxResults` of the EARLIEST slots — users almost always
 * want "as soon as possible".
 *
 * All datetime math is done in milliseconds (UTC), but slot start/end are
 * formatted in the requested time zone offset so the UI displays sensibly.
 */
export function findCommonFreeSlots(opts: {
  busyArraysPerCalendar: BusyBlock[][]
  windowStart: Date
  windowEnd: Date
  durationMinutes: number
  workHours?: WorkHours
  /** Don't return slots starting before this offset from `windowStart` (default 15 min — gives the user reaction time) */
  earliestOffsetMinutes?: number
  maxResults?: number
  /** Minute granularity for slot starts. 15 = slots start on :00, :15, :30, :45. Default 30. */
  granularityMinutes?: number
}): FreeSlot[] {
  const work = opts.workHours ?? DEFAULT_WORK
  const weekdays = work.weekdays ?? DEFAULT_WORK.weekdays!
  const granularity = opts.granularityMinutes ?? 30
  const earliest = new Date(opts.windowStart.getTime() + (opts.earliestOffsetMinutes ?? 15) * 60_000)
  const max = opts.maxResults ?? 5
  const durationMs = opts.durationMinutes * 60_000

  // Merge all busy arrays into one sorted, coalesced list.
  const merged = mergeBusy(opts.busyArraysPerCalendar.flat())

  const slots: FreeSlot[] = []
  // Iterate day by day in the search window.
  const cursor = new Date(opts.windowStart)
  cursor.setHours(0, 0, 0, 0)
  while (cursor < opts.windowEnd && slots.length < max) {
    const dow = cursor.getDay()
    if (weekdays.includes(dow)) {
      const dayStart = new Date(cursor); dayStart.setHours(work.startHour, 0, 0, 0)
      const dayEnd   = new Date(cursor); dayEnd.setHours(work.endHour, 0, 0, 0)
      // Compute the "free" intervals = day window − merged busy
      const dayFree = subtractBusy({ start: dayStart, end: dayEnd }, merged)
      for (const free of dayFree) {
        // Round start UP to next granularity boundary, and respect `earliest`
        let s = roundUp(free.start, granularity)
        if (s < earliest) s = roundUp(earliest, granularity)
        while (s.getTime() + durationMs <= free.end.getTime() && slots.length < max) {
          const e = new Date(s.getTime() + durationMs)
          slots.push({
            start: s.toISOString(),
            end: e.toISOString(),
            dayLabel: DOW_LABELS[s.getDay()],
          })
          s = new Date(s.getTime() + granularity * 60_000)
        }
        if (slots.length >= max) break
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return slots
}

/**
 * Merge overlapping/touching busy blocks into a sorted, coalesced list.
 * Touching blocks (end of A == start of B) are joined into one.
 */
function mergeBusy(blocks: BusyBlock[]): { start: Date; end: Date }[] {
  if (!blocks.length) return []
  const parsed = blocks
    .map(b => ({ start: new Date(b.start), end: new Date(b.end) }))
    .filter(b => !isNaN(b.start.getTime()) && !isNaN(b.end.getTime()) && b.end > b.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  const out: { start: Date; end: Date }[] = []
  for (const b of parsed) {
    const last = out[out.length - 1]
    if (last && b.start <= last.end) {
      if (b.end > last.end) last.end = b.end
    } else {
      out.push({ start: new Date(b.start), end: new Date(b.end) })
    }
  }
  return out
}

/** Return the gaps inside [window.start, window.end] not covered by busy. */
function subtractBusy(
  window: { start: Date; end: Date },
  busy: { start: Date; end: Date }[],
): { start: Date; end: Date }[] {
  const free: { start: Date; end: Date }[] = []
  let cursor = window.start
  for (const b of busy) {
    if (b.end <= cursor) continue
    if (b.start >= window.end) break
    if (b.start > cursor) free.push({ start: cursor, end: b.start < window.end ? b.start : window.end })
    cursor = b.end > cursor ? b.end : cursor
    if (cursor >= window.end) break
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end })
  return free.filter(f => f.end > f.start)
}

function roundUp(d: Date, minutes: number): Date {
  const ms = minutes * 60_000
  return new Date(Math.ceil(d.getTime() / ms) * ms)
}

/**
 * Compute % of work hours that are busy on a given day for one calendar.
 * Used by the Capacity Board.
 */
export function busyPercentForDay(busy: BusyBlock[], day: Date, work: WorkHours = DEFAULT_WORK): number {
  const dayStart = new Date(day); dayStart.setHours(work.startHour, 0, 0, 0)
  const dayEnd   = new Date(day); dayEnd.setHours(work.endHour, 0, 0, 0)
  const totalMs = dayEnd.getTime() - dayStart.getTime()
  if (totalMs <= 0) return 0
  const merged = mergeBusy(busy)
  let busyMs = 0
  for (const b of merged) {
    const start = b.start > dayStart ? b.start : dayStart
    const end   = b.end   < dayEnd   ? b.end   : dayEnd
    if (end > start) busyMs += end.getTime() - start.getTime()
  }
  return Math.min(100, Math.round((busyMs / totalMs) * 100))
}
