import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Pure helpers for the cron endpoint: constant-time auth, the HTTP outcome of a
 * run, and the decision of whether a recurring rule may be claimed. Kept free
 * of I/O so the idempotency rules are unit-tested (see cron-utils.test.ts).
 */

/** Constant-time string comparison. Both sides are hashed first, so the buffers always have equal length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** `Authorization: Bearer <secret>` check in constant time. A missing secret never authorises anyone. */
export function isBearerAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  return safeEqual(header, `Bearer ${secret}`)
}

export interface CronResult {
  sent: number
  skipped: number
  errors: number
  /** Ids (org or rule) that failed, so the summary says WHICH ones. */
  failed?: string[]
}

export interface CronOutcome {
  status: 200 | 207 | 500
  ok: boolean
  partial: boolean
}

/**
 * HTTP outcome of a run:
 *   no errors                       → 200
 *   some errors, some successes     → 207 (a 2xx: Cloud Scheduler does not retry, so orgs already
 *                                     notified are not notified twice; the ERROR log + JSON flag it)
 *   errors and nothing succeeded    → 500 (the run failed)
 *   `strict`                        → any error is a 500 (opt in with ?strict=1 when the job is retry-safe)
 */
export function cronOutcome(result: CronResult, strict = false): CronOutcome {
  if (result.errors <= 0) return { status: 200, ok: true, partial: false }
  if (strict || result.sent === 0) return { status: 500, ok: false, partial: false }
  return { status: 207, ok: false, partial: true }
}

export type RuleClaimDecision = 'claim' | 'not_due' | 'already_ran'

/**
 * May this recurring rule be materialised now? `orgToday` is today's date in the
 * ORG's timezone (YYYY-MM-DD). A rule that already ran today is never claimed
 * again, even if its next_run_at was moved back by hand.
 */
export function decideRuleClaim(
  rule: { next_run_at: string; last_run_at: string | null },
  orgToday: string,
): RuleClaimDecision {
  if (rule.next_run_at > orgToday) return 'not_due'
  if (rule.last_run_at === orgToday) return 'already_ran'
  return 'claim'
}
