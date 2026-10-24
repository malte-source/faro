import { cn } from '@/lib/utils'
import { NEAR_LIMIT_HOURS, OVERLOAD_HOURS, WEEK_CAPACITY_HOURS } from '@/lib/multiempresa'

export interface HoursSegment {
  workspaceId: string
  name: string
  color: string
  hours: number
}

/** Hours of the week as one stacked bar: a segment per empresa in its color. 40 h = 100%. */
export function HoursBar({ segments, total }: { segments: HoursSegment[]; total: number }) {
  // Past the weekly capacity the bar stays full and segments share it proportionally.
  const scale = Math.max(WEEK_CAPACITY_HOURS, total)
  const rounded = Math.round(total * 10) / 10
  const tone =
    total > OVERLOAD_HOURS
      ? 'text-danger'
      : total >= NEAR_LIMIT_HOURS
        ? 'text-signal-ink'
        : 'text-foreground'

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-graphite">Esta semana</span>
        <span className={cn('font-mono font-medium tabular-nums', tone)}>{rounded} h</span>
      </div>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-border-soft"
        role="img"
        aria-label={`${rounded} horas esta semana: ${segments.map(s => `${s.name} ${Math.round(s.hours * 10) / 10} h`).join(', ') || 'sin horas'}`}
      >
        {segments.map(s => (
          <div
            key={s.workspaceId}
            title={`${s.name} · ${Math.round(s.hours * 10) / 10} h`}
            className="h-full"
            style={{ width: `${(s.hours / scale) * 100}%`, background: s.color }}
          />
        ))}
      </div>
    </div>
  )
}
