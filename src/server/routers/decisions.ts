import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * IDOR guard: verify a decision belongs to the user's org before any mutation.
 * Throws NOT_FOUND if the id doesn't exist OR the caller is in a different org.
 * Returns the resolved decision row for convenience.
 */
async function assertDecisionOwnership(
  supabase: SupabaseClient<Database>,
  decisionId: string,
  orgId: string,
) {
  const { data, error } = await supabase
    .from('decisions')
    .select('id, org_id')
    .eq('id', decisionId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Decision not found' })
  return data
}

/**
 * IDOR guard for decision-child entities (criteria, options, scores).
 * Resolves the child's parent decision and asserts the org matches.
 */
async function assertChildOwnership(
  supabase: SupabaseClient<Database>,
  table: 'decision_criteria' | 'decision_options' | 'decision_scores',
  childId: string,
  orgId: string,
) {
  const { data, error } = await supabase
    .from(table)
    .select('decision_id, decision:decisions(org_id)')
    .eq('id', childId)
    .maybeSingle()
  if (error) throw error
  const parentOrg = (data?.decision as { org_id?: string } | null)?.org_id
  if (!data || parentOrg !== orgId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' })
  }
  return data
}

/**
 * Decision Matrix router — paridad con la pestaña "Matriz de Decisión"
 * del spreadsheet original de TPY.
 *
 * Modelo:
 *   - decision (encabezado)
 *     ├── criterion (filas)         weight ∈ [1..10]
 *     ├── option (columnas)         what we're choosing between
 *     └── score (celdas)            score ∈ [1..10] por (criterion × option)
 *
 *   Total por opción = Σ (score × criterion.weight)
 *   La que tenga el mayor total es la recomendada.
 */
export const decisionsRouter = createTRPCRouter({
  // ── List ────────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ projectId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { me } = ctx
      let query = ctx.supabase
        .from('decisions')
        .select(`
          id, title, description, status, project_id, resolved_option_id, created_at, updated_at,
          options:decision_options(id, label),
          criteria:decision_criteria(id)
        `)
        .eq('org_id', me.org_id)
        .order('updated_at', { ascending: false })

      if (input?.projectId) query = query.eq('project_id', input.projectId)

      const { data, error } = await query
      if (error) throw error
      return data
    }),

  // ── Get one with all related rows ────────────────────────────────────
  byId: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      // IDOR fix: filter by org_id so a foreign decision UUID returns null.
      const [{ data: decision }, { data: criteria }, { data: options }, { data: scores }] = await Promise.all([
        ctx.supabase.from('decisions').select('*').eq('id', input).eq('org_id', ctx.me.org_id).maybeSingle(),
        ctx.supabase.from('decision_criteria').select('*').eq('decision_id', input).order('position'),
        ctx.supabase.from('decision_options').select('*').eq('decision_id', input).order('position'),
        ctx.supabase.from('decision_scores').select('*').eq('decision_id', input),
      ])
      if (!decision) throw new TRPCError({ code: 'NOT_FOUND', message: 'Decision not found' })

      return {
        ...decision,
        criteria: criteria ?? [],
        options: options ?? [],
        scores: scores ?? [],
      }
    }),

  // ── Create blank decision with sensible defaults ─────────────────────
  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      projectId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { me } = ctx
      const { data: decision, error } = await ctx.supabase
        .from('decisions')
        .insert({
          org_id: me.org_id,
          project_id: input.projectId ?? null,
          title: input.title,
          description: input.description ?? null,
          created_by: me.id,
        })
        .select('id')
        .single()
      if (error) throw error

      // Seed with 2 criteria + 2 options so the user has something to edit.
      await Promise.all([
        ctx.supabase.from('decision_criteria').insert([
          { decision_id: decision.id, label: 'Criterio 1', weight: 5, position: 0 },
          { decision_id: decision.id, label: 'Criterio 2', weight: 5, position: 1 },
        ]),
        ctx.supabase.from('decision_options').insert([
          { decision_id: decision.id, label: 'Opción A', position: 0 },
          { decision_id: decision.id, label: 'Opción B', position: 1 },
        ]),
      ])

      return decision
    }),

  updateDecision: protectedProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      status: z.enum(['draft', 'resolved', 'archived']).optional(),
      resolvedOptionId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      await assertDecisionOwnership(ctx.supabase, id, ctx.me.org_id)
      const { data, error } = await ctx.supabase
        .from('decisions')
        .update({
          ...(rest.title !== undefined && { title: rest.title }),
          ...(rest.description !== undefined && { description: rest.description }),
          ...(rest.status !== undefined && { status: rest.status }),
          ...(rest.resolvedOptionId !== undefined && { resolved_option_id: rest.resolvedOptionId }),
          updated_at: new Date().toISOString(),
        })
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
      // Constrained by .eq('org_id', ...) so a foreign id is a silent no-op.
      const { error } = await ctx.supabase
        .from('decisions')
        .delete()
        .eq('id', input)
        .eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  // ── Criteria CRUD ────────────────────────────────────────────────────
  addCriterion: protectedProcedure
    .input(z.object({ decisionId: z.string(), label: z.string().min(1), weight: z.number().int().min(1).max(10).default(5) }))
    .mutation(async ({ ctx, input }) => {
      await assertDecisionOwnership(ctx.supabase, input.decisionId, ctx.me.org_id)
      const { count } = await ctx.supabase
        .from('decision_criteria')
        .select('id', { count: 'exact', head: true })
        .eq('decision_id', input.decisionId)
      const { data, error } = await ctx.supabase
        .from('decision_criteria')
        .insert({ decision_id: input.decisionId, label: input.label, weight: input.weight, position: count ?? 0 })
        .select()
        .single()
      if (error) throw error
      return data
    }),

  updateCriterion: protectedProcedure
    .input(z.object({
      id: z.string(),
      label: z.string().min(1).optional(),
      weight: z.number().int().min(1).max(10).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      await assertChildOwnership(ctx.supabase, 'decision_criteria', id, ctx.me.org_id)
      const { data, error } = await ctx.supabase
        .from('decision_criteria')
        .update(rest)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    }),

  deleteCriterion: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      await assertChildOwnership(ctx.supabase, 'decision_criteria', input, ctx.me.org_id)
      const { error } = await ctx.supabase.from('decision_criteria').delete().eq('id', input)
      if (error) throw error
      return { success: true }
    }),

  // ── Options CRUD ─────────────────────────────────────────────────────
  addOption: protectedProcedure
    .input(z.object({ decisionId: z.string(), label: z.string().min(1), notes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertDecisionOwnership(ctx.supabase, input.decisionId, ctx.me.org_id)
      const { count } = await ctx.supabase
        .from('decision_options')
        .select('id', { count: 'exact', head: true })
        .eq('decision_id', input.decisionId)
      const { data, error } = await ctx.supabase
        .from('decision_options')
        .insert({ decision_id: input.decisionId, label: input.label, notes: input.notes ?? null, position: count ?? 0 })
        .select()
        .single()
      if (error) throw error
      return data
    }),

  updateOption: protectedProcedure
    .input(z.object({
      id: z.string(),
      label: z.string().min(1).optional(),
      notes: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input
      await assertChildOwnership(ctx.supabase, 'decision_options', id, ctx.me.org_id)
      const { data, error } = await ctx.supabase
        .from('decision_options')
        .update(rest)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    }),

  deleteOption: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      await assertChildOwnership(ctx.supabase, 'decision_options', input, ctx.me.org_id)
      const { error } = await ctx.supabase.from('decision_options').delete().eq('id', input)
      if (error) throw error
      return { success: true }
    }),

  // ── Score (upsert per cell) ──────────────────────────────────────────
  setScore: protectedProcedure
    .input(z.object({
      decisionId: z.string(),
      criterionId: z.string(),
      optionId: z.string(),
      score: z.number().int().min(1).max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertDecisionOwnership(ctx.supabase, input.decisionId, ctx.me.org_id)
      const { data, error } = await ctx.supabase
        .from('decision_scores')
        .upsert(
          {
            decision_id: input.decisionId,
            criterion_id: input.criterionId,
            option_id: input.optionId,
            score: input.score,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'criterion_id,option_id' },
        )
        .select()
        .single()
      if (error) throw error
      return data
    }),
})
