/**
 * Notification rules — pure functions (no DB, no network), shared by the server
 * (`src/server/notify.ts`) and the preferences UI.
 *
 * Delivery model:
 *   - The in-app inbox always keeps an event, unless the person muted that KIND.
 *   - A push is sent only if push is enabled, the kind is not muted and it is not quiet hours.
 *     Pushes inside quiet hours are dropped, not delayed — the item is still waiting in the inbox.
 */

export const NOTIFICATION_KINDS = [
  'task_assigned',
  'task_review',
  'mention',
  'dm',
  'doc_review',
  'doc_decision',
  'cost_run',
  'deadline',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export const KIND_META: Record<NotificationKind, { label: string; description: string }> = {
  task_assigned: { label: 'Tareas asignadas', description: 'Cuando alguien te asigna o te reasigna una tarea.' },
  task_review: { label: 'Revisiones de tareas', description: 'Cuando te piden revisar algo, o aprueban o piden cambios en lo tuyo.' },
  mention: { label: 'Menciones en el chat', description: 'Cuando te mencionan con @ en un canal o hilo.' },
  dm: { label: 'Mensajes directos', description: 'Cuando alguien te escribe en privado.' },
  doc_review: { label: 'Documentos por revisar', description: 'Cuando te piden revisar o aprobar un documento.' },
  doc_decision: { label: 'Decisiones sobre tus documentos', description: 'Cuando aprueban tu documento o piden cambios.' },
  cost_run: { label: 'Cargos entre empresas', description: 'Cuando hay un reparto de costos listo para aprobar (solo Dirección).' },
  deadline: { label: 'Vencimientos de hoy', description: 'Un resumen cada mañana con lo que vence hoy.' },
}

export interface NotifyPrefs {
  push_enabled: boolean
  /** Per-kind overrides: `false` mutes that kind entirely (no inbox, no push). */
  kinds: Record<string, boolean>
  /** 'HH:MM' or 'HH:MM:SS', local time of the person. */
  quiet_start: string | null
  quiet_end: string | null
}

export const DEFAULT_PREFS: NotifyPrefs = { push_enabled: true, kinds: {}, quiet_start: null, quiet_end: null }

/** Unique recipients, never the person who caused the event. */
export function dedupeRecipients(userIds: ReadonlyArray<string | null | undefined>, actorId?: string | null): string[] {
  const out = new Set<string>()
  for (const id of userIds) if (id && id !== actorId) out.add(id)
  return Array.from(out)
}

/** 'HH:MM[:SS]' → minutes since midnight, or null when malformed. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1]); const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Minutes since local midnight in the given IANA zone. */
export function localMinutes(now: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
    return (h % 24) * 60 + m
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes()
  }
}

/** Quiet hours may wrap midnight (22:00 → 07:00). Equal start and end means "no quiet hours". */
export function inQuietHours(prefs: Pick<NotifyPrefs, 'quiet_start' | 'quiet_end'>, now: Date, tz: string): boolean {
  const start = parseClock(prefs.quiet_start)
  const end = parseClock(prefs.quiet_end)
  if (start === null || end === null || start === end) return false
  const t = localMinutes(now, tz)
  return start < end ? t >= start && t < end : t >= start || t < end
}

export type DeliveryDecision =
  | { store: false; push: false; reason: 'kind_muted' }
  | { store: true; push: false; reason: 'push_disabled' | 'quiet_hours' }
  | { store: true; push: true; reason: 'deliver' }

export function decideDelivery(prefs: NotifyPrefs | null | undefined, kind: string, now: Date, tz: string): DeliveryDecision {
  const p = prefs ?? DEFAULT_PREFS
  if (p.kinds?.[kind] === false) return { store: false, push: false, reason: 'kind_muted' }
  if (!p.push_enabled) return { store: true, push: false, reason: 'push_disabled' }
  if (inQuietHours(p, now, tz)) return { store: true, push: false, reason: 'quiet_hours' }
  return { store: true, push: true, reason: 'deliver' }
}

export interface PushPayload {
  title: string
  body: string
  url: string
  kind: string
  /** Same tag replaces an older notification of the same thing instead of stacking. */
  tag: string
  /** Unread inbox count after this event — used for the app-icon badge. */
  unread: number
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)

/** Shape what the service worker receives. Keeps it small (push payloads cap near 4 KB) and links inside the app only. */
export function buildPushPayload(input: {
  title: string
  body?: string | null
  url?: string | null
  kind: string
  entityId?: string | null
  unread: number
}): PushPayload {
  const url = input.url && input.url.startsWith('/') ? input.url : '/dashboard/bandeja'
  return {
    title: clip(input.title, 80),
    body: clip(input.body ?? '', 160),
    url,
    kind: input.kind,
    tag: input.entityId ? `${input.kind}:${input.entityId}` : input.kind,
    unread: Math.max(0, Math.min(input.unread, 999)),
  }
}
