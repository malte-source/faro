import { cn } from '@/lib/utils'

/**
 * Placeholder shown while a code-split module loads (next/dynamic `loading`). Sized like the real
 * content so the page doesn't jump, announced to screen readers, theme-aware.
 */
export function BlockSkeleton({ className, label = 'Cargando…' }: { className?: string; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn('animate-pulse rounded-[14px] border border-border bg-surface', className)}>
      <span className="sr-only">{label}</span>
    </div>
  )
}

/** Three dashboard-chart cards (Inicio). */
export function ChartsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3 md:gap-6" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando gráficos…</span>
      {[0, 1, 2].map(i => <div key={i} aria-hidden className="h-56 animate-pulse rounded-[14px] border border-border bg-surface" />)}
    </div>
  )
}

/** KPI tiles plus two chart cards (Reportes). */
export function ReportsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando reportes…</span>
      <div aria-hidden className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse rounded-[14px] border border-border bg-surface" />)}
      </div>
      <div aria-hidden className="grid gap-4 md:grid-cols-2">
        {[0, 1].map(i => <div key={i} className="h-64 animate-pulse rounded-[14px] border border-border bg-surface" />)}
      </div>
    </div>
  )
}
