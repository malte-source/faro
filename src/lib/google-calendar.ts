/**
 * Thin wrapper around the Google Calendar REST API.
 *
 * We use raw fetch instead of the `googleapis` npm package to avoid pulling
 * in a 60 MB dependency for two endpoints.
 *
 * All functions take the user's access_token directly — caller is responsible
 * for getting a fresh token from the NextAuth JWT (auth() automatically
 * refreshes it before it expires, see src/lib/auth.ts).
 */

const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

export interface CalendarEventInput {
  summary: string
  description?: string
  start: { date: string } | { dateTime: string; timeZone?: string }
  end: { date: string } | { dateTime: string; timeZone?: string }
  /** Optional URL written into the event description for back-linking to FARO */
  source?: { title: string; url: string }
  /** Optional attendees — used for "schedule meeting" feature */
  attendees?: { email: string; optional?: boolean }[]
  /** If attendees present, whether Google should send them invites. Default true. */
  sendUpdates?: 'all' | 'externalOnly' | 'none'
  /** Optional reminders override. Default: 10 min popup. */
  reminders?: { useDefault: false; overrides: { method: 'popup' | 'email'; minutes: number }[] }
  /** Optional color id (1-11) for visual differentiation in Calendar */
  colorId?: string
}

export interface CalendarEvent extends CalendarEventInput {
  id: string
  htmlLink: string
}

async function call<T>(
  accessToken: string,
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Calendar ${res.status}: ${text}`)
  }
  // DELETE returns 204 No Content
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function createCalendarEvent(
  accessToken: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  // sendUpdates lives in the query string, not the body — pull it out.
  const { sendUpdates, ...body } = input
  const qs = sendUpdates ? `?sendUpdates=${sendUpdates}` : ''
  return call<CalendarEvent>(accessToken, `${BASE}${qs}`, { method: 'POST', body })
}

export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  patch: Partial<CalendarEventInput>,
): Promise<CalendarEvent> {
  return call<CalendarEvent>(accessToken, `${BASE}/${eventId}`, {
    method: 'PATCH',
    body: patch,
  })
}

export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string,
): Promise<void> {
  await call<void>(accessToken, `${BASE}/${eventId}`, { method: 'DELETE' })
}

/**
 * Convenience: build a Calendar event payload from a FARO project.
 * If start_date == end_date we treat it as a 1-day all-day event.
 */
export function projectToCalendarEvent(p: {
  name: string
  code: string
  description?: string | null
  start_date: string
  end_date: string
  id: string
  appUrl: string
}): CalendarEventInput {
  return {
    summary: `[${p.code}] ${p.name}`,
    description: [
      p.description ?? '',
      '',
      `Proyecto en FARO: ${p.appUrl}/dashboard/projects/${p.id}`,
    ].filter(Boolean).join('\n'),
    start: { date: p.start_date },
    // Google Calendar's all-day events use EXCLUSIVE end dates — add 1 day
    // so a project ending on 2026-06-15 shows the bar through that day.
    end: { date: addDays(p.end_date, 1) },
    source: { title: 'FARO', url: `${p.appUrl}/dashboard/projects/${p.id}` },
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}
