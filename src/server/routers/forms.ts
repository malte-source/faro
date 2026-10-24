import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import type { IntakeField } from '@/types/database'
import { requireFeature } from '@/lib/plan-limits'

/**
 * Intake Forms — admin CRUD. The public submit endpoint lives separately
 * at /api/forms/[slug]/submit so it can be called unauthenticated.
 *
 * Permissions: only owner/admin can create/edit/delete forms. All members
 * see the list + can view submissions for forms in their org.
 */

const FIELD_TYPES = ['text', 'textarea', 'email', 'select', 'date', 'phone'] as const
const FIELD_TARGETS = ['title', 'description', 'due_date', 'metadata', 'priority'] as const
const PRIORITY_ENUM = ['very_high', 'high', 'medium', 'low', 'very_low'] as const

const fieldSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(120),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.string()).optional(),
  target: z.enum(FIELD_TARGETS),
})

function requireAdmin(role: string) {
  if (role !== 'owner' && role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo owner/admin pueden gestionar forms.' })
  }
}

/** Slugify — lowercase, dash-separated, ASCII-safe. */
function slugify(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export const formsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('intake_forms')
      .select(`
        *,
        project:projects!intake_forms_target_project_id_fkey(id, code, name, color),
        goal:goals!intake_forms_target_goal_id_fkey(id, title)
      `)
      .eq('org_id', ctx.me.org_id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  }),

  byId: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('intake_forms')
        .select('*')
        .eq('id', input)
        .eq('org_id', ctx.me.org_id)
        .single()
      if (error) throw error
      return data
    }),

  /** Recent submissions for a form — for the dashboard's "ver submissions" drawer. */
  submissions: protectedProcedure
    .input(z.object({ formId: z.string(), limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      // Anti-IDOR: confirm the form is in caller's org.
      const { data: form } = await ctx.supabase
        .from('intake_forms').select('org_id').eq('id', input.formId).single()
      if (!form || form.org_id !== ctx.me.org_id) throw new TRPCError({ code: 'NOT_FOUND' })

      const { data, error } = await ctx.supabase
        .from('intake_submissions')
        .select(`
          *,
          task:tasks!intake_submissions_created_task_id_fkey(id, title, status)
        `)
        .eq('form_id', input.formId)
        .order('submitted_at', { ascending: false })
        .limit(input.limit)
      if (error) throw error
      return data ?? []
    }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      slug: z.string().min(3).max(60).optional(),
      description: z.string().optional(),
      brandingName: z.string().optional(),
      targetProjectId: z.string(),
      targetGoalId: z.string().optional(),
      defaultPriority: z.enum(PRIORITY_ENUM).default('medium'),
      fields: z.array(fieldSchema).min(1).max(20),
      successMessage: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'forms', 'Forms públicos')
      requireAdmin(ctx.me.role)
      // Verify the target project is in the caller's org (anti-IDOR).
      if (!ctx.projectIds.includes(input.targetProjectId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Sin acceso al proyecto destino.' })
      }

      // Slug must be unique across all orgs (global URL namespace).
      // If not provided, derive from title + retry on collision.
      let slug = input.slug ? slugify(input.slug) : slugify(input.title)
      let attempt = 0
      while (attempt < 5) {
        const { data: clash } = await ctx.supabase
          .from('intake_forms').select('id').eq('slug', slug).maybeSingle()
        if (!clash) break
        attempt++
        slug = `${slugify(input.title)}-${Math.random().toString(36).slice(2, 6)}`
      }

      const { data, error } = await ctx.supabase
        .from('intake_forms')
        .insert({
          org_id: ctx.me.org_id,
          slug,
          title: input.title,
          description: input.description ?? null,
          branding_name: input.brandingName ?? null,
          target_project_id: input.targetProjectId,
          target_goal_id: input.targetGoalId ?? null,
          default_priority: input.defaultPriority,
          fields: input.fields as IntakeField[],
          success_message: input.successMessage ?? 'Recibimos tu pedido. Lo procesaremos a la brevedad.',
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
      title: z.string().min(1).max(200).optional(),
      description: z.string().nullable().optional(),
      brandingName: z.string().nullable().optional(),
      targetProjectId: z.string().optional(),
      targetGoalId: z.string().nullable().optional(),
      defaultPriority: z.enum(PRIORITY_ENUM).optional(),
      fields: z.array(fieldSchema).min(1).max(20).optional(),
      successMessage: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      const { data: existing } = await ctx.supabase
        .from('intake_forms').select('org_id').eq('id', input.id).single()
      if (!existing || existing.org_id !== ctx.me.org_id) throw new TRPCError({ code: 'NOT_FOUND' })

      const { data, error } = await ctx.supabase
        .from('intake_forms')
        .update({
          updated_at: new Date().toISOString(),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.brandingName !== undefined && { branding_name: input.brandingName }),
          ...(input.targetProjectId !== undefined && { target_project_id: input.targetProjectId }),
          ...(input.targetGoalId !== undefined && { target_goal_id: input.targetGoalId }),
          ...(input.defaultPriority !== undefined && { default_priority: input.defaultPriority }),
          ...(input.fields !== undefined && { fields: input.fields }),
          ...(input.successMessage !== undefined && { success_message: input.successMessage }),
          ...(input.isActive !== undefined && { is_active: input.isActive }),
        })
        .eq('id', input.id)
        .eq('org_id', ctx.me.org_id)
        .select()
        .single()
      if (error) throw error
      return data
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      const { error } = await ctx.supabase
        .from('intake_forms').delete().eq('id', input).eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),
})
