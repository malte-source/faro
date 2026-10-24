/**
 * Cadence DSL for recurring tasks. Tiny because we want it readable and
 * controllable — full cron is overkill for a PM tool.
 *
 *   daily               → every day
 *   weekly:mon          → every Monday
 *   weekly:mon,fri      → Mondays AND Fridays
 *   monthly:1           → 1st of every month
 *   monthly:15          → 15th of every month
 *   monthly:last        → last day of every month
 */

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
type Day = typeof DOW[number]

export function isValidCadence(s: string): boolean {
  if (s === 'daily') return true
  if (s.startsWith('weekly:')) {
    const days = s.slice('weekly:'.length).split(',').map(d => d.trim())
    return days.length > 0 && days.every(d => DOW.includes(d as Day))
  }
  if (s.startsWith('monthly:')) {
    const target = s.slice('monthly:'.length)
    if (target === 'last') return true
    const n = parseInt(target, 10)
    return n >= 1 && n <= 31
  }
  return false
}

/**
 * Given a cadence and a "from" date, return the next date (inclusive)
 * on which the rule fires.  Always advances at least one day so an
 * already-fired rule doesn't fire again the same day.
 */
export function nextFireDate(cadence: string, fromISO: string): string {
  const from = new Date(fromISO + 'T00:00:00Z')
  const advance = (days: number) => {
    const d = new Date(from)
    d.setUTCDate(d.getUTCDate() + days)
    return d
  }
  // Always look at TOMORROW or later so the same rule doesn't re-fire today.
  const tomorrow = advance(1)

  if (cadence === 'daily') {
    return iso(tomorrow)
  }

  if (cadence.startsWith('weekly:')) {
    const days = cadence.slice('weekly:'.length).split(',').map(d => d.trim() as Day)
    const targets = new Set(days.map(d => DOW.indexOf(d)))
    for (let i = 0; i < 14; i++) {
      const candidate = advance(i + 1)
      if (targets.has(candidate.getUTCDay())) return iso(candidate)
    }
    return iso(tomorrow) // fallback (shouldn't happen)
  }

  if (cadence.startsWith('monthly:')) {
    const target = cadence.slice('monthly:'.length)
    // Walk forward day-by-day. Cap at 70 days because the worst case
    // (monthly:31 starting mid-Feb of a non-leap year) needs up to ~46 days.
    // 70 is a comfortable margin.
    for (let i = 0; i < 70; i++) {
      const candidate = advance(i + 1)
      if (target === 'last') {
        const dayAfter = new Date(candidate)
        dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)
        if (dayAfter.getUTCMonth() !== candidate.getUTCMonth()) return iso(candidate)
      } else {
        const n = parseInt(target, 10)
        if (candidate.getUTCDate() === n) return iso(candidate)
      }
    }
    return iso(tomorrow)
  }

  return iso(tomorrow)
}

function iso(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** Pretty-print a cadence string for the UI. */
export function describeCadence(cadence: string): string {
  if (cadence === 'daily') return 'Todos los días'
  if (cadence.startsWith('weekly:')) {
    const days = cadence.slice('weekly:'.length).split(',').map(d => d.trim() as Day)
    const names: Record<Day, string> = {
      sun: 'Dom', mon: 'Lun', tue: 'Mar', wed: 'Mié', thu: 'Jue', fri: 'Vie', sat: 'Sáb',
    }
    return `Cada ${days.map(d => names[d]).join(', ')}`
  }
  if (cadence.startsWith('monthly:')) {
    const target = cadence.slice('monthly:'.length)
    if (target === 'last') return 'Último día del mes'
    return `Día ${target} de cada mes`
  }
  return cadence
}
