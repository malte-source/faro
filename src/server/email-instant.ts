import type { createAdminSupabaseClient } from '@/lib/supabase'
import { DEFAULT_TZ, todayInTZ } from '@/lib/tz'
import { isEmailConfigured, sendMailBatch, type MailMessage } from '@/lib/mailer'
import { buildInstantEmail } from '@/lib/email-templates'
import { decideInstantEmail, emailRuleFor, resolveEmailPrefs, INSTANT_EMAIL_DAILY_CAP } from '@/lib/email-prefs'
import { dueWithin48h, localDayStartUtc } from '@/lib/email-schedule'
import { KIND_META, type NotificationKind } from '@/lib/notify-core'
import { emailLinksFor } from '@/server/email-links'

type Db = ReturnType<typeof createAdminSupabaseClient>

/**
 * Instant emails, called from notify() after the inbox row and the push were handled.
 * Email is the exception channel: only what someone is waiting on (see decideInstantEmail).
 *
 * Contract: never throws, does nothing without SMTP, and does nothing until the email columns /
 * email_log exist (it could not enforce the daily cap, and Gmail's limits are not worth risking).
 */

export interface InstantInput {
  supabase: Db
  orgId: string
  recipients: string[]
  kind: NotificationKind
  title: string
  body?: string | null
  url?: string | null
  entity?: { type: string; id: string }
  tzById: ReadonlyMap<string, string>
  now?: Date
}

let warnedUnavailable = false

function warnUnavailable(reason: string) {
  if (warnedUnavailable) return
  warnedUnavailable = true
  console.warn(JSON.stringify({ severity: 'WARNING', message: 'email_prefs_unavailable', job: 'instant', reason, hint: 'apply supabase/migrations/20261027_email_prefs.sql' }))
}

interface PrefsRow { user_id: string; push_enabled: boolean; email_instant: boolean; email_kinds: unknown }

/** Returns how many emails went out. */
export async function sendInstantEmails(input: InstantInput): Promise<number> {
  try {
    if (!input.recipients.length || !isEmailConfigured()) return 0
    const { supabase } = input
    const now = input.now ?? new Date()

    const { data: prefRows, error } = await supabase
      .from('user_notification_prefs')
      .select('user_id, push_enabled, email_instant, email_kinds')
      .in('user_id', input.recipients)
    if (error) { warnUnavailable(error.message); return 0 }
    const prefsById = new Map((prefRows as PrefsRow[] | null ?? []).map(r => [r.user_id, r]))

    // Cheap pre-filter before touching anything else: who could possibly want this kind by email?
    const wanting = input.recipients.filter(id => {
      const p = resolveEmailPrefs(prefsById.get(id) as never)
      return p.email_instant && emailRuleFor(p, input.kind) !== 'off'
    })
    if (!wanting.length) return 0

    const [usersRes, subsRes, dueRes, logRes] = await Promise.all([
      supabase.from('users').select('id, name, email').in('id', wanting),
      supabase.from('push_subscriptions').select('user_id').in('user_id', wanting),
      input.kind === 'task_assigned' && input.entity?.type === 'task'
        ? supabase.from('tasks').select('due_date').eq('id', input.entity.id).maybeSingle()
        : Promise.resolve({ data: null as { due_date: string | null } | null, error: null }),
      supabase
        .from('email_log')
        .select('user_id, created_at')
        .in('user_id', wanting)
        .like('kind', 'instant:%')
        .gte('created_at', new Date(now.getTime() - 36 * 3_600_000).toISOString()),
    ])
    if (logRes.error) { warnUnavailable(logRes.error.message); return 0 }

    const hasPush = new Set((subsRes.data ?? []).map(s => s.user_id))
    const due = dueRes.data?.due_date ?? null

    const messages: Array<{ userId: string; message: MailMessage }> = []
    for (const u of usersRes.data ?? []) {
      const tz = input.tzById.get(u.id) ?? DEFAULT_TZ
      const prefs = resolveEmailPrefs(prefsById.get(u.id) as never)
      const dayStart = localDayStartUtc(now, tz)
      const sentToday = (logRes.data ?? []).filter(l => l.user_id === u.id && l.created_at >= dayStart).length
      const row = prefsById.get(u.id)
      const decision = decideInstantEmail({
        kind: input.kind,
        prefs,
        pushLive: hasPush.has(u.id) && (row?.push_enabled ?? true),
        dueSoon: dueWithin48h(due, todayInTZ(now, tz)),
        sentToday,
        cap: INSTANT_EMAIL_DAILY_CAP,
      })
      if (!decision.send) continue
      const built = buildInstantEmail(
        { name: u.name, kindLabel: KIND_META[input.kind].label, title: input.title, body: input.body, url: input.url },
        emailLinksFor(u.id, 'all'),
      )
      messages.push({ userId: u.id, message: { to: u.email, subject: built.subject, html: built.html, text: built.text, headers: built.headers } })
    }
    if (!messages.length) return 0

    const sent = await sendMailBatch(messages.map(m => m.message), { concurrency: 3, kind: `instant:${input.kind}` })
    const okRows = messages.filter((_, i) => sent.results[i].ok).map(m => ({ user_id: m.userId, kind: `instant:${input.kind}` }))
    if (okRows.length) await supabase.from('email_log').insert(okRows)
    return sent.sent
  } catch (err) {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'instant email failed', cause: err instanceof Error ? err.message : String(err) }))
    return 0
  }
}
