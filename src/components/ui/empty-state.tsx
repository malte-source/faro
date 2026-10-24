import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  /** Visual variant — 'default' (stone-dashed) or 'success' (success green, used when "no pendientes" is good news) */
  tone?: 'default' | 'success'
  /** Add `py-N` for vertical breathing room. Default 12. */
  py?: number
}

/**
 * Reusable empty state — replaces the previous ad-hoc
 * `<p className="py-12 text-center text-sm text-graphite">Sin datos</p>`
 * scattered across the codebase.
 *
 * Use:
 *   <EmptyState icon={Users} title="Sin miembros" description="…" />
 *   <EmptyState icon={CheckCircle2} title="¡Todo al día!" tone="success" />
 */
export function EmptyState({ icon: Icon, title, description, action, tone = 'default', py = 12 }: EmptyStateProps) {
  const t = tone === 'success'
    ? { card: 'border-success/50 bg-success-wash/40 dark:border-success/40 dark:bg-success/20', iconWrap: 'bg-success-wash dark:bg-success/60 text-success', title: 'text-success dark:text-success/30', desc: 'text-success/80 dark:text-success/50/80' }
    : { card: 'border-stone bg-mist/40 dark:border-ink-body dark:bg-night', iconWrap: 'bg-stone-100 dark:bg-night-700 text-graphite', title: 'text-ink-body dark:text-stone', desc: 'text-graphite dark:text-graphite' }

  return (
    <div className={`rounded-xl border border-dashed ${t.card} px-6 text-center`} style={{ paddingTop: `${py * 4}px`, paddingBottom: `${py * 4}px` }}>
      {Icon && (
        <span className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${t.iconWrap}`}>
          <Icon className="h-6 w-6" />
        </span>
      )}
      <p className={`text-base font-semibold ${t.title}`}>{title}</p>
      {description && <p className={`mx-auto mt-1 max-w-md text-sm ${t.desc}`}>{description}</p>}
      {action && <div className="mt-4 inline-flex">{action}</div>}
    </div>
  )
}
