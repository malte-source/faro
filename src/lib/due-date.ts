/**
 * Centralised due-date urgency model — every UI surface that displays a date
 * (project cards, task lists, kanban, my-day, priorities, gantt) should use
 * this so the colour scale and labels stay consistent.
 *
 * The previous status quo was: "Vence 15 jun" in neutral gray vs "Vencido"
 * in red. Nothing in between — so a deadline 2 days away looked identical
 * to one 30 days away. This produces *reactive* PMs.
 *
 * 6-level escalation:
 *   none      → no due date set
 *   relaxed   → > 14 días                              graphite / muted
 *   safe      → 8–14 días                              success
 *   warning   → 4–7 días                               signal-ink
 *   urgent    → 1–3 días                               signal-ink → danger blend
 *   today     → vence HOY                              danger / bold
 *   overdue   → ya pasó la fecha                       danger / strikethrough
 */

export type DueUrgency = 'none' | 'relaxed' | 'safe' | 'warning' | 'urgent' | 'today' | 'overdue'

export interface DueUrgencyInfo {
  level: DueUrgency
  /** Días hasta vencer. Negativo = días vencidos. null si no hay fecha. */
  daysLeft: number | null
  /** Etiqueta humana ("Vence en 3 días" / "Vencida hace 2 días" / "Hoy"). */
  label: string
  /** Tailwind classes para fondo + texto + borde de un chip. */
  classes: string
  /** Tailwind classes para texto suelto (sin chip). */
  textClasses: string
  /** Tailwind para un dot indicator pequeño. */
  dotClass: string
}

const LEVELS: Record<DueUrgency, Omit<DueUrgencyInfo, 'daysLeft' | 'label' | 'level'>> = {
  none: {
    classes: 'bg-stone-100 text-graphite border-stone dark:bg-night-700 dark:text-graphite dark:border-ink-body',
    textClasses: 'text-graphite',
    dotClass: 'bg-stone',
  },
  relaxed: {
    classes: 'bg-stone-100 text-graphite border-stone dark:bg-night-700 dark:text-graphite dark:border-ink-body',
    textClasses: 'text-graphite',
    dotClass: 'bg-stone',
  },
  safe: {
    classes: 'bg-success-wash text-success border-success/30 dark:bg-success/30 dark:text-success/50 dark:border-success/40',
    textClasses: 'text-success dark:text-success',
    dotClass: 'bg-success',
  },
  warning: {
    classes: 'bg-signal-wash text-signal-ink border-signal/30 dark:bg-signal/30 dark:text-signal/50 dark:border-signal-ink/40',
    textClasses: 'text-signal-ink dark:text-signal-ink',
    dotClass: 'bg-signal-ink',
  },
  urgent: {
    classes: 'bg-signal-wash text-signal-ink border-danger/30 dark:bg-signal-ink/30 dark:text-signal dark:border-danger/40',
    textClasses: 'text-signal-ink dark:text-signal-ink',
    dotClass: 'bg-signal-ink',
  },
  today: {
    classes: 'bg-danger-wash text-danger border-danger/50 font-semibold dark:bg-danger/40 dark:text-danger/30 dark:border-danger/50',
    textClasses: 'text-danger font-semibold dark:text-danger/50',
    dotClass: 'bg-danger',
  },
  overdue: {
    classes: 'bg-danger-wash text-danger border-danger/50 font-semibold line-through dark:bg-danger/20 dark:text-danger/30 dark:border-danger/40',
    textClasses: 'text-danger font-semibold line-through dark:text-danger/50',
    dotClass: 'bg-danger',
  },
}

/**
 * Compute urgency info for an ISO date string (YYYY-MM-DD or full ISO).
 * `done` tasks are treated as `relaxed` regardless of date — done is done.
 */
export function dueUrgency(
  isoDate: string | null | undefined,
  opts: { isDone?: boolean } = {},
): DueUrgencyInfo {
  if (!isoDate) {
    return { level: 'none', daysLeft: null, label: 'Sin fecha', ...LEVELS.none }
  }
  if (opts.isDone) {
    return { level: 'relaxed', daysLeft: null, label: 'Hecho', ...LEVELS.relaxed }
  }

  // Compare at day granularity (avoid hour drift). Both anchored at local midnight.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = parseLocalDate(isoDate)
  if (!due) {
    return { level: 'none', daysLeft: null, label: 'Sin fecha', ...LEVELS.none }
  }
  due.setHours(0, 0, 0, 0)

  const dayMs = 24 * 60 * 60 * 1000
  const diff = Math.round((due.getTime() - today.getTime()) / dayMs)

  if (diff < 0) {
    const abs = Math.abs(diff)
    return {
      level: 'overdue',
      daysLeft: diff,
      label: abs === 1 ? 'Vencida ayer' : `Vencida hace ${abs} días`,
      ...LEVELS.overdue,
    }
  }
  if (diff === 0) {
    return { level: 'today', daysLeft: 0, label: 'Vence HOY', ...LEVELS.today }
  }
  if (diff <= 3) {
    return {
      level: 'urgent',
      daysLeft: diff,
      label: diff === 1 ? 'Vence mañana' : `Vence en ${diff} días`,
      ...LEVELS.urgent,
    }
  }
  if (diff <= 7) {
    return { level: 'warning', daysLeft: diff, label: `Vence en ${diff} días`, ...LEVELS.warning }
  }
  if (diff <= 14) {
    return { level: 'safe', daysLeft: diff, label: `Vence en ${diff} días`, ...LEVELS.safe }
  }
  return {
    level: 'relaxed',
    daysLeft: diff,
    label: `Vence en ${diff} días`,
    ...LEVELS.relaxed,
  }
}

/** Parse 'YYYY-MM-DD' (or any ISO) as a LOCAL date — avoids timezone-induced -1-day. */
function parseLocalDate(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const [, y, mo, d] = m
    return new Date(Number(y), Number(mo) - 1, Number(d))
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
