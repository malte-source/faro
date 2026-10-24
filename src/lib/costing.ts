/**
 * Intercompany costing — pure functions (no I/O) for the holding's cost model
 * (plan estructural §7). Shared by the router and unit tests.
 *
 *   Gobierno    revenue             prorrateo por facturación de la filial
 *   CoE         central             presupuesto central: se muestra, NO se reparte
 *   SSO         headcount           prorrateo por headcount
 *   Ventas SSO  base_plus_variable  base fija + variable sobre venta atribuida
 *
 * Decisions (documented because they are judgment calls the plan leaves open):
 *  - Fixed parts (revenue / headcount / the base of base_plus_variable) are split
 *    with the largest-remainder method so the lines add up EXACTLY to the pool
 *    amount, in the pool's minor unit (PYG has no decimals; other currencies 2).
 *  - base_plus_variable: the base (monthly_amount) is split by HEADCOUNT among the
 *    empresas; the variable part is variable_pct % × the empresa's attributed
 *    sales, rounded per empresa. The variable part is extra income for the
 *    provider: it is NOT part of monthly_amount, so a pool's "allocated" can
 *    exceed its monthly_amount. The plan says sales "generates billing": the
 *    base covers the structure, the variable aligns incentives.
 *  - If the driver total is zero (no revenue loaded, no headcount) nothing is
 *    allocated for that pool and a warning explains why — never divide by zero
 *    and never silently drop the cost.
 */

export type PoolLayer = 'gobierno' | 'coe' | 'sso'
export type PoolMethod = 'revenue' | 'headcount' | 'central' | 'base_plus_variable'

export interface CostPool {
  id: string
  name: string
  layer: PoolLayer
  method: PoolMethod
  monthlyAmount: number
  currency: string
  /** % over attributed sales (base_plus_variable only). */
  variablePct: number
}

export interface EmpresaMetrics {
  workspaceId: string
  name: string
  revenue: number
  headcount: number
  attributedSales: number
}

export interface AllocationLine {
  poolId: string
  poolName: string
  method: PoolMethod
  workspaceId: string
  amount: number
  driverValue: number
  /** 0–1 share of the fixed part (or of the variable base for base_plus_variable). */
  driverShare: number
  currency: string
  explanation: string
}

export interface PoolResult {
  poolId: string
  poolName: string
  layer: PoolLayer
  method: PoolMethod
  currency: string
  monthlyAmount: number
  /** CoE-style pool: shown as "presupuesto central", never charged. */
  central: boolean
  lines: AllocationLine[]
  /** Sum of the lines (fixed part + variable part). */
  allocated: number
  /** Part of monthly_amount that could not be allocated (driver total = 0). */
  unallocated: number
  warning: string | null
}

export interface AllocationResult {
  pools: PoolResult[]
  /** currency → workspaceId → amount charged (sum over pools). */
  totalsByEmpresa: Record<string, Record<string, number>>
  /** currency → total charged. */
  totalsByCurrency: Record<string, number>
  /** currency → total of central (not charged) budgets. */
  centralByCurrency: Record<string, number>
  /** Empresas with every metric at 0 — probably not loaded yet. */
  empresasWithoutMetrics: string[]
  warnings: string[]
}

/** Minor-unit decimals per currency (PYG, JPY, CLP… have none). */
export function currencyDecimals(currency: string): number {
  return ['PYG', 'JPY', 'CLP', 'KRW', 'VND'].includes(currency.toUpperCase()) ? 0 : 2
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

/**
 * Split `total` proportionally to `weights`, in units of 10^-decimals, with the
 * largest-remainder method: amounts add up exactly to `total` (rounded to the
 * unit). Returns null when the weights add up to zero. Ties on the remainder
 * go to the larger weight, then to the earlier index, so the result is stable.
 */
export function allocateProportional(total: number, weights: number[], decimals: number): number[] | null {
  const sum = weights.reduce((a, w) => a + w, 0)
  if (!(sum > 0)) return null
  const f = 10 ** decimals
  const units = Math.round(total * f)
  const exact = weights.map(w => (units * w) / sum)
  const floors = exact.map(x => Math.floor(x))
  let remaining = units - floors.reduce((a, x) => a + x, 0)
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x), w: weights[i] }))
    .sort((a, b) => b.rem - a.rem || b.w - a.w || a.i - b.i)
  const out = [...floors]
  for (const { i } of order) {
    if (remaining <= 0) break
    if (weights[i] <= 0) continue
    out[i] += 1
    remaining -= 1
  }
  return out.map(u => u / f)
}

const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`
const num = (x: number) => new Intl.NumberFormat('es-PY', { maximumFractionDigits: 2 }).format(x)

/** Allocate every pool among the (charged) empresas for one period. Inactive pools must be filtered out by the caller. */
export function allocate(pools: CostPool[], empresas: EmpresaMetrics[]): AllocationResult {
  const results: PoolResult[] = []
  const warnings: string[] = []

  for (const pool of pools) {
    const decimals = currencyDecimals(pool.currency)
    const base: PoolResult = {
      poolId: pool.id,
      poolName: pool.name,
      layer: pool.layer,
      method: pool.method,
      currency: pool.currency,
      monthlyAmount: pool.monthlyAmount,
      central: pool.method === 'central',
      lines: [],
      allocated: 0,
      unallocated: 0,
      warning: null,
    }

    if (pool.method === 'central') {
      results.push(base)
      continue
    }

    const driverOf = (e: EmpresaMetrics) => (pool.method === 'revenue' ? e.revenue : e.headcount)
    const driverLabel = pool.method === 'revenue' ? 'facturación' : 'headcount'
    const weights = empresas.map(driverOf)
    const split = allocateProportional(pool.monthlyAmount, weights, decimals)
    const weightSum = weights.reduce((a, w) => a + w, 0)

    const lines: AllocationLine[] = []
    if (split) {
      empresas.forEach((e, i) => {
        if (split[i] === 0 && weights[i] === 0) return
        const share = weights[i] / weightSum
        lines.push({
          poolId: pool.id,
          poolName: pool.name,
          method: pool.method,
          workspaceId: e.workspaceId,
          amount: split[i],
          driverValue: weights[i],
          driverShare: share,
          currency: pool.currency,
          explanation: `${pct(share)} del total de ${driverLabel} (${num(weights[i])} de ${num(weightSum)})`,
        })
      })
    } else if (pool.monthlyAmount > 0) {
      base.warning = `«${pool.name}» no se reparte: no hay ${driverLabel} cargado este mes.`
      base.unallocated = pool.monthlyAmount
      warnings.push(base.warning)
    }

    if (pool.method === 'base_plus_variable' && pool.variablePct > 0) {
      for (const e of empresas) {
        if (!(e.attributedSales > 0)) continue
        const variable = roundTo((pool.variablePct / 100) * e.attributedSales, decimals)
        if (variable <= 0) continue
        const existing = lines.find(l => l.workspaceId === e.workspaceId)
        const detail = `variable ${num(pool.variablePct)} % × ventas atribuidas ${num(e.attributedSales)} = ${num(variable)}`
        if (existing) {
          existing.amount = roundTo(existing.amount + variable, decimals)
          existing.explanation = `base: ${existing.explanation}; ${detail}`
        } else {
          lines.push({
            poolId: pool.id,
            poolName: pool.name,
            method: pool.method,
            workspaceId: e.workspaceId,
            amount: variable,
            driverValue: e.attributedSales,
            driverShare: 0,
            currency: pool.currency,
            explanation: detail,
          })
        }
      }
    }

    base.lines = lines
    base.allocated = roundTo(lines.reduce((a, l) => a + l.amount, 0), decimals)
    results.push(base)
  }

  const totalsByEmpresa: Record<string, Record<string, number>> = {}
  const totalsByCurrency: Record<string, number> = {}
  const centralByCurrency: Record<string, number> = {}
  for (const r of results) {
    if (r.central) {
      centralByCurrency[r.currency] = (centralByCurrency[r.currency] ?? 0) + r.monthlyAmount
      continue
    }
    const dec = currencyDecimals(r.currency)
    const perCurrency = (totalsByEmpresa[r.currency] ??= {})
    for (const l of r.lines) {
      perCurrency[l.workspaceId] = roundTo((perCurrency[l.workspaceId] ?? 0) + l.amount, dec)
      totalsByCurrency[r.currency] = roundTo((totalsByCurrency[r.currency] ?? 0) + l.amount, dec)
    }
  }

  const empresasWithoutMetrics = empresas
    .filter(e => e.revenue === 0 && e.headcount === 0 && e.attributedSales === 0)
    .map(e => e.workspaceId)
  if (empresasWithoutMetrics.length > 0 && empresas.length > 0) {
    warnings.push(
      empresasWithoutMetrics.length === empresas.length
        ? 'No hay datos del mes cargados para ninguna empresa.'
        : `Sin datos del mes: ${empresasWithoutMetrics.length} de ${empresas.length} empresas.`,
    )
  }

  return { pools: results, totalsByEmpresa, totalsByCurrency, centralByCurrency, empresasWithoutMetrics, warnings }
}

// ── CSV export ──────────────────────────────────────────────────────────────

export const METHOD_LABEL: Record<PoolMethod, string> = {
  revenue: 'Por facturación',
  headcount: 'Por headcount',
  central: 'Presupuesto central',
  base_plus_variable: 'Base + variable sobre venta',
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export interface CsvLine {
  empresa: string
  poolName: string
  method: string
  driverShare: number
  amount: number
  currency: string
  explanation: string
}

/** CSV (comma separated, UTF-8 BOM-friendly) of a charge run, one row per empresa × concepto. */
export function chargesToCsv(period: string, lines: CsvLine[]): string {
  const header = ['Periodo', 'Empresa', 'Concepto', 'Método', 'Participación %', 'Monto', 'Moneda', 'Explicación']
  const rows = lines.map(l =>
    [period, l.empresa, l.poolName, l.method, (l.driverShare * 100).toFixed(2), l.amount, l.currency, l.explanation].map(csvCell).join(','),
  )
  return [header.join(','), ...rows].join('\r\n')
}

/** 'YYYY-MM' of the month before `period`. */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Parse a number typed or pasted by a person: "1.234.567", "1 234 567",
 * "1.234,56", "1,234.56", "12,5". The last separator is the decimal one when
 * both appear; a lone "." or "," followed by exactly 3 digits is a thousands
 * separator (es-PY style), otherwise it is the decimal point. Returns null for
 * empty or non-numeric input.
 */
export function parseNumber(input: string): number | null {
  const s = input.replace(/[^\d.,-]/g, '').trim()
  if (!s || s === '-') return null
  const negative = s.startsWith('-')
  const body = s.replace(/-/g, '')
  const lastDot = body.lastIndexOf('.')
  const lastComma = body.lastIndexOf(',')
  let normalized: string
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? '.' : ','
    const thousandsSep = decimalSep === '.' ? ',' : '.'
    normalized = body.split(thousandsSep).join('').replace(decimalSep, '.')
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ','
    const parts = body.split(sep)
    const last = parts[parts.length - 1]
    // several separators, or exactly 3 digits after a single one → thousands
    normalized = parts.length > 2 || last.length === 3 ? parts.join('') : `${parts[0]}.${last}`
  } else {
    normalized = body
  }
  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}
