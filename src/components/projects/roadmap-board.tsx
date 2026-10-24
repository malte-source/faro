'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { Target, Calendar, Filter } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { DueDateChip } from '@/components/ui/due-date-chip'
import { HealthChip } from '@/components/ui/health-chip'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'
import { PROJECT_STATUS, PRIORITY } from '@/lib/utils'

/**
 * Quarterly Roadmap view.
 *
 * Layout: horizontal swimlanes by quarter (current + next 3 + past bucket +
 * "sin trimestre"). Each project appears in ONE swimlane derived from:
 *   1. project.goal.quarter (if linked to a goal with a quarter tag)
 *   2. quarter computed from project.end_date
 *   3. fallback bucket "Sin trimestre"
 *
 * Optional grouping by goal — when on, swimlane content is sub-grouped by the
 * goal each project rolls up to. Otherwise it's a flat list of project cards.
 *
 * Read-only for v1 (no drag-drop). Click any project → detail.
 */

const NOW = new Date()
function currentQuarterKey(d: Date = NOW): string {
  const y = d.getFullYear()
  const q = Math.floor(d.getMonth() / 3) + 1
  return `${y}-Q${q}`
}
function quarterFromIsoDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = iso.match(/^(\d{4})-(\d{2})-/)
  if (!m) return null
  const month = parseInt(m[2], 10)
  const q = Math.ceil(month / 3)
  return `${m[1]}-Q${q}`
}
function nextNQuarters(start: string, n: number): string[] {
  const m = start.match(/^(\d{4})-Q(\d)$/)
  if (!m) return []
  let year = parseInt(m[1], 10), q = parseInt(m[2], 10)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    out.push(`${year}-Q${q}`)
    q++
    if (q > 4) { q = 1; year++ }
  }
  return out
}
function compareQuarters(a: string, b: string): number {
  return a.localeCompare(b)
}

interface ProjectLike {
  id: string
  code: string
  name: string
  color: string
  status: string
  priority: string
  end_date: string | null
  start_date?: string | null
  progress_pct: number
  health_score: number | null
  goal_id: string | null
  members?: Array<{ user: { id: string; name: string; avatar_url: string | null } | null }> | null
}

interface GoalLike { id: string; title: string; quarter: string | null }

export function RoadmapBoard() {
  const [groupByGoal, setGroupByGoal] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)

  const { data: projectsRaw, isLoading: lp } = trpc.projects.list.useQuery()
  const { data: goalsRaw, isLoading: lg } = trpc.goals.list.useQuery()

  const projects = (projectsRaw ?? []) as unknown as ProjectLike[]
  const goals = (goalsRaw ?? []) as unknown as GoalLike[]

  const goalById = useMemo(() => {
    const m = new Map<string, GoalLike>()
    for (const g of goals) m.set(g.id, g)
    return m
  }, [goals])

  // Compute quarter per project + filter by status.
  const items = useMemo(() => {
    return projects
      .filter(p => showCompleted || (p.status !== 'completed' && p.status !== 'canceled'))
      .map(p => {
        const goal = p.goal_id ? goalById.get(p.goal_id) ?? null : null
        const quarter = goal?.quarter ?? quarterFromIsoDate(p.end_date) ?? null
        return { project: p, goal, quarter }
      })
  }, [projects, goalById, showCompleted])

  // Build columns: past · current · next 3 · sin TZ
  const cq = currentQuarterKey()
  const futureCols = nextNQuarters(cq, 4)  // current + 3 future
  const columns = useMemo(() => {
    const past = items.filter(i => i.quarter && compareQuarters(i.quarter, cq) < 0)
    const none = items.filter(i => !i.quarter)
    const byCol: Record<string, typeof items> = Object.fromEntries(
      futureCols.map(q => [q, items.filter(i => i.quarter === q)])
    )
    return { past, none, byCol }
  }, [items, futureCols, cq])

  if (lp || lg) return <ListSkeleton rows={5} />
  if (!projects.length) {
    return (
      <EmptyState
        icon={Calendar}
        title="Sin proyectos"
        description="Cuando crees proyectos con fecha de fin o vinculados a objetivos con trimestre, aparecen aquí en su columna correspondiente."
      />
    )
  }

  return (
    <>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setGroupByGoal(g => !g)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            groupByGoal
              ? 'border-signal/50 bg-signal-wash text-night dark:border-signal/60 dark:bg-signal/40 dark:text-signal'
              : 'border-stone text-graphite hover:text-ink-body dark:border-ink-body dark:text-graphite'
          }`}
        >
          <Target className="h-3.5 w-3.5" /> Agrupar por objetivo
        </button>
        <button
          onClick={() => setShowCompleted(s => !s)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            showCompleted
              ? 'border-success bg-success-wash text-success dark:border-success dark:bg-success/40 dark:text-success/50'
              : 'border-stone text-graphite hover:text-ink-body dark:border-ink-body dark:text-graphite'
          }`}
        >
          <Filter className="h-3.5 w-3.5" /> Incluir completados
        </button>
        <p className="ml-auto text-xs text-graphite">
          {items.length} proyecto{items.length === 1 ? '' : 's'} · trimestre actual {cq}
        </p>
      </div>

      {/* Swimlanes */}
      <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:snap-none md:px-0" data-no-track data-no-ptr>
        {columns.past.length > 0 && (
          <Column
            label="Pasados"
            sublabel="Antes del trimestre actual"
            items={columns.past}
            tone="muted"
            groupByGoal={groupByGoal}
            goalById={goalById}
            isPast
          />
        )}
        {futureCols.map((q, i) => (
          <Column
            key={q}
            label={q}
            sublabel={i === 0 ? 'Trimestre actual' : i === 1 ? 'Próximo' : ''}
            items={columns.byCol[q] ?? []}
            tone={i === 0 ? 'current' : 'normal'}
            groupByGoal={groupByGoal}
            goalById={goalById}
          />
        ))}
        {columns.none.length > 0 && (
          <Column
            label="Sin trimestre"
            sublabel="Asigna un goal con quarter o fecha de fin"
            items={columns.none}
            tone="muted"
            groupByGoal={groupByGoal}
            goalById={goalById}
          />
        )}
      </div>
    </>
  )
}

function Column({
  label, sublabel, items, tone, groupByGoal, goalById, isPast,
}: {
  label: string
  sublabel?: string
  items: Array<{ project: ProjectLike; goal: GoalLike | null; quarter: string | null }>
  tone: 'current' | 'normal' | 'muted'
  groupByGoal: boolean
  goalById: Map<string, GoalLike>
  isPast?: boolean
}) {
  const toneClasses = {
    current: 'border-signal/40 bg-signal-wash/40 dark:border-signal/40 dark:bg-signal/20',
    normal: 'border-stone bg-white dark:border-night-700 dark:bg-night',
    muted: 'border-stone bg-mist dark:border-night-700 dark:bg-night/40 opacity-80',
  }[tone]
  const headerColor = {
    current: 'text-night dark:text-signal',
    normal: 'text-ink-body dark:text-stone',
    muted: 'text-graphite dark:text-graphite',
  }[tone]

  // Group by goal if requested.
  const grouped = useMemo(() => {
    if (!groupByGoal) return null
    const buckets = new Map<string | null, typeof items>()
    for (const it of items) {
      const key = it.goal?.id ?? null
      buckets.set(key, [...(buckets.get(key) ?? []), it])
    }
    return Array.from(buckets.entries()).map(([goalId, arr]) => ({
      goalId,
      goal: goalId ? goalById.get(goalId) ?? null : null,
      projects: arr,
    }))
  }, [items, groupByGoal, goalById])

  return (
    <div className={`flex w-[80vw] max-w-[320px] shrink-0 snap-center flex-col rounded-xl border md:w-72 md:max-w-none ${toneClasses}`}>
      <header className="flex items-center justify-between border-b border-stone/60 px-3 py-2.5 dark:border-night-700/60">
        <div>
          <p className={`text-sm font-semibold ${headerColor}`}>{label}</p>
          {sublabel && <p className="text-[10px] uppercase tracking-wider text-graphite">{sublabel}</p>}
        </div>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold tabular-nums text-ink-body dark:bg-night/60 dark:text-stone">
          {items.length}
        </span>
      </header>

      <div className="flex-1 space-y-2 p-2 min-h-[200px]">
        {items.length === 0 ? (
          <p className="py-8 text-center text-xs text-graphite italic">—</p>
        ) : grouped ? (
          grouped.map(g => (
            <div key={g.goalId ?? 'none'} className="space-y-1.5">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-graphite inline-flex items-center gap-1">
                <Target className="h-2.5 w-2.5" />
                {g.goal ? g.goal.title : 'Sin objetivo'}
              </p>
              {g.projects.map(p => <ProjectCard key={p.project.id} {...p} isPast={isPast} />)}
            </div>
          ))
        ) : (
          items.map(p => <ProjectCard key={p.project.id} {...p} isPast={isPast} />)
        )}
      </div>
    </div>
  )
}

function ProjectCard({
  project, isPast,
}: {
  project: ProjectLike
  goal?: GoalLike | null
  quarter?: string | null
  isPast?: boolean
}) {
  const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
  const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]
  const isDone = project.status === 'completed' || project.status === 'canceled'
  const members = project.members ?? []

  return (
    <Link
      href={`/dashboard/projects/${project.id}`}
      className={`block rounded-lg border bg-white p-2.5 shadow-sm transition hover:border-stone hover:shadow-md active:scale-[0.98] dark:bg-night ${
        isPast ? 'border-stone opacity-70 dark:border-night-700' : 'border-stone dark:border-night-700'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: project.color }} />
        <span className="text-[10px] font-mono text-graphite">{project.code}</span>
        <HealthChip score={project.health_score} />
      </div>
      <p className="mt-0.5 text-sm font-medium text-night-700 dark:text-stone-100 line-clamp-2">{project.name}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-graphite">
        <span className={`font-medium ${priorityInfo?.color ?? ''}`}>{priorityInfo?.label}</span>
        {project.end_date && (
          <>
            <span className="text-stone">·</span>
            <DueDateChip date={project.end_date} isDone={isDone} compact />
          </>
        )}
      </div>

      {/* Progress + status pill */}
      <div className="mt-2 flex items-center gap-1.5">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-night-700">
          <div className="h-full rounded-full bg-signal" style={{ width: `${project.progress_pct}%` }} />
        </div>
        <span className="text-[9px] tabular-nums text-graphite">{project.progress_pct}%</span>
      </div>

      {/* Bottom row: members + status */}
      <div className="mt-1.5 flex items-center justify-between">
        <div className="flex -space-x-1">
          {members.slice(0, 3).map((m, i) => (
            <Avatar key={i} className="h-4 w-4 ring-1 ring-white dark:ring-night">
              <AvatarImage src={m.user?.avatar_url ?? undefined} />
              <AvatarFallback className="text-[7px]">{(m.user?.name ?? '?').slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          ))}
          {members.length > 3 && (
            <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-stone text-[7px] font-semibold text-graphite ring-1 ring-white dark:bg-ink-body dark:text-stone dark:ring-night">
              +{members.length - 3}
            </span>
          )}
        </div>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
          project.status === 'completed' ? 'bg-success-wash text-success' :
          project.status === 'delayed' ? 'bg-signal-wash text-signal-ink' :
          project.status === 'canceled' ? 'bg-danger-wash text-danger' :
          project.status === 'in_progress' ? 'bg-signal-wash text-night' :
          project.status === 'on_hold' ? 'bg-signal-wash text-signal-ink' :
          'bg-border-soft text-graphite'
        }`}>
          {statusInfo?.label}
        </span>
      </div>
    </Link>
  )
}

