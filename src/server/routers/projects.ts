import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

export const projectsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({
      workspaceId: z.string().optional(),
      status: z.enum(['not_started', 'in_progress', 'on_hold', 'delayed', 'completed', 'canceled', 'pending']).optional(),
      kanbanStage: z.enum(['ideas', 'backlog', 'pending', 'in_progress', 'on_hold', 'completed', 'canceled']).optional(),
      departmentId: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from('projects')
        .select(`
          *,
          department:departments(id, name, color),
          members:project_members(
            id, role,
            user:users(id, name, email, avatar_url)
          )
        `)
        .order('updated_at', { ascending: false })

      if (input?.status) query = query.eq('status', input.status)
      if (input?.kanbanStage) query = query.eq('kanban_stage', input.kanbanStage)
      if (input?.departmentId) query = query.eq('department_id', input.departmentId)

      const { data, error } = await query
      if (error) throw error
      return data
    }),

  byId: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('projects')
        .select(`
          *,
          department:departments(id, name, color),
          members:project_members(
            id, role, joined_at,
            user:users(id, name, email, avatar_url, department_id)
          ),
          tasks(
            id, title, status, priority, due_date,
            assignee:users!tasks_assignee_id_fkey(id, name, avatar_url)
          )
        `)
        .eq('id', input)
        .single()

      if (error) throw error
      return data
    }),

  create: protectedProcedure
    .input(z.object({
      workspaceId: z.string(),
      code: z.string(),
      name: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(['not_started', 'in_progress', 'on_hold', 'delayed', 'completed', 'canceled', 'pending']).default('not_started'),
      kanbanStage: z.enum(['ideas', 'backlog', 'pending', 'in_progress', 'on_hold', 'completed', 'canceled']).default('backlog'),
      priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).default('medium'),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      estimatedHours: z.number().optional(),
      budget: z.number().optional(),
      departmentId: z.string().optional(),
      color: z.string().default('#6366f1'),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: me } = await ctx.supabase
        .from('users')
        .select('id')
        .eq('email', ctx.session.user.email!)
        .single()

      const { data, error } = await ctx.supabase
        .from('projects')
        .insert({
          workspace_id: input.workspaceId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          status: input.status,
          kanban_stage: input.kanbanStage,
          priority: input.priority,
          start_date: input.startDate ?? null,
          end_date: input.endDate ?? null,
          estimated_hours: input.estimatedHours ?? null,
          budget: input.budget ?? null,
          department_id: input.departmentId ?? null,
          color: input.color,
          progress_pct: 0,
          currency: 'USD',
          created_by: me?.id ?? ctx.session.user.email!,
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
      description: z.string().optional(),
      status: z.enum(['not_started', 'in_progress', 'on_hold', 'delayed', 'completed', 'canceled', 'pending']).optional(),
      kanbanStage: z.enum(['ideas', 'backlog', 'pending', 'in_progress', 'on_hold', 'completed', 'canceled']).optional(),
      priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      progressPct: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      const { data, error } = await ctx.supabase
        .from('projects')
        .update({
          ...(rest.name && { name: rest.name }),
          ...(rest.description !== undefined && { description: rest.description }),
          ...(rest.status && { status: rest.status }),
          ...(rest.kanbanStage && { kanban_stage: rest.kanbanStage }),
          ...(rest.priority && { priority: rest.priority }),
          ...(rest.startDate && { start_date: rest.startDate }),
          ...(rest.endDate && { end_date: rest.endDate }),
          ...(rest.progressPct !== undefined && { progress_pct: rest.progressPct }),
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    }),

  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const { data: projects } = await ctx.supabase
      .from('projects')
      .select('id, code, name, status, kanban_stage, priority, end_date, health_score, progress_pct, department_id')

    if (!projects) return { total: 0, active: 0, delayed: 0, completed: 0, onHold: 0, dueSoon: [] }

    const now = new Date()
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    return {
      total: projects.length,
      active: projects.filter(p => p.status === 'in_progress').length,
      delayed: projects.filter(p => p.status === 'delayed').length,
      completed: projects.filter(p => p.status === 'completed').length,
      onHold: projects.filter(p => p.status === 'on_hold').length,
      dueSoon: projects.filter(p =>
        p.end_date && new Date(p.end_date) <= weekFromNow && p.status !== 'completed'
      ),
      byStatus: {
        not_started: projects.filter(p => p.status === 'not_started').length,
        in_progress: projects.filter(p => p.status === 'in_progress').length,
        on_hold: projects.filter(p => p.status === 'on_hold').length,
        delayed: projects.filter(p => p.status === 'delayed').length,
        completed: projects.filter(p => p.status === 'completed').length,
        canceled: projects.filter(p => p.status === 'canceled').length,
        pending: projects.filter(p => p.status === 'pending').length,
      },
    }
  }),
})
