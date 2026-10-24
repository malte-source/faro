const USD_BIG = new Intl.NumberFormat('es', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const USD_SMALL = new Intl.NumberFormat('es', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 4, maximumFractionDigits: 4 })
const INT = new Intl.NumberFormat('es')

/** US$ 12,34 — cents for normal amounts, 4 decimals below one dollar (a single call costs fractions of a cent). */
export function formatUsd(n: number): string {
  return Math.abs(n) >= 1 || n === 0 ? USD_BIG.format(n) : USD_SMALL.format(n)
}

export function formatInt(n: number): string {
  return INT.format(Math.round(n))
}

/** 0.4231 → "42 %". */
export function formatPct(fraction: number): string {
  return `${Math.round(fraction * 100)} %`
}

/** "2026-10" → "octubre de 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** "2026-12-01" → "1 dic 2026". */
export function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('.', '')
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Reads an amount typed by a person: "12,5", "12.5", "$ 1 200", "1.200,50".
 * Empty → `null` ("sin tope"); anything that isn't a non-negative number → `NaN`.
 */
export function parseMoneyInput(raw: string): number | null {
  const s = raw.replace(/[\s$]|US|USD/gi, '')
  if (s === '') return null
  // "1.200,50" (dot thousands, comma decimals) vs "1,200.50" vs "12,5" vs "12.5"
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.')
  let normalised = s
  if (lastComma >= 0 && lastDot >= 0) {
    normalised = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    normalised = s.replace(',', '.')
  }
  if (!/^\d+(\.\d+)?$/.test(normalised)) return Number.NaN
  const n = Number(normalised)
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN
}
