'use client'

import { useState, useMemo } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AddTaskDialog } from '@/components/projects/add-task-dialog'
import { PRIORITY, formatDate, daysUntil } from '@/lib/utils'
import { Plus, Calendar, AlertCircle, LayoutList, User } from 'lucide-react'
import Link from 'next/link'
import type { TaskStatus } from '@/types/database'

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  done: 'Listo',
  canceled: 'Cancelado',
}

function taskStatusVariant(s: TaskStatus): 'secondary' | 'default' | 'warning' | 'success' | 'danger' {
  const map: Record<TaskStatus, 'secondary' | 'default' | 'warning' | 'success' | 'danger'> = {
    todo: 'secondary', in_progress: 'default', in_review: 'warning', done: 'success', canceled: 'danger',
  }
  return map[s]
}

type ViewMode = 'all' | 'mine'

export function TasksOverview() {
  const [view, setView] = useState<ViewMode>('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [sortBy, setSortBy] = useState('created_at')
  const [addOpen, setAddOpen] = useState(false)
  const [addProjectId, setAddProjectId] = useState('')

  const { data: tasks, isLoading } = trpc.tasks.list.useQuery({
    status: statusFilter !== 'all' ? statusFilter as TaskStatus : undefined,
    priority: priorityFilter !== 'all' ? priorityFilter as 'very_high' | 'high' | 'medium' | 'low' | 'very_low' : undefined,
    projectId: projectFilter !== 'all' ? projectFilter : undefined,
    onlyMine: view === 'mine',
  })

  const { data: projects } = trpc.projects.list.useQuery()
  const utils = trpc.useUtils()

  const sortedTasks = useMemo(() => {
    if (!tasks) return []
    const PRIORITY_ORDER: Record<string, number> = {
      very_high: 0, high: 1, medium: 2, low: 3, very_low: 4,
    }
    const STATUS_ORDER: Record<string, number> = {
      in_progress: 0, in_review: 1, todo: 2, done: 3, canceled: 4,
    }
    return [...tasks].sort((a, b) => {
      switch (sortBy) {
        case 'due_date': {
          if (!a.due_date && !b.due_date) return 0
          if (!a.due_date) return 1
          if (!b.due_date) return -1
          return a.due_date.localeCompare(b.due_date)
        }
        case 'priority':
          return (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99)
        case 'status':
          return (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
        default: // created_at
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
    })
  }, [tasks, sortBy])

  const updateTask = trpc.tasks.update.useMutation({
    onMutate: async (input) => {
      await utils.tasks.list.cancel()
      const prev = utils.tasks.list.getData()
      utils.tasks.list.setData(
        { status: statusFilter !== 'all' ? statusFilter as TaskStatus : undefined,
          priority: priorityFilter !== 'all' ? priorityFilter as 'very_high' | 'high' | 'medium' | 'low' | 'very_low' : undefined,
          projectId: projectFilter !== 'all' ? projectFilter : undefined,
          onlyMine: view === 'mine' },
        (old) => old?.map(t => t.id === input.id ? { ...t, ...(input.status && { status: input.status }) } : t) ?? []
      )
      return { prev }
    },
    onError: () => utils.tasks.list.invalidate(),
    onSettled: () => utils.tasks.list.invalidate(),
  })

  const hasFilters = statusFilter !== 'all' || priorityFilter !== 'all' || projectFilter !== 'all'

  function clearFilters() {
    setStatusFilter('all')
    setPriorityFilter('all')
    setProjectFilter('all')
  }

  return (
    <div className="space-y-4">
      {/* View toggle + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(['all', 'mine'] as ViewMode[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                view === v ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {v === 'all' ? <LayoutList className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
              {v === 'all' ? 'Todas' : 'Mis tareas'}
            </button>
          ))}
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(TASK_STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Prioridad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda prioridad</SelectItem>
            <SelectItem value="very_high">Muy alta</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
            <SelectItem value="medium">Media</SelectItem>
            <SelectItem value="low">Baja</SelectItem>
            <SelectItem value="very_low">Muy baja</SelectItem>
          </SelectContent>
        </Select>

        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Proyecto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los proyectos</SelectItem>
            {projects?.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Ordenar" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at">Más recientes</SelectItem>
            <SelectItem value="due_date">Fecha límite</SelectItem>
            <SelectItem value="priority">Prioridad</SelectItem>
            <SelectItem value="status">Estado</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>Limpiar</Button>
        )}

        <div className="ml-auto">
          <Button
            size="sm"
            onClick={() => {
              const first = projects?.[0]?.id
              if (first) { setAddProjectId(first); setAddOpen(true) }
            }}
            disabled={!projects?.length}
          >
            <Plus className="h-4 w-4" /> Nueva tarea
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-slate-100 px-4 py-2.5">
            <div className="h-3 w-10 rounded bg-slate-100 animate-pulse" />
          </div>
          <div className="divide-y divide-slate-50">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 items-center px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-slate-100 animate-pulse shrink-0" />
                  <div className="h-3.5 rounded bg-slate-100 animate-pulse" style={{ width: `${140 + (i % 3) * 40}px` }} />
                </div>
                <div className="hidden sm:block w-32 h-3 rounded bg-slate-100 animate-pulse" />
                <div className="hidden md:block w-24 h-5 w-5 rounded-full bg-slate-100 animate-pulse mx-auto" />
                <div className="hidden sm:block w-28 h-3 rounded bg-slate-100 animate-pulse" />
                <div className="w-32 h-7 rounded-md bg-slate-100 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : !sortedTasks.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white py-20 text-slate-400">
          <AlertCircle className="mb-3 h-8 w-8" />
          <p className="text-sm font-medium">No hay tareas</p>
          <p className="mt-1 text-xs">
            {hasFilters ? 'Probá cambiando los filtros' : 'Creá una tarea para empezar'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span>Tarea</span>
            <span className="hidden sm:block w-32">Proyecto</span>
            <span className="hidden md:block w-24">Responsable</span>
            <span className="hidden sm:block w-28">Vencimiento</span>
            <span className="w-32">Estado</span>
          </div>

          <div className="divide-y divide-slate-50">
            {sortedTasks.map(task => {
              const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
              const days = task.due_date ? daysUntil(task.due_date) : null
              const isOverdue = days !== null && days < 0 && task.status !== 'done' && task.status !== 'canceled'
              const project = task.project as { id: string; code: string; name: string; color: string } | null

              return (
                <div
                  key={task.id}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 items-center px-4 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`h-2 w-2 shrink-0 rounded-full ${priorityInfo?.dot ?? 'bg-slate-300'}`} />
                    <span className="text-sm text-slate-800 truncate">{task.title}</span>
                  </div>

                  {project && (
                    <Link
                      href={`/dashboard/projects/${project.id}`}
                      className="hidden sm:flex w-32 items-center gap-1.5 group"
                    >
                      <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
                      <span className="text-xs text-slate-400 group-hover:text-indigo-600 transition-colors truncate">
                        {project.code}
                      </span>
                    </Link>
                  )}
                  {!project && <div className="hidden sm:block w-32" />}

                  <div className="hidden md:flex w-24 justify-center">
                    {task.assignee ? (
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={(task.assignee as { avatar_url: string | null }).avatar_url ?? undefined} />
                        <AvatarFallback className="text-[10px]">
                          {(task.assignee as { name: string }).name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </div>

                  <div className={`hidden sm:flex w-28 items-center gap-1 text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                    {task.due_date ? (
                      <>
                        <Calendar className="h-3 w-3 shrink-0" />
                        {isOverdue ? `${Math.abs(days!)}d` : formatDate(task.due_date)}
                      </>
                    ) : '—'}
                  </div>

                  <div className="w-32">
                    <Select
                      value={task.status}
                      onValueChange={val => updateTask.mutate({ id: task.id, status: val as TaskStatus })}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(TASK_STATUS_LABELS).map(([v, l]) => (
                          <SelectItem key={v} value={v}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {sortedTasks.length > 0 && (
        <p className="text-right text-xs text-slate-400">{sortedTasks.length} tarea{sortedTasks.length !== 1 ? 's' : ''}</p>
      )}

      {addProjectId && (
        <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} projectId={addProjectId} onCreated={() => utils.tasks.list.invalidate()} />
      )}
    </div>
  )
}
