import { Calendar, AlertCircle } from 'lucide-react'
import { dueUrgency, type DueUrgency } from '@/lib/due-date'

interface DueDateChipProps {
  date: string | null | undefined
  isDone?: boolean
  /** 'chip' (bordered pill) or 'text' (inline, no background). Default 'chip'. */
  variant?: 'chip' | 'text'
  /** Hide the icon (useful for very dense tables). */
  hideIcon?: boolean
  /** Show only the colored dot + label, no icon, no background. */
  compact?: boolean
  className?: string
}

const URGENT_LEVELS = new Set<DueUrgency>(['urgent', 'today', 'overdue'])

/**
 * Reusable due-date display. Colour scale is centralised in `lib/due-date.ts`
 * so every surface (project cards, task lists, kanban, my-day, priorities)
 * shows the same urgency at a glance.
 *
 *   <DueDateChip date={task.due_date} />           // bordered pill
 *   <DueDateChip date={task.due_date} variant="text" />  // inline text
 *   <DueDateChip date={task.due_date} compact />   // dot + tiny label
 */
export function DueDateChip({
  date, isDone, variant = 'chip', hideIcon, compact, className,
}: DueDateChipProps) {
  const u = dueUrgency(date, { isDone })
  // No date and not in chip mode → render nothing. In chip mode we still
  // render a muted "Sin fecha" so the slot is visually consistent.
  if (u.level === 'none' && variant === 'text') return null

  const Icon = URGENT_LEVELS.has(u.level) ? AlertCircle : Calendar
  const dateLabel = formatShort(date)

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] ${u.textClasses} ${className ?? ''}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${u.dotClass}`} />
        {dateLabel || u.label}
      </span>
    )
  }

  if (variant === 'text') {
    return (
      <span className={`inline-flex items-center gap-1 text-xs ${u.textClasses} ${className ?? ''}`} title={u.label}>
        {!hideIcon && <Icon className="h-3 w-3" />}
        {URGENT_LEVELS.has(u.level) ? u.label : dateLabel || u.label}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${u.classes} ${className ?? ''}`}
      title={`${u.label}${dateLabel ? ` · ${dateLabel}` : ''}`}
    >
      {!hideIcon && <Icon className="h-2.5 w-2.5" />}
      {URGENT_LEVELS.has(u.level) ? u.label : dateLabel || u.label}
    </span>
  )
}

function formatShort(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  const [, y, mo, d] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
}
