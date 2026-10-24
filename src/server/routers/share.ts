import { z } from 'zod'
import { randomBytes } from 'crypto'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { limitsFor } from '@/lib/plan-limits'

/** Free workspaces get exactly one active share link — enough to try the
 *  feature, not enough to run a client-facing practice on it for free. */
const FREE_SHARE_LINK_LIMIT = 1

/**
 * Share links — capability URLs that expose a read-only view of a project
 * (or in the future, a task/goal) to anyone who has the token.
 *
 * Security model:
 *   - The token IS the authorization. 32 random URL-safe chars = ~190 bits of entropy.
 *     Guessing is computationally infeasible.
 *   - On creation, caller must have access to the entity (anti-IDOR).
 *   - On revoke, caller must have admin role OR be the link's creator.
 *   - The public data endpoint lives at /api/share/[token]/data so it can
 *     skip the tRPC + auth layer entirely.
 */

function generateToken(): string {
  // 24 bytes → 32 base64-url chars. URL-safe, no padding.
  return randomBytes(24).toString('base64url')
}

export const shareRouter = createTRPCRouter({
  /** List all share links the caller has access to (in their org). */
  list: protectedProcedure
    .input(z.object({
      entityType: z.enum(['project', 'task', 'goal']).optional(),
      entityId: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      let q = ctx.supabase
        .from('share_links')
        .select('*')
        .eq('org_id', ctx.me.org_id)
        .order('created_at', { ascending: false })
      if (input?.entityType) q = q.eq('entity_type', input.entityType)
      if (input?.entityId) q = q.eq('entity_id', input.entityId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    }),

  create: protectedProcedure
    .input(z.object({
      entityType: z.enum(['project', 'task', 'goal']),
      entityId: z.string(),
      label: z.string().max(120).optional(),
      /** Days from now. 0 / undefined = no expiration. */
      expiresInDays: z.number().int().min(0).max(365).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Anti-IDOR: caller must have access to the entity.
      if (input.entityType === 'project') {
        if (!ctx.projectIds.includes(input.entityId)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Sin acceso al proyecto.' })
        }
      } else if (input.entityType === 'task') {
        const { data: task } = await ctx.supabase
          .from('tasks').select('project_id').eq('id', input.entityId).single()
        if (!task || !ctx.projectIds.includes(task.project_id)) {
          throw new TRPCError({ code: 'FORBIDDEN' })
        }
      } else if (input.entityType === 'goal') {
        const { data: goal } = await ctx.supabase
          .from('goals').select('org_id').eq('id', input.entityId).single()
        if (!goal || goal.org_id !== ctx.me.org_id) {
          throw new TRPCError({ code: 'FORBIDDEN' })
        }
      }

      if (!limitsFor(ctx.activeOrg?.plan).shareLinks) {
        const { count } = await ctx.supabase
          .from('share_links')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', ctx.me.org_id)
        if ((count ?? 0) >= FREE_SHARE_LINK_LIMIT) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `Llegaste al límite de ${FREE_SHARE_LINK_LIMIT} link compartido del plan Free. Crea un workspace de Equipo para tener links ilimitados.`,
          })
        }
      }

      const expiresAt = input.expiresInDays && input.expiresInDays > 0
        ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
        : null

      const { data, error } = await ctx.supabase
        .from('share_links')
        .insert({
          org_id: ctx.me.org_id,
          token: generateToken(),
          entity_type: input.entityType,
          entity_id: input.entityId,
          label: input.label ?? null,
          expires_at: expiresAt,
          created_by: ctx.me.id,
        })
        .select()
        .single()
      if (error) throw error
      return data
    }),

  /** Revoke (delete) a share link. Admin or creator only. */
  revoke: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ctx.me.role === 'owner' || ctx.me.role === 'admin'
      const { data: existing } = await ctx.supabase
        .from('share_links').select('org_id, created_by').eq('id', input).single()
      if (!existing || existing.org_id !== ctx.me.org_id) throw new TRPCError({ code: 'NOT_FOUND' })
      if (!isAdmin && existing.created_by !== ctx.me.id) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }
      const { error } = await ctx.supabase
        .from('share_links').delete().eq('id', input).eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  /** Extend the expiration of an existing link by N days from now. */
  extend: protectedProcedure
    .input(z.object({ id: z.string(), days: z.number().int().min(1).max(365) }))
    .mutation(async ({ ctx, input }) => {
      const newExp = new Date(Date.now() + input.days * 86_400_000).toISOString()
      const { error } = await ctx.supabase
        .from('share_links')
        .update({ expires_at: newExp })
        .eq('id', input.id)
        .eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true, expires_at: newExp }
    }),
})
