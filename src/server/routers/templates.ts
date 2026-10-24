import { z } from 'zod'
import { todayInTZ } from '@/lib/tz'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure, invalidateCtxCache } from '@/lib/trpc/server'

const PRIORITY_ENUM = ['very_high', 'high', 'medium', 'low', 'very_low'] as const

/**
 * Project templates — reusable blueprints for "Cliente nuevo", "Evento",
 * "Auditoría", etc. Each template carries a list of task templates that
 * get materialized when the user applies the template to create a new
 * project.
 *
 * Org isolation: all queries scoped by `ctx.me.org_id`. Child entity
 * mutations (template_tasks) check ownership through the parent template.
 */
export const templatesRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('project_templates')
      .select(`
        *,
        tasks:project_template_tasks(id, title, priority, due_offset_days, position)
      `)
      .eq('org_id', ctx.me.org_id)
      .order('updated_at', { ascending: false })
    if (error) throw error
    return data ?? []
  }),

  byId: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('project_templates')
        .select(`
          *,
          tasks:project_template_tasks(*)
        `)
        .eq('id', input)
        .eq('org_id', ctx.me.org_id)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new TRPCError({ code: 'NOT_FOUND' })
      return data
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      defaultPriority: z.enum(PRIORITY_ENUM).default('medium'),
      defaultColor: z.string().default('#06B6D4'),
      durationDays: z.number().int().min(1).max(365).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('project_templates')
        .insert({
          org_id: ctx.me.org_id,
          name: input.name,
          description: input.description ?? null,
          default_priority: input.defaultPriority,
          default_color: input.defaultColor,
          duration_days: input.durationDays ?? null,
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
      description: z.string().nullable().optional(),
      defaultPriority: z.enum(PRIORITY_ENUM).optional(),
      defaultColor: z.string().optional(),
      durationDays: z.number().int().min(1).max(365).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      const patch: {
        name?: string; description?: string | null
        default_priority?: typeof PRIORITY_ENUM[number]
        default_color?: string; duration_days?: number | null
        updated_at?: string
      } = { updated_at: new Date().toISOString() }
      if (rest.name !== undefined) patch.name = rest.name
      if (rest.description !== undefined) patch.description = rest.description
      if (rest.defaultPriority !== undefined) patch.default_priority = rest.defaultPriority
      if (rest.defaultColor !== undefined) patch.default_color = rest.defaultColor
      if (rest.durationDays !== undefined) patch.duration_days = rest.durationDays

      const { data, error } = await ctx.supabase
        .from('project_templates')
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
        .from('project_templates')
        .delete()
        .eq('id', input)
        .eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  // ── Template-task management ────────────────────────────────────────
  addTask: protectedProcedure
    .input(z.object({
      templateId: z.string(),
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.enum(PRIORITY_ENUM).default('medium'),
      dueOffsetDays: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // IDOR guard: template must be in our org
      const { data: tpl } = await ctx.supabase
        .from('project_templates').select('id').eq('id', input.templateId).eq('org_id', ctx.me.org_id).maybeSingle()
      if (!tpl) throw new TRPCError({ code: 'NOT_FOUND' })

      // Position = current count
      const { count } = await ctx.supabase
        .from('project_template_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('template_id', input.templateId)

      const { data, error } = await ctx.supabase
        .from('project_template_tasks')
        .insert({
          template_id: input.templateId,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          due_offset_days: input.dueOffsetDays ?? null,
          position: count ?? 0,
        })
        .select()
        .single()
      if (error) throw error
      return data
    }),

  deleteTask: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      // Verify ownership through join
      const { data: tt } = await ctx.supabase
        .from('project_template_tasks')
        .select('template:project_templates(org_id)')
        .eq('id', input)
        .maybeSingle()
      const orgId = (tt?.template as { org_id?: string } | null)?.org_id
      if (!orgId || orgId !== ctx.me.org_id) throw new TRPCError({ code: 'NOT_FOUND' })

      const { error } = await ctx.supabase.from('project_template_tasks').delete().eq('id', input)
      if (error) throw error
      return { success: true }
    }),

  // ── Custom field definitions (org-level) ────────────────────────────
  listCustomFields: protectedProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from('organizations').select('custom_field_defs').eq('id', ctx.me.org_id).single()
    return (data?.custom_field_defs ?? []) as Array<{ key: string; label: string; type: 'text' | 'number' | 'date' | 'select'; options?: string[] }>
  }),

  setCustomFields: protectedProcedure
    .input(z.object({
      defs: z.array(z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        type: z.enum(['text', 'number', 'date', 'select']),
        options: z.array(z.string()).optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from('organizations')
        .update({ custom_field_defs: input.defs })
        .eq('id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  /**
   * Apply a template — creates a project + all its task templates as real
   * tasks. Used by /dashboard/projects/new.
   */
  applyTemplate: protectedProcedure
    .input(z.object({
      templateId: z.string(),
      code: z.string(),
      name: z.string().min(1),
      startDate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { me, workspaceIds } = ctx
      const workspaceId = workspaceIds[0]
      if (!workspaceId) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No hay workspace.' })

      // Load the template + its task templates (with IDOR guard)
      const { data: template, error: tErr } = await ctx.supabase
        .from('project_templates')
        .select('*, tasks:project_template_tasks(*)')
        .eq('id', input.templateId)
        .eq('org_id', me.org_id)
        .maybeSingle()
      if (tErr) throw tErr
      if (!template) throw new TRPCError({ code: 'NOT_FOUND' })

      const start = input.startDate ?? todayInTZ(undefined, ctx.tz)
      const endDate = template.duration_days
        ? addDaysISO(start, template.duration_days)
        : null

      // 1) Create project
      const { data: project, error: pErr } = await ctx.supabase
        .from('projects')
        .insert({
          workspace_id: workspaceId,
          code: input.code,
          name: input.name,
          description: template.description ?? null,
          priority: template.default_priority,
          color: template.default_color,
          status: 'not_started',
          kanban_stage: 'backlog',
          start_date: start,
          end_date: endDate,
          progress_pct: 0,
          created_by: me.id,
        })
        .select()
        .single()
      if (pErr) throw pErr

      // 2) Create tasks in bulk
      const templateTasks = (template.tasks as Array<{
        title: string; description: string | null; priority: typeof PRIORITY_ENUM[number]
        due_offset_days: number | null; position: number
      }> | null) ?? []

      if (templateTasks.length > 0) {
        const taskRows = templateTasks
          .sort((a, b) => a.position - b.position)
          .map((t, i) => ({
            project_id: project.id,
            title: t.title,
            description: t.description,
            priority: t.priority,
            status: 'todo' as const,
            due_date: t.due_offset_days != null ? addDaysISO(start, t.due_offset_days) : null,
            position: Date.now() + i,
            labels: ['template'],
            reporter_id: me.id,
          }))
        const { error: tasksErr } = await ctx.supabase.from('tasks').insert(taskRows)
        if (tasksErr) throw tasksErr
      }

      invalidateCtxCache(ctx.session.user.email!)
      return { project, taskCount: templateTasks.length }
    }),
})

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}
