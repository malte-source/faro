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
  todo: '#55636B', in_progress: '#FFB020', in_review: '#2E6F9E',
  done: '#17876A', canceled: '#C8453A',
}
const PRIORITY_COLORS: Record<string, string> = {
  very_high: '#C8453A', high: '#C67A08', medium: '#FFB020',
  low: '#55636B', very_low: '#8B99A2',
}
const PRIORITY_LABELS: Record<string, string> = {
  very_high: 'Muy alta', high: 'Alta', medium: 'Media',
  low: 'Baja', very_low: 'Muy baja',
}
const PROJECT_STATUS_COLORS: Record<string, string> = {
  not_started: '#55636B', in_progress: '#FFB020', on_hold: '#C67A08',
  delayed: '#C8453A', completed: '#17876A', canceled: '#8B99A2', pending: '#7E6BB8',
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
    <div className="rounded-xl bg-night px-3 py-2 text-xs">
      {label && <p className="font-medium text-mist mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-[#9DB0BC]">{p.name ?? ''} {p.value}{unit}</p>
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
    indigo: 'bg-signal-wash text-signal-ink', emerald: 'bg-success-wash text-success',
    amber: 'bg-signal-wash text-signal-ink', red: 'bg-danger-wash text-danger',
    blue: 'bg-info/10 text-info', purple: 'bg-[#7E6BB8]/10 text-[#7E6BB8]',
  }
  return (
    <Card>
      <CardContent className="p-4 pt-4 md:p-6 md:pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-graphite">{label}</p>
            <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{value}</p>
            {sub && <p className="mt-0.5 text-xs text-graphite">{sub}</p>}
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
      { name: 'Crítico (0-39)', value: projects.filter(p => (p.health_score ?? 0) < 40 && p.status !== 'canceled').length, fill: '#C8453A' },
      { name: 'En riesgo (40-69)', value: projects.filter(p => { const s = p.health_score ?? 0; return s >= 40 && s < 70 && p.status !== 'canceled' }).length, fill: '#FFB020' },
      { name: 'Saludable (70+)', value: projects.filter(p => (p.health_score ?? 0) >= 70 && p.status !== 'canceled').length, fill: '#17876A' },
      { name: 'Sin datos', value: projects.filter(p => p.health_score == null && p.status !== 'canceled').length, fill: '#8B99A2' },
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          <CardHeader className="p-4 pb-2 md:p-6 md:pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-graphite" /> Tareas por prioridad
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
            {metrics.byPriority.length === 0 ? (
              <p className="py-8 text-center text-sm text-graphite">Sin datos</p>
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
                    <span className="text-graphite">{d.name}</span>
                  </div>
                  <span className="tabular-nums font-medium text-body">{d.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Projects by status */}
        <Card>
          <CardHeader className="p-4 pb-2 md:p-6 md:pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-graphite" /> Proyectos por estado
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
            {metrics.projectsByStatus.length === 0 ? (
              <p className="py-8 text-center text-sm text-graphite">Sin datos</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={metrics.projectsByStatus} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barSize={18}>
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--graphite)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--graphite)' }} tickLine={false} axisLine={false} allowDecimals={false} />
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
          <CardHeader className="p-4 pb-2 md:p-6 md:pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-graphite" /> Salud de proyectos
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
            {metrics.healthBuckets.length === 0 ? (
              <p className="py-8 text-center text-sm text-graphite">Sin datos</p>
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
                    <span className="text-graphite">{d.name}</span>
                  </div>
                  <span className="tabular-nums font-medium text-body">{d.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team workload chart */}
      {metrics.topAssignees.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-2 md:p-6 md:pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-graphite" /> Carga de tareas por persona
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={metrics.topAssignees} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barSize={20} barGap={2}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--graphite)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--graphite)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<SimpleTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(v) => <span style={{ fontSize: 11, color: 'var(--graphite)' }}>{v}</span>}
                />
                <Bar dataKey="total" name="Total" fill="var(--border-soft)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="done" name="Completadas" fill="#FFB020" radius={[4, 4, 0, 0]} />
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
