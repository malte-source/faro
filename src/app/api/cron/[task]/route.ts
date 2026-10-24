import { NextResponse } from 'next/server'
import { addDays, todayInTZ, DEFAULT_TZ, isValidTZ } from '@/lib/tz'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { generateFlash, stripJsonFence } from '@/lib/gemini'
import {
  postToChatWebhook,
  weeklyDigestCard,
  type ChatCardMessage,
} from '@/lib/google-chat'
import { nextFireDate } from '@/lib/recurring'
import { cronOutcome, decideRuleClaim, isBearerAuthorized, type CronResult } from '@/lib/cron-utils'
import { runDueSoonAutomations, runHealthLowAutomations } from '@/lib/automations'

/**
 * Protected cron endpoint hit by Google Cloud Scheduler on a schedule.
 *
 * Auth: shared secret in the Authorization header (`Bearer <CRON_SECRET>`)
 * configured both in Cloud Run env and in the Scheduler job. This is
 * simpler than OIDC tokens and good enough for an MVP — rotate the secret
 * if you ever suspect leakage.
 *
 * Tasks:
 *   /api/cron/weekly-digest    — Mondays 08:00 ART
 *   /api/cron/daily-deadlines  — Every day 09:00 ART
 *
 * Status codes (see cronOutcome in src/lib/cron-utils.ts):
 *   200  every org/rule succeeded or was skipped
 *   207  partial failure — a 2xx, so Cloud Scheduler does NOT retry (orgs already
 *        notified are not notified twice); the JSON lists `failed` ids and an
 *        ERROR-severity log line is written so Cloud Logging alerts can fire
 *   500  nothing succeeded, the task threw, or ?strict=1 and anything failed
 * One failing org never stops the others.
 */

const APP_URL = process.env.AUTH_URL ?? 'https://faro-app-303070777698.southamerica-east1.run.app'

interface OrgRow {
  id: string
  name: string
  google_chat_webhook_url: string
  notification_prefs: Record<string, boolean> | null
  timezone: string | null
}

/** The org's own timezone (organizations.timezone), falling back to the app default if missing or invalid. */
function resolveTz(tz: string | null | undefined): string {
  return tz && isValidTZ(tz) ? tz : DEFAULT_TZ
}

async function getOrgsWithWebhooks(): Promise<OrgRow[]> {
  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, google_chat_webhook_url, notification_prefs, timezone')
    .not('google_chat_webhook_url', 'is', null)
  if (error) throw error
  return ((data ?? []) as {
    id: string; name: string; google_chat_webhook_url: string | null
    notification_prefs: Record<string, boolean> | null
    timezone: string | null
  }[])
    .filter((o): o is OrgRow => !!o.google_chat_webhook_url)
}

function prefOn(prefs: Record<string, boolean> | null, key: string): boolean {
  if (!prefs) return true
  return prefs[key] !== false
}

/* ── Task 1: Weekly Digest ────────────────────────────────────────── */

async function runWeeklyDigest(): Promise<CronResult> {
  const orgs = await getOrgsWithWebhooks()
  const supabase = createAdminSupabaseClient()
  let sent = 0, skipped = 0, errors = 0
  const failed: string[] = []

  for (const org of orgs) {
    try {
      if (!prefOn(org.notification_prefs, 'chat_weekly_digest')) { skipped++; continue }
      // Gather portfolio for this org (cross-workspace).
      const { data: workspaces } = await supabase
        .from('workspaces').select('id').eq('org_id', org.id)
      const wsIds = (workspaces ?? []).map(w => w.id)
      if (!wsIds.length) { skipped++; continue }

      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const [{ data: projects }, { data: tasks }] = await Promise.all([
        supabase.from('projects')
          .select('code, name, status, priority, end_date, progress_pct, health_score')
          .in('workspace_id', wsIds).limit(80),
        supabase.from('tasks')
          .select('title, status, priority, due_date, project:projects(code)')
          .in('project_id', (await supabase.from('projects').select('id').in('workspace_id', wsIds)).data?.map(p => p.id) ?? [])
          .neq('status', 'done').neq('status', 'canceled')
          .gte('updated_at', sevenDaysAgo)
          .order('updated_at', { ascending: false }).limit(30),
      ])

      // Compare DATE columns as strings against today-in-TZ — avoids
      // `new Date("2026-06-08") === midnight UTC` which is 21:00 ART previous day.
      const allProjects = projects ?? []
      const today = todayInTZ(new Date(), resolveTz(org.timezone))
      const weekFromNow = addDays(today, 7)
      const overdue = allProjects.filter(p =>
        p.end_date && p.end_date < today &&
        p.status !== 'completed' && p.status !== 'canceled',
      )
      const dueSoon = allProjects.filter(p =>
        p.end_date && p.end_date <= weekFromNow &&
        p.status !== 'completed' && p.status !== 'canceled',
      )

      const fallbackDigest = {
        headline: `${allProjects.length} proyectos · ${overdue.length} vencidos · ${dueSoon.length} vencen esta semana`,
        highlights: [
          `${allProjects.filter(p => p.status === 'in_progress').length} en progreso.`,
          `${allProjects.filter(p => p.status === 'completed').length} completados en total.`,
          `${(tasks ?? []).length} tareas con actividad esta semana.`,
        ],
        risks: overdue.slice(0, 3).map(p => `${p.code} venció el ${p.end_date}`),
        asks: [] as string[],
        nextWeekFocus: dueSoon.length > 0
          ? `Cerrar: ${dueSoon.slice(0, 3).map(p => p.code).join(', ')}.`
          : 'Sin deadlines críticos.',
      }

      // Best-effort Gemini summary; on failure use the deterministic fallback.
      let payload = fallbackDigest
      try {
        const projectLines = allProjects.slice(0, 40).map(p =>
          `${p.code} | ${p.name} | ${p.status} | ${p.priority} | progreso ${p.progress_pct}% | salud ${p.health_score ?? '?'} | vence ${p.end_date ?? '—'}`
        ).join('\n')
        const taskLines = (tasks ?? []).slice(0, 25).map(t => {
          const proj = (t.project as { code: string } | null)
          return `[${t.status}] ${t.title}${proj ? ` (${proj.code})` : ''}${t.due_date ? ` · vence ${t.due_date}` : ''}`
        }).join('\n')

        const prompt = `Genera un DIGEST SEMANAL ejecutivo para FARO en JSON estricto, español, conciso.
PROYECTOS (${allProjects.length}):
${projectLines || '(ninguno)'}
TAREAS ACTIVAS (${(tasks ?? []).length}):
${taskLines || '(ninguna)'}
Hoy: ${today}.

Devuelve sin markdown:
{"headline":"...","highlights":["...","..."],"risks":["..."],"asks":["..."],"nextWeekFocus":"..."}`

        const txt = stripJsonFence(await generateFlash(prompt))
        const parsed = JSON.parse(txt)
        payload = {
          headline: parsed.headline ?? fallbackDigest.headline,
          highlights: parsed.highlights ?? [],
          risks: parsed.risks ?? [],
          asks: parsed.asks ?? [],
          nextWeekFocus: parsed.nextWeekFocus ?? '',
        }
      } catch (err) {
        console.warn('[cron weekly-digest] gemini failed for org', org.id, err)
      }

      await postToChatWebhook(org.google_chat_webhook_url, weeklyDigestCard({
        ...payload,
        url: `${APP_URL}/dashboard/reports`,
      }))
      sent++
    } catch (err) {
      errors++
      failed.push(org.id)
      console.error('[cron weekly-digest] failed for org', org.id, err)
    }
  }
  return { sent, skipped, errors, failed }
}

/* ── Task 2: Daily Deadlines ──────────────────────────────────────── */

function deadlineCard(payload: {
  orgName: string
  projectsDueSoon: { code: string; name: string; end_date: string }[]
  tasksDueToday: { title: string; projectCode: string | null; assigneeName: string | null }[]
}): ChatCardMessage {
  const widgets: ChatCardMessage['cardsV2'][number]['card']['sections'] = []

  if (payload.projectsDueSoon.length) {
    widgets.push({
      header: 'Proyectos que vencen en 48 hs',
      widgets: payload.projectsDueSoon.map(p => ({
        decoratedText: {
          topLabel: p.code,
          text: p.name,
          bottomLabel: `Vence ${p.end_date}`,
        },
      })),
    })
  }
  if (payload.tasksDueToday.length) {
    widgets.push({
      header: 'Tareas que vencen hoy',
      widgets: payload.tasksDueToday.map(t => ({
        decoratedText: {
          topLabel: t.projectCode ?? '',
          text: t.title,
          bottomLabel: t.assigneeName ? `Asignada a ${t.assigneeName}` : undefined,
        },
      })),
    })
  }

  return {
    cardsV2: [{
      cardId: `faro-deadlines-${Date.now()}`,
      card: {
        header: { title: '⏰ Alertas de vencimiento · FARO' },
        sections: widgets,
      },
    }],
  }
}

async function runDailyDeadlines(): Promise<CronResult> {
  const orgs = await getOrgsWithWebhooks()
  const supabase = createAdminSupabaseClient()
  let sent = 0, skipped = 0, errors = 0
  const failed: string[] = []

  for (const org of orgs) {
    try {
      if (!prefOn(org.notification_prefs, 'chat_deadlines')) { skipped++; continue }
      const today = todayInTZ(new Date(), resolveTz(org.timezone))
      const twoDays = addDays(today, 2)
      const { data: workspaces } = await supabase
        .from('workspaces').select('id').eq('org_id', org.id)
      const wsIds = (workspaces ?? []).map(w => w.id)
      if (!wsIds.length) { skipped++; continue }

      const { data: projectsDueSoon } = await supabase
        .from('projects')
        .select('code, name, end_date')
        .in('workspace_id', wsIds)
        .gte('end_date', today)
        .lte('end_date', twoDays)
        .neq('status', 'completed').neq('status', 'canceled')

      const { data: projIdsRow } = await supabase
        .from('projects').select('id').in('workspace_id', wsIds)
      const projIds = (projIdsRow ?? []).map(p => p.id)

      const { data: tasksDueToday } = await supabase
        .from('tasks')
        .select('title, project:projects(code), assignee:users!tasks_assignee_id_fkey(name)')
        .in('project_id', projIds)
        .eq('due_date', today)
        .neq('status', 'done').neq('status', 'canceled')

      const psd = (projectsDueSoon ?? []).filter(p => p.end_date) as { code: string; name: string; end_date: string }[]
      const tdt = (tasksDueToday ?? []).map(t => ({
        title: t.title as string,
        projectCode: (t.project as { code: string } | null)?.code ?? null,
        assigneeName: (t.assignee as { name: string } | null)?.name ?? null,
      }))

      if (psd.length === 0 && tdt.length === 0) { skipped++; continue }

      await postToChatWebhook(org.google_chat_webhook_url, deadlineCard({
        orgName: org.name,
        projectsDueSoon: psd,
        tasksDueToday: tdt,
      }))
      sent++
    } catch (err) {
      errors++
      failed.push(org.id)
      console.error('[cron daily-deadlines] failed for org', org.id, err)
    }
  }
  return { sent, skipped, errors, failed }
}

/* ── Task 3: Daily Recurring Tasks Materializer ──────────────────────
 * Fires every day at 00:30 ART. Scans task_recurring_rules where
 *   is_active = true AND next_run_at <= today-in-the-ORG's-timezone
 *
 * Idempotent by construction: each rule is CLAIMED first with a compare-and-set
 * on next_run_at (the update only matches while next_run_at is still the value we
 * read), and only then is the task inserted. So
 *   - two overlapping runs (a retry, a double trigger) can't both materialise it,
 *   - a crash between the claim and the insert at worst skips one occurrence
 *     (rolled back below when the insert itself fails) — it can never duplicate.
 */
const LATEST_TZ = 'Pacific/Kiritimati' // UTC+14: the furthest-ahead local date anywhere

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs))
}

async function runDailyRecurring(): Promise<CronResult> {
  const supabase = createAdminSupabaseClient()
  let sent = 0, skipped = 0, errors = 0
  const failed: string[] = []

  // Upper bound for "due": the latest local date on Earth. Each rule is then checked
  // against ITS org's own date below, so nothing fires early for west-of-UTC orgs.
  const cutoff = todayInTZ(new Date(), LATEST_TZ)
  const { data: rules, error } = await supabase
    .from('task_recurring_rules')
    .select('*')
    .eq('is_active', true)
    .lte('next_run_at', cutoff)
  if (error) throw error
  if (!rules?.length) return { sent, skipped, errors, failed }

  // rule → project → workspace → org → timezone, with plain queries: embedding
  // projects→workspaces is ambiguous (project_workspaces links them too).
  const { data: projects, error: pErr } = await supabase
    .from('projects').select('id, workspace_id').in('id', unique(rules.map(r => r.project_id)))
  if (pErr) throw pErr
  const { data: workspaces, error: wErr } = await supabase
    .from('workspaces').select('id, org_id').in('id', unique((projects ?? []).map(p => p.workspace_id)))
  if (wErr) throw wErr
  const { data: orgs, error: oErr } = await supabase
    .from('organizations').select('id, timezone').in('id', unique((workspaces ?? []).map(w => w.org_id)))
  if (oErr) throw oErr

  const workspaceOfProject = new Map((projects ?? []).map(p => [p.id, p.workspace_id]))
  const orgOfWorkspace = new Map((workspaces ?? []).map(w => [w.id, w.org_id]))
  const tzOfOrg = new Map((orgs ?? []).map(o => [o.id, o.timezone as string | null]))

  for (const rule of rules) {
    try {
      const workspaceId = workspaceOfProject.get(rule.project_id) ?? null
      const orgId = workspaceId ? orgOfWorkspace.get(workspaceId) : undefined
      const today = todayInTZ(new Date(), resolveTz(orgId ? tzOfOrg.get(orgId) : null))

      if (decideRuleClaim(rule, today) !== 'claim') { skipped++; continue }

      // 1) CLAIM — advance the rule, but only if nobody else already has.
      const next = nextFireDate(rule.cadence, today)
      const { data: claimed, error: claimErr } = await supabase
        .from('task_recurring_rules')
        .update({ next_run_at: next, last_run_at: today, updated_at: new Date().toISOString() })
        .eq('id', rule.id)
        .eq('is_active', true)
        .eq('next_run_at', rule.next_run_at)
        .select('id')
      if (claimErr) throw claimErr
      if (!claimed?.length) { skipped++; continue } // another run took this occurrence

      // 2) MATERIALISE the task.
      const { error: insErr } = await supabase
        .from('tasks')
        .insert({
          project_id: rule.project_id,
          workspace_id: workspaceId,
          title: rule.title_template,
          description: rule.description_template,
          assignee_id: rule.assignee_id,
          reporter_id: rule.created_by,
          status: 'todo',
          priority: rule.priority,
          due_date: today,
          position: Date.now(),
          labels: ['recurrente'],
        })
      if (insErr) {
        // Give the occurrence back so the next run retries it. Conditional on OUR claim, so a
        // newer claim is never undone.
        const { error: rbErr } = await supabase
          .from('task_recurring_rules')
          .update({ next_run_at: rule.next_run_at, last_run_at: rule.last_run_at, updated_at: new Date().toISOString() })
          .eq('id', rule.id)
          .eq('next_run_at', next)
        if (rbErr) console.error('[cron daily-recurring] rollback failed — occurrence skipped for rule', rule.id, rbErr)
        throw insErr
      }

      sent++
    } catch (err) {
      errors++
      failed.push(rule.id)
      console.error('[cron daily-recurring] rule', rule.id, err)
    }
  }
  return { sent, skipped, errors, failed }
}

/* ── Handler ──────────────────────────────────────────────────────── */

/* ── Task 4: Monthly Audit Log Cleanup ───────────────────────────────
 * First of every month at 02:00 ART. Deletes audit_log rows older than
 * 180 days. Returns the deleted count for observability.
 */
async function runMonthlyCleanup(): Promise<CronResult> {
  const supabase = createAdminSupabaseClient()
  try {
    const { data, error } = await supabase.rpc('cleanup_old_audit_log', { days_to_keep: 180 })
    if (error) throw error
    const deleted = typeof data === 'number' ? data : 0
    console.log(`[cron monthly-cleanup] purged ${deleted} audit_log rows`)
    return { sent: deleted, skipped: 0, errors: 0 }
  } catch (err) {
    console.error('[cron monthly-cleanup]', err)
    return { sent: 0, skipped: 0, errors: 1 }
  }
}

/* ── Task 5 + 6: Morning & evening team routines ─────────────────────
 * 07:00 ART (morning) and 18:00 ART (evening) — pushes a card to each org's
 * Chat webhook listing every active user's pending workload for the day:
 *   - Vencidas, vence hoy, en progreso, pendientes de revisión por them
 * The whole point Malte described in the meeting: "Valentino me rompe la
 * bola con lo urgente" — Chat is where that happens.
 */
async function runRoutine(label: 'mañana' | 'tarde'): Promise<CronResult> {
  const orgs = await getOrgsWithWebhooks()
  const supabase = createAdminSupabaseClient()
  let sent = 0, skipped = 0, errors = 0
  const failed: string[] = []

  for (const org of orgs) {
    try {
      if (!prefOn(org.notification_prefs, 'chat_deadlines')) { skipped++; continue }
      const today = todayInTZ(new Date(), resolveTz(org.timezone))
      const { data: users } = await supabase
        .from('users').select('id, name').eq('org_id', org.id).eq('is_active', true)
      if (!users?.length) { skipped++; continue }

      // Project scope for this org
      const { data: wsRows } = await supabase.from('workspaces').select('id').eq('org_id', org.id)
      const wsIds = (wsRows ?? []).map(w => w.id)
      if (!wsIds.length) { skipped++; continue }
      const { data: projIdRows } = await supabase.from('projects').select('id').in('workspace_id', wsIds)
      const projIds = (projIdRows ?? []).map(p => p.id)
      if (!projIds.length) { skipped++; continue }

      // Pending tasks for the whole org (we group by user in code)
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, assignee_id, reviewer_id, due_date, status, review_state, project:projects(code)')
        .in('project_id', projIds)
        .neq('status', 'done').neq('status', 'canceled')
        .is('parent_task_id', null)
      const list = tasks ?? []

      // Build per-user buckets
      const sections: { header: string; widgets: Array<{ decoratedText: { topLabel?: string; text: string; bottomLabel?: string } }> }[] = []
      for (const u of users) {
        const overdue = list.filter(t => t.assignee_id === u.id && t.due_date && t.due_date < today)
        const dueToday = list.filter(t => t.assignee_id === u.id && t.due_date === today)
        const reviewing = list.filter(t => t.reviewer_id === u.id && t.review_state === 'requested')
        const total = overdue.length + dueToday.length + reviewing.length
        if (total === 0) continue
        const widgets: Array<{ decoratedText: { topLabel?: string; text: string; bottomLabel?: string } }> = []
        for (const t of overdue.slice(0, 3)) {
          const proj = (t.project as { code: string } | null)?.code
          widgets.push({ decoratedText: { topLabel: '🔴 Vencida', text: t.title, bottomLabel: proj ? `${proj} · venció ${t.due_date}` : `venció ${t.due_date}` } })
        }
        for (const t of dueToday.slice(0, 3)) {
          const proj = (t.project as { code: string } | null)?.code
          widgets.push({ decoratedText: { topLabel: '🟡 Vence HOY', text: t.title, bottomLabel: proj ?? undefined } })
        }
        for (const t of reviewing.slice(0, 3)) {
          const proj = (t.project as { code: string } | null)?.code
          widgets.push({ decoratedText: { topLabel: '🟣 Para revisar', text: t.title, bottomLabel: proj ?? undefined } })
        }
        if (total > widgets.length) {
          widgets.push({ decoratedText: { text: `+ ${total - widgets.length} más` } })
        }
        sections.push({ header: `${u.name} · ${total} pendiente${total > 1 ? 's' : ''}`, widgets })
      }

      if (!sections.length) { skipped++; continue }

      const greeting = label === 'mañana' ? '🌅 Buenos días — agenda del día' : '🌆 Check-in de la tarde'
      await postToChatWebhook(org.google_chat_webhook_url, {
        cardsV2: [{
          cardId: `faro-routine-${label}-${today}`,
          card: { header: { title: greeting, subtitle: `${sections.length} ${sections.length === 1 ? 'persona' : 'personas'} con pendientes` }, sections },
        }],
      })
      sent++
    } catch (err) {
      errors++
      failed.push(org.id)
      console.error('[cron routine]', label, org.id, err)
    }
  }
  return { sent, skipped, errors, failed }
}

/* ── Task 7: Escalation — urgentes sin movimiento ─────────────────────
 * Diario 10:00 ART. Encuentra tareas urgentes (high/very_high) cuyo
 * updated_at es más viejo que 3 días Y siguen en `todo`/`in_progress` Y
 * tienen assignee. Postea un card a Chat con cada una para que el equipo
 * (Valentino, en este caso) las patee.
 */
async function runEscalation(): Promise<CronResult> {
  const orgs = await getOrgsWithWebhooks()
  const supabase = createAdminSupabaseClient()
  const threshold = new Date(Date.now() - 3 * 86_400_000).toISOString()
  let sent = 0, skipped = 0, errors = 0
  const failed: string[] = []

  for (const org of orgs) {
    try {
      if (!prefOn(org.notification_prefs, 'chat_deadlines')) { skipped++; continue }
      const { data: wsRows } = await supabase.from('workspaces').select('id').eq('org_id', org.id)
      const wsIds = (wsRows ?? []).map(w => w.id)
      if (!wsIds.length) { skipped++; continue }
      const { data: projIdRows } = await supabase.from('projects').select('id').in('workspace_id', wsIds)
      const projIds = (projIdRows ?? []).map(p => p.id)
      if (!projIds.length) { skipped++; continue }

      const { data: stale } = await supabase
        .from('tasks')
        .select('id, title, priority, due_date, status, updated_at, assignee:users!tasks_assignee_id_fkey(name), project:projects(code)')
        .in('project_id', projIds)
        .in('priority', ['very_high', 'high'])
        .in('status', ['todo', 'in_progress'])
        .not('assignee_id', 'is', null)
        .lt('updated_at', threshold)
        .order('updated_at', { ascending: true })
        .limit(15)

      const list = stale ?? []
      if (!list.length) { skipped++; continue }

      const widgets = list.slice(0, 10).map(t => {
        const assignee = (t.assignee as { name?: string } | null)?.name ?? '?'
        const proj = (t.project as { code?: string } | null)?.code ?? ''
        const daysStale = Math.floor((Date.now() - new Date(t.updated_at).getTime()) / 86_400_000)
        return {
          decoratedText: {
            topLabel: `${t.priority === 'very_high' ? '🚨' : '⚠️'} ${proj}`,
            text: t.title,
            bottomLabel: `${assignee} · sin movimiento hace ${daysStale}d${t.due_date ? ` · vence ${t.due_date}` : ''}`,
          },
        }
      })

      await postToChatWebhook(org.google_chat_webhook_url, {
        cardsV2: [{
          cardId: `faro-escalation-${todayInTZ(new Date(), resolveTz(org.timezone))}`,
          card: {
            header: { title: `🚨 ${list.length} ${list.length === 1 ? 'tarea urgente' : 'tareas urgentes'} sin movimiento`, subtitle: 'Prioridad alta/muy alta · 3+ días sin update' },
            sections: [{ widgets }],
          },
        }],
      })
      sent++
    } catch (err) {
      errors++
      failed.push(org.id)
      console.error('[cron escalation]', org.id, err)
    }
  }
  return { sent, skipped, errors, failed }
}

const TASKS: Record<string, () => Promise<CronResult>> = {
  'weekly-digest': runWeeklyDigest,
  'daily-deadlines': runDailyDeadlines,
  'daily-recurring': runDailyRecurring,
  'monthly-cleanup': runMonthlyCleanup,
  'morning-routine': () => runRoutine('mañana'),
  'evening-routine': () => runRoutine('tarde'),
  'daily-escalation': runEscalation,
  'automations-due-soon': async () => {
    // Wrap to match the {sent, skipped, errors} shape this route reports.
    const supabase = createAdminSupabaseClient()
    const { tasksProcessed } = await runDueSoonAutomations(supabase)
    return { sent: tasksProcessed, skipped: 0, errors: 0 }
  },
  'automations-health-low': async () => {
    const supabase = createAdminSupabaseClient()
    const { projectsProcessed } = await runHealthLowAutomations(supabase)
    return { sent: projectsProcessed, skipped: 0, errors: 0 }
  },
}

async function handler(
  req: Request,
  { params }: { params: Promise<{ task: string }> },
) {
  const { task } = await params

  // Auth — shared bearer secret, compared in constant time
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[cron] CRON_SECRET not configured')
    return NextResponse.json({ error: 'Cron disabled' }, { status: 503 })
  }
  if (!isBearerAuthorized(req.headers.get('authorization'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fn = TASKS[task]
  if (!fn) {
    return NextResponse.json({ error: `Unknown task: ${task}` }, { status: 404 })
  }

  const strict = new URL(req.url).searchParams.get('strict') === '1'
  const started = Date.now()
  try {
    const result = await fn()
    const outcome = cronOutcome(result, strict)
    const summary = { task, ok: outcome.ok, partial: outcome.partial, ...result, durationMs: Date.now() - started }
    if (!outcome.ok) {
      // Structured, ERROR severity → Cloud Logging can alert on it even when the HTTP status is a 207.
      console.error(JSON.stringify({ severity: 'ERROR', message: `[cron] ${task} finished with errors`, ...summary }))
    }
    return NextResponse.json(summary, { status: outcome.status })
  } catch (err) {
    console.error(JSON.stringify({
      severity: 'ERROR',
      message: `[cron] ${task} threw`,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }))
    return NextResponse.json(
      { task, ok: false, error: 'task_failed', durationMs: Date.now() - started },
      { status: 500 },
    )
  }
}

export { handler as GET, handler as POST }
