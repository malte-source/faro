'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { describeCadence } from '@/lib/recurring'
import { Repeat, Plus, Trash2, ToggleLeft, ToggleRight, Calendar, AlertCircle } from 'lucide-react'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'

/**
 * Org-wide view of every recurring task rule across all the caller's projects.
 *
 * The per-project view (`<ProjectRecurring>`) is the deep one — this one
 * lets you scan the full catalogue, see which rules are pausing the team
 * with too many auto-tasks, or quickly create a new rule on any project.
 */

const CADENCE_PRESETS = [
  { value: 'daily',              label: 'Todos los días' },
  { value: 'weekly:mon',         label: 'Cada Lunes' },
  { value: 'weekly:fri',         label: 'Cada Viernes' },
  { value: 'weekly:mon,wed,fri', label: 'Lun, Mié, Vie' },
  { value: 'weekly:tue,thu',     label: 'Mar y Jue' },
  { value: 'monthly:1',          label: 'Día 1 del mes' },
  { value: 'monthly:15',         label: 'Día 15 del mes' },
  { value: 'monthly:last',       label: 'Último día del mes' },
] as const

const PRIORITY_OPTIONS = [
  { value: 'very_high', label: 'Muy alta' },
  { value: 'high',      label: 'Alta' },
  { value: 'medium',    label: 'Media' },
  { value: 'low',       label: 'Baja' },
  { value: 'very_low',  label: 'Muy baja' },
] as const

type Priority = typeof PRIORITY_OPTIONS[number]['value']

export function RecurringBoard() {
  const utils = trpc.useUtils()
  const { data: rules, isLoading, error } = trpc.recurring.listAll.useQuery()
  const { data: projects } = trpc.projects.list.useQuery()
  const { data: members } = trpc.team.members.useQuery()

  const [creating, setCreating] = useState(false)
  const [projectId, setProjectId] = useState<string>('')
  const [title, setTitle] = useState('')
  const [cadence, setCadence] = useState<string>('weekly:mon')
  const [priority, setPriority] = useState<Priority>('medium')
  const [assigneeId, setAssigneeId] = useState<string>('')

  // Auto-select first available project so the button isn't silently disabled
  // for first-time users.  Without this, the form opens, button is disabled,
  // and nothing happens on click — user thinks "está roto".
  useEffect(() => {
    if (creating && !projectId && projects && projects.length > 0) {
      setProjectId(projects[0].id)
    }
  }, [creating, projectId, projects])

  const create = trpc.recurring.create.useMutation({
    onSuccess: () => {
      toast.success('Regla creada', 'La próxima ocurrencia se materializa en el cron diario.')
      utils.recurring.invalidate()
      resetForm()
    },
    onError: (e) => toast.error('No se pudo crear', e.message),
  })
  const update = trpc.recurring.update.useMutation({
    onSuccess: () => { toast.success('Regla actualizada'); utils.recurring.invalidate() },
    onError: (e) => toast.error('No se pudo actualizar', e.message),
  })
  const remove = trpc.recurring.delete.useMutation({
    onSuccess: () => { toast.success('Regla borrada'); utils.recurring.invalidate() },
    onError: (e) => toast.error('No se pudo borrar', e.message),
  })

  function resetForm() {
    setCreating(false)
    setProjectId('')
    setTitle('')
    setCadence('weekly:mon')
    setPriority('medium')
    setAssigneeId('')
  }

  function handleCreate() {
    // Make validation failures LOUD instead of silently returning.
    if (!projectId) {
      toast.warning('Falta seleccionar un proyecto')
      return
    }
    if (!title.trim()) {
      toast.warning('Falta el título de la regla')
      return
    }
    create.mutate({
      projectId,
      titleTemplate: title.trim(),
      cadence,
      priority,
      assigneeId: assigneeId || undefined,
    })
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-night px-3 py-1.5 text-xs font-semibold text-white hover:bg-night-700 dark:bg-signal dark:text-night dark:hover:bg-signal/90 max-md:h-10 max-md:px-4 max-md:text-sm"
          >
            <Plus className="h-3.5 w-3.5" /> Nueva regla recurrente
          </button>
        )}
        <p className="ml-auto text-xs text-graphite">
          {rules?.length ?? 0} regla{rules?.length === 1 ? '' : 's'} · {rules?.filter(r => r.is_active).length ?? 0} activas
        </p>
      </div>

      {/* Inline creator */}
      {creating && (
        <div className="mb-4 space-y-2 rounded-xl border border-stone bg-signal-wash/30 p-4 dark:border-signal/40 dark:bg-signal/20">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="rounded-lg border border-stone bg-white px-2 py-2 text-sm dark:border-ink-body dark:bg-night-700"
            >
              <option value="">— Elegir proyecto —</option>
              {(projects ?? []).map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder='Título plantilla (ej: "Revisar pipeline semanal")'
              className="rounded-lg border border-stone px-3 py-2 text-sm outline-none focus:border-signal dark:border-ink-body dark:bg-night-700"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <select
              value={cadence}
              onChange={e => setCadence(e.target.value)}
              className="rounded-lg border border-stone bg-white px-2 py-2 text-xs dark:border-ink-body dark:bg-night-700"
            >
              {CADENCE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as Priority)}
              className="rounded-lg border border-stone bg-white px-2 py-2 text-xs dark:border-ink-body dark:bg-night-700"
            >
              {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              className="rounded-lg border border-stone bg-white px-2 py-2 text-xs dark:border-ink-body dark:bg-night-700"
            >
              <option value="">Sin asignar</option>
              {(members ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={resetForm} className="rounded-md px-3 py-1.5 text-xs text-graphite hover:bg-stone-100 dark:hover:bg-night-700">Cancelar</button>
            <button
              onClick={handleCreate}
              disabled={create.isPending}
              className="rounded-md bg-night px-3 py-1.5 text-xs font-semibold text-white hover:bg-night-700 disabled:opacity-50 dark:bg-signal dark:text-night dark:hover:bg-signal/90 max-md:h-10 max-md:px-4 max-md:text-sm"
            >
              {create.isPending ? 'Creando…' : 'Crear regla'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger-wash px-4 py-3 text-sm dark:border-danger/40 dark:bg-danger/30">
          <p className="font-semibold text-danger dark:text-danger/30">No se pudieron cargar las reglas</p>
          <p className="mt-1 text-xs text-danger dark:text-danger/50">{error.message}</p>
          <p className="mt-2 text-[11px] text-danger/80 dark:text-danger/50/80">
            Si nunca usaste recurrentes antes, puede ser que falte correr la migración SQL <code className="font-mono">20260526_task_attachments_and_recurring.sql</code> en Supabase.
          </p>
        </div>
      )}

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : !rules?.length ? (
        <EmptyState
          icon={Repeat}
          title="Sin reglas recurrentes"
          description="Crea una para que FARO genere tareas automáticamente (daily standup, reportes semanales, cierres de mes, etc.)."
        />
      ) : (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone bg-white dark:divide-night-700 dark:border-night-700 dark:bg-night">
          {rules.map(r => {
            const assignee = r.assignee as { name?: string } | null
            const proj = (r as unknown as { project: { id: string; code: string; name: string; color: string } | null }).project
            return (
              <li key={r.id} className={`flex items-start gap-3 px-4 py-3 ${!r.is_active ? 'opacity-60' : ''}`}>
                {proj && (
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: proj.color }} title={proj.name} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-night dark:text-stone-100">{r.title_template}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-graphite">
                    {proj && <span className="font-mono">{proj.code}</span>}
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> {describeCadence(r.cadence)}
                    </span>
                    <span>· Próxima: {r.next_run_at}</span>
                    {assignee && <span>· {assignee.name}</span>}
                    {!r.is_active && <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-graphite dark:bg-night-700">Pausada</span>}
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
                    const ok = await confirmAction({
                      title: `Borrar regla "${r.title_template}"`,
                      description: 'Las instancias ya materializadas se mantienen, pero deja de generar nuevas.',
                      variant: 'destructive',
                    })
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
    </>
  )
}
