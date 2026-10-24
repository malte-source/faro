import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import type { AutomationAction, AutomationConditions } from '@/types/database'
import { requireFeature } from '@/lib/plan-limits'

/**
 * CRUD + manual-run for automation rules.
 *
 * Visibility: every member of the org sees every automation (they're org-wide
 * config, like webhooks). Only owner/admin can create/update/delete.
 */

const TRIGGER_ENUM = ['task.created', 'task.status_changed', 'task.due_soon', 'project.health_low'] as const
const ACTION_KIND_ENUM = ['set_status', 'set_assignee', 'set_priority', 'add_label', 'send_chat'] as const

const conditionsSchema: z.ZodType<AutomationConditions> = z.object({
  project_id: z.string().optional(),
  status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']).optional(),
  priority: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']).optional(),
  from_status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']).optional(),
  to_status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']).optional(),
  hours_until_due: z.number().int().min(0).max(168).optional(),
  health_below: z.number().int().min(0).max(100).optional(),
})

const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set_status'), value: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']) }),
  z.object({ kind: z.literal('set_assignee'), value: z.string() }),
  z.object({ kind: z.literal('set_priority'), value: z.enum(['very_high', 'high', 'medium', 'low', 'very_low']) }),
  z.object({ kind: z.literal('add_label'), value: z.string().min(1) }),
  z.object({ kind: z.literal('send_chat'), value: z.string().min(1) }),
]) satisfies z.ZodType<AutomationAction>

function requireAdmin(role: string) {
  if (role !== 'owner' && role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo owner/admin pueden gestionar automatizaciones.' })
  }
}

export const automationsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('automations')
      .select('*')
      .eq('org_id', ctx.me.org_id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  }),

  /** Recent run history for a single automation — used by the UI's debug drawer. */
  runs: protectedProcedure
    .input(z.object({ automationId: z.string(), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      // Auth: ensure the automation belongs to caller's org.
      const { data: a } = await ctx.supabase
        .from('automations').select('org_id').eq('id', input.automationId).single()
      if (!a || a.org_id !== ctx.me.org_id) throw new TRPCError({ code: 'NOT_FOUND' })
      const { data, error } = await ctx.supabase
        .from('automation_runs')
        .select('*')
        .eq('automation_id', input.automationId)
        .order('triggered_at', { ascending: false })
        .limit(input.limit)
      if (error) throw error
      return data ?? []
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(120),
      description: z.string().optional(),
      enabled: z.boolean().default(true),
      trigger: z.enum(TRIGGER_ENUM),
      conditions: conditionsSchema.default({}),
      actions: z.array(actionSchema).min(1).max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'automations', 'Automatizaciones')
      requireAdmin(ctx.me.role)
      const { data, error } = await ctx.supabase
        .from('automations')
        .insert({
          org_id: ctx.me.org_id,
          name: input.name,
          description: input.description ?? null,
          enabled: input.enabled,
          trigger: input.trigger,
          conditions: input.conditions,
          actions: input.actions,
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
      name: z.string().min(1).max(120).optional(),
      description: z.string().nullable().optional(),
      enabled: z.boolean().optional(),
      trigger: z.enum(TRIGGER_ENUM).optional(),
      conditions: conditionsSchema.optional(),
      actions: z.array(actionSchema).min(1).max(10).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'automations', 'Automatizaciones')
      requireAdmin(ctx.me.role)
      const { id, ...patch } = input
      const { data, error } = await ctx.supabase
        .from('automations')
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
      requireAdmin(ctx.me.role)
      const { error } = await ctx.supabase
        .from('automations').delete().eq('id', input).eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  /** Toggle enabled — quick on/off without opening the editor. */
  toggle: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      const { error } = await ctx.supabase
        .from('automations')
        .update({ enabled: input.enabled })
        .eq('id', input.id)
        .eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),
})
