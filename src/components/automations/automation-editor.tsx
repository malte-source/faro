'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { X, Plus, Trash2 } from 'lucide-react'
import { useEscapeClose } from '@/hooks/use-escape-close'
import type { AutomationAction, AutomationConditions, AutomationTrigger, Priority, TaskStatus } from '@/types/database'

interface Props {
  automationId: string | null  // null = create new
  onClose: () => void
}

const TRIGGER_OPTIONS: { value: AutomationTrigger; label: string; help: string }[] = [
  { value: 'task.created',        label: 'Cuando se crea una tarea',        help: 'Se dispara inmediatamente al crear cualquier tarea.' },
  { value: 'task.status_changed', label: 'Cuando una tarea cambia estado',  help: 'Se dispara solo en transiciones reales (no re-saves del mismo estado).' },
  { value: 'task.due_soon',       label: 'Cuando una tarea está por vencer',help: 'Corre cada hora (cron) sobre tareas con vencimiento próximo.' },
  { value: 'project.health_low',  label: 'Cuando un proyecto tiene salud baja', help: 'Corre cada hora (cron) sobre proyectos con health_score bajo el umbral.' },
]

const STATUS_OPTIONS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'canceled']
const PRIORITY_OPTIONS: Priority[] = ['very_high', 'high', 'medium', 'low', 'very_low']
const ACTION_KINDS: AutomationAction['kind'][] = ['set_status', 'set_assignee', 'set_priority', 'add_label', 'send_chat']

/**
 * Builder modal — used for both create and edit. Loads the existing record
 * (if editing) once on mount. All state is local; on save we hit create or
 * update on the server.
 *
 * Design choices:
 * - One trigger, AND-ed conditions, ordered actions — matches the schema 1:1.
 * - Condition fields render conditionally based on the chosen trigger.
 * - Action editor is a list with add/remove + per-kind input. No drag-reorder
 *   in v1; users rarely have >2 actions per rule.
 */
export function AutomationEditor({ automationId, onClose }: Props) {
  const isEditing = automationId !== null
  const utils = trpc.useUtils()
  const { data: existing } = trpc.automations.list.useQuery(undefined, { enabled: isEditing })
  const create = trpc.automations.create.useMutation({ onSuccess: () => { utils.automations.list.invalidate(); onClose() } })
  const update = trpc.automations.update.useMutation({ onSuccess: () => { utils.automations.list.invalidate(); onClose() } })

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [trigger, setTrigger] = useState<AutomationTrigger>('task.created')
  const [conditions, setConditions] = useState<AutomationConditions>({})
  const [actions, setActions] = useState<AutomationAction[]>([{ kind: 'set_status', value: 'in_progress' }])

  useEffect(() => {
    if (!isEditing || !existing) return
    const a = existing.find(x => x.id === automationId)
    if (!a) return
    setName(a.name)
    setDescription(a.description ?? '')
    setEnabled(a.enabled)
    setTrigger(a.trigger)
    setConditions(a.conditions ?? {})
    setActions(a.actions?.length ? a.actions : [{ kind: 'set_status', value: 'in_progress' }])
  }, [existing, automationId, isEditing])

  useEscapeClose(onClose)

  const save = () => {
    if (!name.trim()) return alert('Falta el nombre.')
    if (!actions.length) return alert('Agrega al menos una acción.')
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      enabled,
      trigger,
      conditions,
      actions,
    }
    if (isEditing && automationId) update.mutate({ id: automationId, ...payload })
    else create.mutate(payload)
  }

  const showTaskConds = trigger === 'task.created' || trigger === 'task.status_changed' || trigger === 'task.due_soon'
  const showStatusTransition = trigger === 'task.status_changed'
  const showDueWindow = trigger === 'task.due_soon'
  const showHealthThreshold = trigger === 'project.health_low'

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 md:items-center md:p-4" onClick={onClose}>
      <div
        className="max-h-[92dvh] md:max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-[26px] rounded-b-none md:rounded-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-5 shadow-2xl dark:bg-night"
        onClick={e => e.stopPropagation()}
      ><span className="mx-auto -mt-2 mb-3 block h-1 w-10 shrink-0 rounded-full bg-stone dark:bg-border md:hidden" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-night dark:text-stone-100">
            {isEditing ? 'Editar automatización' : 'Nueva automatización'}
          </h2>
          <button onClick={onClose} className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name + description */}
          <div>
            <label className="text-xs font-medium text-graphite dark:text-stone">Nombre</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="p. ej. Asignarme cuando algo va a revisión"
              className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-graphite dark:text-stone">Descripción (opcional)</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            <span className="text-graphite dark:text-stone">Activa</span>
          </label>

          {/* Trigger */}
          <div className="rounded-lg border border-stone p-3 dark:border-ink-body">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-graphite">Disparador</p>
            <select
              value={trigger}
              onChange={e => { setTrigger(e.target.value as AutomationTrigger); setConditions({}) }}
              className="w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
            >
              {TRIGGER_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <p className="mt-1 text-[10px] text-graphite">{TRIGGER_OPTIONS.find(t => t.value === trigger)?.help}</p>
          </div>

          {/* Conditions */}
          <div className="rounded-lg border border-stone p-3 dark:border-ink-body">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-graphite">Condiciones (todas se cumplen)</p>
            <div className="grid grid-cols-2 gap-2">
              {showTaskConds && (
                <>
                  <CondSelect label="Estado actual" value={conditions.status ?? ''} options={STATUS_OPTIONS}
                    onChange={v => setConditions(c => ({ ...c, status: v as TaskStatus || undefined }))} />
                  <CondSelect label="Prioridad" value={conditions.priority ?? ''} options={PRIORITY_OPTIONS}
                    onChange={v => setConditions(c => ({ ...c, priority: v as Priority || undefined }))} />
                </>
              )}
              {showStatusTransition && (
                <>
                  <CondSelect label="Desde estado" value={conditions.from_status ?? ''} options={STATUS_OPTIONS}
                    onChange={v => setConditions(c => ({ ...c, from_status: v as TaskStatus || undefined }))} />
                  <CondSelect label="A estado" value={conditions.to_status ?? ''} options={STATUS_OPTIONS}
                    onChange={v => setConditions(c => ({ ...c, to_status: v as TaskStatus || undefined }))} />
                </>
              )}
              {showDueWindow && (
                <label className="text-xs">
                  <span className="text-graphite dark:text-stone">Horas antes de vencer (≤)</span>
                  <input
                    type="number" inputMode="numeric" min={0} max={168}
                    value={conditions.hours_until_due ?? 24}
                    onChange={e => setConditions(c => ({ ...c, hours_until_due: parseInt(e.target.value) || 0 }))}
                    className="mt-1 w-full rounded border border-stone px-2 py-1 text-xs dark:border-ink-body dark:bg-night-700"
                  />
                </label>
              )}
              {showHealthThreshold && (
                <label className="text-xs">
                  <span className="text-graphite dark:text-stone">Salud por debajo de</span>
                  <input
                    type="number" inputMode="numeric" min={0} max={100}
                    value={conditions.health_below ?? 50}
                    onChange={e => setConditions(c => ({ ...c, health_below: parseInt(e.target.value) || 0 }))}
                    className="mt-1 w-full rounded border border-stone px-2 py-1 text-xs dark:border-ink-body dark:bg-night-700"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="rounded-lg border border-stone p-3 dark:border-ink-body">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-graphite">Acciones (en orden)</p>
            <ul className="space-y-1.5">
              {actions.map((a, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <select
                    value={a.kind}
                    onChange={e => {
                      const kind = e.target.value as AutomationAction['kind']
                      const def: AutomationAction = (
                        kind === 'set_status' ? { kind, value: 'in_progress' } :
                        kind === 'set_assignee' ? { kind, value: 'reporter' } :
                        kind === 'set_priority' ? { kind, value: 'high' } :
                        kind === 'add_label' ? { kind, value: 'urgente' } :
                        { kind: 'send_chat', value: 'Tarea {{task.title}} ({{task.status}})' }
                      )
                      setActions(as => as.map((x, ix) => ix === i ? def : x))
                    }}
                    className="rounded border border-stone px-1.5 py-1 text-xs dark:border-ink-body dark:bg-night-700"
                  >
                    {ACTION_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <ActionValueInput action={a} onChange={v => setActions(as => as.map((x, ix) => ix === i ? ({ ...x, value: v } as AutomationAction) : x))} />
                  <button
                    onClick={() => setActions(as => as.filter((_, ix) => ix !== i))}
                    className="rounded p-1 text-graphite hover:text-danger"
                    title="Quitar"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setActions(as => [...as, { kind: 'set_status', value: 'in_progress' }])}
              className="mt-2 inline-flex items-center gap-1 text-xs text-night hover:underline dark:text-signal"
            >
              <Plus className="h-3 w-3" /> agregar acción
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-stone-100 pt-3 dark:border-night-700">
          <button onClick={onClose} className="rounded-lg border border-stone px-3 py-1.5 text-xs hover:bg-mist dark:border-ink-body dark:hover:bg-night-700">Cancelar</button>
          <button
            onClick={save}
            disabled={create.isPending || update.isPending}
            className="rounded-lg bg-night px-3 py-1.5 text-xs font-semibold text-white hover:bg-night-700 disabled:opacity-50 dark:bg-signal dark:text-night dark:hover:bg-signal/90 max-md:h-10 max-md:px-4 max-md:text-sm"
          >
            {create.isPending || update.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CondSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <label className="text-xs">
      <span className="text-graphite dark:text-stone">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-stone px-2 py-1 text-xs dark:border-ink-body dark:bg-night-700"
      >
        <option value="">— cualquiera —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

function ActionValueInput({ action, onChange }: { action: AutomationAction; onChange: (v: string) => void }) {
  if (action.kind === 'set_status') {
    return (
      <select value={action.value} onChange={e => onChange(e.target.value)} className="flex-1 rounded border border-stone px-1.5 py-1 text-xs dark:border-ink-body dark:bg-night-700">
        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    )
  }
  if (action.kind === 'set_priority') {
    return (
      <select value={action.value} onChange={e => onChange(e.target.value)} className="flex-1 rounded border border-stone px-1.5 py-1 text-xs dark:border-ink-body dark:bg-night-700">
        {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
    )
  }
  if (action.kind === 'set_assignee') {
    return (
      <input
        value={action.value}
        onChange={e => onChange(e.target.value)}
        placeholder="user-id, 'reporter' o 'unassign'"
        className="flex-1 rounded border border-stone px-1.5 py-1 text-xs dark:border-ink-body dark:bg-night-700"
      />
    )
  }
  // add_label, send_chat
  return (
    <input
      value={action.value}
      onChange={e => onChange(e.target.value)}
      placeholder={action.kind === 'add_label' ? 'etiqueta' : 'Mensaje (soporta {{task.title}}, {{task.status}}, etc.)'}
      className="flex-1 rounded border border-stone px-1.5 py-1 text-xs dark:border-ink-body dark:bg-night-700"
    />
  )
}
