'use client'

import { useMemo } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from 'recharts'
import {
  CheckSquare, FolderKanban, Clock, TrendingUp,
  AlertTriangle, Users, Target, Activity,
} from 'lucide-react'

/* ── colour maps ─────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  todo: '#94a3b8', in_progress: '#3b82f6', in_review: '#f59e0b',
  done: '#10b981', canceled: '#ef4444',
}
const PRIORITY_COLORS: Record<string, string> = {
  very_high: '#ef4444', high: '#f97316', medium: '#f59e0b',
  low: '#22c55e', very_low: '#94a3b8',
}
const PRIORITY_LABELS: Record<string, string> = {
  very_high: 'Muy alta', high: 'Alta', medium: 'Media',
  low: 'Baja', very_low: 'Muy baja',
}
const PROJECT_STATUS_COLORS: Record<string, string> = {
  not_started: '#94a3b8', in_progress: '#3b82f6', on_hold: '#f59e0b',
  delayed: '#f97316', completed: '#10b981', canceled: '#ef4444', pending: '#8b5cf6',
}
const PROJECT_STATUS_LABELS: Record<string, string> = {
  not_started: 'Sin iniciar', in_progress: 'En progreso', on_hold: 'En pausa',
  delayed: 'Retrasado', completed: 'Completado', canceled: 'Cancelado', pending: 'Pendiente',
}

/* ── tooltips ────────────────────────────────────────────────── */

function SimpleTooltip({ active, payload, label, unit = '' }: {
  active?: boolean; payload?: Array<{ value: number; name?: string }>; label?: string; unit?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md text-xs">
      {label && <p className="font-medium text-slate-700 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-slate-500">{p.name ?? ''} {p.value}{unit}</p>
      ))}
    </div>
  )
}

/* ── stat card ───────────────────────────────────────────────── */

function StatCard({ label, value, sub, icon: Icon, color = 'indigo' }: {
  label: string; value: string | number; sub?: string
  icon: React.ElementType; color?: 'indigo' | 'emerald' | 'amber' | 'red' | 'blue' | 'purple'
}) {
  const bg: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600', red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-600', purple: 'bg-purple-50 text-purple-600',
  }
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
          </div>
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${bg[color]}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── main ────────────────────────────────────────────────────── */

export function ReportsOverview() {
  const { data: tasks, isLoading: loadingTasks } = trpc.tasks.list.useQuery({})
  const { data: projects, isLoading: loadingProjects } = trpc.projects.list.useQuery()
  const { data: taskStats } = trpc.tasks.stats.useQuery()
  const { data: members } = trpc.team.members.useQuery()

  const loading = loadingTasks || loadingProjects

  /* ── computed metrics ──────────────────────────────────────── */

  const metrics = useMemo(() => {
    if (!tasks || !projects) return null

    const today = new Date()

    const totalTasks = tasks.length
    const doneTasks = tasks.filter(t => t.status === 'done').length
    const overdueTasks = tasks.filter(t =>
      t.due_date && new Date(t.due_date) < today && t.status !== 'done' && t.status !== 'canceled'
    ).length
    const totalHoursEstimated = tasks.reduce((acc, t) => acc + (t.estimated_hours ?? 0), 0)
    const totalHoursActual = tasks.reduce((acc, t) => acc + (t.actual_hours ?? 0), 0)

    const activeProjects = projects.filter(p => p.status !== 'canceled' && p.status !== 'completed')
    const completedProjects = projects.filter(p => p.status === 'completed')
    const delayedProjects = projects.filter(p => p.status === 'delayed')

    // Tasks by priority
    const byPriority = ['very_high', 'high', 'medium', 'low', 'very_low'].map(p => ({
      name: PRIORITY_LABELS[p],
      value: tasks.filter(t => t.priority === p).length,
      fill: PRIORITY_COLORS[p],
    })).filter(d => d.value > 0)

    // Projects by status
    const projectsByStatus = Object.entries(PROJECT_STATUS_LABELS).map(([k, label]) => ({
      name: label,
      value: projects.filter(p => p.status === k).length,
      fill: PROJECT_STATUS_COLORS[k],
    })).filter(d => d.value > 0)

    // Top assignees by task count
    const assigneeCounts: Record<string, { name: string; total: number; done: number }> = {}
    for (const t of tasks) {
      const a = t.assignee as { id: string; name: string } | null
      if (!a) continue
      if (!assigneeCounts[a.id]) assigneeCounts[a.id] = { name: a.name, total: 0, done: 0 }
      assigneeCounts[a.id].total++
      if (t.status === 'done') assigneeCounts[a.id].done++
    }
    const topAssignees = Object.values(assigneeCounts)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
      .map(a => ({ name: a.name.split(' ')[0], total: a.total, done: a.done }))

    // Project health distribution
    const healthBuckets = [
      { name: 'Crítico (0-39)', value: projects.filter(p => (p.health_score ?? 0) < 40 && p.status !== 'canceled').length, fill: '#ef4444' },
      { name: 'En riesgo (40-69)', value: projects.filter(p => { const s = p.health_score ?? 0; return s >= 40 && s < 70 && p.status !== 'canceled' }).length, fill: '#f59e0b' },
      { name: 'Saludable (70+)', value: projects.filter(p => (p.health_score ?? 0) >= 70 && p.status !== 'canceled').length, fill: '#10b981' },
      { name: 'Sin datos', value: projects.filter(p => p.health_score == null && p.status !== 'canceled').length, fill: '#cbd5e1' },
    ].filter(d => d.value > 0)

    return {
      totalTasks, doneTasks, overdueTasks, totalHoursEstimated, totalHoursActual,
      activeProjects: activeProjects.length, completedProjects: completedProjects.length,
      delayedProjects: delayedProjects.length, totalProjects: projects.length,
      completionRate: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
      byPriority, projectsByStatus, topAssignees, healthBuckets,
    }
  }, [tasks, projects])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (!metrics) return null

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Tareas completadas"
          value={`${metrics.doneTasks} / ${metrics.totalTasks}`}
          sub={`${metrics.completionRate}% de completitud`}
          icon={CheckSquare}
          color="emerald"
        />
        <StatCard
          label="Proyectos activos"
          value={metrics.activeProjects}
          sub={`${metrics.completedProjects} completados · ${metrics.delayedProjects} retrasados`}
          icon={FolderKanban}
          color="blue"
        />
        <StatCard
          label="Tareas vencidas"
          value={metrics.overdueTasks}
          sub={metrics.overdueTasks === 0 ? '¡Todo al día!' : 'Requieren atención'}
          icon={AlertTriangle}
          color={metrics.overdueTasks > 0 ? 'red' : 'emerald'}
        />
        <StatCard
          label="Equipo"
          value={members?.length ?? 0}
          sub={`${metrics.topAssignees.length} con tareas asignadas`}
          icon={Users}
          color="purple"
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Tasks by priority */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-slate-400" /> Tareas por prioridad
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.byPriority.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={metrics.byPriority} cx="50%" cy="50%" innerRadius={45} outerRadius={72}
                    paddingAngle={2} dataKey="value" strokeWidth={0}>
                    {metrics.byPriority.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip content={<SimpleTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="mt-1 space-y-1">
              {metrics.byPriority.map(d => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
                    <span className="text-slate-600">{d.name}</span>
                  </div>
                  <span className="tabular-nums font-medium text-slate-700">{d.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Projects by status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-slate-400" /> Proyectos por estado
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.projectsByStatus.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={metrics.projectsByStatus} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barSize={18}>
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<SimpleTooltip unit=" proyectos" />} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {metrics.projectsByStatus.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Project health */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-slate-400" /> Salud de proyectos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.healthBuckets.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={metrics.healthBuckets} cx="50%" cy="50%" outerRadius={72}
                    paddingAngle={2} dataKey="value" strokeWidth={0}>
                    {metrics.healthBuckets.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip content={<SimpleTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="mt-1 space-y-1">
              {metrics.healthBuckets.map(d => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
                    <span className="text-slate-600">{d.name}</span>
                  </div>
                  <span className="tabular-nums font-medium text-slate-700">{d.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team workload chart */}
      {metrics.topAssignees.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-400" /> Carga de tareas por persona
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={metrics.topAssignees} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barSize={20} barGap={2}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<SimpleTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(v) => <span style={{ fontSize: 11, color: '#64748b' }}>{v}</span>}
                />
                <Bar dataKey="total" name="Total" fill="#e0e7ff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="done" name="Completadas" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Hours summary */}
      {(metrics.totalHoursEstimated > 0 || metrics.totalHoursActual > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            label="Horas estimadas"
            value={`${metrics.totalHoursEstimated.toLocaleString('es')}h`}
            sub="Total del portafolio activo"
            icon={Clock}
            color="indigo"
          />
          <StatCard
            label="Horas registradas"
            value={`${metrics.totalHoursActual.toLocaleString('es')}h`}
            sub={metrics.totalHoursEstimated > 0
              ? `${Math.round((metrics.totalHoursActual / metrics.totalHoursEstimated) * 100)}% de lo estimado`
              : ''}
            icon={Clock}
            color={metrics.totalHoursActual > metrics.totalHoursEstimated ? 'amber' : 'emerald'}
          />
        </div>
      )}
    </div>
  )
}
