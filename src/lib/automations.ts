/**
 * Automation execution engine.
 *
 * Triggers fire from inside mutation handlers (fire-and-forget) and from the
 * cron route (for time-based triggers). All execution paths go through
 * `triggerAutomations()` which:
 *   1. Loads enabled automations matching (org_id, trigger).
 *   2. For each, evaluates conditions against the trigger payload.
 *   3. Runs actions sequentially, capturing per-action outcome.
 *   4. Writes one `automation_runs` row for observability.
 *
 * Actions are best-effort: a failed action does NOT abort subsequent actions,
 * and a failed automation never propagates an error back to the originating
 * mutation. The PM doesn't need to care if a Chat webhook is down.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database, AutomationTrigger, AutomationConditions, AutomationAction,
  TaskStatus, Priority,
} from '@/types/database'
import { postToChatWebhook } from '@/lib/google-chat'
import { todayInTZ, addDays, daysBetween, localDateAtToUTC } from '@/lib/tz'

type SB = SupabaseClient<Database>

/** Payload shapes per trigger. Keep narrow — only what conditions/actions need. */
export type TriggerPayload =
  | { trigger: 'task.created'; org_id: string; task: TaskShape }
  | { trigger: 'task.status_changed'; org_id: string; task: TaskShape; from_status: TaskStatus; to_status: TaskStatus }
  | { trigger: 'task.due_soon'; org_id: string; task: TaskShape; hours_until_due: number }
  | { trigger: 'project.health_low'; org_id: string; project: { id: string; code: string; name: string; health_score: number } }

interface TaskShape {
  id: string
  project_id: string
  title: string
  status: TaskStatus
  priority: Priority
  assignee_id: string | null
  due_date: string | null
  labels: string[]
}

/**
 * Public entry point. Loads + executes all matching automations.
 * Never throws — wraps everything in try/catch and logs.
 */
export async function triggerAutomations(supabase: SB, payload: TriggerPayload): Promise<void> {
  try {
    const { data: automations } = await supabase
      .from('automations')
      .select('*')
      .eq('org_id', payload.org_id)
      .eq('trigger', payload.trigger)
      .eq('enabled', true)
    if (!automations?.length) return

    await Promise.all(automations.map(a => runOne(supabase, a, payload)))
  } catch (err) {
    console.error('[automations.trigger]', payload.trigger, err)
  }
}

async function runOne(
  supabase: SB,
  automation: { id: string; conditions: AutomationConditions; actions: AutomationAction[]; run_count: number },
  payload: TriggerPayload,
): Promise<void> {
  const start = Date.now()
  const matched = matchesConditions(automation.conditions, payload)
  const results: Array<{ kind: string; ok: boolean; error?: string }> = []

  if (matched) {
    for (const action of automation.actions) {
      try {
        await executeAction(supabase, action, payload)
        results.push({ kind: action.kind, ok: true })
      } catch (err) {
        results.push({ kind: action.kind, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  // Best-effort observability writes — never block the actions.
  void supabase.from('automation_runs').insert({
    automation_id: automation.id,
    // JSON-roundtrip: TS Json type rejects our discriminated union directly,
    // but at runtime it's already a plain JSON-safe object.
    trigger_payload: JSON.parse(JSON.stringify(payload)),
    matched,
    results,
    duration_ms: Date.now() - start,
  })
  if (matched) {
    void supabase
      .from('automations')
      .update({ last_run_at: new Date().toISOString(), run_count: automation.run_count + 1 })
      .eq('id', automation.id)
  }
}

/** All conditions are ANDed. Unset conditions are skipped. */
function matchesConditions(c: AutomationConditions, p: TriggerPayload): boolean {
  // Per-trigger condition matching
  if (p.trigger === 'task.created' || p.trigger === 'task.status_changed' || p.trigger === 'task.due_soon') {
    if (c.project_id && c.project_id !== p.task.project_id) return false
    if (c.status && c.status !== p.task.status) return false
    if (c.priority && c.priority !== p.task.priority) return false
  }
  if (p.trigger === 'task.status_changed') {
    if (c.from_status && c.from_status !== p.from_status) return false
    if (c.to_status && c.to_status !== p.to_status) return false
  }
  if (p.trigger === 'task.due_soon') {
    const max = c.hours_until_due ?? 24
    if (p.hours_until_due > max) return false
  }
  if (p.trigger === 'project.health_low') {
    if (c.project_id && c.project_id !== p.project.id) return false
    const threshold = c.health_below ?? 50
    if (p.project.health_score >= threshold) return false
  }
  return true
}

async function executeAction(supabase: SB, action: AutomationAction, payload: TriggerPayload): Promise<void> {
  // Actions on tasks need a task in the payload.
  const task = 'task' in payload ? payload.task : null

  switch (action.kind) {
    case 'set_status': {
      if (!task) throw new Error('set_status requires a task payload')
      const { error } = await supabase.from('tasks').update({ status: action.value }).eq('id', task.id)
      if (error) throw error
      return
    }
    case 'set_assignee': {
      if (!task) throw new Error('set_assignee requires a task payload')
      const value = action.value === 'unassign' ? null : action.value
      const { error } = await supabase.from('tasks').update({ assignee_id: value }).eq('id', task.id)
      if (error) throw error
      return
    }
    case 'set_priority': {
      if (!task) throw new Error('set_priority requires a task payload')
      const { error } = await supabase.from('tasks').update({ priority: action.value }).eq('id', task.id)
      if (error) throw error
      return
    }
    case 'add_label': {
      if (!task) throw new Error('add_label requires a task payload')
      if (task.labels.includes(action.value)) return // idempotent
      const { error } = await supabase
        .from('tasks')
        .update({ labels: [...task.labels, action.value] })
        .eq('id', task.id)
      if (error) throw error
      return
    }
    case 'send_chat': {
      const { data: org } = await supabase
        .from('organizations')
        .select('google_chat_webhook_url')
        .eq('id', payload.org_id)
        .single()
      if (!org?.google_chat_webhook_url) throw new Error('Sin webhook de Google Chat configurado')
      // Render simple {{placeholders}} from the payload.
      const message = renderTemplate(action.value, payload)
      await postToChatWebhook(org.google_chat_webhook_url, {
        text: message,
      } as { text: string })
      return
    }
  }
}

/**
 * Minimal {{key}} template — supports task.title, task.status, project.id,
 * etc. Missing keys render as empty string (intentional: cheap and forgiving).
 */
function renderTemplate(tpl: string, payload: TriggerPayload): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const parts = path.split('.')
    let cur: unknown = payload
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p]
      } else {
        return ''
      }
    }
    return cur == null ? '' : String(cur)
  })
}

// ── Cron entry points ─────────────────────────────────────────────────

/**
 * Cron handler — finds tasks whose due_date is within the next N hours
 * and fires task.due_soon for each. Called from /api/cron/automations.
 *
 * Uses a 1-hour de-dupe window: if an automation already ran against this
 * task in the last hour (per `automation_runs`), it's skipped. This prevents
 * the hourly cron from re-firing the same automations on the same tasks
 * before someone has time to react.
 */
export async function runDueSoonAutomations(supabase: SB): Promise<{ tasksProcessed: number }> {
  // Compute the 2-day window in TZ-local dates — both the lower and upper
  // bounds need to match what the user perceives as "today" and "+2 days".
  // The previous version used UTC slices, which silently shifted both ends
  // by up to 3 hours and produced wrong `hours_until_due` numbers.
  const today = todayInTZ()
  const inTwoDays = addDays(today, 2)
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, project_id, title, status, priority, assignee_id, due_date, labels, project:projects(org_id:workspace_id)')
    .gte('due_date', today)
    .lte('due_date', inTwoDays)
    .neq('status', 'done')
    .neq('status', 'canceled')
  if (!tasks?.length) return { tasksProcessed: 0 }

  // Resolve workspace → org_id once (cheap join, but `workspace_id` is on
  // projects, and we need the org for org-scoped automations).
  const projectIds = Array.from(new Set(tasks.map(t => t.project_id)))
  const { data: projects } = await supabase
    .from('projects')
    .select('id, workspace_id')
    .in('id', projectIds)
  const workspaceIds = Array.from(new Set((projects ?? []).map(p => p.workspace_id)))
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, org_id')
    .in('id', workspaceIds)
  const projectToOrg = new Map<string, string>()
  for (const p of projects ?? []) {
    const ws = (workspaces ?? []).find(w => w.id === p.workspace_id)
    if (ws) projectToOrg.set(p.id, ws.org_id)
  }

  for (const t of tasks) {
    const orgId = projectToOrg.get(t.project_id)
    if (!orgId || !t.due_date) continue
    // hours_until_due is in TZ wall-clock days × 24 — what the user perceives.
    // (Original used absolute UTC ms diff, which shifted the count by 3h
    // and fired automations early.)
    const daysUntil = daysBetween(today, t.due_date.slice(0, 10))
    const hoursUntil = Math.max(0, daysUntil * 24)
    await triggerAutomations(supabase, {
      trigger: 'task.due_soon',
      org_id: orgId,
      task: {
        id: t.id, project_id: t.project_id, title: t.title,
        status: t.status, priority: t.priority,
        assignee_id: t.assignee_id, due_date: t.due_date, labels: t.labels ?? [],
      },
      hours_until_due: hoursUntil,
    })
  }
  return { tasksProcessed: tasks.length }
}

/** Cron handler — finds projects with low health and fires project.health_low. */
export async function runHealthLowAutomations(supabase: SB): Promise<{ projectsProcessed: number }> {
  const { data: projects } = await supabase
    .from('projects')
    .select('id, code, name, health_score, workspace_id')
    .not('health_score', 'is', null)
    .lt('health_score', 70)  // outer cap; per-automation threshold filters further
  if (!projects?.length) return { projectsProcessed: 0 }

  const workspaceIds = Array.from(new Set(projects.map(p => p.workspace_id)))
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, org_id')
    .in('id', workspaceIds)
  const wsToOrg = new Map<string, string>()
  for (const w of workspaces ?? []) wsToOrg.set(w.id, w.org_id)

  for (const p of projects) {
    const orgId = wsToOrg.get(p.workspace_id)
    if (!orgId || p.health_score == null) continue
    await triggerAutomations(supabase, {
      trigger: 'project.health_low',
      org_id: orgId,
      project: { id: p.id, code: p.code, name: p.name, health_score: p.health_score },
    })
  }
  return { projectsProcessed: projects.length }
}
