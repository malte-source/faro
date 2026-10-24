import { Link2 } from 'lucide-react'

/**
 * Shape of the `blocking` field returned by tasks.byProject — each row is
 * a dependency where THIS task depends on another. The dependency is
 * "active" if the dependee is not yet done/canceled.
 */
type Blocking = Array<{
  id: string
  depends_on: { id: string; title: string; status: string } | null
}> | null | undefined

/** Count how many of the task's dependencies are still open (blocking it). */
export function countBlockers(blocking: Blocking): number {
  if (!blocking) return 0
  return blocking.filter(b => {
    const s = b.depends_on?.status
    return s && s !== 'done' && s !== 'canceled'
  }).length
}

/** First N titles of incomplete blockers, for tooltip text. */
export function blockerTitles(blocking: Blocking, max = 3): string[] {
  if (!blocking) return []
  return blocking
    .filter(b => b.depends_on && b.depends_on.status !== 'done' && b.depends_on.status !== 'canceled')
    .slice(0, max)
    .map(b => b.depends_on!.title)
}

interface BlockedChipProps {
  blocking: Blocking
  variant?: 'icon' | 'pill'
  className?: string
}

/**
 * Small visual indicator that a task is blocked by an unfinished dependency.
 * Mounts as an icon (default) or a tiny pill — use the icon in dense tables
 * and the pill where there's more room.
 *
 * Renders null when there are no active blockers (so it's safe to drop into
 * any row without conditional logic at the call site).
 */
export function BlockedChip({ blocking, variant = 'icon', className }: BlockedChipProps) {
  const n = countBlockers(blocking)
  if (n === 0) return null

  const titles = blockerTitles(blocking, 3)
  const tooltip = n === 1
    ? `Bloqueada por: ${titles[0]}`
    : `Bloqueada por ${n} tareas:\n${titles.join('\n')}${n > 3 ? `\n…y ${n - 3} más` : ''}`

  if (variant === 'pill') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border border-signal/30 bg-signal-wash px-1.5 py-0.5 text-[10px] font-medium text-signal-ink dark:border-signal-ink/40 dark:bg-signal/30 dark:text-signal/50 ${className ?? ''}`}
        title={tooltip}
      >
        <Link2 className="h-2.5 w-2.5" />
        {n === 1 ? 'Bloqueada' : `Bloqueada ×${n}`}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full bg-signal-wash text-signal-ink dark:bg-signal/40 dark:text-signal-ink ${className ?? ''}`}
      title={tooltip}
    >
      <Link2 className="h-2.5 w-2.5" />
    </span>
  )
}
