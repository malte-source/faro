import { describe, expect, it } from 'vitest'
import { formatInt, formatPct, formatUsd, monthLabel, parseMoneyInput, shiftMonth, shortDate } from './format'

describe('parseMoneyInput', () => {
  it('empty means "no cap" (null)', () => {
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput('   ')).toBeNull()
  })

  it('reads both decimal styles and thousands separators', () => {
    expect(parseMoneyInput('12,5')).toBe(12.5)
    expect(parseMoneyInput('12.5')).toBe(12.5)
    expect(parseMoneyInput('1.200,50')).toBe(1200.5)
    expect(parseMoneyInput('1,200.50')).toBe(1200.5)
    expect(parseMoneyInput('$ 100')).toBe(100)
    expect(parseMoneyInput('US$ 40')).toBe(40)
    expect(parseMoneyInput('0')).toBe(0)
  })

  it('rejects garbage and negatives with NaN', () => {
    expect(parseMoneyInput('abc')).toBeNaN()
    expect(parseMoneyInput('-5')).toBeNaN()
    expect(parseMoneyInput('1,2,3')).toBeNaN()
  })
})

describe('formatting', () => {
  it('shows cents for normal amounts and 4 decimals below one dollar', () => {
    expect(formatUsd(12.3456)).toMatch(/12,35/)
    expect(formatUsd(0.0034)).toMatch(/0,0034/)
    expect(formatUsd(0)).toMatch(/0,00/)
  })

  it('formats counts and percentages', () => {
    expect(formatInt(1234)).toMatch(/1\D?234/)
    expect(formatPct(0.4231)).toBe('42 %')
    expect(formatPct(1.5)).toBe('150 %')
  })

  it('labels months and dates in Spanish', () => {
    expect(monthLabel('2026-10')).toMatch(/octubre/i)
    expect(shortDate('2026-12-01')).toMatch(/1 dic/)
  })

  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-10', 0)).toBe('2026-10')
  })
})
