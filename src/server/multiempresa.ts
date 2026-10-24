import { TRPCError } from '@trpc/server'
import { invalidateCtxCache } from '@/lib/trpc/server'
import type { createAdminSupabaseClient } from '@/lib/supabase'
import {
  WEEK_CAPACITY_HOURS,
  weekBounds,
  type DirectoryPerson,
  type DirectoryWorkspace,
} from '@/lib/multiempresa'

type Db = ReturnType<typeof createAdminSupabaseClient>

/** The slice of the tRPC context these helpers need. */
export interface EmpresaCtx {
  supabase: Db
  me: { id: string; org_id: string; role: string }
  activeOrg: { id: string; role: 'owner' | 'admin' | 'member'; workspace_scoped: boolean } | null
  workspaceIds: string[]
  myWorkspaceIds: string[]
}

export const isDirection = (ctx: Pick<EmpresaCtx, 'me'>) => ctx.me.role === 'owner' || ctx.me.role === 'admin'

export interface EmpresaRow extends DirectoryWorkspace {
  color: string
}

export interface PersonRow extends DirectoryPerson {
  email: string
  avatarUrl: string | null
  notifyChannel: string
  isActive: boolean
  orgRole: 'owner' | 'admin' | 'member'
  memberships: Array<{ workspaceId: string; position: string; role: string; workspaceName: string; workspaceColor: string; departmentId: string | null }>
}

/**
 * Empresas the caller can see: Dirección sees all of the grupo's empresas;
 * in workspace-scoped orgs everyone else sees only the ones where they have a
 * sombrero; in other orgs the empresa list is informational and shows all.
 */
export async function visibleEmpresas(ctx: EmpresaCtx): Promise<EmpresaRow[]> {
  if (!ctx.workspaceIds.length) return []
  const scoped = ctx.activeOrg?.workspace_scoped && !isDirection(ctx)
  const ids = scoped ? ctx.myWorkspaceIds : ctx.workspaceIds
  if (!ids.length) return []
  const { data, error } = await ctx.supabase
    .from('workspaces')
    .select('id, name, color')
    .in('id', ids)
    .order('name')
  if (error) throw error
  return (data ?? []).map(w => ({ id: w.id, name: w.name, color: w.color }))
}

/** Everyone in the active grupo (org_memberships ∪ workspace_members) with their sombreros. */
export async function loadPeople(ctx: EmpresaCtx): Promise<PersonRow[]> {
  if (!ctx.activeOrg) return []
  const [{ data: orgMembers, error: e1 }, { data: sombreros, error: e2 }, { data: empresas }] = await Promise.all([
    ctx.supabase
      .from('org_memberships')
      .select('role, user:users!org_memberships_user_id_fkey(id, name, email, avatar_url, notify_channel, is_active)')
      .eq('org_id', ctx.activeOrg.id),
    ctx.workspaceIds.length
      ? ctx.supabase
          .from('workspace_members')
          .select('user_id, workspace_id, position, role, department_id')
          .in('workspace_id', ctx.workspaceIds)
          .eq('is_active', true)
      : Promise.resolve({ data: [], error: null }),
    ctx.workspaceIds.length
      ? ctx.supabase.from('workspaces').select('id, name, color').in('id', ctx.workspaceIds)
      : Promise.resolve({ data: [] }),
  ])
  if (e1) throw e1
  if (e2) throw e2

  const wsById = new Map((empresas ?? []).map(w => [w.id, w]))
  const hatsByUser = new Map<string, PersonRow['memberships']>()
  for (const s of sombreros ?? []) {
    const ws = wsById.get(s.workspace_id)
    if (!ws) continue
    const list = hatsByUser.get(s.user_id) ?? []
    list.push({
      workspaceId: s.workspace_id,
      position: s.position,
      role: s.role,
      workspaceName: ws.name,
      workspaceColor: ws.color,
      departmentId: s.department_id,
    })
    hatsByUser.set(s.user_id, list)
  }

  // Members of a workspace-scoped grupo only see hats in the empresas where they have one themselves.
  const hideOtherEmpresas = !!ctx.activeOrg?.workspace_scoped && !isDirection(ctx)
  type U = { id: string; name: string; email: string; avatar_url: string | null; notify_channel: string; is_active: boolean }
  const out: PersonRow[] = []
  for (const m of (orgMembers ?? []) as unknown as Array<{ role: 'owner' | 'admin' | 'member'; user: U | null }>) {
    if (!m.user || !m.user.is_active) continue
    out.push({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatar_url,
      notifyChannel: m.user.notify_channel,
      isActive: m.user.is_active,
      orgRole: m.role,
      memberships: (hatsByUser.get(m.user.id) ?? [])
        .filter(h => !hideOtherEmpresas || ctx.myWorkspaceIds.includes(h.workspaceId))
        .sort((a, b) => a.workspaceName.localeCompare(b.workspaceName)),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export interface WeekLoad {
  /** hours of the week by empresa */
  byWorkspace: Record<string, number>
  total: number
}

/**
 * Hours committed in the week containing `anyDateInWeek`, per person and per
 * empresa: sum of estimated_hours of open tasks due that week. (Phase 1 —
 * time_entries can replace this later.)
 */
export async function weekLoad(
  ctx: EmpresaCtx,
  userIds: string[],
  anyDateInWeek: string,
): Promise<Map<string, WeekLoad>> {
  const result = new Map<string, WeekLoad>()
  if (!userIds.length || !ctx.workspaceIds.length) return result
  const { monday, sunday } = weekBounds(anyDateInWeek)
  const { data, error } = await ctx.supabase
    .from('tasks')
    .select('assignee_id, estimated_hours, workspace_id, project:projects!inner(workspace_id)')
    .in('assignee_id', userIds)
    .in('project.workspace_id', ctx.workspaceIds)
    .gte('due_date', monday)
    .lte('due_date', sunday)
    .not('status', 'in', '(done,canceled)')
    .not('estimated_hours', 'is', null)
    .limit(5000)
  if (error) throw error

  for (const t of (data ?? []) as unknown as Array<{
    assignee_id: string | null; estimated_hours: number | null; workspace_id: string | null; project: { workspace_id: string } | null
  }>) {
    if (!t.assignee_id || !t.estimated_hours) continue
    const ws = t.workspace_id ?? t.project?.workspace_id
    if (!ws) continue
    const load = result.get(t.assignee_id) ?? { byWorkspace: {}, total: 0 }
    load.byWorkspace[ws] = (load.byWorkspace[ws] ?? 0) + Number(t.estimated_hours)
    load.total += Number(t.estimated_hours)
    result.set(t.assignee_id, load)
  }
  return result
}

export const loadPct = (hours: number) => Math.round((hours / WEEK_CAPACITY_HOURS) * 100)

const INBOX_CODE = 'BANDEJA'

/**
 * Every empresa has a "Bandeja" project that receives tasks created in one
 * line or from a capture when no project was chosen. Created lazily; the
 * creator and assignee are added as members so it is visible in orgs that
 * don't use workspace-scoped visibility, and their ctx cache is busted so
 * the new project shows up immediately.
 */
export async function ensureInboxProject(
  ctx: EmpresaCtx & { activeOrg: NonNullable<EmpresaCtx['activeOrg']> },
  workspaceId: string,
  participantIds: string[],
): Promise<string> {
  if (!ctx.workspaceIds.includes(workspaceId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Esa empresa no es parte de tu grupo.' })
  }
  const findInbox = async () => {
    const { data } = await ctx.supabase
      .from('projects')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('code', INBOX_CODE)
      .order('created_at', { ascending: true })
      .limit(1)
    return data?.[0]?.id as string | undefined
  }

  let projectId = await findInbox()
  let created = false
  if (!projectId) {
    const { data, error } = await ctx.supabase
      .from('projects')
      .insert({
        workspace_id: workspaceId,
        code: INBOX_CODE,
        name: 'Bandeja',
        description: 'Tareas creadas en una línea o desde una captura, sin proyecto asignado.',
        status: 'in_progress',
        kanban_stage: 'in_progress',
        color: '#FFB020',
        created_by: ctx.me.id,
        visibility: 'workspace',
      })
      .select('id')
      .single()
    if (error) {
      // 23505 = another request created the Bandeja at the same moment (unique index): use theirs.
      projectId = error.code === '23505' ? await findInbox() : undefined
      if (!projectId) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
    } else {
      projectId = data.id
      created = true
    }
  }

  const ids = Array.from(new Set([ctx.me.id, ...participantIds]))
  const { data: already } = await ctx.supabase
    .from('project_members')
    .select('user_id')
    .eq('project_id', projectId)
    .in('user_id', ids)
  const have = new Set((already ?? []).map(r => r.user_id))
  const missing = ids.filter(id => !have.has(id))
  if (missing.length) {
    await ctx.supabase.from('project_members').insert(
      missing.map(user_id => ({ project_id: projectId!, user_id, role: 'contributor' as const, added_by: ctx.me.id })),
    )
  }

  if (created || missing.length) {
    const { data: users } = await ctx.supabase.from('users').select('email').in('id', ids)
    for (const u of users ?? []) invalidateCtxCache(u.email)
  }
  return projectId
}
