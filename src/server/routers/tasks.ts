import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'

export const tasksRouter = createTRPCRouter({
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
    }))
    .mutation(async ({ ctx, input }) => {
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
          description: input.description,
          assignee_id: input.assigneeId,
          reporter_id: ctx.session.user.id!,
          priority: input.priority,
          status: 'todo',
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
