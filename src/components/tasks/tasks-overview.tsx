'use client'

import { useState, useMemo } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AddTaskDialog } from '@/components/projects/add-task-dialog'
import { BulkActionsBar } from '@/components/tasks/bulk-actions-bar'
import { SavedViews, type ViewFilters } from '@/components/tasks/saved-views'
import { PRIORITY } from '@/lib/utils'
import { Plus, AlertCircle, LayoutList, User, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type { TaskStatus } from '@/types/database'
import { DueDateChip } from '@/components/ui/due-date-chip'
import { Segmented } from '@/components/mobile/segmented'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'
import { TaskDetailPanel } from '@/components/projects/task-detail-panel'
import { FilterChip } from '@/components/projects/mobile-bits'
import { MobileTaskRow, TaskActionsSheet, TaskCard, TaskEmpty, type RowTask } from '@/components/tasks/mobile-task-row'
import {
  TasksFilterSheet, TASK_STATUS_LABELS as MOBILE_STATUS_LABELS, TASK_PRIORITY_LABELS, DUE_LABELS,
  type TaskFilterValues,
} from '@/components/tasks/tasks-filter-sheet'
import { CheckSquare, ListChecks, SlidersHorizontal, FolderOpen } from 'lucide-react'

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
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [reviewerFilter, setReviewerFilter] = useState('all')
  const [labelFilter, setLabelFilter] = useState('')
  const [dueWithinFilter, setDueWithinFilter] = useState<'all' | '3' | '7' | '14' | '30'>('all')
  const [onlyBlocked, setOnlyBlocked] = useState(false)
  const [sortBy, setSortBy] = useState('created_at')
  const [addOpen, setAddOpen] = useState(false)
  const [addProjectId, setAddProjectId] = useState('')
  // Multi-select state for bulk operations.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const { data: tasks, isLoading } = trpc.tasks.list.useQuery({
    status: statusFilter !== 'all' ? statusFilter as TaskStatus : undefined,
    priority: priorityFilter !== 'all' ? priorityFilter as 'very_high' | 'high' | 'medium' | 'low' | 'very_low' : undefined,
    projectId: projectFilter !== 'all' ? projectFilter : undefined,
    assigneeId: assigneeFilter !== 'all' ? assigneeFilter : undefined,
    reviewerId: reviewerFilter !== 'all' ? reviewerFilter : undefined,
    label: labelFilter.trim() || undefined,
    dueWithinDays: dueWithinFilter !== 'all' ? parseInt(dueWithinFilter, 10) : undefined,
    onlyBlocked: onlyBlocked || undefined,
    onlyMine: view === 'mine',
  })

  const { data: projects } = trpc.projects.list.useQuery()
  const { data: members } = trpc.team.members.useQuery()
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
    onError: () => utils.tasks.invalidate(),
    onSettled: () => utils.tasks.invalidate(),
  })

  const hasFilters =
    statusFilter !== 'all' || priorityFilter !== 'all' || projectFilter !== 'all' ||
    assigneeFilter !== 'all' || reviewerFilter !== 'all' || labelFilter.trim() !== '' ||
    dueWithinFilter !== 'all' || onlyBlocked

  function clearFilters() {
    setStatusFilter('all')
    setPriorityFilter('all')
    setProjectFilter('all')
    setAssigneeFilter('all')
    setReviewerFilter('all')
    setLabelFilter('')
    setDueWithinFilter('all')
    setOnlyBlocked(false)
  }

  const currentView: ViewFilters = { view, statusFilter, priorityFilter, projectFilter, sortBy }
  const applyView = (f: ViewFilters) => {
    setView(f.view)
    setStatusFilter(f.statusFilter)
    setPriorityFilter(f.priorityFilter)
    setProjectFilter(f.projectFilter)
    setSortBy(f.sortBy)
  }

  // ── Phones ──────────────────────────────────────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [moreTaskId, setMoreTaskId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ id: string; projectId: string } | null>(null)

  const filterValues: TaskFilterValues = {
    status: statusFilter, priority: priorityFilter, project: projectFilter, assignee: assigneeFilter,
    reviewer: reviewerFilter, label: labelFilter, dueWithin: dueWithinFilter, onlyBlocked, sortBy,
  }
  const applyFilters = (v: TaskFilterValues) => {
    setStatusFilter(v.status); setPriorityFilter(v.priority); setProjectFilter(v.project)
    setAssigneeFilter(v.assignee); setReviewerFilter(v.reviewer); setLabelFilter(v.label)
    setDueWithinFilter(v.dueWithin as typeof dueWithinFilter); setOnlyBlocked(v.onlyBlocked); setSortBy(v.sortBy)
  }
  const nameOf = (id: string) => (members ?? []).find(m => m.id === id)?.name ?? 'Persona'
  const activeChips: Array<{ key: string; label: string; clear: () => void }> = [
    ...(statusFilter !== 'all' ? [{ key: 'status', label: MOBILE_STATUS_LABELS[statusFilter] ?? statusFilter, clear: () => setStatusFilter('all') }] : []),
    ...(priorityFilter !== 'all' ? [{ key: 'priority', label: `Prioridad ${(TASK_PRIORITY_LABELS[priorityFilter] ?? priorityFilter).toLowerCase()}`, clear: () => setPriorityFilter('all') }] : []),
    ...(projectFilter !== 'all' ? [{ key: 'project', label: projects?.find(p => p.id === projectFilter)?.code ?? 'Proyecto', clear: () => setProjectFilter('all') }] : []),
    ...(assigneeFilter !== 'all' ? [{ key: 'assignee', label: nameOf(assigneeFilter).split(' ')[0], clear: () => setAssigneeFilter('all') }] : []),
    ...(reviewerFilter !== 'all' ? [{ key: 'reviewer', label: `Revisa ${nameOf(reviewerFilter).split(' ')[0]}`, clear: () => setReviewerFilter('all') }] : []),
    ...(labelFilter.trim() ? [{ key: 'label', label: `#${labelFilter.trim()}`, clear: () => setLabelFilter('') }] : []),
    ...(dueWithinFilter !== 'all' ? [{ key: 'due', label: DUE_LABELS[dueWithinFilter] ?? 'Vence pronto', clear: () => setDueWithinFilter('all') }] : []),
    ...(onlyBlocked ? [{ key: 'blocked', label: 'Bloqueadas', clear: () => setOnlyBlocked(false) }] : []),
  ]
  const moreTask = sortedTasks.find(t => t.id === moreTaskId) ?? null
  const toggleDone = (id: string, status: string) =>
    updateTask.mutate({ id, status: status === 'done' ? 'todo' : 'done' })

  return (
    <>
    {/* ─── Phones: segmented scope, one Filtros button, inset rows with swipe actions ─── */}
    <div className="space-y-3 md:hidden">
      <SavedViews current={currentView} onApply={applyView} />

      <Segmented
        aria-label="Alcance"
        value={view}
        onChange={setView}
        options={[{ value: 'all', label: 'Todas' }, { value: 'mine', label: 'Mis tareas' }]}
      />

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-track data-no-ptr>
        <FilterChip onClick={() => setFiltersOpen(true)} count={activeChips.length}>
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
        </FilterChip>
        {activeChips.map(c => (
          <FilterChip key={c.key} selected onRemove={c.clear}>{c.label}</FilterChip>
        ))}
        {sortedTasks.length > 0 && (
          <FilterChip selected={selectMode} onClick={() => { if (selectMode) setSelected(new Set()); setSelectMode(m => !m) }}>
            <CheckSquare className="h-4 w-4" />
            {selectMode ? 'Listo' : 'Seleccionar'}
          </FilterChip>
        )}
      </div>

      {isLoading ? (
        <TaskCard>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex min-h-[62px] items-center gap-3 px-4 py-2.5">
              <div className="h-[22px] w-[22px] shrink-0 animate-pulse rounded-[7px] bg-border-soft" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 animate-pulse rounded bg-border-soft" style={{ width: `${55 + (i % 3) * 15}%` }} />
                <div className="h-3 w-1/3 animate-pulse rounded bg-border-soft" />
              </div>
            </div>
          ))}
        </TaskCard>
      ) : !sortedTasks.length ? (
        <TaskEmpty
          icon={<ListChecks />}
          title={hasFilters ? 'Nada con esos filtros' : view === 'mine' ? 'No tienes tareas' : 'Aún no hay tareas'}
          hint={hasFilters ? 'Prueba quitando algún filtro.' : view === 'mine' ? 'Cuando te asignen algo, aparece aquí.' : 'Crea una con el botón + de abajo.'}
          action={hasFilters ? (
            <button type="button" onClick={clearFilters} className="h-11 rounded-full bg-foreground px-5 text-sm font-semibold text-background active:opacity-90">Limpiar filtros</button>
          ) : undefined}
        />
      ) : (
        <TaskCard>
          {sortedTasks.map(task => (
            <MobileTaskRow
              key={task.id}
              task={task as unknown as RowTask}
              showProject
              selectMode={selectMode}
              selected={selected.has(task.id)}
              onSelectToggle={() => toggleSelected(task.id)}
              onOpen={() => {
                const p = task.project as { id: string } | null
                if (p) setDetail({ id: task.id, projectId: p.id })
              }}
              onToggleDone={() => toggleDone(task.id, task.status)}
              onMore={() => setMoreTaskId(task.id)}
            />
          ))}
        </TaskCard>
      )}

      {sortedTasks.length > 0 && (
        <p className="pb-2 text-center text-xs text-graphite">{sortedTasks.length} tarea{sortedTasks.length !== 1 ? 's' : ''}</p>
      )}

      <TasksFilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        values={filterValues}
        onApply={applyFilters}
        projects={(projects ?? []).map(p => ({ id: p.id, code: p.code, name: p.name }))}
        members={(members ?? []).map(m => ({ id: m.id, name: m.name }))}
      />

      <TaskActionsSheet
        open={!!moreTask}
        onClose={() => setMoreTaskId(null)}
        title={moreTask?.title ?? ''}
        status={moreTask?.status}
        onStatus={st => moreTask && updateTask.mutate({ id: moreTask.id, status: st })}
      >
        {(moreTask?.project as { id: string } | null | undefined) && (
          <InsetGroup>
            <ListRow
              title="Abrir proyecto"
              href={`/dashboard/projects/${(moreTask!.project as { id: string }).id}`}
              leading={<IconTile tone="neutral"><FolderOpen /></IconTile>}
            />
          </InsetGroup>
        )}
      </TaskActionsSheet>

      {detail && (
        <TaskDetailPanel taskId={detail.id} projectId={detail.projectId} onClose={() => setDetail(null)} />
      )}
    </div>

    <div className="hidden space-y-4 md:block">
      {/* Saved views — quick switcher */}
      <SavedViews current={currentView} onApply={applyView} />

      {/* View toggle + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-surface p-0.5">
          {(['all', 'mine'] as ViewMode[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                view === v ? 'bg-foreground text-background' : 'text-graphite hover:text-body'
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

        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Asignado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Cualquier asignado</SelectItem>
            {(members ?? []).map(m => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={reviewerFilter} onValueChange={setReviewerFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Reviewer" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Cualquier reviewer</SelectItem>
            {(members ?? []).map(m => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={dueWithinFilter} onValueChange={(v) => setDueWithinFilter(v as typeof dueWithinFilter)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Vencimiento" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Cualquier vencimiento</SelectItem>
            <SelectItem value="3">Próx. 3 días</SelectItem>
            <SelectItem value="7">Próx. 7 días</SelectItem>
            <SelectItem value="14">Próx. 14 días</SelectItem>
            <SelectItem value="30">Próx. 30 días</SelectItem>
          </SelectContent>
        </Select>

        <input
          type="text"
          value={labelFilter}
          onChange={e => setLabelFilter(e.target.value)}
          placeholder="Etiqueta…"
          className="w-32 rounded-md border border-stone bg-white px-2 py-1 text-xs dark:border-ink-body dark:bg-night-700"
        />

        <button
          onClick={() => setOnlyBlocked(b => !b)}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition ${
            onlyBlocked
              ? 'border-signal-ink bg-signal-wash text-signal-ink dark:border-signal-ink dark:bg-signal/40 dark:text-signal/50'
              : 'border-stone text-graphite hover:text-ink-body dark:border-ink-body dark:text-graphite'
          }`}
          title="Solo tareas bloqueadas por una dependencia incompleta"
        >
          🔗 Bloqueadas
        </button>

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
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-border-soft px-4 py-2.5">
            <div className="h-3 w-10 rounded bg-border-soft animate-pulse" />
          </div>
          <div className="divide-y divide-mist">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 items-center px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-border-soft animate-pulse shrink-0" />
                  <div className="h-3.5 rounded bg-border-soft animate-pulse" style={{ width: `${140 + (i % 3) * 40}px` }} />
                </div>
                <div className="hidden sm:block w-32 h-3 rounded bg-border-soft animate-pulse" />
                <div className="hidden md:block w-24 h-5 w-5 rounded-full bg-border-soft animate-pulse mx-auto" />
                <div className="hidden sm:block w-28 h-3 rounded bg-border-soft animate-pulse" />
                <div className="w-32 h-7 rounded-md bg-border-soft animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : !sortedTasks.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface py-20 text-graphite">
          <AlertCircle className="mb-3 h-8 w-8" />
          <p className="text-sm font-medium">No hay tareas</p>
          <p className="mt-1 text-xs">
            {hasFilters ? 'Prueba cambiando los filtros' : 'Crea una tarea para empezar'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-stone bg-white overflow-hidden dark:border-night-700 dark:bg-night">
          {/* Desktop-only column headers — mobile uses card layout */}
          <div className="hidden md:grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-4 border-b border-stone-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-graphite dark:border-night-700">
            <span className="w-3.5" />
            <span>Tarea</span>
            <span className="w-32">Proyecto</span>
            <span className="w-24 text-center">Resp.</span>
            <span className="w-28">Vencimiento</span>
            <span className="w-32">Estado</span>
          </div>

          <div className="divide-y divide-stone-100 dark:divide-night-700">
            {sortedTasks.map(task => {
              const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
              const project = task.project as { id: string; code: string; name: string; color: string } | null
              const assignee = task.assignee as { name: string; avatar_url: string | null } | null
              const isDone = task.status === 'done' || task.status === 'canceled'
              const isSelected = selected.has(task.id)
              const projectHref = project ? `/dashboard/projects/${project.id}` : '#'

              return (
                <div
                  key={task.id}
                  className={`group transition-colors ${isSelected ? 'bg-signal-wash dark:bg-signal/30' : 'hover:bg-mist dark:hover:bg-night-700/40'}`}
                >
                  {/* ─── MOBILE LAYOUT (< md) — vertical card, tappable ─── */}
                  <Link
                    href={projectHref}
                    className="block touch-manipulation px-4 py-3 active:bg-stone-100 dark:active:bg-night-700 md:hidden"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${priorityInfo?.dot ?? 'bg-stone'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-night-700 dark:text-stone-100 line-clamp-2">{task.title}</p>
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-graphite dark:text-graphite">
                          {project && (
                            <span className="inline-flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: project.color }} />
                              <span className="font-mono">{project.code}</span>
                            </span>
                          )}
                          {task.due_date && (
                            <>
                              <span className="text-stone">·</span>
                              <DueDateChip date={task.due_date} isDone={isDone} compact />
                            </>
                          )}
                          {assignee && (
                            <>
                              <span className="text-stone">·</span>
                              <span className="inline-flex items-center gap-1">
                                <Avatar className="h-4 w-4">
                                  <AvatarImage src={assignee.avatar_url ?? undefined} />
                                  <AvatarFallback className="text-[8px]">{assignee.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <span className="truncate max-w-[100px]">{assignee.name.split(' ')[0]}</span>
                              </span>
                            </>
                          )}
                        </div>
                        {/* Inline status selector for quick mobile editing */}
                        <div className="mt-2 flex items-center gap-2" onClick={e => e.preventDefault()}>
                          <Select
                            value={task.status}
                            onValueChange={val => updateTask.mutate({ id: task.id, status: val as TaskStatus })}
                          >
                            <SelectTrigger className="h-7 w-32 text-[11px]" onClick={e => e.preventDefault()}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(TASK_STATUS_LABELS).map(([v, l]) => (
                                <SelectItem key={v} value={v}>{l}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Badge variant={taskStatusVariant(task.status as TaskStatus)} className="text-[9px] px-1.5">
                            {priorityInfo?.label ?? task.priority}
                          </Badge>
                        </div>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-stone" />
                    </div>
                  </Link>

                  {/* ─── DESKTOP LAYOUT (md+) — table row ─── */}
                  <div className="hidden md:grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-4 items-center px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(task.id)}
                      className={`h-3.5 w-3.5 cursor-pointer rounded border-border text-signal-ink transition focus:ring-signal ${isSelected ? '' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}
                      aria-label="Seleccionar tarea"
                    />
                    <Link href={projectHref} className="flex items-center gap-2.5 min-w-0 hover:text-night dark:hover:text-signal">
                      <div className={`h-2 w-2 shrink-0 rounded-full ${priorityInfo?.dot ?? 'bg-stone'}`} />
                      <span className="text-sm text-night-700 truncate dark:text-stone-100">{task.title}</span>
                    </Link>

                    {project ? (
                      <Link
                        href={`/dashboard/projects/${project.id}`}
                        className="flex w-32 items-center gap-1.5 group/p"
                      >
                        <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
                        <span className="text-xs text-graphite group-hover/p:text-signal-ink transition-colors truncate">
                          {project.code}
                        </span>
                      </Link>
                    ) : <div className="w-32" />}

                    <div className="flex w-24 justify-center">
                      {assignee ? (
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={assignee.avatar_url ?? undefined} />
                          <AvatarFallback className="text-[10px]">{assignee.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      ) : <span className="text-xs text-stone">—</span>}
                    </div>

                    <div className="flex w-28">
                      {task.due_date ? (
                        <DueDateChip date={task.due_date} isDone={isDone} variant="text" />
                      ) : <span className="text-xs text-stone">—</span>}
                    </div>

                    <div className="w-32">
                      <Select
                        value={task.status}
                        onValueChange={val => updateTask.mutate({ id: task.id, status: val as TaskStatus })}
                      >
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(TASK_STATUS_LABELS).map(([v, l]) => (
                            <SelectItem key={v} value={v}>{l}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {sortedTasks.length > 0 && (
        <p className="text-right text-xs text-graphite">{sortedTasks.length} tarea{sortedTasks.length !== 1 ? 's' : ''}</p>
      )}

      {addProjectId && (
        <AddTaskDialog open={addOpen} onOpenChange={setAddOpen} projectId={addProjectId} onCreated={() => utils.tasks.invalidate()} />
      )}

    </div>

    {/* Bulk-actions bar (floating pill on desktop, pinned above the tab bar on phones) — only with a selection */}
    <BulkActionsBar selectedIds={Array.from(selected)} onClear={() => { setSelected(new Set()); setSelectMode(false) }} />
    </>
  )
}
