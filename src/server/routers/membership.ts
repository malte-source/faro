import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure, invalidateCtxCache } from '@/lib/trpc/server'
import { todayInTZ } from '@/lib/tz'
import { limitsFor } from '@/lib/plan-limits'
import { isDirection, loadPeople, visibleEmpresas, weekLoad, type EmpresaCtx } from '@/server/multiempresa'

const SOMBRERO_ROLES = ['owner', 'admin', 'manager', 'member', 'viewer', 'guest'] as const

/** Dirección of the grupo, or admin/owner of that specific empresa, can edit its sombreros. */
async function requireCanManage(ctx: EmpresaCtx, workspaceId: string) {
  if (!ctx.workspaceIds.includes(workspaceId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Esa empresa no es parte de tu grupo.' })
  }
  if (isDirection(ctx)) return
  const { data } = await ctx.supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', ctx.me.id)
    .eq('is_active', true)
    .maybeSingle()
  if (data?.role !== 'owner' && data?.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo Dirección o el admin de la empresa puede cambiar cargos.' })
  }
}

/** Only Dirección can hand out admin/owner permissions: an empresa admin must not be able to mint more Dirección. */
function requireDirectionForAdminRole(ctx: EmpresaCtx, role: string) {
  if (!isDirection(ctx) && (role === 'owner' || role === 'admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo Dirección puede dar permisos de administrador.' })
  }
}

export const membershipRouter = createTRPCRouter({
  /** Who am I and under which sombreros ("Mis sombreros" in the sidebar). */
  me: protectedProcedure.query(async ({ ctx }) => {
    const empresas = await visibleEmpresas(ctx)
    const { data } = ctx.workspaceIds.length
      ? await ctx.supabase
          .from('workspace_members')
          .select('workspace_id, position, role')
          .eq('user_id', ctx.me.id)
          .eq('is_active', true)
          .in('workspace_id', ctx.workspaceIds)
      : { data: [] }
    const byWs = new Map((data ?? []).map(m => [m.workspace_id, m]))
    const colorOf = new Map(empresas.map(e => [e.id, e]))

    // Sombreros need the empresa color even when `empresas` is filtered —
    // a sombrero is always an empresa I can see.
    const memberships = (data ?? [])
      .filter(m => colorOf.has(m.workspace_id))
      .map(m => ({
        workspaceId: m.workspace_id,
        name: colorOf.get(m.workspace_id)!.name,
        color: colorOf.get(m.workspace_id)!.color,
        position: byWs.get(m.workspace_id)!.position,
        role: m.role,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return {
      user: {
        id: ctx.me.id,
        name: ctx.session.user.name ?? ctx.session.user.email ?? '',
        email: ctx.session.user.email ?? '',
        avatar: ctx.session.user.image ?? null,
      },
      groupName: ctx.activeOrg?.name ?? '',
      /** Orgs with workspace-scoped visibility use the simplified Hoy · Proyectos · Personas · Grupo navigation. */
      groupMode: ctx.activeOrg?.workspace_scoped ?? false,
      /** Personal workspaces have nobody to talk to: the chat entry is for team workspaces. */
      isTeam: ctx.activeOrg?.workspace_type === 'team',
      isDirection: isDirection(ctx),
      empresas,
      memberships,
    }
  }),

  /**
   * Compact directory used client-side by the quick-add parser and the capture
   * review (instant hat + warning recompute when the assignee changes).
   */
  directory: protectedProcedure.query(async ({ ctx }) => {
    const [empresas, people] = await Promise.all([visibleEmpresas(ctx), loadPeople(ctx)])
    return {
      today: todayInTZ(undefined, ctx.tz),
      workspaces: empresas,
      people: people.map(p => ({
        id: p.id,
        name: p.name,
        avatarUrl: p.avatarUrl,
        memberships: p.memberships.map(m => ({ workspaceId: m.workspaceId, position: m.position })),
      })),
    }
  }),

  /** Personas section: everyone with their sombreros and this week's hours per empresa. */
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const [empresas, allPeople] = await Promise.all([visibleEmpresas(ctx), loadPeople(ctx)])
      const visible = new Set(empresas.map(e => e.id))
      const today = todayInTZ(undefined, ctx.tz)

      // A person belongs to the list if they wear a visible hat, or (Dirección)
      // if they're in the grupo at all — new invitees have no hat yet.
      let people = allPeople.filter(p => isDirection(ctx) || p.memberships.some(m => visible.has(m.workspaceId)))
      if (input?.workspaceId) people = people.filter(p => p.memberships.some(m => m.workspaceId === input.workspaceId))

      const loads = await weekLoad(ctx, people.map(p => p.id), today)
      return {
        empresas,
        people: people.map(p => {
          const load = loads.get(p.id)
          return {
            id: p.id,
            name: p.name,
            email: p.email,
            avatarUrl: p.avatarUrl,
            notifyChannel: p.notifyChannel,
            orgRole: p.orgRole,
            memberships: p.memberships.filter(m => isDirection(ctx) || visible.has(m.workspaceId)),
            hoursByWorkspace: load?.byWorkspace ?? {},
            totalHours: load?.total ?? 0,
          }
        }),
      }
    }),

  /** Create or update a person's sombrero (cargo + permiso) in an empresa. */
  upsert: protectedProcedure
    .input(z.object({
      userId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      position: z.string().trim().min(1).max(80),
      role: z.enum(SOMBRERO_ROLES).default('member'),
      departmentId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireCanManage(ctx, input.workspaceId)
      requireDirectionForAdminRole(ctx, input.role)
      if (!ctx.activeOrg) throw new TRPCError({ code: 'NOT_FOUND' })

      const { data: member } = await ctx.supabase
        .from('org_memberships')
        .select('id')
        .eq('org_id', ctx.activeOrg.id)
        .eq('user_id', input.userId)
        .maybeSingle()
      if (!member) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Primero invita a la persona al grupo (Equipo → Invitar).' })
      }

      const { error } = await ctx.supabase.from('workspace_members').upsert(
        {
          user_id: input.userId,
          workspace_id: input.workspaceId,
          position: input.position,
          role: input.role,
          department_id: input.departmentId ?? null,
          is_active: true,
        },
        { onConflict: 'user_id,workspace_id' },
      )
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })

      const { data: u } = await ctx.supabase.from('users').select('email').eq('id', input.userId).single()
      if (u) invalidateCtxCache(u.email)
      return { ok: true }
    }),

  /**
   * Invite one or many people to the grupo and give them a sombrero in an
   * empresa, in a single step (the flow of "cargar al equipo de La Trinchera").
   * Creates the user row if the email is new — they join the grupo the first
   * time they sign in with Google. Per-row results so one bad email doesn't
   * sink the rest.
   */
  inviteMany: protectedProcedure
    .input(z.object({
      workspaceId: z.string().uuid(),
      role: z.enum(SOMBRERO_ROLES).default('member'),
      people: z.array(z.object({
        email: z.string().trim().toLowerCase().email(),
        name: z.string().trim().max(80).optional(),
        position: z.string().trim().min(1).max(80),
      })).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      await requireCanManage(ctx, input.workspaceId)
      requireDirectionForAdminRole(ctx, input.role)
      const org = ctx.activeOrg
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' })
      if (org.workspace_type !== 'team') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Solo los workspaces de equipo pueden tener miembros.' })
      }
      const orgRole: 'admin' | 'member' = isDirection(ctx) && (input.role === 'owner' || input.role === 'admin') ? 'admin' : 'member'
      const maxMembers = limitsFor(org.plan).maxMembers

      const { count: current } = await ctx.supabase
        .from('org_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id)
      let seats = current ?? 0

      const results: Array<{ email: string; ok: boolean; error?: string }> = []
      for (const p of input.people) {
        try {
          const { data: existing } = await ctx.supabase.from('users').select('id').eq('email', p.email).maybeSingle()
          let userId = existing?.id
          const { data: already } = userId
            ? await ctx.supabase.from('org_memberships').select('id').eq('org_id', org.id).eq('user_id', userId).maybeSingle()
            : { data: null }

          if (!already) {
            if (maxMembers !== null && seats >= maxMembers) {
              results.push({ email: p.email, ok: false, error: `Límite de ${maxMembers} miembros del plan ${org.plan}.` })
              continue
            }
            if (!userId) {
              const { data: created, error: createErr } = await ctx.supabase
                .from('users')
                .insert({ email: p.email, name: p.name || p.email.split('@')[0], org_id: org.id, role: 'member' })
                .select('id')
                .single()
              if (createErr) throw new Error(createErr.message)
              userId = created.id
            }
            const { error: omErr } = await ctx.supabase
              .from('org_memberships')
              .insert({ user_id: userId!, org_id: org.id, role: orgRole, invited_by: ctx.me.id })
            if (omErr && omErr.code !== '23505') throw new Error(omErr.message)
            seats++
          }

          const { error: wmErr } = await ctx.supabase.from('workspace_members').upsert(
            { user_id: userId!, workspace_id: input.workspaceId, position: p.position, role: input.role, is_active: true },
            { onConflict: 'user_id,workspace_id' },
          )
          if (wmErr) throw new Error(wmErr.message)
          invalidateCtxCache(p.email)
          results.push({ email: p.email, ok: true })
        } catch (err) {
          results.push({ email: p.email, ok: false, error: err instanceof Error ? err.message : 'Error desconocido' })
        }
      }
      return { results }
    }),

  /** Take a sombrero off (keeps history; the person stays in the grupo). */
  deactivate: protectedProcedure
    .input(z.object({ userId: z.string().uuid(), workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireCanManage(ctx, input.workspaceId)
      const { error } = await ctx.supabase
        .from('workspace_members')
        .update({ is_active: false })
        .eq('user_id', input.userId)
        .eq('workspace_id', input.workspaceId)
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })

      const { data: channels } = await ctx.supabase.from('chat_channels').select('id').eq('workspace_id', input.workspaceId)
      const channelIds = (channels ?? []).map(c => c.id)
      if (channelIds.length) await ctx.supabase.from('chat_members').delete().eq('user_id', input.userId).in('channel_id', channelIds)

      const { data: u } = await ctx.supabase.from('users').select('email').eq('id', input.userId).single()
      if (u) invalidateCtxCache(u.email)
      return { ok: true }
    }),
})
