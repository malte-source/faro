import { z } from 'zod'
import { todayInTZ } from '@/lib/tz'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { isValidCadence, nextFireDate } from '@/lib/recurring'

const PRIORITY_ENUM = ['very_high', 'high', 'medium', 'low', 'very_low'] as const

/**
 * Recurring task RULES management. The cron job at /api/cron/daily-recurring
 * is what actually materialises new tasks from these rules.
 *
 * Org isolation: all queries gated on `ctx.projectIds` (already org-scoped
 * in createTRPCContext). No IDOR.
 */
export const recurringRouter = createTRPCRouter({
  /**
   * All recurring rules across the user's visible projects. For the global
   * /dashboard/recurring page so the user doesn't have to dive into each
   * project to see what's recurring.
   */
  listAll: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.projectIds.length) return []
    // Explicit FK hint on `project:` — PostgREST embed resolution can fail
    // silently when multiple paths exist or schema cache is stale.
    const { data, error } = await ctx.supabase
      .from('task_recurring_rules')
      .select(`
        *,
        assignee:users!task_recurring_rules_assignee_id_fkey(id, name, avatar_url),
        project:projects!task_recurring_rules_project_id_fkey(id, code, name, color)
      `)
      .in('project_id', ctx.projectIds)
      .order('is_active', { ascending: false })
      .order('next_run_at', { ascending: true })
    if (error) {
      console.error('[recurring.listAll]', error)
      throw error
    }
    return data ?? []
  }),

  byProject: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input: projectId }) => {
      // IDOR guard: project must be in the user's org
      if (!ctx.projectIds.includes(projectId)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      const { data, error } = await ctx.supabase
        .from('task_recurring_rules')
        .select('*, assignee:users!task_recurring_rules_assignee_id_fkey(id, name, avatar_url)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      titleTemplate: z.string().min(1),
      descriptionTemplate: z.string().optional(),
      assigneeId: z.string().nullable().optional(),
      priority: z.enum(PRIORITY_ENUM).default('medium'),
      cadence: z.string().refine(isValidCadence, 'Cadence inválida'),
      startDate: z.string().optional(), // when to first fire; defaults to next occurrence
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.projectIds.includes(input.projectId)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      const today = todayInTZ(undefined, ctx.tz)
      const nextRun = input.startDate ?? nextFireDate(input.cadence, today)

      const { data, error } = await ctx.supabase
        .from('task_recurring_rules')
        .insert({
          project_id: input.projectId,
          title_template: input.titleTemplate,
          description_template: input.descriptionTemplate ?? null,
          assignee_id: input.assigneeId ?? null,
          priority: input.priority,
          cadence: input.cadence,
          next_run_at: nextRun,
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
      titleTemplate: z.string().min(1).optional(),
      descriptionTemplate: z.string().nullable().optional(),
      assigneeId: z.string().nullable().optional(),
      priority: z.enum(PRIORITY_ENUM).optional(),
      cadence: z.string().refine(isValidCadence).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      // Verify the rule belongs to one of our projects
      const { data: rule } = await ctx.supabase
        .from('task_recurring_rules')
        .select('project_id, cadence, next_run_at')
        .eq('id', id)
        .single()
      if (!rule || !ctx.projectIds.includes(rule.project_id)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      const patch: {
        title_template?: string
        description_template?: string | null
        assignee_id?: string | null
        priority?: typeof PRIORITY_ENUM[number]
        cadence?: string
        is_active?: boolean
        next_run_at?: string
        updated_at?: string
      } = { updated_at: new Date().toISOString() }
      if (rest.titleTemplate !== undefined) patch.title_template = rest.titleTemplate
      if (rest.descriptionTemplate !== undefined) patch.description_template = rest.descriptionTemplate
      if (rest.assigneeId !== undefined) patch.assignee_id = rest.assigneeId
      if (rest.priority !== undefined) patch.priority = rest.priority
      if (rest.isActive !== undefined) patch.is_active = rest.isActive
      if (rest.cadence !== undefined) {
        patch.cadence = rest.cadence
        // Recompute next_run_at when cadence changes so the rule doesn't
        // fire at the old cadence's next date.
        patch.next_run_at = nextFireDate(rest.cadence, todayInTZ(undefined, ctx.tz))
      }

      const { data, error } = await ctx.supabase
        .from('task_recurring_rules')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input: id }) => {
      const { data: rule } = await ctx.supabase
        .from('task_recurring_rules')
        .select('project_id')
        .eq('id', id)
        .single()
      if (!rule || !ctx.projectIds.includes(rule.project_id)) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      const { error } = await ctx.supabase
        .from('task_recurring_rules')
        .delete()
        .eq('id', id)
      if (error) throw error
      return { success: true }
    }),
})
