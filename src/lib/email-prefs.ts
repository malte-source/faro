import type { NotificationKind } from '@/lib/notify-core'
import { normalizeDigestHour, type DigestMode } from '@/lib/email-schedule'

/**
 * Email preferences + the rule for INSTANT emails (the digest has its own rules in email-schedule.ts).
 *
 * An instant email is the exception, not the channel: push and the inbox carry day-to-day events.
 * Email goes out immediately only for things someone is waiting on:
 *   - asking you to review / approve something (task review, document review, cost run)   → always
 *   - a task assigned to you                                                                 → only if due within 48 h
 * …and never when push already reached the person (unless it is an approval, or they explicitly opted that kind in).
 */

export type EmailKindRule = 'always' | 'due48' | 'off'

/** What a person gets when they have not touched the settings. Kinds not listed are 'off'. */
export const DEFAULT_EMAIL_KIND_RULES: Partial<Record<NotificationKind, EmailKindRule>> = {
  task_review: 'always',
  doc_review: 'always',
  cost_run: 'always',
  task_assigned: 'due48',
}

/** Requests that block someone else: these reach the inbox of a person even if their phone buzzed. */
export const APPROVAL_KINDS: ReadonlySet<string> = new Set(['task_review', 'doc_review', 'cost_run'])

/** Kinds whose email the person can configure. 'deadline' is covered by the digest. */
export const EMAIL_CONFIGURABLE_KINDS: ReadonlyArray<NotificationKind> = [
  'task_review',
  'doc_review',
  'cost_run',
  'task_assigned',
  'doc_decision',
  'mention',
  'dm',
]

export const INSTANT_EMAIL_DAILY_CAP = 10

export interface EmailPrefs {
  email_digest: DigestMode
  digest_hour: number
  email_instant: boolean
  /** Explicit per-kind choices: true = always email it, false = never. Absent = default rule. */
  email_kinds: Record<string, boolean>
  last_digest_at: string | null
}

export const DEFAULT_EMAIL_PREFS: EmailPrefs = {
  email_digest: 'daily',
  digest_hour: 8,
  email_instant: true,
  email_kinds: {},
  last_digest_at: null,
}

/** Rows may be missing, partial, or hold junk: always come out with a valid object. */
export function resolveEmailPrefs(row: Partial<Record<keyof EmailPrefs, unknown>> | null | undefined): EmailPrefs {
  if (!row) return { ...DEFAULT_EMAIL_PREFS }
  const digest = row.email_digest === 'off' || row.email_digest === 'weekly' || row.email_digest === 'daily' ? row.email_digest : 'daily'
  const kinds: Record<string, boolean> = {}
  if (row.email_kinds && typeof row.email_kinds === 'object' && !Array.isArray(row.email_kinds)) {
    for (const [k, v] of Object.entries(row.email_kinds as Record<string, unknown>)) if (typeof v === 'boolean') kinds[k] = v
  }
  return {
    email_digest: digest,
    digest_hour: normalizeDigestHour(row.digest_hour),
    email_instant: typeof row.email_instant === 'boolean' ? row.email_instant : true,
    email_kinds: kinds,
    last_digest_at: typeof row.last_digest_at === 'string' ? row.last_digest_at : null,
  }
}

/** The effective rule for one kind: an explicit choice wins over the default. */
export function emailRuleFor(prefs: Pick<EmailPrefs, 'email_kinds'>, kind: string): EmailKindRule {
  const explicit = prefs.email_kinds[kind]
  if (explicit === true) return 'always'
  if (explicit === false) return 'off'
  return DEFAULT_EMAIL_KIND_RULES[kind as NotificationKind] ?? 'off'
}

export type InstantSkip = 'instant_off' | 'kind_off' | 'cap' | 'not_due_soon' | 'push_covers'
export type InstantDecision = { send: true } | { send: false; reason: InstantSkip }

export function decideInstantEmail(input: {
  kind: string
  prefs: Pick<EmailPrefs, 'email_instant' | 'email_kinds'>
  /** Has at least one registered device AND push enabled: the phone already buzzed. */
  pushLive: boolean
  /** For 'due48' rules: is the task due within 48 h (or overdue)? */
  dueSoon: boolean
  /** Instant emails already sent to this person today. */
  sentToday: number
  cap?: number
}): InstantDecision {
  const { kind, prefs } = input
  if (!prefs.email_instant) return { send: false, reason: 'instant_off' }
  const rule = emailRuleFor(prefs, kind)
  if (rule === 'off') return { send: false, reason: 'kind_off' }
  if (input.sentToday >= (input.cap ?? INSTANT_EMAIL_DAILY_CAP)) return { send: false, reason: 'cap' }
  if (rule === 'due48' && !input.dueSoon) return { send: false, reason: 'not_due_soon' }
  const explicitOptIn = prefs.email_kinds[kind] === true
  if (input.pushLive && !APPROVAL_KINDS.has(kind) && !explicitOptIn) return { send: false, reason: 'push_covers' }
  return { send: true }
}
