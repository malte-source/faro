import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny fake of the admin Supabase client — only what ai-usage.ts touches.
const db = vi.hoisted(() => ({
  org: { timezone: 'America/Asuncion' } as { timezone: string } | null,
  budget: null as null | { monthly_usd: number | null; per_user_monthly_usd: number | null; warn_pct: number },
  budgetError: null as null | { code: string; message: string },
  rollup: [] as Array<Record<string, unknown>>,
  rpcError: null as null | { code: string; message: string },
  inserted: [] as Array<Record<string, unknown>>,
  rpcCalls: 0,
}))

vi.mock('@/lib/supabase', () => ({
  createAdminSupabaseClient: () => ({
    from(table: string) {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => (table === 'ai_budgets' ? { data: db.budget, error: db.budgetError } : { data: db.org, error: null }) }) }),
        insert: (row: Record<string, unknown>) => {
          db.inserted.push(row)
          return Promise.resolve({ error: null }).then(r => r)
        },
      }
    },
    rpc: async () => {
      db.rpcCalls++
      return { data: db.rollup, error: db.rpcError }
    },
  }),
}))

import { generateFlash, setGeminiBackendForTests, type GeminiBackend } from '@/lib/gemini'
import { AiBudgetError } from '@/lib/ai-budget'
import { runWithAiContext } from '@/lib/ai-context'
import { estimateCostUsd } from '@/lib/ai-pricing'
import { invalidateAiBudgetCache, limitsFromRow, monthRangeUtc } from './ai-usage'

const USAGE = { inputTokens: 2000, outputTokens: 500, totalTokens: 2500 }
const CALL_COST = estimateCostUsd({ model: 'gemini-3.8-flash', inputTokens: 2000, outputTokens: 500 })
const day = new Date().toISOString().slice(0, 10)
const row = (userId: string | null, cost: number) => ({ feature: 'x.y', user_id: userId, day, calls: 1, failed: 0, input_tokens: 1, output_tokens: 1, cost_usd: cost })

describe('AI budget guard + usage sink (fake database)', () => {
  let generate: ReturnType<typeof vi.fn>
  let orgSeq = 0
  const org = () => `org-${++orgSeq}`

  const callAs = (orgId: string, userId: string | null = 'user-1') =>
    runWithAiContext({ orgId, userId, path: 'tasks.parseAndCreate' }, () => generateFlash('hola'))

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    generate = vi.fn().mockResolvedValue({ text: 'ok', usage: USAGE })
    setGeminiBackendForTests({ generate: generate as GeminiBackend['generate'], chat: vi.fn() })
    Object.assign(db, { org: { timezone: 'America/Asuncion' }, budget: null, budgetError: null, rollup: [], rpcError: null, inserted: [], rpcCalls: 0 })
  })

  afterEach(() => {
    setGeminiBackendForTests(null)
    vi.restoreAllMocks()
  })

  it('without a budget row every call goes through and is recorded with its cost', async () => {
    const id = org()
    await expect(callAs(id)).resolves.toBe('ok')
    await Promise.resolve()
    expect(db.inserted).toHaveLength(1)
    expect(db.inserted[0]).toMatchObject({ org_id: id, user_id: 'user-1', feature: 'tasks.parseAndCreate', model: 'gemini-3.8-flash', tier: 'flash', input_tokens: 2000, output_tokens: 500, ok: true })
    expect(db.inserted[0].cost_usd).toBe(CALL_COST)
  })

  it('blocks BEFORE calling the model once the org cap is spent', async () => {
    db.budget = { monthly_usd: 10, per_user_monthly_usd: null, warn_pct: 80 }
    db.rollup = [row('user-2', 6), row('user-3', 4)]
    await expect(callAs(org())).rejects.toBeInstanceOf(AiBudgetError)
    expect(generate).not.toHaveBeenCalled()
    expect(db.inserted).toHaveLength(0)
  })

  it('blocks one person at their personal cap while others keep working', async () => {
    db.budget = { monthly_usd: 100, per_user_monthly_usd: 5, warn_pct: 80 }
    db.rollup = [row('user-1', 5), row('user-2', 1)]
    const id = org()
    await expect(callAs(id, 'user-1')).rejects.toMatchObject({ scope: 'user' })
    await expect(callAs(id, 'user-2')).resolves.toBe('ok')
  })

  it('a cap of 0 switches the AI off', async () => {
    db.budget = { monthly_usd: 0, per_user_monthly_usd: null, warn_pct: 80 }
    await expect(callAs(org())).rejects.toBeInstanceOf(AiBudgetError)
  })

  it('FAILS OPEN when the tables do not exist yet (SQL not applied)', async () => {
    db.budgetError = { code: '42P01', message: 'relation "ai_budgets" does not exist' }
    db.rpcError = { code: 'PGRST202', message: 'Could not find the function' }
    await expect(callAs(org())).resolves.toBe('ok')
  })

  it('FAILS OPEN on an unexpected database error too', async () => {
    db.rpcError = { code: 'XX000', message: 'boom' }
    await expect(callAs(org())).resolves.toBe('ok')
  })

  it('counts a call in the cached spend immediately, so a burst cannot sail past the cap', async () => {
    const cap = 1
    db.budget = { monthly_usd: cap, per_user_monthly_usd: null, warn_pct: 80 }
    db.rollup = [row('user-9', cap - CALL_COST / 2)] // room for exactly one more call
    const id = org()
    await expect(callAs(id)).resolves.toBe('ok') // spent < cap → allowed
    await expect(callAs(id)).rejects.toBeInstanceOf(AiBudgetError) // cached total now ≥ cap, no refetch needed
    expect(db.rpcCalls).toBe(1)
  })

  it('a refreshed cache sees an edited budget', async () => {
    db.budget = { monthly_usd: 10, per_user_monthly_usd: null, warn_pct: 80 }
    db.rollup = [row('user-2', 10)]
    const id = org()
    await expect(callAs(id)).rejects.toBeInstanceOf(AiBudgetError)
    db.budget = { monthly_usd: 50, per_user_monthly_usd: null, warn_pct: 80 }
    invalidateAiBudgetCache(id)
    await expect(callAs(id)).resolves.toBe('ok')
  })

  it('logs one warning per day when the warn threshold is crossed (and still allows the call)', async () => {
    db.budget = { monthly_usd: 10, per_user_monthly_usd: null, warn_pct: 80 }
    db.rollup = [row('user-2', 8.5)]
    const warn = vi.spyOn(console, 'warn')
    const id = org()
    await callAs(id)
    await callAs(id)
    const warns = warn.mock.calls.map(c => String(c[0])).filter(l => l.includes('ai.budget.warn'))
    expect(warns).toHaveLength(1)
  })
})

describe('helpers', () => {
  it('limitsFromRow converts numeric strings and keeps null as "no cap"', () => {
    expect(limitsFromRow(null)).toBeNull()
    expect(limitsFromRow({ monthly_usd: '25.50', per_user_monthly_usd: null, warn_pct: 90 })).toEqual({ monthlyUsd: 25.5, perUserMonthlyUsd: null, warnPct: 90 })
  })

  it('monthRangeUtc spans the local month (Asunción is UTC−3/−4, so local midnight is 03:00/04:00 UTC)', () => {
    const { from, to } = monthRangeUtc('2026-10', 'America/Asuncion')
    expect(new Date(from).getTime()).toBeLessThan(new Date(to).getTime())
    expect(from.startsWith('2026-10-01T0')).toBe(true)
    expect(to.startsWith('2026-11-01T0')).toBe(true)
  })
})
