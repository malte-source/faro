import { cleanupAfterMembershipRemoved } from '@/server/org-cleanup'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure, invalidateCtxCache } from '@/lib/trpc/server'
import { limitsFor } from '@/lib/plan-limits'

/**
 * Organizations = the "workspaces" the user sees in the switcher.
 *
 * Naming note: the DB has both `organizations` (tenants) AND `workspaces`
 * (sub-divisions inside an org, mostly unused). The user-facing concept of
 * a "workspace" maps to a row in `organizations`. This router exposes that
 * mapping with that user-facing language.
 *
 * Procedures:
 *   - mine: list orgs the user belongs to (read from ctx, no DB query)
 *   - active: current active org (read from ctx, no DB query)
 *   - createPersonal: create a new personal workspace
 *   - createTeam: create a new team workspace (the upsell path)
 *   - invite: add a member to a team workspace (admin/owner only)
 *   - rename / setPlan / etc — basic settings
 *   - leave: remove yourself from an org (owners can't leave their only org)
 */

const slugify = (s: string) =>
  s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)

export const orgsRouter = createTRPCRouter({
  /** All orgs the user belongs to. Sourced from ctx — zero DB queries. */
  mine: protectedProcedure.query(({ ctx }) => ctx.myOrgs ?? []),

  /** The org the request is currently scoped to. */
  active: protectedProcedure.query(({ ctx }) => ctx.activeOrg),

  /**
   * Create a Personal workspace for the caller. Personal = single-user, free
   * plan, workspace_type='personal'. A user can have multiple Personal
   * workspaces (e.g. "Casa" + "Side projects") but most have one.
   */
  createPersonal: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const slug = `${slugify(input.name)}-${Date.now().toString(36)}`
      const { data: org, error } = await ctx.supabase
        .from('organizations')
        .insert({
          name: input.name,
          slug,
          workspace_type: 'personal',
          plan: 'free',
          owner_user_id: ctx.me.id,
        })
        .select('id, name, slug, workspace_type, plan')
        .single()
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })

      await Promise.all([
        ctx.supabase.from('org_memberships').insert({
          user_id: ctx.me.id,
          org_id: org.id,
          role: 'owner',
        }),
        ctx.supabase.from('workspaces').insert({ org_id: org.id, name: 'Main' }),
      ])

      invalidateCtxCache(ctx.session.user.email!)
      return org
    }),

  /**
   * Create a Team workspace. Becomes the billable surface. Trial period kicks
   * in via plan='team' + trial_ends_at (handled by webhook later — for now
   * just sets the plan).
   */
  createTeam: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const slug = `${slugify(input.name)}-${Date.now().toString(36)}`
      const { data: org, error } = await ctx.supabase
        .from('organizations')
        .insert({
          name: input.name,
          slug,
          workspace_type: 'team',
          plan: 'team',
          owner_user_id: ctx.me.id,
        })
        .select('id, name, slug, workspace_type, plan')
        .single()
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })

      await Promise.all([
        ctx.supabase.from('org_memberships').insert({
          user_id: ctx.me.id,
          org_id: org.id,
          role: 'owner',
        }),
        ctx.supabase.from('workspaces').insert({ org_id: org.id, name: 'Main' }),
      ])

      invalidateCtxCache(ctx.session.user.email!)
      return org
    }),

  /** Rename the active org. Owner / admin only. */
  rename: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeOrg) throw new TRPCError({ code: 'NOT_FOUND' })
      if (ctx.activeOrg.role !== 'owner' && ctx.activeOrg.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo el owner o admin puede renombrar' })
      }
      const { error } = await ctx.supabase
        .from('organizations')
        .update({ name: input.name })
        .eq('id', ctx.activeOrg.id)
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      invalidateCtxCache(ctx.session.user.email!)
      return { ok: true }
    }),

  /**
   * Invite a user to the active TEAM workspace by email. Creates the user
   * row if needed (they'll see the workspace next time they log in). For now
   * we just bind email to the membership — actual invite emails come later.
   */
  inviteMember: protectedProcedure
    .input(z.object({
      email: z.string().email(),
      role: z.enum(['admin', 'member']).default('member'),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeOrg) throw new TRPCError({ code: 'NOT_FOUND' })
      if (ctx.activeOrg.workspace_type !== 'team') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Solo workspaces de equipo pueden tener miembros' })
      }
      if (ctx.activeOrg.role !== 'owner' && ctx.activeOrg.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo el owner o admin puede invitar' })
      }

      const maxMembers = limitsFor(ctx.activeOrg.plan).maxMembers
      if (maxMembers !== null) {
        const { count } = await ctx.supabase
          .from('org_memberships')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', ctx.activeOrg.id)
        if ((count ?? 0) >= maxMembers) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `Llegaste al límite de ${maxMembers} miembros del plan ${ctx.activeOrg.plan}. Actualiza el plan para invitar más gente.`,
          })
        }
      }

      // Find or create the user row.
      const { data: existing } = await ctx.supabase
        .from('users')
        .select('id')
        .eq('email', input.email)
        .single()

      let userId = existing?.id
      if (!userId) {
        const { data: created, error: createErr } = await ctx.supabase
          .from('users')
          .insert({
            email: input.email,
            name: input.email.split('@')[0],
            org_id: ctx.activeOrg.id, // default org pointer for first sign-in
            role: 'member',
          })
          .select('id')
          .single()
        if (createErr) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: createErr.message })
        userId = created!.id
      }

      const { error: membErr } = await ctx.supabase
        .from('org_memberships')
        .insert({
          user_id: userId,
          org_id: ctx.activeOrg.id,
          role: input.role,
          invited_by: ctx.me.id,
        })
      if (membErr && membErr.code !== '23505') {
        // 23505 = unique violation → already a member, ok
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: membErr.message })
      }

      // Bust the invited user's ctx cache — otherwise their `myOrgs` stays
      // stale (missing this workspace) until the 5-minute TTL expires, even
      // though the membership row already exists.
      invalidateCtxCache(input.email)

      return { ok: true, userId }
    }),

  /** Members of the active workspace. Returns user info + role. */
  members: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.activeOrg) return []
    const { data, error } = await ctx.supabase
      .from('org_memberships')
      .select('id, role, joined_at, user:users!org_memberships_user_id_fkey(id, name, email, avatar_url)')
      .eq('org_id', ctx.activeOrg.id)
      .order('joined_at', { ascending: true })
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
    return data ?? []
  }),

  /**
   * Remove a member from the active workspace. Owner can't be removed (must
   * transfer ownership first — not implemented yet).
   */
  removeMember: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.activeOrg) throw new TRPCError({ code: 'NOT_FOUND' })
      if (ctx.activeOrg.role !== 'owner' && ctx.activeOrg.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }
      // Block removing the owner.
      const { data: target } = await ctx.supabase
        .from('org_memberships')
        .select('role')
        .eq('org_id', ctx.activeOrg.id)
        .eq('user_id', input.userId)
        .single()
      if (target?.role === 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No se puede remover al owner' })
      }
      const { error } = await ctx.supabase
        .from('org_memberships')
        .delete()
        .eq('org_id', ctx.activeOrg.id)
        .eq('user_id', input.userId)
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      await cleanupAfterMembershipRemoved(ctx.supabase, input.userId, ctx.activeOrg.id)
      return { ok: true }
    }),

  /**
   * Leave a workspace. You can't leave a workspace where you're the only
   * owner — transfer ownership or delete the workspace instead.
   */
  leave: protectedProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = ctx.myOrgs?.find(o => o.id === input.orgId)
      if (!membership) throw new TRPCError({ code: 'NOT_FOUND' })

      if (membership.role === 'owner') {
        const { count } = await ctx.supabase
          .from('org_memberships')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', input.orgId)
          .eq('role', 'owner')
        if ((count ?? 0) <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Eres el único owner. Transfiere o elimina el workspace antes de salir.',
          })
        }
      }

      // Clean up project_members rows in this org's workspaces so the user
      // doesn't linger as a phantom member of projects they lost access to
      // (stale rows would otherwise still show their name/avatar on cards
      // and count them in "assigned to" filters).
      const { data: workspaces } = await ctx.supabase
        .from('workspaces')
        .select('id')
        .eq('org_id', input.orgId)
      const workspaceIds = (workspaces ?? []).map(w => w.id)
      if (workspaceIds.length) {
        const { data: projects } = await ctx.supabase
          .from('projects')
          .select('id')
          .in('workspace_id', workspaceIds)
        const projectIds = (projects ?? []).map(p => p.id)
        if (projectIds.length) {
          await ctx.supabase
            .from('project_members')
            .delete()
            .eq('user_id', ctx.me.id)
            .in('project_id', projectIds)
        }
      }

      const { error } = await ctx.supabase
        .from('org_memberships')
        .delete()
        .eq('org_id', input.orgId)
        .eq('user_id', ctx.me.id)
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })

      await cleanupAfterMembershipRemoved(ctx.supabase, ctx.me.id, input.orgId)
      invalidateCtxCache(ctx.session.user.email!)
      return { ok: true }
    }),
})
