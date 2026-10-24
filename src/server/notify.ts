import webpush from 'web-push'
import type { createAdminSupabaseClient } from '@/lib/supabase'
import { DEFAULT_TZ } from '@/lib/tz'
import { sendInstantEmails } from '@/server/email-instant'
import {
  buildPushPayload,
  decideDelivery,
  dedupeRecipients,
  type NotificationKind,
  type NotifyPrefs,
} from '@/lib/notify-core'

type Db = ReturnType<typeof createAdminSupabaseClient>

/** Total time budget for the whole push fan-out; a slow push service must never slow the request that caused the event. */
const PUSH_BUDGET_MS = 3000
const PUSH_TTL_SECONDS = 12 * 60 * 60
/** Same idea for the (rare) instant email: SMTP can be slow, the request that caused the event must not wait for it. */
const EMAIL_BUDGET_MS = 4000

async function withBudget<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms) })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

let vapidReady: boolean | null = null

/** Configure VAPID once. Without the three env vars push silently turns off (the inbox keeps working). */
function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady
  const pub = process.env.VAPID_PUBLIC_KEY?.trim()
  const priv = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:soporte@faro.app'
  if (!pub || !priv) {
    vapidReady = false
    return false
  }
  try {
    webpush.setVapidDetails(subject, pub, priv)
    vapidReady = true
  } catch (err) {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'VAPID configuration is invalid', cause: err instanceof Error ? err.message : String(err) }))
    vapidReady = false
  }
  return vapidReady
}

export const pushConfigured = () => ensureVapid()

export interface NotifyInput {
  supabase: Db
  orgId: string
  userIds: ReadonlyArray<string | null | undefined>
  kind: NotificationKind
  title: string
  body?: string | null
  /** In-app path the notification opens, e.g. `/dashboard/chat?c=…`. */
  url?: string | null
  entity?: { type: string; id: string }
  actorId?: string | null
  /** Skip preferences and quiet hours (used by the "send me a test" button only). */
  force?: boolean
}

export interface NotifyResult {
  stored: number
  pushed: number
  /** Instant emails sent (only for things someone is waiting on; see src/lib/email-prefs.ts). */
  emailed?: number
}

interface SubRow { endpoint: string; p256dh: string; auth: string; user_id: string }

/**
 * Record an event for some people and push it to their devices.
 *
 *   inbox row  → always, unless the person muted that kind
 *   Web Push   → if push is on, the kind isn't muted and it isn't quiet hours
 *
 * It NEVER throws: a notification is a side effect of something that already succeeded
 * (a task was assigned, a message was sent) and must not turn that into an error.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const result: NotifyResult = { stored: 0, pushed: 0 }
  try {
    const recipients = dedupeRecipients(input.userIds, input.actorId)
    if (!recipients.length) return result
    const { supabase } = input
    const now = new Date()

    const [{ data: prefRows }, { data: userRows }, { data: org }] = await Promise.all([
      supabase.from('user_notification_prefs').select('user_id, push_enabled, kinds, quiet_start, quiet_end').in('user_id', recipients),
      supabase.from('users').select('id, timezone').in('id', recipients),
      supabase.from('organizations').select('timezone').eq('id', input.orgId).maybeSingle(),
    ])
    const prefsById = new Map<string, NotifyPrefs>(
      (prefRows ?? []).map(r => [
        r.user_id,
        { push_enabled: r.push_enabled, kinds: (r.kinds ?? {}) as Record<string, boolean>, quiet_start: r.quiet_start, quiet_end: r.quiet_end },
      ]),
    )
    const tzById = new Map((userRows ?? []).map(u => [u.id, u.timezone ?? org?.timezone ?? DEFAULT_TZ]))

    const toStore: string[] = []
    const toPush: string[] = []
    for (const id of recipients) {
      const d = input.force
        ? ({ store: true, push: true, reason: 'deliver' } as const)
        : decideDelivery(prefsById.get(id), input.kind, now, tzById.get(id) ?? DEFAULT_TZ)
      if (d.store) toStore.push(id)
      if (d.push) toPush.push(id)
    }
    if (!toStore.length) return result

    const { error } = await supabase.from('notifications').insert(
      toStore.map(user_id => ({
        org_id: input.orgId,
        user_id,
        kind: input.kind,
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 500) ?? null,
        url: input.url ?? null,
        entity_type: input.entity?.type ?? null,
        entity_id: input.entity?.id ?? null,
        actor_id: input.actorId ?? null,
      })),
    )
    if (error) {
      console.error(JSON.stringify({ severity: 'ERROR', message: 'notify: insert failed', cause: error.message }))
      return result
    }
    result.stored = toStore.length

    if (toPush.length && ensureVapid()) result.pushed = await pushTo(supabase, toPush, input)

    // Email: the exception channel (approvals, assignments due soon). Never for the "send me a test" push.
    if (!input.force) {
      result.emailed = await withBudget(
        sendInstantEmails({
          supabase,
          orgId: input.orgId,
          recipients: toStore,
          kind: input.kind,
          title: input.title,
          body: input.body,
          url: input.url,
          entity: input.entity,
          tzById,
          now,
        }),
        EMAIL_BUDGET_MS,
        0,
      )
    }
  } catch (err) {
    console.error(JSON.stringify({ severity: 'ERROR', message: 'notify failed', cause: err instanceof Error ? err.message : String(err) }))
  }
  return result
}

async function pushTo(supabase: Db, userIds: string[], input: NotifyInput): Promise<number> {
  const [{ data: subs }, { data: unreadRows }] = await Promise.all([
    supabase.from('push_subscriptions').select('endpoint, p256dh, auth, user_id').in('user_id', userIds),
    supabase.from('notifications').select('user_id').in('user_id', userIds).is('read_at', null).limit(5000),
  ])
  if (!subs?.length) return 0

  const unread = new Map<string, number>()
  for (const r of unreadRows ?? []) unread.set(r.user_id, (unread.get(r.user_id) ?? 0) + 1)

  const dead: string[] = []
  const alive: string[] = []
  const sends = (subs as SubRow[]).map(async sub => {
    const payload = buildPushPayload({
      title: input.title,
      body: input.body,
      url: input.url,
      kind: input.kind,
      entityId: input.entity?.id,
      unread: unread.get(sub.user_id) ?? 1,
    })
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: PUSH_TTL_SECONDS, urgency: 'normal' },
      )
      alive.push(sub.endpoint)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) dead.push(sub.endpoint) // browser says the subscription is gone
      else console.warn(JSON.stringify({ severity: 'WARNING', message: 'push failed', status: status ?? null }))
    }
  })

  await Promise.race([Promise.allSettled(sends), new Promise(resolve => setTimeout(resolve, PUSH_BUDGET_MS))])

  if (dead.length) await supabase.from('push_subscriptions').delete().in('endpoint', dead)
  if (alive.length) await supabase.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).in('endpoint', alive)
  return alive.length
}

/** Unread persisted notifications for one person. */
export async function unreadCountFor(supabase: Db, userId: string): Promise<number> {
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  return count ?? 0
}

/** "Send me a test": pushes to the person's own devices without writing an inbox row or touching prefs. */
export async function sendTestPush(supabase: Db, orgId: string, userId: string): Promise<{ configured: boolean; pushed: number }> {
  if (!ensureVapid()) return { configured: false, pushed: 0 }
  const pushed = await pushTo(supabase, [userId], {
    supabase,
    orgId,
    userIds: [userId],
    kind: 'mention',
    title: 'Faro: aviso de prueba',
    body: 'Si lo ves, los avisos funcionan en este dispositivo.',
    url: '/dashboard/ajustes-avisos',
  })
  return { configured: true, pushed }
}
