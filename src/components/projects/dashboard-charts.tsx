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

/* ── Colours ─────────────────────────────────────────────────────── */

const TASK_STATUS_COLORS: Record<string, string> = {
  todo:        '#94a3b8',
  in_progress: '#3b82f6',
  in_review:   '#f59e0b',
  done:        '#10b981',
  canceled:    '#ef4444',
}

const TASK_STATUS_LABELS: Record<string, string> = {
  todo:        'Por hacer',
  in_progress: 'En progreso',
  in_review:   'En revisión',
  done:        'Listo',
  canceled:    'Cancelado',
}

const PROJECT_STATUS_COLORS: Record<string, string> = {
  not_started: '#94a3b8',
  in_progress: '#3b82f6',
  on_hold:     '#f59e0b',
  delayed:     '#f97316',
  completed:   '#10b981',
  canceled:    '#ef4444',
  pending:     '#8b5cf6',
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
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-slate-700">{name}</p>
      <p className="text-slate-500 tabular-nums">{value} tarea{value !== 1 ? 's' : ''}</p>
    </div>
  )
}

function ProjectTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-slate-700">{name}</p>
      <p className="text-slate-500 tabular-nums">{value} proyecto{value !== 1 ? 's' : ''}</p>
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
      fill: TASK_STATUS_COLORS[key] ?? '#94a3b8',
    }))
    .filter(d => d.value > 0)

  const total = data?.total ?? 0
  const done = byStatus['done'] ?? 0
  const completionPct = total > 0 ? Math.round((done / total) * 100) : 0

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-slate-400">
        <p className="text-sm">Sin tareas todavía</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
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
          <span className="text-xl font-bold text-slate-800 tabular-nums">{completionPct}%</span>
          <span className="text-[10px] text-slate-400">completo</span>
        </div>
      </div>

      {/* Legend */}
      <div className="w-full space-y-1.5">
        {chartData.map(({ name, value, fill }) => (
          <div key={name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: fill }} />
              <span className="text-slate-600">{name}</span>
            </div>
            <span className="font-medium text-slate-700 tabular-nums">{value}</span>
          </div>
        ))}
        {data?.overdue ? (
          <div className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-600">
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
      fill: PROJECT_STATUS_COLORS[key] ?? '#94a3b8',
    }))
    .filter(d => d.value > 0)

  if (!chartData.length) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-slate-400">
        Sin proyectos todavía
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={20}>
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<ProjectTooltip />} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={index} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
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
    return <p className="text-sm text-slate-400 py-4 text-center">Sin proyectos activos</p>
  }

  return (
    <div className="space-y-3">
      {activeProjects.map(p => (
        <div key={p.id}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="truncate font-medium text-slate-700">{p.name}</span>
            </div>
            <span className="ml-2 shrink-0 tabular-nums text-slate-500">{p.progress_pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
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
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tareas por estado</CardTitle>
        </CardHeader>
        <CardContent>
          <TasksDonut />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Proyectos por estado</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ProjectsBar />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Progreso — proyectos activos</CardTitle>
        </CardHeader>
        <CardContent>
          <TopProjectsProgress />
        </CardContent>
      </Card>
    </div>
  )
}
