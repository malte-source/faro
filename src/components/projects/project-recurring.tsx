'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { describeCadence } from '@/lib/recurring'
import { Repeat, Plus, Trash2, ToggleLeft, ToggleRight, Calendar } from 'lucide-react'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'

interface Props { projectId: string }

const CADENCE_PRESETS = [
  { value: 'daily',            label: 'Todos los días' },
  { value: 'weekly:mon',       label: 'Cada Lunes' },
  { value: 'weekly:fri',       label: 'Cada Viernes' },
  { value: 'weekly:mon,wed,fri', label: 'Lun, Mié, Vie' },
  { value: 'monthly:1',        label: 'Día 1 de cada mes' },
  { value: 'monthly:15',       label: 'Día 15 de cada mes' },
  { value: 'monthly:last',     label: 'Último día del mes' },
] as const

const PRIORITY_OPTIONS = [
  { value: 'very_high', label: 'Muy alta' },
  { value: 'high',      label: 'Alta' },
  { value: 'medium',    label: 'Media' },
  { value: 'low',       label: 'Baja' },
  { value: 'very_low',  label: 'Muy baja' },
] as const

type Priority = typeof PRIORITY_OPTIONS[number]['value']

export function ProjectRecurring({ projectId }: Props) {
  const utils = trpc.useUtils()
  const { data: rules, isLoading } = trpc.recurring.byProject.useQuery(projectId)
  const { data: members } = trpc.team.members.useQuery()

  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [cadence, setCadence] = useState<string>('weekly:mon')
  const [priority, setPriority] = useState<Priority>('medium')
  const [assigneeId, setAssigneeId] = useState<string>('')

  const refetch = () => utils.recurring.byProject.invalidate(projectId)

  const create = trpc.recurring.create.useMutation({
    onSuccess: () => { refetch(); resetForm() },
  })
  const update = trpc.recurring.update.useMutation({ onSuccess: refetch })
  const remove = trpc.recurring.delete.useMutation({ onSuccess: refetch })

  function resetForm() {
    setCreating(false)
    setTitle('')
    setCadence('weekly:mon')
    setPriority('medium')
    setAssigneeId('')
  }

  function handleCreate() {
    if (!title.trim()) return
    create.mutate({
      projectId,
      titleTemplate: title.trim(),
      cadence,
      priority,
      assigneeId: assigneeId || undefined,
    })
  }

  return (
    <div className="rounded-xl border border-stone bg-white dark:border-night-700 dark:bg-night">
      <header className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 dark:border-night-700">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
          <Repeat className="h-4 w-4 text-signal-ink" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-night dark:text-stone-100">Tareas recurrentes</h3>
          <p className="text-[10px] uppercase tracking-wider text-graphite">
            Se materializan automáticamente según la cadencia (cron diario 00:30 ART)
          </p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90"
          >
            <Plus className="h-3 w-3" />
            Nueva regla
          </button>
        )}
      </header>

      {/* Creator */}
      {creating && (
        <div className="space-y-2 border-b border-stone-100 px-4 py-3 dark:border-night-700">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='Plantilla del título (ej: "Revisar pipeline semanal")'
            className="w-full rounded-lg border border-stone px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal dark:border-ink-body dark:bg-night-700"
            autoFocus
          />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              className="rounded-lg border border-stone bg-white px-2 py-1.5 text-xs dark:border-ink-body dark:bg-night-700"
            >
              {CADENCE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="rounded-lg border border-stone bg-white px-2 py-1.5 text-xs dark:border-ink-body dark:bg-night-700"
            >
              {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="rounded-lg border border-stone bg-white px-2 py-1.5 text-xs dark:border-ink-body dark:bg-night-700"
            >
              <option value="">Sin asignar</option>
              {(members ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={resetForm} className="rounded-md px-3 py-1 text-xs text-graphite hover:bg-stone-100 dark:hover:bg-night-700">Cancelar</button>
            <button
              onClick={handleCreate}
              disabled={!title.trim() || create.isPending}
              className="rounded-md bg-foreground px-3 py-1 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
            >
              {create.isPending ? 'Creando…' : 'Crear regla'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-2 p-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />
          ))}
        </div>
      ) : !rules?.length ? (
        <p className="px-4 py-8 text-center text-xs text-graphite">
          Sin reglas recurrentes. Crea una para que FARO genere tareas automáticamente.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-night-700">
          {rules.map(r => {
            const assignee = (r.assignee as { name?: string } | null)
            return (
              <li key={r.id} className={`flex items-start gap-3 px-4 py-3 ${!r.is_active ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-night dark:text-stone-100">{r.title_template}</p>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-graphite">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {describeCadence(r.cadence)}
                    </span>
                    <span>· Prioridad {r.priority.replace('_', ' ')}</span>
                    {assignee && <span>· {assignee.name}</span>}
                    <span>· Próxima: {r.next_run_at}</span>
                  </div>
                </div>
                <button
                  onClick={() => update.mutate({ id: r.id, isActive: !r.is_active })}
                  className="rounded-md p-1.5 text-graphite hover:bg-stone-100 hover:text-body dark:hover:bg-night-700"
                  title={r.is_active ? 'Pausar' : 'Activar'}
                >
                  {r.is_active ? <ToggleRight className="h-4 w-4 text-signal-ink" /> : <ToggleLeft className="h-4 w-4" />}
                </button>
                <button
                  onClick={async () => {
                    const ok = await confirmAction({ title: 'Borrar regla recurrente', description: 'Las instancias ya creadas se mantienen, pero deja de generar nuevas.', variant: 'destructive' })
                    if (ok) remove.mutate(r.id)
                  }}
                  className="rounded-md p-1.5 text-graphite hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
