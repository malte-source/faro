import { describe, expect, it } from 'vitest'
import { AiBudgetError, BUDGET_EXHAUSTED_MESSAGE, evaluateBudget, monthBounds, projectMonthEnd } from './ai-budget'

const limits = (over: Partial<{ monthlyUsd: number | null; perUserMonthlyUsd: number | null; warnPct: number }> = {}) => ({
  monthlyUsd: 100, perUserMonthlyUsd: null, warnPct: 80, ...over,
})

describe('evaluateBudget', () => {
  it('allows everything without a budget row', () => {
    expect(evaluateBudget({ spentOrgUsd: 9999, spentUserUsd: 9999, limits: null })).toEqual({
      allowed: true, blockedBy: null, warn: false, orgUsedFraction: null,
    })
  })

  it('allows and does not warn below the warning threshold', () => {
    const d = evaluateBudget({ spentOrgUsd: 50, spentUserUsd: 5, limits: limits() })
    expect(d).toMatchObject({ allowed: true, warn: false, orgUsedFraction: 0.5 })
  })

  it('allows but warns from warnPct of the org cap', () => {
    expect(evaluateBudget({ spentOrgUsd: 80, spentUserUsd: 0, limits: limits() })).toMatchObject({ allowed: true, warn: true })
    expect(evaluateBudget({ spentOrgUsd: 79.99, spentUserUsd: 0, limits: limits() }).warn).toBe(false)
  })

  it('blocks when the org cap is reached', () => {
    expect(evaluateBudget({ spentOrgUsd: 100, spentUserUsd: 0, limits: limits() })).toMatchObject({ allowed: false, blockedBy: 'org' })
    expect(evaluateBudget({ spentOrgUsd: 150, spentUserUsd: 0, limits: limits() }).blockedBy).toBe('org')
  })

  it('blocks one person at their own cap while the org still has room', () => {
    const l = limits({ perUserMonthlyUsd: 10 })
    expect(evaluateBudget({ spentOrgUsd: 30, spentUserUsd: 10, limits: l })).toMatchObject({ allowed: false, blockedBy: 'user' })
    expect(evaluateBudget({ spentOrgUsd: 30, spentUserUsd: 9.99, limits: l }).allowed).toBe(true)
  })

  it('the org cap wins when both are exceeded', () => {
    const l = limits({ perUserMonthlyUsd: 10 })
    expect(evaluateBudget({ spentOrgUsd: 120, spentUserUsd: 50, limits: l }).blockedBy).toBe('org')
  })

  it('a cap of 0 switches AI off; null is unlimited', () => {
    expect(evaluateBudget({ spentOrgUsd: 0, spentUserUsd: 0, limits: limits({ monthlyUsd: 0 }) }).allowed).toBe(false)
    expect(evaluateBudget({ spentOrgUsd: 1e6, spentUserUsd: 1e6, limits: limits({ monthlyUsd: null, perUserMonthlyUsd: null }) }).allowed).toBe(true)
  })
})

describe('AiBudgetError', () => {
  it('carries the user-facing Spanish message and the scope', () => {
    const e = new AiBudgetError('user')
    expect(e.message).toBe(BUDGET_EXHAUSTED_MESSAGE)
    expect(e.scope).toBe('user')
    expect(e).toBeInstanceOf(Error)
  })
})

describe('monthBounds', () => {
  it('knows month lengths, leap years and the December roll-over', () => {
    expect(monthBounds('2026-10')).toEqual({ first: '2026-10-01', nextFirst: '2026-11-01', days: 31 })
    expect(monthBounds('2026-02').days).toBe(28)
    expect(monthBounds('2028-02').days).toBe(29)
    expect(monthBounds('2026-12').nextFirst).toBe('2027-01-01')
  })
})

describe('projectMonthEnd', () => {
  it('extrapolates the run rate inside the current month', () => {
    // $10 after 10 days of a 31-day month → $31
    expect(projectMonthEnd({ spentUsd: 10, today: '2026-10-10', month: '2026-10' })).toBe(31)
  })

  it('a past month is just what was spent; a future month is zero', () => {
    expect(projectMonthEnd({ spentUsd: 42, today: '2026-11-15', month: '2026-10' })).toBe(42)
    expect(projectMonthEnd({ spentUsd: 0, today: '2026-10-15', month: '2026-11' })).toBe(0)
  })
})
