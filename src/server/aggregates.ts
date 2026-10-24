import type { createAdminSupabaseClient } from '@/lib/supabase'

type Db = ReturnType<typeof createAdminSupabaseClient>

/**
 * Task aggregates for the project list and the dashboard.
 *
 * Primary path: SQL functions from supabase/migrations/20261025_aggregates.sql, called with
 * `rpc` (ids travel in the request body, counts are exact). Fallback path: the previous
 * "fetch rows and count in JS" approach — now paginated, so it no longer truncates at
 * PostgREST's 1,000-row default. The fallback is what runs until that migration is applied,
 * so the code is safe to deploy before or after it.
 */

const PAGE = 1000
const MAX_PAGES = 30 // safety valve: 30k top-level tasks per call

let warned = false
function warnFallback(fn: string, err: { code?: string; message?: string }) {
  // PGRST202 = function not created yet: expected until the SQL is applied, log once.
  if (warned) return
  warned = true
  console.warn(`[aggregates] ${fn} unavailable (${err.code ?? 'error'}: ${err.message ?? ''}) — using the paginated fallback`)
}

export interface ProjectTaskAgg { total: number; done: number; lastActivity: string | null }

/** Per-project totals of top-level tasks: total, done and last activity. */
export async function projectTaskAggregates(db: Db, projectIds: string[]): Promise<Map<string, ProjectTaskAgg>> {
  const out = new Map<string, ProjectTaskAgg>()
  if (!projectIds.length) return out

  const { data, error } = await db.rpc('project_task_stats', { p_project_ids: projectIds })
  if (!error && data) {
    for (const r of data) {
      out.set(r.project_id, { total: Number(r.total), done: Number(r.done), lastActivity: r.last_activity })
    }
    return out
  }
  warnFallback('project_task_stats', error ?? {})

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data: rows, error: e } = await db
      .from('tasks')
      .select('id, project_id, status, updated_at')
      .in('project_id', projectIds)
      .is('parent_task_id', null)
      .order('id')
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (e) throw e
    for (const t of rows ?? []) {
      const a = out.get(t.project_id) ?? { total: 0, done: 0, lastActivity: null }
      a.total++
      if (t.status === 'done') a.done++
      if (!a.lastActivity || (t.updated_at && t.updated_at > a.lastActivity)) a.lastActivity = t.updated_at
      out.set(t.project_id, a)
    }
    if ((rows?.length ?? 0) < PAGE) break
  }
  return out
}

export interface TaskOverview {
  byStatus: { todo: number; in_progress: number; in_review: number; done: number; canceled: number }
  total: number
  myPending: number
  overdue: number
}

const emptyOverview = (): TaskOverview => ({
  byStatus: { todo: 0, in_progress: 0, in_review: 0, done: 0, canceled: 0 },
  total: 0,
  myPending: 0,
  overdue: 0,
})

type StatusKey = keyof TaskOverview['byStatus']
const isStatus = (s: string): s is StatusKey => s in emptyOverview().byStatus

/** Dashboard counters: tasks per status, total, overdue, and the caller's pending tasks. */
export async function taskOverviewStats(db: Db, projectIds: string[], userId: string, today: string): Promise<TaskOverview> {
  const out = emptyOverview()
  if (!projectIds.length) return out

  const { data, error } = await db.rpc('task_overview_stats', { p_project_ids: projectIds, p_user_id: userId, p_today: today })
  if (!error && data) {
    for (const r of data) {
      if (isStatus(r.status)) out.byStatus[r.status] += Number(r.total)
      out.total += Number(r.total)
      out.overdue += Number(r.overdue)
      out.myPending += Number(r.mine_pending)
    }
    return out
  }
  warnFallback('task_overview_stats', error ?? {})

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data: rows, error: e } = await db
      .from('tasks')
      .select('id, status, due_date')
      .in('project_id', projectIds)
      .is('parent_task_id', null)
      .order('id')
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (e) throw e
    for (const t of rows ?? []) {
      if (isStatus(t.status)) out.byStatus[t.status]++
      out.total++
      if (t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'canceled') out.overdue++
    }
    if ((rows?.length ?? 0) < PAGE) break
  }

  const { count, error: ce } = await db
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .in('project_id', projectIds)
    .eq('assignee_id', userId)
    .neq('status', 'done')
    .neq('status', 'canceled')
    .is('parent_task_id', null)
  if (ce) throw ce
  out.myPending = count ?? 0
  return out
}
