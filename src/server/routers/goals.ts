import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { requireFeature } from '@/lib/plan-limits'

const STATUS_ENUM = ['not_started', 'on_track', 'at_risk', 'off_track', 'achieved', 'canceled'] as const

/**
 * Goals / Objectives module — the "para qué" layer above projects.
 *
 * Hierarchy: parent_goal_id allows nesting (org goal → team goal → sub-goal).
 * Projects link via `projects.goal_id`. progress_pct is auto-rolled from
 * linked projects unless `progress_manual = true` (owner can override).
 *
 * Org-scoped: everyone in the org sees all goals; only owner/admin can
 * create/edit/delete (or the goal's owner_id can edit their own).
 */
export const goalsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({
      quarter: z.string().optional(),
      status: z.enum(STATUS_ENUM).optional(),
      parentGoalId: z.string().nullable().optional(),  // null = top-level only
    }).optional())
    .query(async ({ ctx, input }) => {
      let q = ctx.supabase
        .from('goals')
        .select(`
          *,
          owner:users!goals_owner_id_fkey(id, name, avatar_url),
          parent:goals!parent_goal_id(id, title)
        `)
        .eq('org_id', ctx.me.org_id)
        .order('target_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })

      if (input?.quarter) q = q.eq('quarter', input.quarter)
      if (input?.status) q = q.eq('status', input.status)
      if (input?.parentGoalId === null) q = q.is('parent_goal_id', null)
      else if (input?.parentGoalId) q = q.eq('parent_goal_id', input.parentGoalId)

      const { data, error } = await q
      if (error) throw error
      const goals = data ?? []
      if (!goals.length) return []

      // Compute auto-rollup of progress from linked projects for any goal
      // that isn't manually set. Single query, distributed in memory.
      const goalIds = goals.map(g => g.id)
      const { data: projects } = await ctx.supabase
        .from('projects')
        .select('id, code, name, progress_pct, status, goal_id')
        .in('goal_id', goalIds)

      const byGoal = new Map<string, { ids: string[]; sumProgress: number; count: number }>()
      for (const p of projects ?? []) {
        if (!p.goal_id) continue
        const cur = byGoal.get(p.goal_id) ?? { ids: [], sumProgress: 0, count: 0 }
        cur.ids.push(p.id)
        // Completed/canceled projects count as 100% / 0% respectively for rollup.
        const eff = p.status === 'completed' ? 100 : p.status === 'canceled' ? 0 : (p.progress_pct ?? 0)
        cur.sumProgress += eff
        cur.count++
        byGoal.set(p.goal_id, cur)
      }

      return goals.map(g => {
        const agg = byGoal.get(g.id)
        const autoProgress = agg && agg.count > 0 ? Math.round(agg.sumProgress / agg.count) : 0
        return {
          ...g,
          _projectCount: agg?.count ?? 0,
          _effectiveProgress: g.progress_manual ? g.progress_pct : autoProgress,
        }
      })
    }),

  byId: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('goals')
        .select(`
          *,
          owner:users!goals_owner_id_fkey(id, name, avatar_url),
          parent:goals!parent_goal_id(id, title)
        `)
        .eq('id', input)
        .eq('org_id', ctx.me.org_id)
        .single()
      if (error) throw error

      // Linked projects + children goals for the detail view.
      const [{ data: projects }, { data: children }] = await Promise.all([
        ctx.supabase
          .from('projects')
          .select('id, code, name, status, progress_pct, color, end_date, health_score')
          .eq('goal_id', input),
        ctx.supabase
          .from('goals')
          .select('id, title, status, progress_pct, target_date')
          .eq('parent_goal_id', input)
          .eq('org_id', ctx.me.org_id),
      ])

      return { ...data, projects: projects ?? [], children: children ?? [] }
    }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      description: z.string().optional(),
      parentGoalId: z.string().optional(),
      ownerId: z.string().optional(),
      status: z.enum(STATUS_ENUM).default('not_started'),
      progressPct: z.number().int().min(0).max(100).default(0),
      progressManual: z.boolean().default(false),
      targetDate: z.string().optional(),
      quarter: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireFeature(ctx.activeOrg?.plan, 'goals', 'Objetivos / OKRs')
      const isAdmin = ctx.me.role === 'owner' || ctx.me.role === 'admin'
      // Allow any user to create their own goals; only admin can assign to others.
      const ownerId = input.ownerId ?? ctx.me.id
      if (ownerId !== ctx.me.id && !isAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo admins pueden asignar objetivos a otros.' })
      }
      const { data, error } = await ctx.supabase
        .from('goals')
        .insert({
          org_id: ctx.me.org_id,
          title: input.title,
          description: input.description ?? null,
          parent_goal_id: input.parentGoalId ?? null,
          owner_id: ownerId,
          status: input.status,
          progress_pct: input.progressPct,
          progress_manual: input.progressManual,
          target_date: input.targetDate ?? null,
          quarter: input.quarter ?? null,
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
      parentGoalId: z.string().nullable().optional(),
      ownerId: z.string().nullable().optional(),
      status: z.enum(STATUS_ENUM).optional(),
      progressPct: z.number().int().min(0).max(100).optional(),
      progressManual: z.boolean().optional(),
      targetDate: z.string().nullable().optional(),
      quarter: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ctx.me.role === 'owner' || ctx.me.role === 'admin'
      // Verify ownership (admin OR owner can edit).
      const { data: existing } = await ctx.supabase
        .from('goals').select('owner_id, org_id').eq('id', input.id).single()
      if (!existing || existing.org_id !== ctx.me.org_id) throw new TRPCError({ code: 'NOT_FOUND' })
      if (!isAdmin && existing.owner_id !== ctx.me.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo el dueño o admins pueden editar.' })
      }

      const { data, error } = await ctx.supabase
        .from('goals')
        .update({
          updated_at: new Date().toISOString(),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.parentGoalId !== undefined && { parent_goal_id: input.parentGoalId }),
          ...(input.ownerId !== undefined && { owner_id: input.ownerId }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.progressPct !== undefined && { progress_pct: input.progressPct }),
          ...(input.progressManual !== undefined && { progress_manual: input.progressManual }),
          ...(input.targetDate !== undefined && { target_date: input.targetDate }),
          ...(input.quarter !== undefined && { quarter: input.quarter }),
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
      const isAdmin = ctx.me.role === 'owner' || ctx.me.role === 'admin'
      const { data: existing } = await ctx.supabase
        .from('goals').select('owner_id, org_id').eq('id', input).single()
      if (!existing || existing.org_id !== ctx.me.org_id) throw new TRPCError({ code: 'NOT_FOUND' })
      if (!isAdmin && existing.owner_id !== ctx.me.id) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }
      const { error } = await ctx.supabase
        .from('goals').delete().eq('id', input).eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),
})
