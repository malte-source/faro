'use client'

import { useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PROJECT_STATUS, PRIORITY, KANBAN_STAGES, formatDate, daysUntil } from '@/lib/utils'
import { Plus, Calendar, AlertCircle } from 'lucide-react'
import type { ProjectStatus, KanbanStage } from '@/types/database'

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  ...Object.entries(PROJECT_STATUS).map(([value, { label }]) => ({ value, label })),
]

const KANBAN_OPTIONS = [
  { value: 'all', label: 'Todas las etapas' },
  ...KANBAN_STAGES.map(({ id, label }) => ({ value: id, label })),
]

function statusVariant(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange' {
  const map: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange'> = {
    not_started: 'secondary',
    in_progress: 'default',
    on_hold: 'warning',
    delayed: 'orange',
    completed: 'success',
    canceled: 'danger',
    pending: 'default',
  }
  return map[status] ?? 'secondary'
}

export function ProjectsList() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [kanbanFilter, setKanbanFilter] = useState<string>('all')

  const { data: projects, isLoading } = trpc.projects.list.useQuery(
    statusFilter !== 'all' || kanbanFilter !== 'all'
      ? {
          status: statusFilter !== 'all' ? (statusFilter as ProjectStatus) : undefined,
          kanbanStage: kanbanFilter !== 'all' ? (kanbanFilter as KanbanStage) : undefined,
        }
      : undefined
  )

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={kanbanFilter} onValueChange={setKanbanFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KANBAN_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(statusFilter !== 'all' || kanbanFilter !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setStatusFilter('all'); setKanbanFilter('all') }}
          >
            Limpiar filtros
          </Button>
        )}

        <div className="ml-auto">
          <Link href="/dashboard/projects/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Nuevo proyecto
            </Button>
          </Link>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-3 w-3 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-64" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-4 w-16" />
              </div>
            </Card>
          ))}
        </div>
      ) : !projects?.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white py-20 text-slate-400">
          <AlertCircle className="mb-3 h-8 w-8" />
          <p className="text-sm font-medium">No hay proyectos</p>
          <p className="mt-1 text-xs">
            {statusFilter !== 'all' || kanbanFilter !== 'all'
              ? 'Probá cambiando los filtros'
              : 'Creá el primer proyecto para empezar'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => {
            const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
            const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]
            const days = project.end_date ? daysUntil(project.end_date) : null
            const isOverdue = days !== null && days < 0 && project.status !== 'completed'

            return (
              <Link key={project.id} href={`/dashboard/projects/${project.id}`}>
                <Card className="cursor-pointer p-4 transition-shadow hover:shadow-md">
                  <div className="flex items-center gap-4">
                    <div
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: project.color }}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-400">{project.code}</span>
                        <span className="text-sm font-semibold text-slate-900 truncate">{project.name}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                        <span className={`font-medium ${priorityInfo?.color ?? ''}`}>
                          {priorityInfo?.label}
                        </span>
                        {project.end_date && (
                          <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
                            <Calendar className="h-3 w-3" />
                            {isOverdue
                              ? `Vencido hace ${Math.abs(days!)} día${Math.abs(days!) !== 1 ? 's' : ''}`
                              : `Vence ${formatDate(project.end_date)}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="hidden sm:flex w-28 flex-col gap-1">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Progreso</span>
                        <span>{project.progress_pct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-indigo-500 transition-all"
                          style={{ width: `${project.progress_pct}%` }}
                        />
                      </div>
                    </div>

                    <Badge variant={statusVariant(project.status)} className="shrink-0">
                      {statusInfo?.label}
                    </Badge>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {projects && projects.length > 0 && (
        <p className="text-right text-xs text-slate-400">
          {projects.length} proyecto{projects.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
