import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { todayInTZ, addDays } from '@/lib/tz'
import { DEFAULT_PREFS, KIND_META, NOTIFICATION_KINDS, parseClock, type NotifyPrefs } from '@/lib/notify-core'
import { pushConfigured, sendTestPush } from '@/server/notify'

const PAGE = 30
const clock = z.string().trim().refine(v => parseClock(v) !== null, 'Hora no válida').nullable()

export const notificationsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { me, workspaceIds } = ctx

    // All thresholds in ART — what the user perceives as "today" and "+N days".
    const today = todayInTZ(undefined, ctx.tz)
    const in3days = addDays(today, 3)
    const in7days = addDays(today, 7)

    // Run overdue tasks, due-soon tasks, and due projects in parallel
    const [{ data: overdueTasks }, { data: dueSoonTasks }, dueProjectsResult] = await Promise.all([
      // Overdue tasks assigned to me
      ctx.supabase
        .from('tasks')
        .select('id, title, due_date, project:projects(id, code, name, color)')
        .eq('assignee_id', me.id)
        .neq('status', 'done')
        .neq('status', 'canceled')
        .not('due_date', 'is', null)
        .lt('due_date', today)
        .order('due_date', { ascending: true })
        .limit(8),

      // Tasks due in next 3 days assigned to me
      ctx.supabase
        .from('tasks')
        .select('id, title, due_date, project:projects(id, code, name, color)')
        .eq('assignee_id', me.id)
        .neq('status', 'done')
        .neq('status', 'canceled')
        .gte('due_date', today)
        .lte('due_date', in3days)
        .order('due_date', { ascending: true })
        .limit(8),

      // Projects due in next 7 days (needs workspace IDs from context)
      workspaceIds.length
        ? ctx.supabase
            .from('projects')
            .select('id, code, name, color, end_date, status')
            .in('workspace_id', workspaceIds)
            .neq('status', 'completed')
            .neq('status', 'canceled')
            .not('end_date', 'is', null)
            .gte('end_date', today)
            .lte('end_date', in7days)
            .order('end_date', { ascending: true })
            .limit(5)
        : Promise.resolve({ data: [] }),
    ])

    const dueProjects = dueProjectsResult.data

    const totalCount =
      (overdueTasks?.length ?? 0) +
      (dueSoonTasks?.length ?? 0) +
      (dueProjects?.length ?? 0)

    return {
      overdueTasks: (overdueTasks ?? []) as Array<{
        id: string
        title: string
        due_date: string | null
        project: { id: string; code: string; name: string; color: string } | null
      }>,
      dueSoonTasks: (dueSoonTasks ?? []) as Array<{
        id: string
        title: string
        due_date: string | null
        project: { id: string; code: string; name: string; color: string } | null
      }>,
      dueProjects: (dueProjects ?? []) as Array<{
        id: string
        code: string
        name: string
        color: string
        end_date: string | null
        status: string
      }>,
      totalCount,
    }
  }),

  // ── Persisted inbox ───────────────────────────────────────────────────────
  // Events (assigned, mentioned, asked to review…) that stay until read. The derived
  // `list` above keeps covering overdue / due-soon items.

  /** Newest first, keyset-paginated by created_at. Scoped to the active grupo. */
  inbox: protectedProcedure
    .input(z.object({
      cursor: z.string().datetime({ offset: true }).optional(),
      onlyUnread: z.boolean().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      let q = ctx.supabase
        .from('notifications')
        .select('id, kind, title, body, url, entity_type, entity_id, read_at, created_at, actor:users!notifications_actor_id_fkey(id, name, avatar_url)')
        .eq('user_id', ctx.me.id)
        .eq('org_id', ctx.me.org_id)
        .order('created_at', { ascending: false })
        .limit(PAGE + 1)
      if (input?.onlyUnread) q = q.is('read_at', null)
      if (input?.cursor) q = q.lt('created_at', input.cursor)
      const { data, error } = await q
      if (error) throw error
      const rows = data ?? []
      const items = rows.slice(0, PAGE).map(r => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        url: r.url,
        read: !!r.read_at,
        createdAt: r.created_at,
        actor: (r as unknown as { actor: { id: string; name: string; avatar_url: string | null } | null }).actor,
      }))
      return { items, nextCursor: rows.length > PAGE ? items[items.length - 1].createdAt : null }
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const { count } = await ctx.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.me.id)
      .eq('org_id', ctx.me.org_id)
      .is('read_at', null)
    return count ?? 0
  }),

  /** Mark some (or all) of MY notifications as read. */
  markRead: protectedProcedure
    .input(z.union([
      z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }),
      z.object({ all: z.literal(true) }),
    ]))
    .mutation(async ({ ctx, input }) => {
      let q = ctx.supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', ctx.me.id)
        .eq('org_id', ctx.me.org_id)
        .is('read_at', null)
      if ('ids' in input) q = q.in('id', input.ids)
      const { error } = await q
      if (error) throw error
      return { ok: true }
    }),

  // ── Web Push devices ──────────────────────────────────────────────────────

  /** Is push available on the server, and how many of MY devices are registered? */
  pushStatus: protectedProcedure.query(async ({ ctx }) => {
    const { count } = await ctx.supabase
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.me.id)
    return { configured: pushConfigured(), devices: count ?? 0 }
  }),

  /** Register this browser/device. The same endpoint re-registered by someone else moves to them (shared device, new login). */
  savePushSubscription: protectedProcedure
    .input(z.object({
      endpoint: z.string().url().max(1000).refine(u => u.startsWith('https://'), 'El endpoint debe ser https'),
      keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
      userAgent: z.string().max(300).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.from('push_subscriptions').upsert(
        {
          user_id: ctx.me.id,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          user_agent: input.userAgent ?? null,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      )
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No se pudo registrar este dispositivo.' })
      return { ok: true }
    }),

  removePushSubscription: protectedProcedure
    .input(z.object({ endpoint: z.string().url().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.supabase.from('push_subscriptions').delete().eq('endpoint', input.endpoint).eq('user_id', ctx.me.id)
      return { ok: true }
    }),

  /** Push to my own devices only (no inbox row), so I can check this device works. */
  sendTest: protectedProcedure.mutation(async ({ ctx }) => {
    const r = await sendTestPush(ctx.supabase, ctx.me.org_id, ctx.me.id)
    if (!r.configured) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Los avisos push todavía no están activados en el servidor.' })
    if (r.pushed === 0) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No hay ningún dispositivo registrado para recibir avisos. Activa los avisos en este dispositivo primero.' })
    return { pushed: r.pushed }
  }),

  // ── Preferences ───────────────────────────────────────────────────────────

  prefs: protectedProcedure.query(async ({ ctx }) => {
    const { data } = await ctx.supabase
      .from('user_notification_prefs')
      .select('push_enabled, kinds, quiet_start, quiet_end')
      .eq('user_id', ctx.me.id)
      .maybeSingle()
    const prefs: NotifyPrefs = data
      ? { push_enabled: data.push_enabled, kinds: (data.kinds ?? {}) as Record<string, boolean>, quiet_start: data.quiet_start?.slice(0, 5) ?? null, quiet_end: data.quiet_end?.slice(0, 5) ?? null }
      : DEFAULT_PREFS
    return {
      prefs,
      // Cost runs are only meaningful for Dirección.
      kinds: NOTIFICATION_KINDS
        .filter(k => k !== 'cost_run' || ctx.me.role === 'owner' || ctx.me.role === 'admin')
        .map(k => ({ kind: k, ...KIND_META[k], enabled: prefs.kinds[k] !== false })),
    }
  }),

  setPrefs: protectedProcedure
    .input(z.object({
      push_enabled: z.boolean().optional(),
      kinds: z.record(z.string(), z.boolean()).optional(),
      quiet_start: clock.optional(),
      quiet_end: clock.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: current } = await ctx.supabase
        .from('user_notification_prefs')
        .select('kinds')
        .eq('user_id', ctx.me.id)
        .maybeSingle()
      const known = new Set<string>(NOTIFICATION_KINDS)
      const kinds = { ...((current?.kinds ?? {}) as Record<string, boolean>) }
      for (const [k, v] of Object.entries(input.kinds ?? {})) if (known.has(k)) kinds[k] = v
      const { error } = await ctx.supabase.from('user_notification_prefs').upsert(
        {
          user_id: ctx.me.id,
          ...(input.push_enabled !== undefined && { push_enabled: input.push_enabled }),
          kinds,
          ...(input.quiet_start !== undefined && { quiet_start: input.quiet_start }),
          ...(input.quiet_end !== undefined && { quiet_end: input.quiet_end }),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No se pudieron guardar las preferencias.' })
      return { ok: true }
    }),

})
