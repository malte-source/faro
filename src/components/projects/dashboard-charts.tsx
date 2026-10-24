'use client'

import { trpc } from '@/lib/trpc/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

/* ── Colours — Faro status palette (see Manual de Marca §Charts) ──── */

const TASK_STATUS_COLORS: Record<string, string> = {
  todo:        '#55636B', // graphite
  in_progress: '#FFB020', // signal
  in_review:   '#2E6F9E', // info
  done:        '#17876A', // success
  canceled:    '#C8453A', // danger
}

const TASK_STATUS_LABELS: Record<string, string> = {
  todo:        'Por hacer',
  in_progress: 'En progreso',
  in_review:   'En revisión',
  done:        'Listo',
  canceled:    'Cancelado',
}

const PROJECT_STATUS_COLORS: Record<string, string> = {
  not_started: '#55636B', // graphite
  in_progress: '#FFB020', // signal
  on_hold:     '#C67A08', // signal-ink
  delayed:     '#C8453A', // danger
  completed:   '#17876A', // success
  canceled:    '#8B99A2', // muted grey — distinct from delayed/danger
  pending:     '#7E6BB8', // chart-4
}

const PROJECT_STATUS_LABELS: Record<string, string> = {
  not_started: 'Sin iniciar',
  in_progress: 'En progreso',
  on_hold:     'En pausa',
  delayed:     'Retrasado',
  completed:   'Completado',
  canceled:    'Cancelado',
  pending:     'Pendiente',
}

/* ── Custom tooltip ─────────────────────────────────────────────── */

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload?: { fill?: string } }> }) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="rounded-xl bg-night px-3 py-2 text-xs ring-1 ring-transparent dark:bg-surface dark:ring-border">
      <p className="font-medium text-mist">{name}</p>
      <p className="text-graphite tabular-nums">{value} tarea{value !== 1 ? 's' : ''}</p>
    </div>
  )
}

function ProjectTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="rounded-xl bg-night px-3 py-2 text-xs ring-1 ring-transparent dark:bg-surface dark:ring-border">
      <p className="font-medium text-mist">{name}</p>
      <p className="text-graphite tabular-nums">{value} proyecto{value !== 1 ? 's' : ''}</p>
    </div>
  )
}

/* ── Task donut chart ───────────────────────────────────────────── */

function TasksDonut() {
  const { data, isLoading } = trpc.tasks.stats.useQuery()

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="mx-auto h-40 w-40 rounded-full" />
        <div className="space-y-1.5">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-3 w-full" />)}
        </div>
      </div>
    )
  }

  const byStatus = (data?.byStatus ?? {}) as Record<string, number>
  const chartData = Object.entries(byStatus)
    .map(([key, value]) => ({
      name: TASK_STATUS_LABELS[key] ?? key,
      value,
      fill: TASK_STATUS_COLORS[key] ?? '#55636B',
    }))
    .filter(d => d.value > 0)

  const total = data?.total ?? 0
  const done = byStatus['done'] ?? 0
  const completionPct = total > 0 ? Math.round((done / total) * 100) : 0

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-graphite">
        <p className="text-sm">Sin tareas todavía</p>
      </div>
    )
  }

  return (
    <div className="flex flex-row items-center gap-5 md:flex-col md:gap-4">
      <div className="relative shrink-0">
        <PieChart width={160} height={160}>
          <Pie
            data={chartData}
            cx={75}
            cy={75}
            innerRadius={48}
            outerRadius={72}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
          >
            {chartData.map((entry, index) => (
              <Cell key={index} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-foreground tabular-nums">{completionPct}%</span>
          <span className="text-[10px] text-graphite">completo</span>
        </div>
      </div>

      {/* Legend */}
      <div className="min-w-0 flex-1 space-y-2 md:w-full md:flex-none md:space-y-1.5">
        {chartData.map(({ name, value, fill }) => (
          <div key={name} className="flex items-center justify-between text-[13px] md:text-xs">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: fill }} />
              <span className="text-graphite">{name}</span>
            </div>
            <span className="font-medium text-body tabular-nums">{value}</span>
          </div>
        ))}
        {data?.overdue ? (
          <div className="mt-2 rounded-md bg-danger-wash px-2 py-1.5 text-xs text-danger">
            ⚠ {data.overdue} tarea{data.overdue !== 1 ? 's' : ''} vencida{data.overdue !== 1 ? 's' : ''}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ── Projects bar chart ─────────────────────────────────────────── */

function ProjectsBar() {
  const { data, isLoading } = trpc.projects.dashboard.useQuery()

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-lg" />
  }

  const byStatus = (data?.byStatus ?? {}) as Record<string, number>
  const chartData = Object.entries(byStatus)
    .map(([key, value]) => ({
      name: PROJECT_STATUS_LABELS[key] ?? key,
      value,
      fill: PROJECT_STATUS_COLORS[key] ?? '#55636B',
    }))
    .filter(d => d.value > 0)

  if (!chartData.length) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-graphite">
        Sin proyectos todavía
      </div>
    )
  }

  const maxValue = Math.max(...chartData.map(d => d.value))

  return (
    <>
    <ul className="space-y-3 md:hidden">
      {chartData.map(d => (
        <li key={d.name}>
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2 text-body">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
              {d.name}
            </span>
            <span className="font-semibold tabular-nums text-foreground">{d.value}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border-soft">
            <div className="h-full rounded-full" style={{ width: `${(d.value / maxValue) * 100}%`, backgroundColor: d.fill }} />
          </div>
        </li>
      ))}
    </ul>
    <div className="hidden md:block">
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={20}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: 'var(--graphite)' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--graphite)' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<ProjectTooltip />} cursor={{ fill: 'var(--border-soft)' }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={index} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
    </>
  )
}

/* ── Top projects progress ──────────────────────────────────────── */

function TopProjectsProgress() {
  const { data: projects, isLoading } = trpc.projects.list.useQuery()

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    )
  }

  const activeProjects = (projects ?? [])
    .filter(p => p.status !== 'canceled' && p.status !== 'completed')
    .sort((a, b) => (b.progress_pct ?? 0) - (a.progress_pct ?? 0))
    .slice(0, 6)

  if (!activeProjects.length) {
    return <p className="text-sm text-graphite py-4 text-center">Sin proyectos activos</p>
  }

  return (
    <div className="space-y-3">
      {activeProjects.map(p => (
        <div key={p.id}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="truncate font-medium text-body">{p.name}</span>
            </div>
            <span className="ml-2 shrink-0 tabular-nums text-graphite">{p.progress_pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-soft">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${p.progress_pct}%`, backgroundColor: p.color }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Main export ─────────────────────────────────────────────────── */

export function DashboardCharts() {
  return (
    <div className="grid gap-4 md:gap-6 md:grid-cols-3">
      <Card>
        <CardHeader className="p-4 pb-2 md:p-6 md:pb-2">
          <CardTitle className="text-sm">Tareas por estado</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
          <TasksDonut />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2 md:p-6 md:pb-2">
          <CardTitle className="text-sm">Proyectos por estado</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
          <ProjectsBar />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2 md:p-6 md:pb-2">
          <CardTitle className="text-sm">Progreso — proyectos activos</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
          <TopProjectsProgress />
        </CardContent>
      </Card>
    </div>
  )
}
