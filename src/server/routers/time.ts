import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

/**
 * Time tracking.
 *
 * Invariants:
 *  - At most one ACTIVE entry per user (DB unique partial index enforces it)
 *  - duration_minutes is computed at stop time (ended_at - started_at)
 *  - Manual entries always have both started_at + ended_at + duration
 *
 * IDOR guard via ctx.projectIds — every entry references a task whose
 * project must be in the user's projects.
 */
export const timeRouter = createTRPCRouter({
  /**
   * Returns the user's currently-active timer if any.
   *
   * Resilient: this query runs on EVERY page (sidebar pill) and gets
   * batched with other queries. If the time_entries table is missing
   * (migration not yet run) we return null instead of throwing — a 500
   * here would otherwise fail the whole tRPC batch and break unrelated
   * pages like the projects list.
   */
  current: protectedProcedure.query(async ({ ctx }) => {
    try {
      const { data, error } = await ctx.supabase
        .from('time_entries')
        .select('*, task:tasks(id, title, project:projects(id, code, name, color))')
        .eq('user_id', ctx.me.id)
        .is('ended_at', null)
        .maybeSingle()
      if (error) {
        console.warn('[time.current] non-fatal:', error.message)
        return null
      }
      return data
    } catch (err) {
      console.warn('[time.current] non-fatal:', err)
      return null
    }
  }),

  /**
   * Start a new timer on `taskId`. If the user already has an active
   * timer, it is auto-stopped first.
   */
  start: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify task is in our org
      const { data: task } = await ctx.supabase
        .from('tasks').select('project_id').eq('id', input.taskId).maybeSingle()
      if (!task || !ctx.projectIds.includes(task.project_id)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      // Auto-stop the existing active timer if any
      const { data: existing } = await ctx.supabase
        .from('time_entries')
        .select('id, started_at, task_id')
        .eq('user_id', ctx.me.id)
        .is('ended_at', null)
        .maybeSingle()
      if (existing) {
        if (existing.task_id === input.taskId) {
          // Already running for this task → no-op
          return existing
        }
        const now = new Date()
        const start = new Date(existing.started_at)
        const minutes = Math.max(1, Math.round((now.getTime() - start.getTime()) / 60_000))
        await ctx.supabase
          .from('time_entries')
          .update({ ended_at: now.toISOString(), duration_minutes: minutes })
          .eq('id', existing.id)
      }

      const { data, error } = await ctx.supabase
        .from('time_entries')
        .insert({
          task_id: input.taskId,
          user_id: ctx.me.id,
          started_at: new Date().toISOString(),
          source: 'timer',
        })
        .select()
        .single()
      if (error) throw error
      return data
    }),

  /** Stop the user's active timer (no-op if none). */
  stop: protectedProcedure.mutation(async ({ ctx }) => {
    const { data: existing } = await ctx.supabase
      .from('time_entries')
      .select('id, started_at')
      .eq('user_id', ctx.me.id)
      .is('ended_at', null)
      .maybeSingle()
    if (!existing) return { stopped: false }

    const now = new Date()
    const start = new Date(existing.started_at)
    const minutes = Math.max(1, Math.round((now.getTime() - start.getTime()) / 60_000))
    const { data, error } = await ctx.supabase
      .from('time_entries')
      .update({ ended_at: now.toISOString(), duration_minutes: minutes })
      .eq('id', existing.id)
      .select()
      .single()
    if (error) throw error
    return { stopped: true, entry: data }
  }),

  /** Manual entry — user backfills time without using the live timer. */
  addManual: protectedProcedure
    .input(z.object({
      taskId: z.string(),
      date: z.string(),             // YYYY-MM-DD
      durationMinutes: z.number().int().min(1).max(24 * 60),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: task } = await ctx.supabase
        .from('tasks').select('project_id').eq('id', input.taskId).maybeSingle()
      if (!task || !ctx.projectIds.includes(task.project_id)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      const startedAt = new Date(input.date + 'T09:00:00Z')
      const endedAt = new Date(startedAt.getTime() + input.durationMinutes * 60_000)
      const { data, error } = await ctx.supabase
        .from('time_entries')
        .insert({
          task_id: input.taskId,
          user_id: ctx.me.id,
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
          duration_minutes: input.durationMinutes,
          notes: input.notes ?? null,
          source: 'manual',
        })
        .select()
        .single()
      if (error) throw error
      return data
    }),

  /** Entries for a task (any user) — used to show "X hs total" + breakdown. */
  listByTask: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input: taskId }) => {
      const { data: task } = await ctx.supabase
        .from('tasks').select('project_id').eq('id', taskId).maybeSingle()
      if (!task || !ctx.projectIds.includes(task.project_id)) return []

      const { data, error } = await ctx.supabase
        .from('time_entries')
        .select('*, user:users(id, name, avatar_url)')
        .eq('task_id', taskId)
        .order('started_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input: entryId }) => {
      // Can only delete own entries
      const { error } = await ctx.supabase
        .from('time_entries')
        .delete()
        .eq('id', entryId)
        .eq('user_id', ctx.me.id)
      if (error) throw error
      return { success: true }
    }),

  /**
   * Weekly summary — total time per user / per project for the current week.
   * Used on the reports / team page.
   */
  weeklySummary: protectedProcedure
    .input(z.object({ weekStart: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      // Default: start of this week (Monday) in UTC.
      const now = new Date()
      const day = now.getUTCDay() // 0 = Sun, 1 = Mon, …
      const offsetToMon = (day + 6) % 7
      const monday = new Date(now)
      monday.setUTCDate(now.getUTCDate() - offsetToMon)
      monday.setUTCHours(0, 0, 0, 0)
      const weekStart = input?.weekStart ?? monday.toISOString().split('T')[0]
      const weekStartISO = new Date(weekStart + 'T00:00:00Z').toISOString()
      const weekEndISO = new Date(new Date(weekStart + 'T00:00:00Z').getTime() + 7 * 86_400_000).toISOString()

      if (ctx.projectIds.length === 0) return { weekStart, byUser: [], byProject: [], total: 0 }

      // Pre-fetch all task IDs in user's org so we don't leak across orgs
      const { data: taskRows } = await ctx.supabase
        .from('tasks').select('id, project_id').in('project_id', ctx.projectIds)
      const taskIds = (taskRows ?? []).map(t => t.id)
      const taskToProject = new Map<string, string>()
      for (const t of (taskRows ?? [])) taskToProject.set(t.id, t.project_id)
      if (taskIds.length === 0) return { weekStart, byUser: [], byProject: [], total: 0 }

      const { data: entries } = await ctx.supabase
        .from('time_entries')
        .select('user_id, task_id, duration_minutes, user:users(id, name, avatar_url)')
        .in('task_id', taskIds)
        .gte('started_at', weekStartISO)
        .lt('started_at', weekEndISO)
        .not('duration_minutes', 'is', null)

      const { data: projects } = await ctx.supabase
        .from('projects').select('id, code, name, color').in('id', ctx.projectIds)
      const projectMap = new Map((projects ?? []).map(p => [p.id, p]))

      const byUserMap = new Map<string, { id: string; name: string; avatar_url: string | null; minutes: number }>()
      const byProjectMap = new Map<string, { id: string; code: string; name: string; color: string; minutes: number }>()
      let total = 0
      for (const e of entries ?? []) {
        const mins = e.duration_minutes ?? 0
        total += mins
        const u = e.user as { id?: string; name?: string; avatar_url?: string | null } | null
        if (u?.id) {
          const cur = byUserMap.get(u.id)
          if (cur) cur.minutes += mins
          else byUserMap.set(u.id, { id: u.id, name: u.name ?? '?', avatar_url: u.avatar_url ?? null, minutes: mins })
        }
        const projId = taskToProject.get(e.task_id)
        if (projId) {
          const p = projectMap.get(projId)
          if (p) {
            const cur = byProjectMap.get(p.id)
            if (cur) cur.minutes += mins
            else byProjectMap.set(p.id, { ...p, minutes: mins })
          }
        }
      }
      return {
        weekStart,
        total,
        byUser: Array.from(byUserMap.values()).sort((a, b) => b.minutes - a.minutes),
        byProject: Array.from(byProjectMap.values()).sort((a, b) => b.minutes - a.minutes),
      }
    }),
})
