import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

/**
 * Sprint planning. Sprints are org-level time-boxed iterations. Tasks
 * (across any project) can be assigned to a sprint via tasks.sprint_id.
 *
 * Org isolation: sprints filtered by org_id; task assignment validated
 * against ctx.projectIds.
 */
export const sprintsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('sprints')
      .select('*')
      .eq('org_id', ctx.me.org_id)
      .order('start_date', { ascending: false })
    if (error) throw error
    return data ?? []
  }),

  /** Sprint + its tasks (grouped client-side) + velocity metric. */
  byId: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const { data: sprint } = await ctx.supabase
        .from('sprints').select('*').eq('id', input).eq('org_id', ctx.me.org_id).maybeSingle()
      if (!sprint) throw new TRPCError({ code: 'NOT_FOUND' })

      const { data: tasks } = await ctx.supabase
        .from('tasks')
        .select('id, title, status, priority, due_date, assignee:users!tasks_assignee_id_fkey(id, name, avatar_url), project:projects(id, code, color)')
        .eq('sprint_id', input)
        .order('position')

      const all = tasks ?? []
      const done = all.filter(t => t.status === 'done').length
      return {
        ...sprint,
        tasks: all,
        velocity: { total: all.length, done, pct: all.length ? Math.round((done / all.length) * 100) : 0 },
      }
    }),

  /** Backlog: tasks in the org with no sprint assigned (limited). */
  backlog: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.projectIds.length) return []
    const { data, error } = await ctx.supabase
      .from('tasks')
      .select('id, title, status, priority, due_date, project:projects(id, code, color)')
      .in('project_id', ctx.projectIds)
      .is('sprint_id', null)
      .neq('status', 'done')
      .neq('status', 'canceled')
      .is('parent_task_id', null)
      .order('priority')
      .limit(100)
    if (error) throw error
    return data ?? []
  }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      goal: z.string().optional(),
      startDate: z.string(),
      endDate: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('sprints')
        .insert({
          org_id: ctx.me.org_id,
          name: input.name,
          goal: input.goal ?? null,
          start_date: input.startDate,
          end_date: input.endDate,
          created_by: ctx.me.id,
        })
        .select()
        .single()
      if (error) throw error
      return data
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      goal: z.string().nullable().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      status: z.enum(['planned', 'active', 'completed']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      const patch: {
        name?: string; goal?: string | null; start_date?: string
        end_date?: string; status?: 'planned' | 'active' | 'completed'; updated_at?: string
      } = { updated_at: new Date().toISOString() }
      if (rest.name !== undefined) patch.name = rest.name
      if (rest.goal !== undefined) patch.goal = rest.goal
      if (rest.startDate !== undefined) patch.start_date = rest.startDate
      if (rest.endDate !== undefined) patch.end_date = rest.endDate
      if (rest.status !== undefined) patch.status = rest.status

      const { data, error } = await ctx.supabase
        .from('sprints')
        .update(patch)
        .eq('id', id)
        .eq('org_id', ctx.me.org_id)
        .select()
        .single()
      if (error) throw error
      return data
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from('sprints').delete().eq('id', input).eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  /** Assign (or unassign with sprintId=null) a task to a sprint. */
  assignTask: protectedProcedure
    .input(z.object({ taskId: z.string(), sprintId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      // Validate task ownership
      const { data: task } = await ctx.supabase
        .from('tasks').select('project_id').eq('id', input.taskId).maybeSingle()
      if (!task || !ctx.projectIds.includes(task.project_id)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      // Validate sprint ownership (if assigning, not unassigning)
      if (input.sprintId) {
        const { data: sprint } = await ctx.supabase
          .from('sprints').select('id').eq('id', input.sprintId).eq('org_id', ctx.me.org_id).maybeSingle()
        if (!sprint) throw new TRPCError({ code: 'NOT_FOUND' })
      }
      const { error } = await ctx.supabase
        .from('tasks')
        .update({ sprint_id: input.sprintId })
        .eq('id', input.taskId)
        .in('project_id', ctx.projectIds)
      if (error) throw error
      return { success: true }
    }),
})
