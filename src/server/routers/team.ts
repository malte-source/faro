import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure, invalidateCtxCache } from '@/lib/trpc/server'
import { todayInTZ, startOfWeekUTC, addDays, daysBetween, isValidTZ } from '@/lib/tz'
import { limitsFor, requireFeature } from '@/lib/plan-limits'
import { generateFlash } from '@/lib/gemini'
import { enforceRateLimit } from '@/lib/rate-limit'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Team management — members, departments, workload.
 *
 * Mutations are admin-gated: only `owner` and `admin` org roles can invite,
 * edit, deactivate or delete users; or CRUD departments.  Reading is open
 * to everyone in the org.
 */

function requireAdmin(role: string) {
  if (role !== 'owner' && role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo owner/admin pueden gestionar usuarios.' })
  }
}

const ROLE_ENUM = ['admin', 'manager', 'member', 'viewer'] as const

/**
 * `users.role` (this legacy 4-tier scheme) and `org_memberships.role` (the
 * 3-tier owner/admin/member scheme the multi-workspace ctx actually reads
 * for permissions — see createTRPCContext) are two different columns that
 * must stay in sync. Writing only `users.role` silently no-ops any
 * permission change: ctx.me.role comes from org_memberships, not users.
 */
function toMembershipRole(role: (typeof ROLE_ENUM)[number]): 'admin' | 'member' {
  return role === 'admin' ? 'admin' : 'member'
}

/** Upsert the org_memberships row so it mirrors a `users.role` write, and
 *  bust the affected user's ctx cache so the change takes effect immediately
 *  instead of waiting out the 5-minute TTL. */
async function syncMembershipRole(
  supabase: SupabaseClient<Database>,
  orgId: string,
  userId: string,
  email: string,
  role: (typeof ROLE_ENUM)[number]
) {
  await supabase
    .from('org_memberships')
    .upsert(
      { org_id: orgId, user_id: userId, role: toMembershipRole(role) },
      { onConflict: 'user_id,org_id' }
    )
  invalidateCtxCache(email)
}

export const teamRouter = createTRPCRouter({
  /** Current user identity + role — used by the client to gate admin-only UI. */
  me: protectedProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.me.id,
      role: ctx.me.role,
      orgId: ctx.me.org_id,
      email: ctx.session.user.email,
      name: ctx.session.user.name,
      avatar: ctx.session.user.image,
      isAdmin: ctx.me.role === 'owner' || ctx.me.role === 'admin',
      tz: ctx.tz,
    }
  }),

  /** Update the caller's own timezone (or clear it to fall back to org default). */
  updateMyTimezone: protectedProcedure
    .input(z.object({ timezone: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      if (input.timezone !== null && !isValidTZ(input.timezone)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Zona horaria inválida.' })
      }
      const { error } = await ctx.supabase
        .from('users')
        .update({ timezone: input.timezone })
        .eq('id', ctx.me.id)
      if (error) throw error
      return { success: true }
    }),

  /** Update the org's default timezone (admins only). */
  updateOrgTimezone: protectedProcedure
    .input(z.object({ timezone: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      if (!isValidTZ(input.timezone)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Zona horaria inválida.' })
      }
      const { error } = await ctx.supabase
        .from('organizations')
        .update({ timezone: input.timezone })
        .eq('id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  /** Read the org's settings (currently just timezone). */
  orgSettings: protectedProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from('organizations')
      .select('id, name, timezone')
      .eq('id', ctx.me.org_id)
      .single()
    return data
  }),

  /** Members of the caller's org. Active by default; pass {includeInactive:true} to see deactivated ones too. */
  members: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const { me } = ctx
      let q = ctx.supabase
        .from('users')
        .select(`
          *,
          department:departments!fk_users_department(id, name, color),
          project_memberships:project_members!project_members_user_id_fkey(
            id, role,
            project:projects(id, code, name, status)
          )
        `)
        .eq('org_id', me.org_id)
        .order('name')
      if (!input?.includeInactive) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) throw error
      return data
    }),

  invite: protectedProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum(ROLE_ENUM).default('member'),
      departmentId: z.string().optional(),
      position: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      const { me } = ctx

      // Idempotent: if a user with this email already exists in the org,
      // reactivate + update rather than insert a duplicate.
      const { data: existing } = await ctx.supabase
        .from('users').select('id, is_active').eq('email', input.email).eq('org_id', me.org_id).maybeSingle()
      if (existing) {
        const { data, error } = await ctx.supabase
          .from('users')
          .update({
            name: input.name,
            role: input.role,
            department_id: input.departmentId ?? null,
            position: input.position ?? null,
            is_active: true,
          })
          .eq('id', existing.id)
          .select()
          .single()
        if (error) throw error
        await syncMembershipRole(ctx.supabase, me.org_id, existing.id, input.email, input.role)
        return { ...data, _reactivated: true as const }
      }

      // Seat limit only applies to brand-new members — reactivating an
      // existing (deactivated) one above doesn't add a new seat.
      const maxMembers = limitsFor(ctx.activeOrg?.plan).maxMembers
      if (maxMembers !== null) {
        const { count } = await ctx.supabase
          .from('org_memberships')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', me.org_id)
        if ((count ?? 0) >= maxMembers) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `Llegaste al límite de ${maxMembers} miembros de tu plan. Actualiza el plan para invitar más gente.`,
          })
        }
      }

      const { data, error } = await ctx.supabase
        .from('users')
        .insert({
          org_id: me.org_id,
          email: input.email,
          name: input.name,
          role: input.role,
          department_id: input.departmentId ?? null,
          position: input.position ?? null,
          // Pending login — the user becomes "real" the first time they sign in with Google
          // (the auth.ts callback updates is_active=true on first login if the row exists).
          is_active: false,
        })
        .select()
        .single()
      if (error) throw error
      await syncMembershipRole(ctx.supabase, me.org_id, data.id, input.email, input.role)
      return data
    }),

  updateMember: protectedProcedure
    .input(z.object({
      userId: z.string(),
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
      role: z.enum(ROLE_ENUM).optional(),
      departmentId: z.string().nullable().optional(),
      position: z.string().nullable().optional(),
      /** Required if changing the email of an already-active user — that's
       *  a destructive operation (breaks OAuth pairing) so we make it opt-in. */
      confirmEmailChange: z.boolean().optional(),
      // Org-structure fields ("capas" framework) — independent of the
      // system RBAC role above. See supabase/migrations/20260912_org_structure.sql.
      roleCode: z.string().max(20).nullable().optional(),
      corporateLayer: z.enum(['gobierno', 'coe', 'sso', 'filial']).nullable().optional(),
      reportsToUserId: z.string().nullable().optional(),
      dottedLineToUserId: z.string().nullable().optional(),
      kpiDescription: z.string().max(500).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)

      // Safety: can't promote anyone else to 'owner' — there's only one owner.
      // Can't demote yourself if you're the only owner.
      if (input.role && input.userId === ctx.me.id && ctx.me.role === 'owner') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No puedes cambiar tu propio rol siendo owner.' })
      }
      // Verify the target user is in our org (anti-IDOR)
      const { data: target } = await ctx.supabase
        .from('users').select('org_id, role, email, is_active').eq('id', input.userId).single()
      if (!target || target.org_id !== ctx.me.org_id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Usuario no encontrado en tu organización.' })
      }
      if (target.role === 'owner' && input.role !== undefined) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No se puede cambiar el rol del owner.' })
      }
      // A person can't report to themselves, solidly or functionally.
      if (input.reportsToUserId === input.userId || input.dottedLineToUserId === input.userId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Una persona no puede reportarse a sí misma.' })
      }

      // Email change safety
      const wantsEmailChange = input.email !== undefined && input.email.toLowerCase() !== target.email.toLowerCase()
      if (wantsEmailChange) {
        if (target.is_active && !input.confirmEmailChange) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'El usuario ya se logueó. Cambiar el email rompe su acceso. Confirma la operación explícitamente.',
          })
        }
        // Refuse if the new email already exists in this org (uniqueness conflict)
        const { data: clash } = await ctx.supabase
          .from('users').select('id').eq('email', input.email!).eq('org_id', ctx.me.org_id).maybeSingle()
        if (clash && clash.id !== input.userId) {
          throw new TRPCError({ code: 'CONFLICT', message: `Ya hay un miembro con el email ${input.email}.` })
        }
      }

      const { userId, ...fields } = input
      // The layer that grants access (chat capa channels) lives per grupo on org_memberships.
      if (fields.corporateLayer !== undefined) {
        await ctx.supabase
          .from('org_memberships')
          .update({ corporate_layer: fields.corporateLayer })
          .eq('org_id', ctx.me.org_id)
          .eq('user_id', userId)
      }
      const { data, error } = await ctx.supabase
        .from('users')
        .update({
          ...(fields.name !== undefined && { name: fields.name }),
          ...(wantsEmailChange && { email: fields.email }),
          ...(fields.role !== undefined && { role: fields.role }),
          ...(fields.departmentId !== undefined && { department_id: fields.departmentId }),
          ...(fields.position !== undefined && { position: fields.position }),
          ...(fields.roleCode !== undefined && { role_code: fields.roleCode }),
          ...(fields.corporateLayer !== undefined && { corporate_layer: fields.corporateLayer }),
          ...(fields.reportsToUserId !== undefined && { reports_to_user_id: fields.reportsToUserId }),
          ...(fields.dottedLineToUserId !== undefined && { dotted_line_to_user_id: fields.dottedLineToUserId }),
          ...(fields.kpiDescription !== undefined && { kpi_description: fields.kpiDescription }),
        })
        .eq('id', userId)
        .eq('org_id', ctx.me.org_id)
        .select()
        .single()
      if (error) throw error
      if (fields.role !== undefined) {
        await syncMembershipRole(ctx.supabase, ctx.me.org_id, userId, data.email, fields.role)
      }
      return data
    }),

  deactivateMember: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      if (input.userId === ctx.me.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No puedes desactivarte a ti mismo.' })
      }
      const { data: target } = await ctx.supabase
        .from('users').select('org_id, role').eq('id', input.userId).single()
      if (!target || target.org_id !== ctx.me.org_id) throw new TRPCError({ code: 'NOT_FOUND' })
      if (target.role === 'owner') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No se puede desactivar al owner.' })
      }
      const { error } = await ctx.supabase
        .from('users').update({ is_active: false }).eq('id', input.userId).eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  /** Bring back a previously deactivated user. */
  reactivateMember: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      const { error } = await ctx.supabase
        .from('users').update({ is_active: true }).eq('id', input.userId).eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  /**
   * HARD delete a user.  Use with care — this removes their `users` row, which
   * cascades to project_members, time_entries, comments authored by them, etc.
   * For most cases you want `deactivateMember` instead; delete is only useful
   * to clean up a test invite that never logged in.
   */
  deleteMember: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      if (input.userId === ctx.me.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No puedes borrarte a ti mismo.' })
      }
      const { data: target } = await ctx.supabase
        .from('users').select('org_id, role').eq('id', input.userId).single()
      if (!target || target.org_id !== ctx.me.org_id) throw new TRPCError({ code: 'NOT_FOUND' })
      if (target.role === 'owner') throw new TRPCError({ code: 'FORBIDDEN', message: 'No se puede borrar al owner.' })
      const { error } = await ctx.supabase
        .from('users').delete().eq('id', input.userId).eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  // ── Departments ──────────────────────────────────────────────────

  departments: protectedProcedure.query(async ({ ctx }) => {
    const { me } = ctx
    const { data, error } = await ctx.supabase
      .from('departments')
      .select(`*, head:users!departments_head_user_id_fkey(id, name, avatar_url)`)
      .eq('org_id', me.org_id)
      .order('name')
    if (error) throw error
    return data
  }),

  createDepartment: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(80),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#0EA5E9'),
      headUserId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      const { data, error } = await ctx.supabase
        .from('departments')
        .insert({
          org_id: ctx.me.org_id,
          name: input.name,
          color: input.color,
          head_user_id: input.headUserId ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return data
    }),

  updateDepartment: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(80).optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      headUserId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      const { id, ...patch } = input
      const { data, error } = await ctx.supabase
        .from('departments')
        .update({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.color !== undefined && { color: patch.color }),
          ...(patch.headUserId !== undefined && { head_user_id: patch.headUserId }),
        })
        .eq('id', id)
        .eq('org_id', ctx.me.org_id)
        .select()
        .single()
      if (error) throw error
      return data
    }),

  deleteDepartment: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      // Sanity: refuse if there are still members assigned (UX safeguard).
      const { count } = await ctx.supabase
        .from('users').select('id', { count: 'exact', head: true })
        .eq('department_id', input).eq('org_id', ctx.me.org_id)
      if ((count ?? 0) > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `El departamento tiene ${count} miembro(s). Reasignalos primero.` })
      }
      const { error } = await ctx.supabase
        .from('departments').delete().eq('id', input).eq('org_id', ctx.me.org_id)
      if (error) throw error
      return { success: true }
    }),

  workload: protectedProcedure.query(async ({ ctx }) => {
    const { me, projectIds } = ctx

    // Week start in ART (Monday 00:00 local) for time tracking aggregation.
    // `monday` is the absolute UTC moment corresponding to that wall clock.
    const monday = new Date(startOfWeekUTC(undefined, ctx.tz))
    const today = todayInTZ(undefined, ctx.tz)

    // Pull everything in parallel
    const [{ data: users }, { data: openTasks }, { data: timeRows }] = await Promise.all([
      ctx.supabase
        .from('users')
        .select(`
          id, name, avatar_url, position,
          project_members!project_members_user_id_fkey(role, project:projects(id, status))
        `)
        .eq('org_id', me.org_id)
        .eq('is_active', true),
      // Open tasks per assignee
      ctx.supabase
        .from('tasks')
        .select('assignee_id, status, due_date')
        .in('project_id', projectIds.length ? projectIds : ['00000000-0000-0000-0000-000000000000'])
        .neq('status', 'done')
        .neq('status', 'canceled'),
      // Time tracked this week per user
      ctx.supabase
        .from('time_entries')
        .select('user_id, duration_minutes')
        .gte('started_at', monday.toISOString())
        .not('duration_minutes', 'is', null),
    ])

    const tasksByUser = new Map<string, { open: number; overdue: number; inProgress: number }>()
    for (const t of openTasks ?? []) {
      if (!t.assignee_id) continue
      const cur = tasksByUser.get(t.assignee_id) ?? { open: 0, overdue: 0, inProgress: 0 }
      cur.open++
      if (t.status === 'in_progress') cur.inProgress++
      if (t.due_date && t.due_date < today) cur.overdue++
      tasksByUser.set(t.assignee_id, cur)
    }
    const minutesByUser = new Map<string, number>()
    for (const e of timeRows ?? []) {
      minutesByUser.set(e.user_id, (minutesByUser.get(e.user_id) ?? 0) + (e.duration_minutes ?? 0))
    }

    type Member = { project: { status: string } | null }
    return users?.map(user => {
      const stats = tasksByUser.get(user.id) ?? { open: 0, overdue: 0, inProgress: 0 }
      const members = (user.project_members as Member[] | null) ?? []
      return {
        id: user.id,
        name: user.name,
        avatar_url: user.avatar_url,
        position: user.position,
        activeProjects: members.filter(pm => pm.project?.status === 'in_progress').length,
        openTasks: stats.open,
        overdueTasks: stats.overdue,
        inProgressTasks: stats.inProgress,
        minutesThisWeek: minutesByUser.get(user.id) ?? 0,
      }
    }) ?? []
  }),

  /**
   * Task-based weekly workload — the Asana/Monday "Workload view".
   *
   * For each (member, week) returns the sum of `estimated_hours` of OPEN
   * tasks (status not in done/canceled) assigned to that member whose
   * `due_date` falls within that week.
   *
   * Why due_date and not "ongoing work"? Two options exist:
   *   A. Tasks "active during" a week (start..due overlapping the week).
   *   B. Tasks due in that week.
   * Most PM tools use (B) because it's a clearer mental model: "what does
   * this person have to deliver this week?". Easier to action.
   *
   * Defaults: 6 weeks out, 40h/week capacity. UI can override both.
   */
  workloadTasks: protectedProcedure
    .input(z.object({
      weeksOut: z.number().int().min(1).max(26).default(6),
      capacityHours: z.number().int().min(1).max(80).default(40),
    }).optional())
    .query(async ({ ctx, input }) => {
      const weeksOut = input?.weeksOut ?? 6
      const capacityHours = input?.capacityHours ?? 40

      // Compute Monday-of-this-week in caller TZ. All week boundaries are local
      // dates — Supabase compares DATE columns lexicographically (safe).
      const today = todayInTZ(undefined, ctx.tz)
      const probe = new Date(today + 'T12:00:00Z')
      const dow = probe.getUTCDay()
      const offsetToMon = (dow + 6) % 7
      const monday = addDays(today, -offsetToMon)

      // Week ranges: [start, end) — end is exclusive so a Sunday due_date
      // belongs to the previous week's range.
      const weeks: Array<{ start: string; end: string; label: string }> = []
      for (let i = 0; i < weeksOut; i++) {
        const start = addDays(monday, i * 7)
        const end = addDays(start, 7)
        const startDate = new Date(start + 'T00:00:00')
        weeks.push({
          start,
          end,
          label: startDate.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
        })
      }
      const overallEnd = weeks[weeks.length - 1].end

      // Pull members + open tasks (assigned to anyone) with due_date in range.
      const [{ data: users }, { data: tasks }] = await Promise.all([
        ctx.supabase
          .from('users')
          .select('id, name, avatar_url, position')
          .eq('org_id', ctx.me.org_id)
          .eq('is_active', true)
          .order('name'),
        ctx.supabase
          .from('tasks')
          .select('assignee_id, estimated_hours, due_date, status')
          .gte('due_date', monday)
          .lt('due_date', overallEnd)
          .not('assignee_id', 'is', null)
          .neq('status', 'done')
          .neq('status', 'canceled'),
      ])
      const memberList = users ?? []

      // grid[userIdx][weekIdx] = hours
      const grid: number[][] = memberList.map(() => weeks.map(() => 0))
      const userIndex = new Map<string, number>()
      memberList.forEach((u, i) => userIndex.set(u.id, i))

      for (const t of tasks ?? []) {
        if (!t.assignee_id || !t.due_date) continue
        const uIdx = userIndex.get(t.assignee_id)
        if (uIdx === undefined) continue
        // Find week index by binary-ish scan (weeks are sorted).
        const dueDay = t.due_date.slice(0, 10)
        const wIdx = weeks.findIndex(w => dueDay >= w.start && dueDay < w.end)
        if (wIdx < 0) continue
        // Use estimated_hours if set, otherwise assume 2h per task as fallback
        // (a "we don't know but it's not zero" heuristic).
        const hours = t.estimated_hours ?? 2
        grid[uIdx][wIdx] += hours
      }

      // Sanity counts for the header.
      const totalTasksConsidered = (tasks ?? []).length
      const totalHours = grid.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0)

      return {
        users: memberList,
        weeks,
        grid,
        capacityHours,
        totalTasksConsidered,
        totalHours,
        // Diagnostic: how many days into the future we span.
        daysSpanned: daysBetween(monday, overallEnd),
      }
    }),

  /**
   * Org chart — every active member with their capa, línea sólida
   * (reports_to) and línea punteada (dotted_line_to), ready for the client
   * to lay out as a tree. Building the tree client-side (not here) because
   * the UI needs to render multiple independent trees if some people have
   * no reports_to (e.g. peers at the Gobierno layer).
   */
  orgChart: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('users')
      .select('id, name, email, avatar_url, position, role_code, corporate_layer, reports_to_user_id, dotted_line_to_user_id, kpi_description')
      .eq('org_id', ctx.me.org_id)
      .eq('is_active', true)
      .order('role_code', { ascending: true, nullsFirst: false })
    if (error) throw error
    return data ?? []
  }),

  /**
   * Draft a Job Description with Gemini from the role's structural fields
   * (código, capa, KPI, a quién reporta) plus a short free-text brief. Returns
   * plain markdown — the caller pastes/edits it, nothing is saved server-side.
   */
  generateJobDescription: protectedProcedure
    .input(z.object({
      userId: z.string(),
      brief: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdmin(ctx.me.role)
      requireFeature(ctx.activeOrg?.plan, 'ai', 'Generar JD con IA')
      enforceRateLimit(`${ctx.me.id}:generateJD`)

      const { data: target } = await ctx.supabase
        .from('users')
        .select('name, position, role_code, corporate_layer, kpi_description, department_id, reports_to:reports_to_user_id(name, position), dotted_line_to:dotted_line_to_user_id(name, position)')
        .eq('id', input.userId)
        .eq('org_id', ctx.me.org_id)
        .single()
      if (!target) throw new TRPCError({ code: 'NOT_FOUND' })

      const reportsTo = (target.reports_to as unknown as { name: string; position: string | null } | null)
      const dottedTo = (target.dotted_line_to as unknown as { name: string; position: string | null } | null)
      const layerLabel: Record<string, string> = {
        gobierno: 'Gobierno (manda sobre las filiales, autoridad de mando)',
        coe: 'Centro de Excelencia (fija el estándar, autoridad de veto sobre la forma, no manda personas)',
        sso: 'Servicios Compartidos (ejecuta trabajo por pedido, relación proveedor-cliente interno, SLA)',
        filial: 'Filial Operativa (tiene P&L y margen propio, autoridad total sobre su ejecución)',
      }

      const prompt = `Redacta una Job Description profesional en español neutro (sin voseo) para este rol corporativo, en formato markdown con secciones: Resumen del rol, Responsabilidades principales, A quién reporta, Decisiones que toma solo, Decisiones que escala, KPI principal, Perfil buscado.

DATOS DEL ROL:
- Nombre / cargo: ${target.name}${target.position ? ` — ${target.position}` : ''}
- Código de rol: ${target.role_code ?? 'sin asignar'}
- Capa corporativa: ${target.corporate_layer ? layerLabel[target.corporate_layer] : 'sin asignar'}
- Reporta (línea sólida) a: ${reportsTo?.name ?? 'sin asignar'}${reportsTo?.position ? ` (${reportsTo.position})` : ''}
- Línea punteada / funcional a: ${dottedTo?.name ?? 'ninguna'}${dottedTo?.position ? ` (${dottedTo.position})` : ''}
- KPI principal: ${target.kpi_description ?? 'sin definir — inferilo razonablemente del cargo'}
${input.brief ? `\nCONTEXTO ADICIONAL PROVISTO POR EL ADMIN:\n${input.brief}` : ''}

Sé concreto y accionable, no genérico. Si es un rol de Centro de Excelencia, aclara que su autoridad es de veto sobre la forma, no de mando sobre personas. Si es de Servicios Compartidos, aclara que responde a un pedido con SLA, no da órdenes a las filiales. Devuelve solo el markdown, sin explicación previa.`

      const draft = await generateFlash(prompt)
      return { draft }
    }),
})
