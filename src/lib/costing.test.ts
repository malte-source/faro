import { describe, expect, it } from 'vitest'
import {
  allocate,
  allocateProportional,
  chargesToCsv,
  parseNumber,
  previousPeriod,
  type CostPool,
  type EmpresaMetrics,
} from './costing'

const empresas: EmpresaMetrics[] = [
  { workspaceId: 'crew', name: 'The Crew', revenue: 600_000_000, headcount: 10, attributedSales: 200_000_000 },
  { workspaceId: 'tec', name: 'Tecnología', revenue: 300_000_000, headcount: 5, attributedSales: 50_000_000 },
  { workspaceId: 'log', name: 'Logística', revenue: 100_000_000, headcount: 5, attributedSales: 0 },
]

const pool = (over: Partial<CostPool>): CostPool => ({
  id: 'p1', name: 'Pool', layer: 'sso', method: 'headcount', monthlyAmount: 1_000_000, currency: 'PYG', variablePct: 0, ...over,
})

const lineOf = (r: ReturnType<typeof allocate>, poolId: string, ws: string) =>
  r.pools.find(p => p.poolId === poolId)!.lines.find(l => l.workspaceId === ws)

describe('allocateProportional', () => {
  it('adds up exactly to the total (largest remainder)', () => {
    const out = allocateProportional(100, [1, 1, 1], 0)!
    expect(out.reduce((a, x) => a + x, 0)).toBe(100)
    expect(out.sort()).toEqual([33, 33, 34])
  })
  it('keeps two decimals for non-PYG currencies', () => {
    const out = allocateProportional(100, [1, 1, 1], 2)!
    expect(out.reduce((a, x) => a + x, 0)).toBeCloseTo(100, 6)
    expect(out.sort()).toEqual([33.33, 33.33, 33.34])
  })
  it('returns null when there is nothing to split by', () => {
    expect(allocateProportional(100, [0, 0], 0)).toBeNull()
  })
  it('never gives a share to a zero weight', () => {
    expect(allocateProportional(10, [0, 1, 0], 0)).toEqual([0, 10, 0])
  })
})

describe('allocate — Gobierno por facturación', () => {
  const r = allocate([pool({ id: 'gob', layer: 'gobierno', method: 'revenue', monthlyAmount: 10_000_000 })], empresas)
  it('charges each empresa its share of revenue', () => {
    expect(lineOf(r, 'gob', 'crew')!.amount).toBe(6_000_000)
    expect(lineOf(r, 'gob', 'tec')!.amount).toBe(3_000_000)
    expect(lineOf(r, 'gob', 'log')!.amount).toBe(1_000_000)
  })
  it('totals match the pool', () => {
    expect(r.totalsByCurrency.PYG).toBe(10_000_000)
    expect(r.pools[0].unallocated).toBe(0)
  })
})

describe('allocate — SSO por headcount', () => {
  it('splits by headcount with exact rounding', () => {
    const r = allocate([pool({ id: 'sso', monthlyAmount: 1_000_001 })], empresas)
    const amounts = r.pools[0].lines.map(l => l.amount)
    expect(amounts.reduce((a, x) => a + x, 0)).toBe(1_000_001)
    // exact shares 500.000,5 / 250.000,25 / 250.000,25 → the odd guaraní goes to the largest remainder
    expect(lineOf(r, 'sso', 'crew')!.amount).toBe(500_001)
    expect(lineOf(r, 'sso', 'tec')!.amount).toBe(250_000)
    expect(lineOf(r, 'sso', 'log')!.amount).toBe(250_000)
  })
  it('explains the driver in words', () => {
    const r = allocate([pool({ id: 'sso' })], empresas)
    expect(lineOf(r, 'sso', 'crew')!.explanation).toContain('headcount')
  })
})

describe('allocate — presupuesto central', () => {
  const r = allocate([pool({ id: 'coe', layer: 'coe', method: 'central', monthlyAmount: 5_000_000 })], empresas)
  it('is shown as central budget and never charged', () => {
    expect(r.pools[0].central).toBe(true)
    expect(r.pools[0].lines).toHaveLength(0)
    expect(r.totalsByCurrency.PYG ?? 0).toBe(0)
    expect(r.centralByCurrency.PYG).toBe(5_000_000)
  })
})

describe('allocate — Ventas: base + variable', () => {
  const r = allocate(
    [pool({ id: 'ventas', method: 'base_plus_variable', monthlyAmount: 2_000_000, variablePct: 5 })],
    empresas,
  )
  it('base by headcount plus variable % of attributed sales', () => {
    // base: 10/20, 5/20, 5/20 of 2.000.000 → 1.000.000 / 500.000 / 500.000
    // variable: 5% × 200M = 10.000.000 ; 5% × 50M = 2.500.000 ; 0
    expect(lineOf(r, 'ventas', 'crew')!.amount).toBe(11_000_000)
    expect(lineOf(r, 'ventas', 'tec')!.amount).toBe(3_000_000)
    expect(lineOf(r, 'ventas', 'log')!.amount).toBe(500_000)
  })
  it('allocated can exceed monthly_amount because the variable is extra income', () => {
    expect(r.pools[0].allocated).toBe(14_500_000)
  })
  it('charges the variable to an empresa with sales but no headcount', () => {
    const only = allocate(
      [pool({ id: 'v', method: 'base_plus_variable', monthlyAmount: 100, variablePct: 10 })],
      [{ workspaceId: 'a', name: 'A', revenue: 0, headcount: 0, attributedSales: 1000 }],
    )
    expect(only.pools[0].lines[0].amount).toBe(100)
    expect(only.pools[0].warning).toContain('no se reparte')
  })
})

describe('allocate — edge cases', () => {
  it('warns and allocates nothing when the driver total is zero', () => {
    const zero = empresas.map(e => ({ ...e, revenue: 0 }))
    const r = allocate([pool({ id: 'gob', method: 'revenue', monthlyAmount: 1000 })], zero)
    expect(r.pools[0].lines).toHaveLength(0)
    expect(r.pools[0].unallocated).toBe(1000)
    expect(r.pools[0].warning).toContain('facturación')
    expect(r.warnings.length).toBeGreaterThan(0)
  })
  it('reports empresas with no metrics loaded', () => {
    const r = allocate([pool({})], [...empresas, { workspaceId: 'new', name: 'Nueva', revenue: 0, headcount: 0, attributedSales: 0 }])
    expect(r.empresasWithoutMetrics).toEqual(['new'])
    expect(r.warnings.some(w => w.includes('1 de 4'))).toBe(true)
  })
  it('keeps currencies apart', () => {
    const r = allocate(
      [pool({ id: 'a', monthlyAmount: 1000 }), pool({ id: 'b', currency: 'USD', monthlyAmount: 100 })],
      empresas,
    )
    expect(r.totalsByCurrency.PYG).toBe(1000)
    expect(r.totalsByCurrency.USD).toBeCloseTo(100, 6)
  })
})

describe('helpers', () => {
  it('previousPeriod crosses the year boundary', () => {
    expect(previousPeriod('2026-03')).toBe('2026-02')
    expect(previousPeriod('2026-01')).toBe('2025-12')
  })
  it('chargesToCsv escapes commas and quotes', () => {
    const csv = chargesToCsv('2026-10', [
      { empresa: 'Agencia, S.A.', poolName: 'Gobierno', method: 'Por facturación', driverShare: 0.5, amount: 1000, currency: 'PYG', explanation: 'dijo "50 %"' },
    ])
    const [header, row] = csv.split('\r\n')
    expect(header.startsWith('Periodo,Empresa')).toBe(true)
    expect(row).toContain('"Agencia, S.A."')
    expect(row).toContain('"dijo ""50 %"""')
    expect(row).toContain('50.00')
  })
})

describe('parseNumber', () => {
  it.each([
    ['1.234.567', 1234567],
    ['1 234 567', 1234567],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['12,5', 12.5],
    ['12.5', 12.5],
    ['1.234', 1234],
    ['Gs. 600.000.000', 600000000],
    ['0', 0],
  ])('reads %s as %d', (raw, expected) => {
    expect(parseNumber(raw)).toBe(expected)
  })
  it('returns null for empty or non-numeric text', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
  })
})
