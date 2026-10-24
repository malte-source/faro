import { describe, it, expect } from 'vitest'
import { isValidCadence, nextFireDate, describeCadence } from './recurring'

describe('isValidCadence', () => {
  it('accepts the canonical forms', () => {
    expect(isValidCadence('daily')).toBe(true)
    expect(isValidCadence('weekly:mon')).toBe(true)
    expect(isValidCadence('weekly:mon,fri')).toBe(true)
    expect(isValidCadence('monthly:1')).toBe(true)
    expect(isValidCadence('monthly:31')).toBe(true)
    expect(isValidCadence('monthly:last')).toBe(true)
  })

  it('rejects garbage', () => {
    expect(isValidCadence('')).toBe(false)
    expect(isValidCadence('hourly')).toBe(false)
    expect(isValidCadence('weekly:funday')).toBe(false)
    expect(isValidCadence('monthly:32')).toBe(false)
    expect(isValidCadence('monthly:0')).toBe(false)
    expect(isValidCadence('weekly:')).toBe(false)
  })
})

describe('nextFireDate', () => {
  it('daily → tomorrow', () => {
    expect(nextFireDate('daily', '2026-06-15')).toBe('2026-06-16')
  })

  it('weekly:mon when today is Wednesday → next Monday', () => {
    // 2026-06-17 was a Wednesday
    expect(nextFireDate('weekly:mon', '2026-06-17')).toBe('2026-06-22')
  })

  it('weekly:mon,fri picks whichever is sooner', () => {
    // Wednesday → next is Friday (closer than Monday)
    expect(nextFireDate('weekly:mon,fri', '2026-06-17')).toBe('2026-06-19')
  })

  it('weekly:mon when today IS Monday → next Monday', () => {
    // 2026-06-15 was a Monday — advances ≥1 day
    const next = nextFireDate('weekly:mon', '2026-06-15')
    expect(next).toBe('2026-06-22')
  })

  it('monthly:15 when today is the 10th → 15th of same month', () => {
    expect(nextFireDate('monthly:15', '2026-06-10')).toBe('2026-06-15')
  })

  it('monthly:1 when today is the 15th → 1st of next month', () => {
    expect(nextFireDate('monthly:1', '2026-06-15')).toBe('2026-07-01')
  })

  it('monthly:last → last day of next applicable month', () => {
    const next = nextFireDate('monthly:last', '2026-06-15')
    // June 2026 has 30 days
    expect(next).toBe('2026-06-30')
  })

  it('monthly:31 in February → falls to next month with 31 days', () => {
    // Feb only has 28 days in 2026; next match is March 31
    const next = nextFireDate('monthly:31', '2026-02-15')
    expect(next).toBe('2026-03-31')
  })
})

describe('describeCadence', () => {
  it('humanises canonical forms', () => {
    expect(describeCadence('daily')).toBe('Todos los días')
    expect(describeCadence('weekly:mon')).toBe('Cada Lun')
    expect(describeCadence('weekly:mon,fri')).toBe('Cada Lun, Vie')
    expect(describeCadence('monthly:1')).toBe('Día 1 de cada mes')
    expect(describeCadence('monthly:last')).toBe('Último día del mes')
  })
})
