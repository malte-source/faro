import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { todayInTZ } from '@/lib/tz'
import { OVERLOAD_HOURS } from '@/lib/multiempresa'
import { isDirection, loadPeople, weekLoad } from '@/server/multiempresa'

const MANAGER_ROLES = ['owner', 'admin', 'manager']

export const groupRouter = createTRPCRouter({
  /**
   * "Grupo" — Dirección only. One row per empresa (active/late projects,
   * overdue tasks, who manages it) plus the cross-company insight nobody sees
   * from a single empresa: people over the weekly limit summing all empresas.
   */
  overview: protectedProcedure.query(async ({ ctx }) => {
    if (!isDirection(ctx)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'La vista de grupo es para Dirección.' })
    }
    const today = todayInTZ(undefined, ctx.tz)
    if (!ctx.workspaceIds.length) return { empresas: [], overloaded: [], insight: null }

    const [{ data: empresas }, { data: projects }, { data: overdue }, { data: managers }, people] = await Promise.all([
      ctx.supabase.from('workspaces').select('id, name, color').in('id', ctx.workspaceIds).order('name'),
      ctx.supabase
        .from('projects')
        .select('id, workspace_id, status, end_date')
        .in('workspace_id', ctx.workspaceIds)
        .not('status', 'in', '(completed,canceled)'),
      ctx.supabase
        .from('tasks')
        .select('id, project:projects!inner(workspace_id)')
        .in('project.workspace_id', ctx.workspaceIds)
        .lt('due_date', today)
        .not('status', 'in', '(done,canceled)')
        .limit(5000),
      ctx.supabase
        .from('workspace_members')
        .select('workspace_id, role, user:users(name)')
        .in('workspace_id', ctx.workspaceIds)
        .in('role', MANAGER_ROLES as unknown as ('owner' | 'admin' | 'manager')[])
        .eq('is_active', true),
      loadPeople(ctx),
    ])

    const rows = new Map<string, { active: number; late: number; overdueTasks: number; managers: string[] }>()
    for (const e of empresas ?? []) rows.set(e.id, { active: 0, late: 0, overdueTasks: 0, managers: [] })
    for (const p of projects ?? []) {
      const r = rows.get(p.workspace_id)
      if (!r) continue
      r.active++
      if (p.status === 'delayed' || (p.end_date && p.end_date < today)) r.late++
    }
    for (const t of (overdue ?? []) as unknown as Array<{ project: { workspace_id: string } | null }>) {
      const r = t.project ? rows.get(t.project.workspace_id) : undefined
      if (r) r.overdueTasks++
    }
    for (const m of (managers ?? []) as unknown as Array<{ workspace_id: string; user: { name: string } | null }>) {
      const r = rows.get(m.workspace_id)
      if (r && m.user) r.managers.push(m.user.name)
    }

    const loads = await weekLoad(ctx, people.map(p => p.id), today)
    const overloaded = people
      .map(p => {
        const load = loads.get(p.id)
        return { id: p.id, name: p.name, hours: Math.round((load?.total ?? 0) * 10) / 10, empresas: Object.keys(load?.byWorkspace ?? {}).length }
      })
      .filter(p => p.hours > OVERLOAD_HOURS)
      .sort((a, b) => b.hours - a.hours)

    const top = overloaded[0]
    const insight = top
      ? `${top.name.split(' ')[0]} suma ${top.hours} h esta semana entre ${top.empresas} empresa${top.empresas === 1 ? '' : 's'}. ${top.empresas > 1 ? 'Ninguna lo ve sola.' : ''}`.trim()
      : null

    return {
      empresas: (empresas ?? []).map(e => ({
        id: e.id,
        name: e.name,
        color: e.color,
        ...rows.get(e.id)!,
      })),
      overloaded,
      insight,
    }
  }),
})
