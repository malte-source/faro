import { Heart, HeartCrack, HeartPulse } from 'lucide-react'

interface HealthChipProps {
  score: number | null
  variant?: 'compact' | 'full'
  className?: string
}

/**
 * Visual indicator of a project's health_score (0-100).
 *
 *   ≥ 70  → emerald, beating heart (proyecto saludable)
 *   40-69 → amber, regular heart (atención)
 *   < 40  → rose, broken heart (en riesgo)
 *
 * Tooltip explains how the score is computed. Renders null when score is
 * missing — projects without a computed score (new ones) just don't show it
 * instead of confusing the user with "??".
 */
export function HealthChip({ score, variant = 'compact', className }: HealthChipProps) {
  if (score == null) return null

  const tone =
    score >= 70 ? { color: 'text-success', bg: 'bg-success-wash dark:bg-success/30', border: 'border-success/30 dark:border-success/40', icon: HeartPulse, label: 'Saludable' } :
    score >= 40 ? { color: 'text-signal-ink',   bg: 'bg-signal-wash dark:bg-signal/30',   border: 'border-signal/30 dark:border-signal-ink/40',   icon: Heart,      label: 'Atención'  } :
                  { color: 'text-danger',    bg: 'bg-danger-wash dark:bg-danger/30',    border: 'border-danger/30 dark:border-danger/40',    icon: HeartCrack, label: 'En riesgo' }

  const Icon = tone.icon
  const tooltip = `Health score: ${score}/100 (${tone.label}). Combina % tareas overdue, ratio de completadas vs estimadas, días desde la última actividad y feedback del lead.`

  if (variant === 'full') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.border} ${tone.color} ${className ?? ''}`}
        title={tooltip}
      >
        <Icon className="h-2.5 w-2.5" />
        {score}
      </span>
    )
  }

  // compact: just the icon + number, no background — for dense card layouts
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${tone.color} ${className ?? ''}`}
      title={tooltip}
    >
      <Icon className="h-3 w-3" />
      {score}
    </span>
  )
}
