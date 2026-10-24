import { createAdminSupabaseClient } from '@/lib/supabase'
import { DEFAULT_TZ, isValidTZ } from '@/lib/tz'
import { isEmailConfigured, sendMailBatch, type MailMessage } from '@/lib/mailer'
import { buildDigestEmail } from '@/lib/email-templates'
import { resolveEmailPrefs } from '@/lib/email-prefs'
import {
  decideDigestSend,
  localClock,
  localDayStartUtc,
  weekEndOf,
  type DigestMode,
} from '@/lib/email-schedule'
import {
  bucketTasks,
  groupBucket,
  hasContent,
  type ApprovalItem,
  type DigestData,
  type RawTask,
  type UnreadItem,
  type WorkspaceInfo,
} from '@/lib/email-digest-core'
import type { CronResult } from '@/lib/cron-utils'
import { emailLinksFor } from '@/server/email-links'

type Db = ReturnType<typeof createAdminSupabaseClient>

/**
 * The hourly digest job.
 *
 * For every active person: is it their send hour (in THEIR timezone) and have they not been sent one
 * today? Claim the day with a conditional UPDATE (so overlapping runs can never double-send), build the
 * digest, send it, and release the claim if the send fails so the grace hour can retry.
 *
 * Safety rails: does nothing until SMTP is configured; does nothing if the email columns are not
 * migrated yet (it could not claim, so it would re-send every hour); a per-run cap keeps Gmail's
 * daily limit safe; one person's failure never stops the others.
 */

const PAGE = 1000
const MAX_PAGES = 5
const BATCH = 25
const LIMIT_OVERDUE_TODAY = 6
const LIMIT_WEEK = 8
const LIMIT_APPROVALS = 5
const LIMIT_UNREAD = 5

export interface DigestRunResult extends CronResult {
  disabled?: 'email_disabled' | 'email_prefs_unavailable'
  considered: number
  capped: number
  /** Why people were not sent anything (off, not_hour, already_today, empty, …). */
  reasons: Record<string, number>
}

interface UserRow { id: string; name: string; email: string; timezone: string | null; org_id: string }
interface PrefRow { user_id: string; email_digest: string; digest_hour: number; last_digest_at: string | null }
interface Candidate { user: UserRow; tz: string; mode: Exclude<DigestMode, 'off'>; hasRow: boolean }

const bump = (reasons: Record<string, number>, key: string) => { reasons[key] = (reasons[key] ?? 0) + 1 }

function logJson(severity: 'INFO' | 'WARNING' | 'ERROR', message: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ severity, message, ...extra })
  if (severity === 'ERROR') console.error(line)
  else if (severity === 'WARNING') console.warn(line)
  else console.log(line)
}

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await fetchPage(page * PAGE, page * PAGE + PAGE - 1)
    if (error) return { rows, error: error.message }
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE) break
  }
  return { rows, error: null }
}

/** Everyone the job could write to, with their effective timezone. Throws on a prefs error (see run). */
async function loadPeople(supabase: Db): Promise<{ users: UserRow[]; prefs: Map<string, PrefRow>; orgTz: Map<string, string | null> }> {
  const prefsRes = await pageAll<PrefRow>((from, to) =>
    supabase.from('user_notification_prefs').select('user_id, email_digest, digest_hour, last_digest_at').order('user_id').range(from, to))
  if (prefsRes.error) throw Object.assign(new Error(prefsRes.error), { code: 'prefs_unavailable' })

  const usersRes = await pageAll<UserRow>((from, to) =>
    supabase.from('users').select('id, name, email, timezone, org_id').eq('is_active', true).order('id').range(from, to))
  if (usersRes.error) throw new Error(`users: ${usersRes.error}`)

  const orgIds = Array.from(new Set(usersRes.rows.map(u => u.org_id)))
  const orgTz = new Map<string, string | null>()
  for (let i = 0; i < orgIds.length; i += 200) {
    const { data } = await supabase.from('organizations').select('id, timezone').in('id', orgIds.slice(i, i + 200))
    for (const o of data ?? []) orgTz.set(o.id, o.timezone)
  }
  return { users: usersRes.rows, prefs: new Map(prefsRes.rows.map(p => [p.user_id, p])), orgTz }
}

const validTz = (tz: string | null | undefined) => (tz && isValidTZ(tz) ? tz : null)

/** Reserve today's digest for this person. Returns false when another run already did. */
async function claim(supabase: Db, c: Candidate, now: Date): Promise<boolean> {
  if (!c.hasRow) {
    await supabase.from('user_notification_prefs').upsert({ user_id: c.user.id }, { onConflict: 'user_id', ignoreDuplicates: true })
  }
  const dayStart = localDayStartUtc(now, c.tz)
  const { data, error } = await supabase
    .from('user_notification_prefs')
    .update({ last_digest_at: now.toISOString() })
    .eq('user_id', c.user.id)
    .or(`last_digest_at.is.null,last_digest_at.lt.${dayStart}`)
    .select('user_id')
  if (error) throw new Error(`claim: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/** Give the day back (a failed send must not cost the person their digest). */
async function release(supabase: Db, userId: string, claimedAt: string, previous: string | null) {
  await supabase.from('user_notification_prefs').update({ last_digest_at: previous }).eq('user_id', userId).eq('last_digest_at', claimedAt)
}

const MAX_TASK_ROWS = 5000

interface TaskRow {
  id: string
  title: string
  due_date: string
  workspace_id: string | null
  assignee_id: string | null
  project: { id: string; name: string | null; workspace_id: string } | null
}

/** One round of queries for a whole batch of people; per-person results are assembled in memory. */
async function buildDigests(supabase: Db, batch: Candidate[], now: Date): Promise<Map<string, DigestData>> {
  const ids = batch.map(c => c.user.id)
  const today = new Map(batch.map(c => [c.user.id, localClock(now, c.tz).date]))
  const maxEnd = Array.from(today.values()).map(weekEndOf).sort().at(-1)!

  const [memberships, hatRows, taskRes, unreadRes] = await Promise.all([
    supabase.from('org_memberships').select('user_id, org_id, role').in('user_id', ids),
    supabase.from('workspace_members').select('user_id, workspace_id, position').in('user_id', ids).eq('is_active', true),
    supabase
      .from('tasks')
      .select('id, title, due_date, workspace_id, assignee_id, project:projects!inner(id, name, workspace_id)')
      .in('assignee_id', ids)
      .not('status', 'in', '(done,canceled)')
      .not('due_date', 'is', null)
      .lte('due_date', maxEnd)
      .order('due_date', { ascending: true })
      .limit(MAX_TASK_ROWS),
    supabase
      .from('notifications')
      .select('user_id, title, body, url, created_at')
      .in('user_id', ids)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(2000),
  ])
  if (taskRes.error) throw new Error(`tasks: ${taskRes.error.message}`)
  if (memberships.error) throw new Error(`org_memberships: ${memberships.error.message}`)

  // Which empresas may each person read? Only those of grupos they still belong to.
  const orgsOf = new Map<string, Set<string>>()
  const adminOrgsOf = new Map<string, Set<string>>()
  for (const m of memberships.data ?? []) {
    if (!orgsOf.has(m.user_id)) orgsOf.set(m.user_id, new Set())
    orgsOf.get(m.user_id)!.add(m.org_id)
    if (m.role === 'owner' || m.role === 'admin') {
      if (!adminOrgsOf.has(m.user_id)) adminOrgsOf.set(m.user_id, new Set())
      adminOrgsOf.get(m.user_id)!.add(m.org_id)
    }
  }
  const allOrgIds = Array.from(new Set((memberships.data ?? []).map(m => m.org_id)))
  const { data: wsRows } = allOrgIds.length
    ? await supabase.from('workspaces').select('id, name, color, org_id').in('org_id', allOrgIds)
    : { data: [] as Array<{ id: string; name: string; color: string; org_id: string }> }
  const workspaces = new Map<string, WorkspaceInfo>((wsRows ?? []).map(w => [w.id, { id: w.id, name: w.name, color: w.color }]))
  const wsOrg = new Map((wsRows ?? []).map(w => [w.id, w.org_id]))

  const hats = new Map<string, Map<string, string>>()
  for (const h of hatRows.data ?? []) {
    if (!hats.has(h.user_id)) hats.set(h.user_id, new Map())
    hats.get(h.user_id)!.set(h.workspace_id, h.position)
  }

  const tasksBy = new Map<string, RawTask[]>()
  for (const t of (taskRes.data ?? []) as unknown as TaskRow[]) {
    if (!t.assignee_id || !t.project) continue
    const wsId = t.workspace_id ?? t.project.workspace_id
    const orgId = wsOrg.get(wsId)
    if (!orgId || !orgsOf.get(t.assignee_id)?.has(orgId)) continue
    const list = tasksBy.get(t.assignee_id) ?? []
    list.push({ id: t.id, title: t.title, due_date: t.due_date, project_id: t.project.id, project_name: t.project.name, workspace_id: wsId })
    tasksBy.set(t.assignee_id, list)
  }

  const unreadBy = new Map<string, UnreadItem[]>()
  const unreadTotal = new Map<string, number>()
  for (const n of unreadRes.error ? [] : unreadRes.data ?? []) {
    unreadTotal.set(n.user_id, (unreadTotal.get(n.user_id) ?? 0) + 1)
    const list = unreadBy.get(n.user_id) ?? []
    if (list.length < LIMIT_UNREAD) list.push({ title: n.title, body: n.body, url: n.url ?? '/dashboard/bandeja' })
    unreadBy.set(n.user_id, list)
  }

  const approvals = await loadApprovals(supabase, ids, adminOrgsOf)

  const out = new Map<string, DigestData>()
  for (const c of batch) {
    const todayIso = today.get(c.user.id)!
    const buckets = bucketTasks(tasksBy.get(c.user.id) ?? [], todayIso, c.mode)
    const userHats = hats.get(c.user.id) ?? new Map<string, string>()
    out.set(c.user.id, {
      name: c.user.name,
      mode: c.mode,
      todayIso,
      weekEndIso: weekEndOf(todayIso),
      overdue: groupBucket(buckets.overdue, workspaces, userHats, LIMIT_OVERDUE_TODAY),
      today: groupBucket(buckets.today, workspaces, userHats, LIMIT_OVERDUE_TODAY),
      week: groupBucket(buckets.week, workspaces, userHats, LIMIT_WEEK),
      approvals: (approvals.get(c.user.id) ?? []).slice(0, LIMIT_APPROVALS),
      unread: { total: unreadTotal.get(c.user.id) ?? 0, items: unreadBy.get(c.user.id) ?? [] },
    })
  }
  return out
}

/** Things waiting on a person's review. Each source is optional: a failing query only drops that source. */
async function loadApprovals(supabase: Db, userIds: string[], adminOrgsOf: Map<string, Set<string>>): Promise<Map<string, ApprovalItem[]>> {
  const out = new Map<string, ApprovalItem[]>()
  const add = (userId: string, item: ApprovalItem) => out.set(userId, [...(out.get(userId) ?? []), item])

  const [docs, taskReviews, runs] = await Promise.all([
    supabase.from('documents').select('id, title, reviewer_id').in('reviewer_id', userIds).eq('status', 'en_revision').limit(200),
    supabase.from('tasks').select('id, title, reviewer_id, project_id').in('reviewer_id', userIds).eq('review_state', 'requested').not('status', 'in', '(done,canceled)').limit(200),
    supabase.from('charge_runs').select('id, org_id, period, prepared_by').eq('status', 'borrador').limit(100),
  ])
  for (const d of docs.error ? [] : docs.data ?? []) if (d.reviewer_id) add(d.reviewer_id, { title: d.title, label: 'Documento por revisar', url: `/dashboard/documentos/${d.id}` })
  for (const t of taskReviews.error ? [] : taskReviews.data ?? []) if (t.reviewer_id) add(t.reviewer_id, { title: t.title, label: 'Tarea por revisar', url: `/dashboard/projects/${t.project_id}` })
  for (const r of runs.error ? [] : runs.data ?? []) {
    for (const userId of userIds) {
      if (r.prepared_by !== userId && adminOrgsOf.get(userId)?.has(r.org_id)) {
        add(userId, { title: `Reparto de costos de ${r.period}`, label: 'Cargos por aprobar', url: '/dashboard/costos' })
      }
    }
  }
  return out
}

export async function runUserDigest(opts: { supabase?: Db; now?: Date; maxPerRun?: number } = {}): Promise<DigestRunResult> {
  const result: DigestRunResult = { sent: 0, skipped: 0, errors: 0, failed: [], considered: 0, capped: 0, reasons: {} }
  if (!isEmailConfigured()) {
    logJson('INFO', 'email_disabled', { job: 'user-digest' })
    return { ...result, disabled: 'email_disabled' }
  }
  const supabase = opts.supabase ?? createAdminSupabaseClient()
  const now = opts.now ?? new Date()
  const maxPerRun = opts.maxPerRun ?? (Number(process.env.EMAIL_MAX_PER_RUN) > 0 ? Number(process.env.EMAIL_MAX_PER_RUN) : 300)

  let people: Awaited<ReturnType<typeof loadPeople>>
  try {
    people = await loadPeople(supabase)
  } catch (err) {
    if ((err as { code?: string }).code === 'prefs_unavailable') {
      // The email columns are not migrated: we could not claim a day, so sending would repeat every hour.
      logJson('WARNING', 'email_prefs_unavailable', { job: 'user-digest', hint: 'apply supabase/migrations/20261027_email_prefs.sql' })
      return { ...result, disabled: 'email_prefs_unavailable' }
    }
    throw err
  }

  // 1. Who is due now, in their own timezone?
  const due: Candidate[] = []
  for (const user of people.users) {
    result.considered++
    const row = people.prefs.get(user.id)
    const prefs = resolveEmailPrefs(row ?? null)
    const tz = validTz(user.timezone) ?? validTz(people.orgTz.get(user.org_id)) ?? DEFAULT_TZ
    const decision = decideDigestSend({ email_digest: prefs.email_digest, digest_hour: prefs.digest_hour, last_digest_at: prefs.last_digest_at }, now, tz)
    if (!decision.send) { bump(result.reasons, decision.reason); continue }
    due.push({ user, tz, mode: prefs.email_digest === 'weekly' ? 'weekly' : 'daily', hasRow: !!row })
  }
  const selected = due.slice(0, maxPerRun)
  result.capped = due.length - selected.length
  if (result.capped) bump(result.reasons, 'capped')

  // 2. Claim → build → send, a batch at a time.
  let budgetLeft = maxPerRun
  for (let i = 0; i < selected.length; i += BATCH) {
    const batch = selected.slice(i, i + BATCH)
    const claimed: Array<{ c: Candidate; claimedAt: string; previous: string | null }> = []
    for (const c of batch) {
      try {
        const previous = people.prefs.get(c.user.id)?.last_digest_at ?? null
        if (await claim(supabase, c, now)) claimed.push({ c, claimedAt: now.toISOString(), previous })
        else bump(result.reasons, 'claimed_elsewhere')
      } catch (err) {
        result.errors++
        result.failed!.push(c.user.id)
        logJson('ERROR', 'digest claim failed', { error: err instanceof Error ? err.message : String(err) })
      }
    }
    if (!claimed.length) continue

    let data: Map<string, DigestData>
    try {
      data = await buildDigests(supabase, claimed.map(x => x.c), now)
    } catch (err) {
      for (const x of claimed) {
        await release(supabase, x.c.user.id, x.claimedAt, x.previous)
        result.errors++
        result.failed!.push(x.c.user.id)
      }
      logJson('ERROR', 'digest build failed', { error: err instanceof Error ? err.message : String(err), users: claimed.length })
      continue
    }

    const toSend: Array<{ x: (typeof claimed)[number]; message: MailMessage }> = []
    for (const x of claimed) {
      const digest = data.get(x.c.user.id)!
      if (!hasContent(digest)) { bump(result.reasons, 'empty'); result.skipped++; continue }
      const built = buildDigestEmail(digest, emailLinksFor(x.c.user.id))
      toSend.push({ x, message: { to: x.c.user.email, subject: built.subject, html: built.html, text: built.text, headers: built.headers } })
    }
    if (!toSend.length) continue

    const sent = await sendMailBatch(toSend.map(s => s.message), { concurrency: 3, cap: budgetLeft, kind: 'digest' })
    const logRows: Array<{ user_id: string; kind: string }> = []
    for (let k = 0; k < toSend.length; k++) {
      const { x } = toSend[k]
      const r = sent.results[k]
      if (r.ok) {
        result.sent++
        budgetLeft--
        logRows.push({ user_id: x.c.user.id, kind: x.c.mode === 'weekly' ? 'digest_weekly' : 'digest_daily' })
      } else {
        await release(supabase, x.c.user.id, x.claimedAt, x.previous)
        if ('skipped' in r) { result.skipped++; bump(result.reasons, r.skipped) } else { result.errors++; result.failed!.push(x.c.user.id) }
      }
    }
    if (logRows.length) await supabase.from('email_log').insert(logRows)
  }

  logJson(result.errors ? 'ERROR' : 'INFO', 'user-digest finished', {
    sent: result.sent, skipped: result.skipped, errors: result.errors, considered: result.considered, capped: result.capped, reasons: result.reasons,
  })
  return result
}
