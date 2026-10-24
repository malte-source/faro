'use client'

import { useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { GitBranch, AlertTriangle } from 'lucide-react'

interface Props { projectId: string }

const DAY_MS = 86_400_000
const PRIORITY_DOT: Record<string, string> = {
  very_high: 'bg-danger', high: 'bg-signal-ink', medium: 'bg-signal-ink', low: 'bg-success', very_low: 'bg-stone',
}

function toDate(s: string | null): Date | null {
  return s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s) : null
}
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}

/**
 * Task-level Gantt for a single project with dependency arrows + critical path.
 *
 * Tasks only carry due_date + created_at (no explicit start), so each bar
 * spans [created_at → due_date]. Dependency edges are drawn as SVG arrows
 * from the blocker's right edge to the blocked task's left edge. When an
 * arrow points BACKWARDS (blocked task scheduled before its blocker ends)
 * it's flagged red — a real scheduling conflict the timeline surfaces.
 *
 * Critical path = the longest chain (by summed bar duration) through the
 * dependency DAG; those bars + arrows are highlighted cyan.
 */
export function ProjectTaskGantt({ projectId }: Props) {
  const { data: tasks, isLoading } = trpc.tasks.byProject.useQuery(projectId)
  const { data: deps } = trpc.tasks.dependenciesByProject.useQuery(projectId)
  const [dayWidth, setDayWidth] = useState(20)

  const model = useMemo(() => {
    if (!tasks) return null
    type Row = {
      id: string; title: string; status: string; priority: string
      start: Date; end: Date
    }
    const rows: Row[] = []
    for (const t of tasks) {
      const created = toDate(t.created_at) ?? new Date()
      const due = toDate(t.due_date)
      // Bar end = due date if present, else created + 2 days (placeholder span)
      const end = due ?? new Date(created.getTime() + 2 * DAY_MS)
      // Bar start = created, but never after end
      const start = created < end ? created : new Date(end.getTime() - DAY_MS)
      rows.push({ id: t.id, title: t.title, status: t.status, priority: t.priority, start, end })
    }
    if (rows.length === 0) return null

    // Timeline bounds
    const minStart = new Date(Math.min(...rows.map(r => r.start.getTime())))
    const maxEnd = new Date(Math.max(...rows.map(r => r.end.getTime())))
    const boundStart = new Date(minStart.getTime() - 2 * DAY_MS)
    const boundEnd = new Date(maxEnd.getTime() + 2 * DAY_MS)
    const totalDays = Math.max(1, daysBetween(boundStart, boundEnd))

    // Dependency edges (blocker depends_on_id → blocked task_id)
    const edges = (deps ?? []).filter(d =>
      rows.some(r => r.id === d.task_id) && rows.some(r => r.id === d.depends_on_id),
    )

    // Critical path: longest chain by summed duration through the DAG.
    const byId = new Map(rows.map(r => [r.id, r]))
    const blockers = new Map<string, string[]>() // task → its blockers
    for (const e of edges) {
      const arr = blockers.get(e.task_id) ?? []
      arr.push(e.depends_on_id)
      blockers.set(e.task_id, arr)
    }
    const dur = (id: string) => {
      const r = byId.get(id)!
      return Math.max(1, daysBetween(r.start, r.end) + 1)
    }
    const memo = new Map<string, number>()
    const seen = new Set<string>()
    const longestTo = (id: string): number => {
      if (memo.has(id)) return memo.get(id)!
      if (seen.has(id)) return dur(id) // cycle guard
      seen.add(id)
      const bs = blockers.get(id) ?? []
      const best = bs.length ? Math.max(...bs.map(b => longestTo(b))) : 0
      const total = best + dur(id)
      memo.set(id, total)
      seen.delete(id)
      return total
    }
    // Find the end task of the critical path (max longestTo), then backtrack
    let endTask: string | null = null
    let maxLen = -1
    for (const r of rows) {
      const l = longestTo(r.id)
      if (l > maxLen) { maxLen = l; endTask = r.id }
    }
    const critical = new Set<string>()
    let cur = endTask
    while (cur) {
      critical.add(cur)
      const bs = blockers.get(cur) ?? []
      if (!bs.length) break
      // pick the blocker that contributes the longest path
      cur = bs.reduce((a, b) => (longestTo(a) >= longestTo(b) ? a : b))
    }

    return { rows, boundStart, boundEnd, totalDays, edges, critical }
  }, [tasks, deps])

  if (isLoading) {
    return <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-9 animate-pulse rounded bg-stone-100 dark:bg-night-700" />)}</div>
  }
  if (!model) {
    return (
      <div className="rounded-xl border border-dashed border-stone bg-white p-10 text-center dark:border-ink-body dark:bg-night">
        <p className="text-sm text-graphite">Sin tareas para mostrar en el timeline.</p>
      </div>
    )
  }

  const { rows, boundStart, totalDays, edges, critical } = model
  const ROW_H = 40
  const BAR_H = 22
  const LABEL_W = 200
  const timelineW = totalDays * dayWidth
  const xOf = (d: Date) => daysBetween(boundStart, d) * dayWidth
  const yOf = (i: number) => i * ROW_H + (ROW_H - BAR_H) / 2 + BAR_H / 2 // bar vertical center
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]))

  // Month markers
  const months: { label: string; offset: number }[] = []
  const cur = new Date(boundStart.getFullYear(), boundStart.getMonth(), 1)
  const end = new Date(boundStart.getTime() + totalDays * DAY_MS)
  while (cur < end) {
    months.push({ label: cur.toLocaleString('es', { month: 'short', year: '2-digit' }), offset: daysBetween(boundStart, cur) * dayWidth })
    cur.setMonth(cur.getMonth() + 1)
  }
  const todayX = (() => {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    const off = daysBetween(boundStart, t) * dayWidth
    return off >= 0 && off <= timelineW ? off : null
  })()

  return (
    <div className="rounded-xl border border-stone bg-white dark:border-night-700 dark:bg-night">
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2 dark:border-night-700">
        <p className="flex items-center gap-2 text-xs text-graphite">
          <GitBranch className="h-3.5 w-3.5" />
          {rows.length} tareas · {edges.length} dependencias · <span className="text-signal-ink font-medium">critical path resaltado</span>
        </p>
        <div className="flex items-center gap-1 rounded-lg border border-stone dark:border-ink-body">
          <button onClick={() => setDayWidth(w => Math.max(8, w - 4))} className="px-2 py-0.5 text-xs hover:bg-mist dark:hover:bg-night-700">−</button>
          <span className="px-1.5 text-[10px] tabular-nums text-graphite">{dayWidth}px</span>
          <button onClick={() => setDayWidth(w => Math.min(48, w + 4))} className="px-2 py-0.5 text-xs hover:bg-mist dark:hover:bg-night-700">+</button>
        </div>
      </div>

      <div className="flex overflow-hidden">
        {/* Labels */}
        <div className="shrink-0 border-r border-stone-100 dark:border-night-700" style={{ width: LABEL_W }}>
          <div className="h-8 border-b border-stone-100 dark:border-night-700" />
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-2 border-b border-mist px-3 dark:border-night-700" style={{ height: ROW_H }}>
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', PRIORITY_DOT[r.priority])} />
              <span className={cn('truncate text-xs', critical.has(r.id) ? 'font-semibold text-night dark:text-signal' : 'text-ink-body dark:text-stone')}>
                {r.title}
              </span>
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-x-auto">
          <div className="relative" style={{ width: timelineW, minWidth: '100%' }}>
            {/* Month header */}
            <div className="sticky top-0 z-10 h-8 border-b border-stone-100 bg-white dark:border-night-700 dark:bg-night">
              {months.map((m, i) => (
                <div key={i} className="absolute top-0 flex h-full items-center border-l border-stone-100 pl-1.5 text-[10px] uppercase tracking-wider text-graphite dark:border-night-700" style={{ left: m.offset }}>
                  {m.label}
                </div>
              ))}
            </div>

            {/* SVG overlay for bars + arrows */}
            <svg width={timelineW} height={rows.length * ROW_H} className="block">
              {/* today line */}
              {todayX !== null && (
                <line x1={todayX} x2={todayX} y1={0} y2={rows.length * ROW_H} stroke="#06b6d4" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
              )}

              {/* dependency arrows: from blocker end → blocked start */}
              {edges.map((e, i) => {
                const bi = rowIndex.get(e.depends_on_id), ti = rowIndex.get(e.task_id)
                if (bi === undefined || ti === undefined) return null
                const blocker = rows[bi], blocked = rows[ti]
                const x1 = xOf(blocker.end), y1 = yOf(bi)
                const x2 = xOf(blocked.start), y2 = yOf(ti)
                const backward = x2 < x1 // scheduling conflict
                const isCrit = critical.has(e.task_id) && critical.has(e.depends_on_id)
                const color = backward ? '#f43f5e' : isCrit ? '#06b6d4' : '#94a3b8'
                const midX = Math.max(x1 + 12, x2 - 12)
                return (
                  <g key={i}>
                    <path
                      d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                      fill="none" stroke={color} strokeWidth={isCrit ? 2 : 1.2}
                      strokeDasharray={backward ? '4 3' : undefined}
                      markerEnd={`url(#arrow-${backward ? 'r' : isCrit ? 'c' : 'g'})`}
                    />
                  </g>
                )
              })}

              {/* bars */}
              {rows.map((r, i) => {
                const x = xOf(r.start)
                const w = Math.max(daysBetween(r.start, r.end) * dayWidth, dayWidth)
                const y = i * ROW_H + (ROW_H - BAR_H) / 2
                const isCrit = critical.has(r.id)
                const done = r.status === 'done'
                return (
                  <g key={r.id}>
                    <rect
                      x={x} y={y} width={w} height={BAR_H} rx={5}
                      fill={done ? '#10b981' : isCrit ? '#06b6d4' : '#cbd5e1'}
                      opacity={done ? 0.85 : 1}
                    />
                    {isCrit && <rect x={x} y={y} width={w} height={BAR_H} rx={5} fill="none" stroke="#0e7490" strokeWidth="1" />}
                  </g>
                )
              })}

              {/* arrow markers */}
              <defs>
                <marker id="arrow-g" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" /></marker>
                <marker id="arrow-c" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#06b6d4" /></marker>
                <marker id="arrow-r" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#f43f5e" /></marker>
              </defs>
            </svg>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-stone-100 px-4 py-2 text-[11px] text-graphite dark:border-night-700">
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-signal" /> Critical path</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-success" /> Completada</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-stone" /> Normal</span>
        <span className="flex items-center gap-1.5 text-danger"><AlertTriangle className="h-3 w-3" /> Flecha roja = conflicto de fechas (depende de algo que termina después)</span>
      </div>
    </div>
  )
}
