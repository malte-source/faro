import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { featureLabel } from '@/lib/ai-features'
import { monthBounds, projectMonthEnd } from '@/lib/ai-budget'
import { upcomingPriceChanges } from '@/lib/ai-pricing'
import { addDays, todayInTZ } from '@/lib/tz'
import type { createAdminSupabaseClient } from '@/lib/supabase'
import { isDirection } from '@/server/multiempresa'
import { getOrgSpend, invalidateAiBudgetCache, limitsFromRow, loadRollup } from '@/server/ai-usage'

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

interface Ctx {
  supabase: ReturnType<typeof createAdminSupabaseClient>
  me: { id: string; org_id: string; role: string }
  activeOrg: { id: string } | null
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * Month summary for the AI meter. Dirección sees the whole grupo (by feature, by
 * person, by day); everyone else sees only their own calls and their personal cap.
 */
async function buildSummary(ctx: Ctx, month: string | undefined, scope: 'org' | 'me') {
  const org = ctx.activeOrg
  if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'No hay un grupo activo.' })

  const spend = await getOrgSpend(org.id, { fresh: true })
  const tz = spend.tz
  const picked = month ?? spend.month
  const today = todayInTZ(new Date(), tz)
  const { first, nextFirst, days } = monthBounds(picked)

  const { rows, available } = await loadRollup(org.id, picked, tz, scope === 'me' ? ctx.me.id : undefined)

  const byFeature = new Map<string, { calls: number; failed: number; costUsd: number; tokens: number }>()
  const byUser = new Map<string, { calls: number; costUsd: number }>()
  const byDay = new Map<string, { calls: number; costUsd: number }>()
  let totalCost = 0, totalCalls = 0, totalFailed = 0, totalTokens = 0

  for (const r of rows) {
    totalCost += r.cost_usd
    totalCalls += r.calls
    totalFailed += r.failed
    totalTokens += r.input_tokens + r.output_tokens

    const f = byFeature.get(r.feature) ?? { calls: 0, failed: 0, costUsd: 0, tokens: 0 }
    f.calls += r.calls; f.failed += r.failed; f.costUsd += r.cost_usd; f.tokens += r.input_tokens + r.output_tokens
    byFeature.set(r.feature, f)

    const uKey = r.user_id ?? 'system'
    const u = byUser.get(uKey) ?? { calls: 0, costUsd: 0 }
    u.calls += r.calls; u.costUsd += r.cost_usd
    byUser.set(uKey, u)

    const d = byDay.get(r.day) ?? { calls: 0, costUsd: 0 }
    d.calls += r.calls; d.costUsd += r.cost_usd
    byDay.set(r.day, d)
  }

  // Every day of the month up to today (or the whole month if it is over), zeros included.
  const lastDay = today >= nextFirst ? addDays(nextFirst, -1) : today < first ? first : today
  const daily: Array<{ day: string; calls: number; costUsd: number }> = []
  for (let d = first; d <= lastDay && daily.length < 31; d = addDays(d, 1)) {
    const v = byDay.get(d)
    daily.push({ day: d, calls: v?.calls ?? 0, costUsd: round6(v?.costUsd ?? 0) })
  }

  let people: Array<{ userId: string | null; name: string; calls: number; costUsd: number }> = []
  if (scope === 'org') {
    const ids = Array.from(byUser.keys()).filter(k => k !== 'system')
    const { data: users } = ids.length
      ? await ctx.supabase.from('users').select('id, name').in('id', ids)
      : { data: [] as Array<{ id: string; name: string }> }
    const nameOf = new Map((users ?? []).map(u => [u.id, u.name]))
    people = Array.from(byUser.entries())
      .map(([id, v]) => ({
        userId: id === 'system' ? null : id,
        name: id === 'system' ? 'Automático (sin persona)' : (nameOf.get(id) ?? 'Alguien'),
        calls: v.calls,
        costUsd: round6(v.costUsd),
      }))
      .sort((a, b) => b.costUsd - a.costUsd)
  }

  const cap = spend.limits?.monthlyUsd ?? null
  return {
    /** false until 20261026_ai_usage.sql is applied: the page shows a setup note instead of zeros. */
    available,
    scope,
    month: picked,
    days,
    today,
    totals: { costUsd: round6(totalCost), calls: totalCalls, failed: totalFailed, tokens: totalTokens },
    projectedUsd: round6(projectMonthEnd({ spentUsd: totalCost, today, month: picked })),
    budget: {
      monthlyUsd: spend.limits?.monthlyUsd ?? null,
      perUserMonthlyUsd: spend.limits?.perUserMonthlyUsd ?? null,
      warnPct: spend.limits?.warnPct ?? 80,
      hasRow: spend.limits !== null,
      usedFraction: cap === null ? null : cap === 0 ? 1 : totalCost / cap,
    },
    byFeature: Array.from(byFeature.entries())
      .map(([feature, v]) => ({ feature, label: featureLabel(feature), calls: v.calls, failed: v.failed, costUsd: round6(v.costUsd), tokens: v.tokens }))
      .sort((a, b) => b.costUsd - a.costUsd),
    people,
    daily,
    priceChanges: upcomingPriceChanges(today),
  }
}

export const aiUsageRouter = createTRPCRouter({
  /** The meter. Dirección: the whole grupo. Anyone else: only their own usage. */
  summary: protectedProcedure
    .input(z.object({ month: MONTH.optional() }).optional())
    .query(({ ctx, input }) => buildSummary(ctx as unknown as Ctx, input?.month, isDirection(ctx) ? 'org' : 'me')),

  /** Only my own calls this month (works for everyone, Dirección included). */
  myUsage: protectedProcedure
    .input(z.object({ month: MONTH.optional() }).optional())
    .query(({ ctx, input }) => buildSummary(ctx as unknown as Ctx, input?.month, 'me')),

  /** Monthly caps for the grupo and per person (null = no cap, 0 = AI off). Dirección only. */
  setBudget: protectedProcedure
    .input(z.object({
      monthlyUsd: z.number().min(0).max(100_000).nullable(),
      perUserMonthlyUsd: z.number().min(0).max(100_000).nullable(),
      warnPct: z.number().int().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!isDirection(ctx)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo Dirección puede fijar el presupuesto de IA.' })
      }
      const org = ctx.activeOrg
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'No hay un grupo activo.' })

      const { data, error } = await ctx.supabase
        .from('ai_budgets')
        .upsert(
          {
            org_id: org.id,
            monthly_usd: input.monthlyUsd,
            per_user_monthly_usd: input.perUserMonthlyUsd,
            warn_pct: input.warnPct,
            updated_by: ctx.me.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'org_id' },
        )
        .select('monthly_usd, per_user_monthly_usd, warn_pct')
        .single()
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') {
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Falta aplicar la migración del medidor de IA en Supabase (20261026_ai_usage.sql).' })
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message })
      }
      invalidateAiBudgetCache(org.id)
      return limitsFromRow(data)
    }),
})
