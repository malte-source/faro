/**
 * AI budget rules (pure). The database lookups live in src/server/ai-usage.ts; this
 * file only answers "is this call allowed?" from numbers, so it is trivially testable.
 */

export const BUDGET_EXHAUSTED_MESSAGE = 'El presupuesto de IA de este mes se agotó. Pide a Dirección que lo amplíe.'

/** Thrown BEFORE a Gemini call when the month's cap is reached; protectedProcedure turns it into FORBIDDEN. */
export class AiBudgetError extends Error {
  constructor(public readonly scope: 'org' | 'user', message: string = BUDGET_EXHAUSTED_MESSAGE) {
    super(message)
    this.name = 'AiBudgetError'
  }
}

export interface BudgetLimits {
  /** Monthly cap for the whole organisation in USD. `null` = no cap. */
  monthlyUsd: number | null
  /** Monthly cap per person in USD. `null` = no cap. */
  perUserMonthlyUsd: number | null
  /** Percentage of the org cap at which a warning is logged. */
  warnPct: number
}

export interface BudgetDecision {
  allowed: boolean
  /** Which cap blocked the call (only when `allowed` is false). */
  blockedBy: 'org' | 'user' | null
  /** The org spend crossed `warnPct` of its cap (but the call is still allowed). */
  warn: boolean
  /** Spend as a fraction of the org cap (0–1+), or `null` without a cap. */
  orgUsedFraction: number | null
}

/**
 * Decide on a call given what has been spent this month. A cap of 0 blocks everything
 * (a deliberate "AI off" switch); `null` means unlimited.
 */
export function evaluateBudget(input: { spentOrgUsd: number; spentUserUsd: number; limits: BudgetLimits | null }): BudgetDecision {
  const { spentOrgUsd, spentUserUsd, limits } = input
  if (!limits) return { allowed: true, blockedBy: null, warn: false, orgUsedFraction: null }

  const orgCap = limits.monthlyUsd
  const userCap = limits.perUserMonthlyUsd
  const orgUsedFraction = orgCap === null ? null : orgCap === 0 ? 1 : spentOrgUsd / orgCap

  if (orgCap !== null && spentOrgUsd >= orgCap) return { allowed: false, blockedBy: 'org', warn: false, orgUsedFraction }
  if (userCap !== null && spentUserUsd >= userCap) return { allowed: false, blockedBy: 'user', warn: false, orgUsedFraction }

  const warn = orgUsedFraction !== null && orgUsedFraction * 100 >= limits.warnPct
  return { allowed: true, blockedBy: null, warn, orgUsedFraction }
}

/** First and last day (YYYY-MM-DD) of a `YYYY-MM` month, plus its length in days. */
export function monthBounds(month: string): { first: string; nextFirst: string; days: number } {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { first: `${month}-01`, nextFirst: `${next}-01`, days }
}

/**
 * Projected spend at month end from spend so far — a straight-line run rate.
 * For a past month it is simply what was spent; for a month that has not started, 0.
 */
export function projectMonthEnd(input: { spentUsd: number; today: string; month: string }): number {
  const { spentUsd, today, month } = input
  const { first, nextFirst, days } = monthBounds(month)
  if (today >= nextFirst) return spentUsd
  if (today < first) return 0
  const elapsed = Number(today.slice(8, 10))
  if (elapsed <= 0) return spentUsd
  return Math.round((spentUsd / elapsed) * days * 1e6) / 1e6
}
