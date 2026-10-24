import { createAdminSupabaseClient } from '@/lib/supabase'
import { setAiBudgetGuard, setAiUsageSink, type AiUsageRecord } from '@/lib/gemini'
import { AiBudgetError, evaluateBudget, monthBounds, type BudgetLimits } from '@/lib/ai-budget'
import { DEFAULT_TZ, localDateAtToUTC, todayInTZ } from '@/lib/tz'

/**
 * AI metering + budgets, server side.
 *
 *   • SINK   — every Gemini call writes one row to `ai_usage` (fire-and-forget).
 *   • GUARD  — before every call, month-to-date spend is compared with `ai_budgets`;
 *              over the cap → `AiBudgetError` (protectedProcedure maps it to FORBIDDEN).
 *
 * Both FAIL OPEN: if the tables don't exist yet (the SQL is applied by hand after a
 * deploy) or a query errors, calls are neither blocked nor recorded — metering must
 * never be the reason the product stops working. Importing this module registers the
 * hooks (it is imported from the tRPC context and the cron route).
 */

const CACHE_TTL_MS = 60_000
const FAILED_TTL_MS = 15_000

export interface OrgSpend {
  /** `false` when the tables are missing or unreadable: no metering, no blocking. */
  available: boolean
  month: string
  tz: string
  org: number
  byUser: Map<string, number>
  limits: BudgetLimits | null
  loadedAt: number
}

export interface RollupRow {
  feature: string
  user_id: string | null
  day: string
  calls: number
  failed: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

const cache = new Map<string, OrgSpend>()
const warnedOn = new Map<string, string>()

/** Postgres/PostgREST codes meaning "that table or function does not exist (yet)". */
const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205'])

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return (err.code !== undefined && MISSING.has(err.code)) || /does not exist|schema cache/i.test(err.message ?? '')
}

/** `YYYY-MM` of "today" in a timezone. */
export function currentMonth(tz: string, now: Date = new Date()): string {
  return todayInTZ(now, tz).slice(0, 7)
}

/** UTC instants for the start and end of a local month, for `created_at` filters. */
export function monthRangeUtc(month: string, tz: string): { from: string; to: string } {
  const { first, nextFirst } = monthBounds(month)
  return { from: localDateAtToUTC(first, 0, 0, tz), to: localDateAtToUTC(nextFirst, 0, 0, tz) }
}

/** Budget limits row → pure limits (or null when the org has no row). */
export function limitsFromRow(row: { monthly_usd: number | string | null; per_user_monthly_usd: number | string | null; warn_pct: number } | null): BudgetLimits | null {
  if (!row) return null
  const num = (v: number | string | null) => (v === null || v === undefined ? null : Number(v))
  return { monthlyUsd: num(row.monthly_usd), perUserMonthlyUsd: num(row.per_user_monthly_usd), warnPct: row.warn_pct }
}

export async function loadRollup(orgId: string, month: string, tz: string, userId?: string): Promise<{ rows: RollupRow[]; available: boolean }> {
  const { from, to } = monthRangeUtc(month, tz)
  const { data, error } = await createAdminSupabaseClient().rpc('ai_usage_rollup', {
    p_org: orgId, p_from: from, p_to: to, p_tz: tz, p_user: userId ?? null,
  })
  if (error) {
    if (isMissingTable(error)) return { rows: [], available: false }
    throw error
  }
  return {
    available: true,
    rows: (data ?? []).map(r => ({
      feature: r.feature, user_id: r.user_id, day: String(r.day),
      calls: Number(r.calls), failed: Number(r.failed),
      input_tokens: Number(r.input_tokens), output_tokens: Number(r.output_tokens), cost_usd: Number(r.cost_usd),
    })),
  }
}

export async function loadBudgetRow(orgId: string) {
  const { data, error } = await createAdminSupabaseClient()
    .from('ai_budgets')
    .select('monthly_usd, per_user_monthly_usd, warn_pct')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return { row: null, available: false }
    throw error
  }
  return { row: data, available: true }
}

async function loadSpend(orgId: string): Promise<OrgSpend> {
  const supabase = createAdminSupabaseClient()
  const { data: org } = await supabase.from('organizations').select('timezone').eq('id', orgId).maybeSingle()
  const tz = (org as { timezone?: string | null } | null)?.timezone ?? DEFAULT_TZ
  const month = currentMonth(tz)
  const [{ row, available: budgetOk }, { rows, available: usageOk }] = await Promise.all([loadBudgetRow(orgId), loadRollup(orgId, month, tz)])
  const byUser = new Map<string, number>()
  let total = 0
  for (const r of rows) {
    total += r.cost_usd
    if (r.user_id) byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + r.cost_usd)
  }
  return { available: budgetOk && usageOk, month, tz, org: total, byUser, limits: limitsFromRow(row), loadedAt: Date.now() }
}

/** Month-to-date spend and limits for an organisation, cached for 60 s. Never throws. */
export async function getOrgSpend(orgId: string, opts: { fresh?: boolean } = {}): Promise<OrgSpend> {
  const hit = cache.get(orgId)
  const ttl = hit && !hit.available ? FAILED_TTL_MS : CACHE_TTL_MS
  if (!opts.fresh && hit && Date.now() - hit.loadedAt < ttl && hit.month === currentMonth(hit.tz)) return hit
  try {
    const next = await loadSpend(orgId)
    cache.set(orgId, next)
    return next
  } catch (err) {
    console.warn(JSON.stringify({ severity: 'WARNING', event: 'ai.budget.lookup_failed', orgId, error: err instanceof Error ? err.message : 'unknown' }))
    const failed: OrgSpend = { available: false, month: currentMonth(DEFAULT_TZ), tz: DEFAULT_TZ, org: 0, byUser: new Map(), limits: null, loadedAt: Date.now() }
    cache.set(orgId, failed)
    return failed
  }
}

/** Forget the cached spend/limits of an organisation (after the budget is edited). */
export function invalidateAiBudgetCache(orgId: string) {
  cache.delete(orgId)
}

async function guard(who: { orgId: string | null; userId: string | null; feature: string }): Promise<void> {
  if (!who.orgId) return
  const spend = await getOrgSpend(who.orgId)
  if (!spend.available || !spend.limits) return
  const decision = evaluateBudget({
    spentOrgUsd: spend.org,
    spentUserUsd: who.userId ? (spend.byUser.get(who.userId) ?? 0) : 0,
    limits: spend.limits,
  })
  if (!decision.allowed) {
    console.warn(JSON.stringify({
      severity: 'WARNING', event: 'ai.budget.blocked', orgId: who.orgId, userId: who.userId, feature: who.feature,
      scope: decision.blockedBy, spentOrgUsd: round(spend.org),
    }))
    throw new AiBudgetError(decision.blockedBy ?? 'org')
  }
  if (decision.warn) {
    const today = todayInTZ(new Date(), spend.tz)
    if (warnedOn.get(who.orgId) !== today) {
      warnedOn.set(who.orgId, today)
      console.warn(JSON.stringify({
        severity: 'WARNING', event: 'ai.budget.warn', orgId: who.orgId,
        usedPct: Math.round((decision.orgUsedFraction ?? 0) * 100), spentOrgUsd: round(spend.org), capUsd: spend.limits.monthlyUsd,
      }))
    }
  }
}

const round = (n: number) => Math.round(n * 100) / 100

let lastWriteWarning = 0

function record(r: AiUsageRecord): void {
  if (!r.orgId) return
  // Count it in the cached month-to-date right away: the 60 s cache would otherwise let a burst of
  // calls sail past a cap that the very first of them already used up.
  const hit = cache.get(r.orgId)
  if (hit && hit.available && hit.month === currentMonth(hit.tz)) {
    hit.org += r.costUsd
    if (r.userId) hit.byUser.set(r.userId, (hit.byUser.get(r.userId) ?? 0) + r.costUsd)
  }
  void createAdminSupabaseClient()
    .from('ai_usage')
    .insert({
      org_id: r.orgId, user_id: r.userId, feature: r.feature, model: r.model, tier: r.tier,
      input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: r.costUsd, latency_ms: r.latencyMs, ok: r.ok,
    })
    .then(({ error }) => {
      if (error && !isMissingTable(error) && Date.now() - lastWriteWarning > 60_000) {
        lastWriteWarning = Date.now()
        console.warn(JSON.stringify({ severity: 'WARNING', event: 'ai.usage.write_failed', code: error.code }))
      }
    })
}

/** Idempotent: wires the sink and the guard into the Gemini wrapper. */
export function registerAiMetering() {
  setAiUsageSink(record)
  setAiBudgetGuard(guard)
}

registerAiMetering()
