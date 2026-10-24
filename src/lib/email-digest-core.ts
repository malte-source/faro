import { weekEndOf } from '@/lib/email-schedule'

/**
 * Pure bucketing for the digest: which tasks are overdue / due today / due this week, and how they
 * are grouped by empresa (with the person's cargo there). No DB — fed by email-digest.ts.
 */

export interface RawTask {
  id: string
  title: string
  /** YYYY-MM-DD */
  due_date: string
  project_id: string
  project_name: string | null
  workspace_id: string
}

export interface WorkspaceInfo {
  id: string
  name: string
  color: string | null
}

export interface DigestItem {
  title: string
  due: string
  project: string | null
  /** In-app path, e.g. /dashboard/projects/<id> */
  url: string
}

export interface DigestGroup {
  empresa: string
  color: string | null
  /** The person's cargo in that empresa, when they have one. */
  hat: string | null
  items: DigestItem[]
}

export interface DigestBucket {
  /** How many tasks the bucket holds in total (items shown can be fewer: see `more`). */
  total: number
  groups: DigestGroup[]
  /** Tasks that did not fit in the list. */
  more: number
}

export const emptyBucket = (): DigestBucket => ({ total: 0, groups: [], more: 0 })

export type DigestWindowMode = 'daily' | 'weekly'

/**
 * daily : overdue (< today) · today (= today) · week (today, Sunday]
 * weekly: overdue (< today) · week [today, Sunday]   (the Monday digest folds "today" into the week)
 */
export function bucketTasks(tasks: RawTask[], todayIso: string, mode: DigestWindowMode): { overdue: RawTask[]; today: RawTask[]; week: RawTask[] } {
  const weekEnd = weekEndOf(todayIso)
  const overdue: RawTask[] = []
  const today: RawTask[] = []
  const week: RawTask[] = []
  for (const t of tasks) {
    if (!t.due_date) continue
    if (t.due_date < todayIso) overdue.push(t)
    else if (mode === 'daily' && t.due_date === todayIso) today.push(t)
    else if (t.due_date <= weekEnd) week.push(t)
  }
  return { overdue, today, week }
}

const byDueThenTitle = (a: RawTask, b: RawTask) => a.due_date.localeCompare(b.due_date) || a.title.localeCompare(b.title, 'es')

/** Group by empresa (earliest due first), show at most `limit` tasks, count the rest. */
export function groupBucket(
  tasks: RawTask[],
  workspaces: ReadonlyMap<string, WorkspaceInfo>,
  hats: ReadonlyMap<string, string>,
  limit: number,
): DigestBucket {
  if (!tasks.length) return emptyBucket()
  const sorted = [...tasks].sort(byDueThenTitle)
  const shown = sorted.slice(0, Math.max(0, limit))
  const groups = new Map<string, DigestGroup>()
  for (const t of shown) {
    const ws = workspaces.get(t.workspace_id)
    let g = groups.get(t.workspace_id)
    if (!g) {
      g = { empresa: ws?.name ?? 'Sin empresa', color: ws?.color ?? null, hat: hats.get(t.workspace_id) ?? null, items: [] }
      groups.set(t.workspace_id, g)
    }
    g.items.push({ title: t.title, due: t.due_date, project: t.project_name, url: `/dashboard/projects/${t.project_id}` })
  }
  return { total: tasks.length, groups: Array.from(groups.values()), more: tasks.length - shown.length }
}

export interface ApprovalItem {
  title: string
  /** 'documento' | 'tarea' | 'cargos' — shown as the small label. */
  label: string
  url: string
}

export interface UnreadItem {
  title: string
  body: string | null
  url: string
}

export interface DigestData {
  name: string
  mode: DigestWindowMode
  todayIso: string
  weekEndIso: string
  overdue: DigestBucket
  today: DigestBucket
  week: DigestBucket
  approvals: ApprovalItem[]
  unread: { total: number; items: UnreadItem[] }
}

export function taskCount(d: Pick<DigestData, 'overdue' | 'today' | 'week'>): number {
  return d.overdue.total + d.today.total + d.week.total
}

/** "Skip sending when there is nothing to say." */
export function hasContent(d: Pick<DigestData, 'overdue' | 'today' | 'week' | 'approvals' | 'unread'>): boolean {
  return taskCount(d) > 0 || d.approvals.length > 0 || d.unread.total > 0
}
