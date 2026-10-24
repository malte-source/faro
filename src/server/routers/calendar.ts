import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { getFreeBusy, findCommonFreeSlots, busyPercentForDay, type WorkHours } from '@/lib/google-calendar-freebusy'
import { createCalendarEvent } from '@/lib/google-calendar'

const APP_URL = process.env.AUTH_URL ?? 'https://faro-app-303070777698.southamerica-east1.run.app'

const TZ = 'America/Argentina/Buenos_Aires'
const DEFAULT_WORK: WorkHours = { startHour: 9, endHour: 18, weekdays: [1, 2, 3, 4, 5] }

const workHoursSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
}).optional()

/**
 * Calendar-aware features built on top of Google Calendar freeBusy.
 *
 * All procedures require the caller to have a Google access token (granted at
 * login via the calendar scope). Cross-user free/busy queries work inside the
 * same Workspace domain by default — no extra setup needed.
 */
export const calendarRouter = createTRPCRouter({
  /**
   * Find slots of `durationMinutes` where ALL specified team members are free.
   * Used by the meeting scheduler.
   */
  findCommonSlots: protectedProcedure
    .input(z.object({
      userIds: z.array(z.string()).min(1).max(20),
      durationMinutes: z.number().int().min(15).max(480),
      windowDays: z.number().int().min(1).max(30).default(7),
      workHours: workHoursSchema,
      maxResults: z.number().int().min(1).max(20).default(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sin token de Google — relogueate.' })

      // Resolve user emails (Calendar IDs); verify all are in the same org.
      const { data: users } = await ctx.supabase
        .from('users').select('id, email, name').in('id', input.userIds).eq('org_id', ctx.me.org_id)
      if (!users?.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No se encontraron usuarios válidos.' })
      const emails = users.map(u => u.email!).filter(Boolean)

      const now = new Date()
      const windowEnd = new Date(now.getTime() + input.windowDays * 86400_000)

      let fb
      try {
        fb = await getFreeBusy(accessToken, emails, now, windowEnd, TZ)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Calendar API: ${msg}` })
      }

      // Build per-calendar busy arrays in input order (so we can report errors)
      const perCalendar = emails.map(e => fb.calendars[e]?.busy ?? [])
      const slots = findCommonFreeSlots({
        busyArraysPerCalendar: perCalendar,
        windowStart: now,
        windowEnd,
        durationMinutes: input.durationMinutes,
        workHours: input.workHours ?? DEFAULT_WORK,
        maxResults: input.maxResults,
      })

      // Report which calendars came back with errors (often: user not in domain)
      const calendarErrors = emails
        .map(e => ({ email: e, errors: fb.calendars[e]?.errors }))
        .filter(c => c.errors?.length)

      return { slots, attendees: users, calendarErrors }
    }),

  /** Find focus slots in ONE user's calendar — for the per-task focus picker. */
  suggestFocusSlots: protectedProcedure
    .input(z.object({
      userId: z.string(),
      durationMinutes: z.number().int().min(15).max(480),
      windowDays: z.number().int().min(1).max(14).default(7),
      workHours: workHoursSchema,
      maxResults: z.number().int().min(1).max(10).default(5),
    }))
    .mutation(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sin token de Google — relogueate.' })

      const { data: user } = await ctx.supabase
        .from('users').select('id, email, name').eq('id', input.userId).eq('org_id', ctx.me.org_id).single()
      if (!user?.email) throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario sin email.' })

      const now = new Date()
      const windowEnd = new Date(now.getTime() + input.windowDays * 86400_000)
      const fb = await getFreeBusy(accessToken, [user.email], now, windowEnd, TZ)
      const slots = findCommonFreeSlots({
        busyArraysPerCalendar: [fb.calendars[user.email]?.busy ?? []],
        windowStart: now,
        windowEnd,
        durationMinutes: input.durationMinutes,
        workHours: input.workHours ?? DEFAULT_WORK,
        maxResults: input.maxResults,
      })
      return { slots, user }
    }),

  /**
   * Book a focus-time block on the caller's own Calendar, linked to a task.
   * Only the caller's calendar is touched — never a teammate's.
   */
  bookFocusTime: protectedProcedure
    .input(z.object({
      taskId: z.string(),
      start: z.string(),  // ISO datetime
      end: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sin token de Google.' })

      // Auth + resolve task
      const { data: task } = await ctx.supabase
        .from('tasks')
        .select('id, title, project_id, project:projects(id, code, name)')
        .eq('id', input.taskId)
        .in('project_id', ctx.projectIds)
        .single()
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tarea no encontrada.' })

      const proj = task.project as { id: string; code: string; name: string } | null
      const link = proj ? `${APP_URL}/dashboard/projects/${proj.id}` : APP_URL

      const event = await createCalendarEvent(accessToken, {
        summary: `🎯 Focus: ${task.title}`,
        description: `Bloque de foco para tarea de FARO.\n\nProyecto: ${proj?.code ?? ''} ${proj?.name ?? ''}\n${link}`,
        start: { dateTime: input.start, timeZone: TZ },
        end:   { dateTime: input.end,   timeZone: TZ },
        colorId: '5',  // yellow — visually distinct from regular meetings
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 5 }] },
        source: { title: `[${proj?.code ?? 'FARO'}] ${task.title}`, url: link },
      })
      return { eventId: event.id, htmlLink: event.htmlLink }
    }),

  /**
   * Schedule a meeting: book the chosen slot as a Calendar event with all
   * attendees invited (Google sends emails automatically).
   */
  scheduleMeeting: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      description: z.string().optional(),
      start: z.string(),
      end: z.string(),
      attendeeUserIds: z.array(z.string()).min(1).max(20),
      projectId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sin token de Google.' })

      const { data: users } = await ctx.supabase
        .from('users').select('email').in('id', input.attendeeUserIds).eq('org_id', ctx.me.org_id)
      const emails = (users ?? []).map(u => u.email!).filter(Boolean)
      if (!emails.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sin destinatarios válidos.' })

      let link = APP_URL
      if (input.projectId && ctx.projectIds.includes(input.projectId)) {
        link = `${APP_URL}/dashboard/projects/${input.projectId}`
      }

      const event = await createCalendarEvent(accessToken, {
        summary: input.title,
        description: [
          input.description ?? '',
          '',
          `Coordinado desde FARO: ${link}`,
        ].filter(Boolean).join('\n'),
        start: { dateTime: input.start, timeZone: TZ },
        end:   { dateTime: input.end,   timeZone: TZ },
        attendees: emails.map(email => ({ email })),
        sendUpdates: 'all',  // Google emails the invites
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
        source: { title: 'FARO', url: link },
      })
      return { eventId: event.id, htmlLink: event.htmlLink, attendees: emails }
    }),

  /**
   * Team capacity grid for the next N days. For each (user, day) returns
   * the % of working hours that are busy in Calendar.
   *
   * This is a heavy query (one freeBusy roundtrip per request), so it's
   * gated to admins by default — surface for capacity planning, not for
   * everyone's homepage.
   */
  capacity: protectedProcedure
    .input(z.object({
      windowDays: z.number().int().min(1).max(14).default(7),
      workHours: workHoursSchema,
    }).optional())
    .query(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sin token de Google.' })

      const { data: users } = await ctx.supabase
        .from('users').select('id, name, email, avatar_url')
        .eq('org_id', ctx.me.org_id)
        .not('email', 'is', null)
        .order('name')
      if (!users?.length) return { users: [], days: [], grid: [] }

      const emails = users.map(u => u.email!).filter(Boolean)
      const now = new Date(); now.setHours(0, 0, 0, 0)
      const windowDays = input?.windowDays ?? 7
      const windowEnd = new Date(now.getTime() + windowDays * 86400_000)
      const work = input?.workHours ?? DEFAULT_WORK

      let fb
      try {
        fb = await getFreeBusy(accessToken, emails, now, windowEnd, TZ)
      } catch (err) {
        // Be forgiving — return an empty grid + a warning so the UI can show why.
        return { users, days: [], grid: [], error: err instanceof Error ? err.message : String(err) }
      }

      // Build the days list (only weekdays in workHours.weekdays)
      const weekdays = work.weekdays ?? DEFAULT_WORK.weekdays!
      const days: { iso: string; label: string }[] = []
      const cursor = new Date(now)
      while (cursor < windowEnd) {
        if (weekdays.includes(cursor.getDay())) {
          days.push({
            iso: cursor.toISOString().slice(0, 10),
            label: cursor.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' }),
          })
        }
        cursor.setDate(cursor.getDate() + 1)
      }

      // grid[userIndex][dayIndex] = busyPct (0-100)
      const grid = users.map(u => {
        const busy = fb.calendars[u.email!]?.busy ?? []
        return days.map(d => busyPercentForDay(busy, new Date(d.iso + 'T00:00:00'), work))
      })

      return { users, days, grid }
    }),

  /**
   * Check if a task's assignee has back-to-back meetings on the due date.
   * Returns a simple busyPct + has_conflict flag. Used to show a warning
   * banner on task detail.
   */
  checkDeadlineConflict: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ ctx, input }) => {
      const accessToken = ctx.session.accessToken
      if (!accessToken) return { has_conflict: false, busyPct: 0 }

      const { data: task } = await ctx.supabase
        .from('tasks')
        .select('due_date, assignee_id, assignee:users!tasks_assignee_id_fkey(email)')
        .eq('id', input.taskId)
        .in('project_id', ctx.projectIds)
        .single()
      if (!task?.due_date || !task.assignee_id) return { has_conflict: false, busyPct: 0 }
      const email = (task.assignee as { email?: string } | null)?.email
      if (!email) return { has_conflict: false, busyPct: 0 }

      const day = new Date(task.due_date + 'T00:00:00')
      const nextDay = new Date(day.getTime() + 86400_000)
      try {
        const fb = await getFreeBusy(accessToken, [email], day, nextDay, TZ)
        const busy = fb.calendars[email]?.busy ?? []
        const pct = busyPercentForDay(busy, day, DEFAULT_WORK)
        return { has_conflict: pct >= 70, busyPct: pct }
      } catch {
        return { has_conflict: false, busyPct: 0 }
      }
    }),
})
