import { currencyDecimals, type PoolLayer } from '@/lib/costing'

export function fmtMoney(n: number, currency = 'PYG'): string {
  const d = currencyDecimals(currency)
  return new Intl.NumberFormat('es-PY', { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(n)
}

export function fmtInt(n: number): string {
  return new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(n)
}

export function fmtPct(share: number): string {
  return `${(share * 100).toFixed(1).replace('.', ',')} %`
}

/** 'YYYY-MM' of the current month. */
export function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 'YYYY-MM' shifted by `delta` months. */
export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const LAYER_LABEL: Record<PoolLayer, string> = {
  gobierno: 'Gobierno',
  coe: 'Centro de Excelencia',
  sso: 'Servicios Compartidos',
}

export const LAYER_BADGE: Record<PoolLayer, 'night' | 'warning' | 'default'> = {
  gobierno: 'night',
  coe: 'warning',
  sso: 'default',
}

export const METHOD_HELP: Record<string, string> = {
  revenue: 'Se reparte según la facturación de cada empresa.',
  headcount: 'Se reparte según el headcount de cada empresa.',
  central: 'Presupuesto central: se muestra pero no se reparte entre empresas.',
  base_plus_variable: 'Base fija repartida por headcount, más un % sobre la venta atribuida de cada empresa.',
}
