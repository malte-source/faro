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
      const { data: me } = await ctx.supabase
        .from('users').select('id, org_id').eq('email', ctx.session.user.email!).single()
      if (!me) return []

      const { data: workspaces } = await ctx.supabase
        .from('workspaces').select('id').eq('org_id', me.org_id)
      const wsIds = workspaces?.map(w => w.id) ?? []

      let projectQuery = ctx.supabase.from('projects').select('id').in('workspace_id', wsIds)
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
      const { data: me } = await ctx.supabase
        .from('users')
        .select('id')
        .eq('email', ctx.session.user.email!)
        .single()

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
          reporter_id: me?.id ?? ctx.session.user.email!,
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
