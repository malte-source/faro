import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

export const tasksRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({
      status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']).optional(),
      priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).optional(),
      projectId: z.string().optional(),
      assigneeId: z.string().optional(),
      onlyMine: z.boolean().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { me, workspaceIds } = ctx
      if (!workspaceIds.length) return []

      let projectQuery = ctx.supabase.from('projects').select('id').in('workspace_id', workspaceIds)
      if (input?.projectId) projectQuery = projectQuery.eq('id', input.projectId)
      const { data: projects } = await projectQuery
      const projectIds = projects?.map(p => p.id) ?? []
      if (!projectIds.length) return []

      let query = ctx.supabase
        .from('tasks')
        .select(`
          *,
          assignee:users!tasks_assignee_id_fkey(id, name, avatar_url),
          project:projects(id, code, name, color)
        `)
        .in('project_id', projectIds)
        .is('parent_task_id', null)
        .order('created_at', { ascending: false })
        .limit(200)

      if (input?.status) query = query.eq('status', input.status)
      if (input?.priority) query = query.eq('priority', input.priority)
      if (input?.assigneeId) query = query.eq('assignee_id', input.assigneeId)
      if (input?.onlyMine) query = query.eq('assignee_id', me.id)

      const { data, error } = await query
      if (error) throw error
      return data
    }),

  byProject: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('tasks')
        .select(`
          *,
          assignee:users!tasks_assignee_id_fkey(id, name, avatar_url),
          subtasks:tasks!parent_task_id(id, title, status, priority)
        `)
        .eq('project_id', input)
        .is('parent_task_id', null)
        .order('position')
        .limit(500)

      if (error) throw error
      return data
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      title: z.string().min(1),
      description: z.string().optional(),
      assigneeId: z.string().optional(),
      priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).default('medium'),
      dueDate: z.string().optional(),
      estimatedHours: z.number().optional(),
      parentTaskId: z.string().optional(),
      labels: z.array(z.string()).default([]),
      status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']).default('todo'),
    }))
    .mutation(async ({ ctx, input }) => {
      const { me } = ctx

      const { data: lastTask } = await ctx.supabase
        .from('tasks')
        .select('position')
        .eq('project_id', input.projectId)
        .order('position', { ascending: false })
        .limit(1)
        .single()

      const { data, error } = await ctx.supabase
        .from('tasks')
        .insert({
          project_id: input.projectId,
          title: input.title,
          description: input.description ?? null,
          assignee_id: input.assigneeId ?? null,
          reporter_id: me.id,
          priority: input.priority,
          status: input.status,
          due_date: input.dueDate,
          estimated_hours: input.estimatedHours,
          parent_task_id: input.parentTaskId,
          labels: input.labels,
          position: (lastTask?.position ?? 0) + 1000,
        })
        .select()
        .single()

      if (error) throw error
      return data
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.from('tasks').delete().eq('id', input)
      if (error) throw error
      return { success: true }
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    const { me, workspaceIds } = ctx
    if (!workspaceIds.length) {
      return { byStatus: { todo: 0, in_progress: 0, in_review: 0, done: 0, canceled: 0 }, total: 0, myPending: 0, overdue: 0 }
    }

    const { data: projects } = await ctx.supabase
      .from('projects').select('id').in('workspace_id', workspaceIds)
    const projectIds = projects?.map(p => p.id) ?? []

    if (!projectIds.length) {
      return { byStatus: { todo: 0, in_progress: 0, in_review: 0, done: 0, canceled: 0 }, total: 0, myPending: 0, overdue: 0 }
    }

    const today = new Date().toISOString().split('T')[0]

    const [{ data: tasks }, { data: myPendingTasks }] = await Promise.all([
      ctx.supabase.from('tasks').select('id, status, due_date').in('project_id', projectIds).is('parent_task_id', null),
      ctx.supabase.from('tasks').select('id').in('project_id', projectIds)
        .eq('assignee_id', me.id).neq('status', 'done').neq('status', 'canceled').is('parent_task_id', null),
    ])

    const byStatus = {
      todo:        tasks?.filter(t => t.status === 'todo').length ?? 0,
      in_progress: tasks?.filter(t => t.status === 'in_progress').length ?? 0,
      in_review:   tasks?.filter(t => t.status === 'in_review').length ?? 0,
      done:        tasks?.filter(t => t.status === 'done').length ?? 0,
      canceled:    tasks?.filter(t => t.status === 'canceled').length ?? 0,
    }

    const overdue = tasks?.filter(t =>
      t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'canceled'
    ).length ?? 0

    return { byStatus, total: tasks?.length ?? 0, myPending: myPendingTasks?.length ?? 0, overdue }
  }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).optional(),
      status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']).optional(),
      priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).optional(),
      assigneeId: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      actualHours: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      const { data, error } = await ctx.supabase
        .from('tasks')
        .update({
          ...(rest.title && { title: rest.title }),
          ...(rest.status && { status: rest.status }),
          ...(rest.priority && { priority: rest.priority }),
          ...(rest.assigneeId !== undefined && { assignee_id: rest.assigneeId }),
          ...(rest.dueDate !== undefined && { due_date: rest.dueDate }),
          ...(rest.actualHours !== undefined && { actual_hours: rest.actualHours }),
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    }),
})
