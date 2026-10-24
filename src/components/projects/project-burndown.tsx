'use client'

import { useMemo } from 'react'
import { trpc } from '@/lib/trpc/client'
import { LineChart, TrendingDown } from 'lucide-react'

interface Props { projectId: string }

/**
 * Burn-down chart for a project — pure inline SVG, no chart library
 * dependency. Plots:
 *   - Total tasks created over time (slate)
 *   - Tasks completed (cyan)
 *   - Ideal burn-down (dashed) — perfectly even pace start→end
 *
 * "Healthy" project = the cyan completed line stays close to or above the
 * ideal dashed line.
 */
export function ProjectBurndown({ projectId }: Props) {
  const { data, isLoading } = trpc.projects.burndown.useQuery(projectId)

  const chart = useMemo(() => {
    if (!data?.points.length) return null
    const W = 600, H = 200, P = 28
    const xs = (i: number) => P + (i / Math.max(1, data.points.length - 1)) * (W - 2 * P)
    const maxY = Math.max(1, ...data.points.map(p => p.total))
    const ys = (v: number) => H - P - (v / maxY) * (H - 2 * P)

    const line = (key: 'total' | 'done' | 'ideal') =>
      data.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(i).toFixed(1)} ${ys(p[key]).toFixed(1)}`).join(' ')

    // Vertical "today" marker
    const todayIdx = data.points.findIndex(p => p.date >= new Date().toISOString().split('T')[0])
    return { W, H, P, xs, ys, maxY, line, todayIdx }
  }, [data])

  if (isLoading) {
    return (
      <div className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
        <div className="h-5 w-40 animate-pulse rounded bg-stone-100 dark:bg-night-700" />
        <div className="mt-4 h-48 animate-pulse rounded bg-stone-100 dark:bg-night-700" />
      </div>
    )
  }

  if (!data?.points.length || !chart) {
    return (
      <div className="rounded-xl border border-dashed border-stone bg-white p-8 text-center dark:border-ink-body dark:bg-night">
        <LineChart className="mx-auto h-7 w-7 text-stone" />
        <p className="mt-2 text-sm text-graphite">Burn-down disponible cuando el proyecto tenga fechas y tareas.</p>
      </div>
    )
  }

  const lastPoint = data.points[data.points.length - 1]
  const remaining = lastPoint.total - lastPoint.done
  const onTrack = lastPoint.done >= lastPoint.ideal

  return (
    <div className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
      <header className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
          <TrendingDown className="h-4 w-4 text-signal-ink" />
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-night dark:text-stone-100">Burn-down</h3>
          <p className="text-[10px] uppercase tracking-wider text-graphite">
            Del {data.start} al {data.end} · {lastPoint.done}/{lastPoint.total} tareas completadas
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          onTrack ? 'bg-success-wash text-success' : 'bg-danger-wash text-danger'
        }`}>
          {onTrack ? 'A tiempo' : `${remaining} pendientes`}
        </span>
      </header>

      <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full" preserveAspectRatio="none">
        {/* Y axis grid */}
        {[0, 0.5, 1].map(t => (
          <line key={t} x1={chart.P} x2={chart.W - chart.P}
            y1={chart.ys(chart.maxY * (1 - t))} y2={chart.ys(chart.maxY * (1 - t))}
            stroke="#e2e8f0" strokeDasharray="2 4" strokeWidth="1" />
        ))}
        {/* Today marker */}
        {chart.todayIdx >= 0 && (
          <line
            x1={chart.xs(chart.todayIdx)} x2={chart.xs(chart.todayIdx)}
            y1={chart.P} y2={chart.H - chart.P}
            stroke="#06b6d4" strokeWidth="1" strokeDasharray="3 3" opacity="0.5"
          />
        )}
        {/* Ideal burndown (dashed) */}
        <path d={chart.line('ideal')} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 4" />
        {/* Total tasks (gray area) */}
        <path d={chart.line('total')} fill="none" stroke="#cbd5e1" strokeWidth="2" />
        {/* Completed tasks (cyan) */}
        <path d={chart.line('done')} fill="none" stroke="#06b6d4" strokeWidth="2.5" />

        {/* Final point dot */}
        <circle cx={chart.xs(data.points.length - 1)} cy={chart.ys(lastPoint.done)} r="3" fill="#06b6d4" />

        {/* Axis labels */}
        <text x={chart.P} y={chart.H - 6} fontSize="10" fill="#94a3b8">{data.start}</text>
        <text x={chart.W - chart.P} y={chart.H - 6} fontSize="10" fill="#94a3b8" textAnchor="end">{data.end}</text>
        <text x={4} y={chart.ys(chart.maxY)} fontSize="10" fill="#94a3b8">{chart.maxY}</text>
        <text x={4} y={chart.H - chart.P} fontSize="10" fill="#94a3b8">0</text>
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px]">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-signal" /> Completadas</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-graphite" /> Total creadas</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-graphite opacity-50" style={{ borderTop: '1.5px dashed #94a3b8', background: 'transparent' }} /> Ideal</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ borderLeft: '1.5px dashed #06b6d4', height: '8px' }} /> Hoy</span>
      </div>
    </div>
  )
}
