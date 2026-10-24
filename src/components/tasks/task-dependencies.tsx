'use client'

import { useState, useMemo } from 'react'
import { trpc } from '@/lib/trpc/client'
import { GitBranch, Plus, X, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface Props {
  taskId: string
  projectId: string
}

/**
 * UI to add/remove "blocked by" relationships on a task.
 *
 * Cycle detection runs server-side in tasks.addDependency — we just surface
 * the error nicely.
 */
export function TaskDependencies({ taskId, projectId }: Props) {
  const utils = trpc.useUtils()
  const { data: deps } = trpc.tasks.dependenciesByProject.useQuery(projectId)
  const { data: tasks } = trpc.tasks.byProject.useQuery(projectId)

  const [adding, setAdding] = useState(false)
  const [selectedId, setSelectedId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  // Dependencies WHERE this task is the blocked one (depends_on others)
  const blockedBy = useMemo(() => (deps ?? []).filter(d => d.task_id === taskId), [deps, taskId])
  const blockerIds = new Set(blockedBy.map(d => d.depends_on_id))

  // Dependencies WHERE this task blocks others (informational)
  const blocking = useMemo(() => (deps ?? []).filter(d => d.depends_on_id === taskId), [deps, taskId])
  const blockingIds = new Set(blocking.map(d => d.task_id))

  const taskMap = useMemo(() => {
    const m = new Map<string, { id: string; title: string; status: string }>()
    for (const t of tasks ?? []) m.set(t.id, { id: t.id, title: t.title, status: t.status })
    return m
  }, [tasks])

  // Tasks eligible as new blockers: same project, not self, not already a blocker
  const eligible = useMemo(() => {
    return (tasks ?? []).filter(t =>
      t.id !== taskId && !blockerIds.has(t.id) && !blockingIds.has(t.id)
    )
  }, [tasks, taskId, blockerIds, blockingIds])

  const refetch = () => {
    utils.tasks.dependenciesByProject.invalidate(projectId)
  }

  const add = trpc.tasks.addDependency.useMutation({
    onSuccess: () => {
      refetch()
      setAdding(false)
      setSelectedId('')
      setError(null)
    },
    onError: (e) => setError(e.message),
  })

  const remove = trpc.tasks.removeDependency.useMutation({ onSuccess: refetch })

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-graphite" />
        <span className="text-xs font-semibold text-graphite dark:text-stone">
          Dependencias
        </span>
      </div>

      {/* Blocked by */}
      {blockedBy.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-danger dark:text-danger">Bloqueada por</p>
          <ul className="space-y-1">
            {blockedBy.map(d => {
              const blocker = taskMap.get(d.depends_on_id)
              const isDone = blocker?.status === 'done'
              return (
                <li key={d.id} className="group flex items-center gap-2 rounded-md bg-danger-wash px-2 py-1 text-xs dark:bg-danger/30">
                  {isDone
                    ? <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                    : <AlertTriangle className="h-3 w-3 shrink-0 text-danger" />}
                  <span className={`flex-1 truncate ${isDone ? 'text-graphite line-through' : 'text-night-700 dark:text-stone'}`}>
                    {blocker?.title ?? d.depends_on_id}
                  </span>
                  <button
                    onClick={() => remove.mutate(d.id)}
                    className="rounded p-0.5 text-stone opacity-100 md:opacity-0 hover:bg-danger-wash hover:text-danger md:group-hover:opacity-100 dark:hover:bg-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Blocking (informational) */}
      {blocking.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-signal-ink dark:text-signal-ink">Bloquea a</p>
          <ul className="space-y-1">
            {blocking.map(d => {
              const t = taskMap.get(d.task_id)
              return (
                <li key={d.id} className="flex items-center gap-2 rounded-md bg-signal-wash px-2 py-1 text-xs dark:bg-signal/30">
                  <GitBranch className="h-3 w-3 shrink-0 text-signal-ink" />
                  <span className="flex-1 truncate text-ink-body dark:text-stone">{t?.title ?? d.task_id}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Add dependency */}
      {adding ? (
        <div className="space-y-1.5">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            autoFocus
            className="w-full rounded-md border border-stone bg-white px-2 py-1 text-xs dark:border-graphite dark:bg-night-700"
          >
            <option value="">— Elige tarea que la bloquea —</option>
            {eligible.map(t => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <div className="flex justify-end gap-1.5">
            <button
              onClick={() => { setAdding(false); setSelectedId(''); setError(null) }}
              className="rounded-md px-2 py-1 text-[11px] text-graphite hover:bg-stone-100 dark:hover:bg-night-700"
            >Cancelar</button>
            <button
              onClick={() => add.mutate({ taskId, dependsOnId: selectedId })}
              disabled={!selectedId || add.isPending}
              className="rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
            >Agregar</button>
          </div>
          {error && <p className="text-[11px] text-danger">{error}</p>}
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-graphite hover:bg-stone-100 hover:text-body dark:hover:bg-night-700"
        >
          <Plus className="h-3 w-3" />
          Agregar dependencia
        </button>
      )}
    </div>
  )
}
