'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import {
  Plus, Rocket, Target, CheckCircle2, Play, Archive, Trash2, ArrowRight, ArrowLeft,
} from 'lucide-react'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof Rocket }> = {
  planned:   { label: 'Planificado', cls: 'bg-stone-100 text-graphite dark:bg-night-700 dark:text-stone', icon: Target },
  active:    { label: 'Activo',      cls: 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal', icon: Play },
  completed: { label: 'Completado',  cls: 'bg-success-wash text-success dark:bg-success/40 dark:text-success/50', icon: CheckCircle2 },
}

const PRIORITY_DOT: Record<string, string> = {
  very_high: 'bg-danger', high: 'bg-signal-ink', medium: 'bg-signal-ink', low: 'bg-success', very_low: 'bg-stone',
}

export function SprintsBoard() {
  const utils = trpc.useUtils()
  const { data: sprints, isLoading } = trpc.sprints.list.useQuery()
  const { data: backlog } = trpc.sprints.backlog.useQuery()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().split('T')[0])

  const refetch = () => {
    utils.sprints.list.invalidate()
    utils.sprints.backlog.invalidate()
    if (selectedId) utils.sprints.byId.invalidate(selectedId)
  }

  const create = trpc.sprints.create.useMutation({
    onSuccess: (s) => { refetch(); setCreating(false); setName(''); setGoal(''); setSelectedId(s.id) },
  })
  const update = trpc.sprints.update.useMutation({ onSuccess: refetch })
  const remove = trpc.sprints.delete.useMutation({ onSuccess: () => { refetch(); setSelectedId(null) } })
  const assign = trpc.sprints.assignTask.useMutation({ onSuccess: refetch })

  const selectedSprint = trpc.sprints.byId.useQuery(selectedId!, { enabled: !!selectedId })

  if (isLoading) {
    return <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-100 dark:bg-night-700" />)}</div>
  }

  // ── Detail view ──────────────────────────────────────────────────────
  if (selectedId && selectedSprint.data) {
    const s = selectedSprint.data
    const meta = STATUS_META[s.status]
    const cols = (['todo', 'in_progress', 'in_review', 'done'] as const)
    const colLabels = { todo: 'Por hacer', in_progress: 'En progreso', in_review: 'En revisión', done: 'Listo' }

    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedId(null)} className="inline-flex items-center gap-1 text-xs text-graphite hover:text-body">
          <ArrowLeft className="h-3 w-3" /> Volver a sprints
        </button>

        <div className="rounded-xl border border-stone bg-white p-4 dark:border-night-700 dark:bg-night">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-night dark:text-stone-100">{s.name}</h2>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', meta.cls)}>{meta.label}</span>
              </div>
              {s.goal && <p className="mt-0.5 text-sm text-graphite">{s.goal}</p>}
              <p className="mt-1 text-[11px] text-graphite">{s.start_date} → {s.end_date}</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Velocity */}
              <div className="text-right">
                <p className="text-lg font-bold tabular-nums text-night dark:text-signal">{s.velocity.pct}%</p>
                <p className="text-[10px] text-graphite">{s.velocity.done}/{s.velocity.total} tareas</p>
              </div>
              {s.status !== 'active' && (
                <button onClick={() => update.mutate({ id: s.id, status: 'active' })} className="rounded-lg bg-night px-2.5 py-1 text-xs font-semibold text-white hover:bg-night-700 dark:bg-signal dark:text-night dark:hover:bg-signal/90">Activar</button>
              )}
              {s.status === 'active' && (
                <button onClick={() => update.mutate({ id: s.id, status: 'completed' })} className="rounded-lg bg-success px-2.5 py-1 text-xs font-semibold text-white hover:bg-success">Completar</button>
              )}
              <button onClick={async () => {
                const ok = await confirmAction({ title: `Borrar sprint "${s.name}"`, description: 'Las tareas asignadas vuelven al backlog.', variant: 'destructive' })
                if (ok) remove.mutate(s.id)
              }} className="rounded-md p-1.5 text-graphite hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-night-700">
            <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${s.velocity.pct}%` }} />
          </div>
        </div>

        {/* Mini board by status */}
        <div className="grid gap-3 md:grid-cols-4">
          {cols.map(col => {
            const colTasks = s.tasks.filter(t => t.status === col)
            return (
              <div key={col} className="rounded-xl border border-stone bg-mist/50 p-2 dark:border-night-700 dark:bg-night/40">
                <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-graphite">{colLabels[col]} · {colTasks.length}</p>
                <ul className="space-y-1.5">
                  {colTasks.map(t => {
                    const proj = t.project as { code: string; color: string } | null
                    return (
                      <li key={t.id} className="group rounded-lg bg-white p-2 text-xs shadow-sm dark:bg-night-700">
                        <div className="flex items-start gap-1.5">
                          <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', PRIORITY_DOT[t.priority])} />
                          <span className="flex-1 text-night-700 dark:text-stone">{t.title}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          {proj && <span className="text-[10px] text-graphite">{proj.code}</span>}
                          <button onClick={() => assign.mutate({ taskId: t.id, sprintId: null })} className="text-[10px] text-graphite md:opacity-0 hover:text-danger md:group-hover:opacity-100">quitar</button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>

        {/* Backlog to pull from */}
        <div className="rounded-xl border border-dashed border-stone bg-white p-3 dark:border-ink-body dark:bg-night">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-graphite">Backlog — agregar al sprint</p>
          {!backlog?.length ? (
            <p className="py-3 text-center text-xs text-graphite">Backlog vacío.</p>
          ) : (
            <ul className="grid gap-1.5 md:grid-cols-2">
              {backlog.slice(0, 20).map(t => {
                const proj = t.project as { code: string } | null
                return (
                  <li key={t.id} className="flex items-center gap-2 rounded-lg bg-mist px-2 py-1.5 text-xs dark:bg-night-700">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', PRIORITY_DOT[t.priority])} />
                    <span className="flex-1 truncate text-ink-body dark:text-stone">{t.title}</span>
                    {proj && <span className="text-[10px] text-graphite">{proj.code}</span>}
                    <button onClick={() => assign.mutate({ taskId: t.id, sprintId: s.id })} className="inline-flex items-center gap-0.5 rounded bg-night px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-night-700 dark:bg-signal dark:text-night dark:hover:bg-signal/90">
                      <ArrowRight className="h-2.5 w-2.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    )
  }

  // ── List view ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {creating ? (
        <div className="space-y-2 rounded-xl border border-stone bg-signal-wash/30 p-3 dark:border-signal/40 dark:bg-signal/20">
          <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder='Nombre (ej: "Sprint 12 — Junio S1")' className="w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700" />
          <input value={goal} onChange={e => setGoal(e.target.value)} placeholder="Objetivo del sprint (opcional)" className="w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700" />
          <div className="flex gap-2">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="flex-1 rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700" />
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="flex-1 rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="rounded-md px-3 py-1 text-xs text-graphite hover:bg-stone-100 dark:hover:bg-night-700">Cancelar</button>
            <button onClick={() => create.mutate({ name: name.trim(), goal: goal || undefined, startDate, endDate })} disabled={!name.trim() || create.isPending} className="rounded-md bg-night px-3 py-1 text-xs font-semibold text-white hover:bg-night-700 disabled:opacity-50 dark:bg-signal dark:text-night dark:hover:bg-signal/90">Crear sprint</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone px-4 py-3 text-sm font-medium text-graphite transition hover:border-signal/50 hover:bg-signal-wash/40 hover:text-night dark:border-ink-body dark:hover:bg-signal/30">
          <Plus className="h-4 w-4" /> Nuevo sprint
        </button>
      )}

      {!sprints?.length ? (
        <div className="rounded-xl border border-dashed border-stone bg-white p-12 text-center dark:border-ink-body dark:bg-night">
          <Rocket className="mx-auto h-8 w-8 text-stone" />
          <p className="mt-3 text-sm text-graphite">Sin sprints. Crea el primero y arrastra tareas del backlog.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sprints.map(s => {
            const meta = STATUS_META[s.status]
            const Icon = meta.icon
            return (
              <li key={s.id}>
                <button onClick={() => setSelectedId(s.id)} className="flex w-full items-center gap-3 rounded-xl border border-stone bg-white p-4 text-left transition hover:border-signal/40 hover:shadow-sm dark:border-night-700 dark:bg-night dark:hover:border-signal/60">
                  <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', meta.cls)}><Icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-night dark:text-stone-100">{s.name}</p>
                    {s.goal && <p className="truncate text-xs text-graphite">{s.goal}</p>}
                  </div>
                  <div className="text-right">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', meta.cls)}>{meta.label}</span>
                    <p className="mt-1 text-[10px] text-graphite">{s.start_date} → {s.end_date}</p>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
