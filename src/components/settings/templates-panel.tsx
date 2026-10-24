'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Plus, Trash2, FolderPlus, ChevronDown, ChevronRight, X } from 'lucide-react'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'

const PRIORITY_OPTIONS = [
  { value: 'very_high', label: 'Muy alta' },
  { value: 'high',      label: 'Alta' },
  { value: 'medium',    label: 'Media' },
  { value: 'low',       label: 'Baja' },
  { value: 'very_low',  label: 'Muy baja' },
] as const

type Priority = typeof PRIORITY_OPTIONS[number]['value']

/**
 * Settings → Integraciones → Templates panel.
 * Lets the user CRUD templates + their task lists. Used when creating
 * new projects to seed a known starting structure.
 */
export function TemplatesPanel() {
  const utils = trpc.useUtils()
  const { data: templates, isLoading } = trpc.templates.list.useQuery()
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [duration, setDuration] = useState('')

  const refetch = () => utils.templates.list.invalidate()

  const create = trpc.templates.create.useMutation({
    onSuccess: (d) => {
      refetch()
      setCreating(false)
      setName('')
      setDuration('')
      setExpanded(d.id)
    },
  })
  const remove = trpc.templates.delete.useMutation({ onSuccess: refetch })

  return (
    <div className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-night dark:text-stone-100">
            Plantillas de proyecto
          </h3>
          <p className="text-xs text-graphite">
            Reutilizables al crear proyectos. Ideal para tipos recurrentes (&ldquo;Cliente nuevo&rdquo;, &ldquo;Evento&rdquo;, etc.)
          </p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-night px-3 py-1.5 text-xs font-semibold text-white hover:bg-night-700 dark:bg-signal dark:text-night dark:hover:bg-signal/90 max-md:h-10 max-md:px-4 max-md:text-sm"
          >
            <Plus className="h-3 w-3" />
            Nueva plantilla
          </button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="mb-3 space-y-2 rounded-lg border border-stone bg-signal-wash/30 p-3 dark:border-signal/40 dark:bg-signal/20">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder='Nombre (ej: "Cliente nuevo")'
            className="w-full rounded-lg border border-stone px-3 py-2 text-sm outline-none focus:border-signal dark:border-ink-body dark:bg-night-700"
          />
          <input
            type="number"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="Duración por defecto en días (opcional)"
            className="w-full rounded-lg border border-stone px-3 py-2 text-sm outline-none focus:border-signal dark:border-ink-body dark:bg-night-700"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setCreating(false); setName(''); setDuration('') }}
              className="rounded-md px-3 py-1 text-xs text-graphite hover:bg-stone-100 dark:hover:bg-night-700"
            >Cancelar</button>
            <button
              onClick={() => create.mutate({
                name: name.trim(),
                durationDays: duration ? parseInt(duration, 10) : undefined,
              })}
              disabled={!name.trim() || create.isPending}
              className="rounded-md bg-night px-3 py-1 text-xs font-semibold text-white hover:bg-night-700 disabled:opacity-50 dark:bg-signal dark:text-night dark:hover:bg-signal/90"
            >
              {create.isPending ? 'Creando…' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />
          ))}
        </div>
      ) : !templates?.length ? (
        <p className="py-8 text-center text-xs text-graphite">
          Sin plantillas. Crea una para acelerar la creación de proyectos repetitivos.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {templates.map(t => {
            const taskCount = (t.tasks as { id: string }[] | null)?.length ?? 0
            const isExpanded = expanded === t.id
            return (
              <li key={t.id} className="overflow-hidden rounded-lg border border-stone dark:border-ink-body">
                <button
                  onClick={() => setExpanded(isExpanded ? null : t.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-mist dark:hover:bg-night-700"
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3 text-graphite" /> : <ChevronRight className="h-3 w-3 text-graphite" />}
                  <FolderPlus className="h-3.5 w-3.5 text-signal-ink" style={{ color: t.default_color }} />
                  <span className="flex-1 text-sm font-medium text-night-700 dark:text-stone">{t.name}</span>
                  <span className="text-[10px] text-graphite">{taskCount} tareas</span>
                  {t.duration_days && (
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-graphite dark:bg-night-700">
                      {t.duration_days}d
                    </span>
                  )}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      const ok = await confirmAction({ title: `Borrar plantilla "${t.name}"`, variant: 'destructive' })
                      if (ok) remove.mutate(t.id)
                    }}
                    className="rounded p-1 text-stone hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </button>
                {isExpanded && (
                  <TemplateTasksEditor templateId={t.id} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function TemplateTasksEditor({ templateId }: { templateId: string }) {
  const utils = trpc.useUtils()
  const { data: template } = trpc.templates.byId.useQuery(templateId)
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState<Priority>('medium')
  const [newOffset, setNewOffset] = useState('')

  const refetch = () => {
    utils.templates.byId.invalidate(templateId)
    utils.templates.list.invalidate()
  }

  const addTask = trpc.templates.addTask.useMutation({
    onSuccess: () => {
      refetch()
      setNewTitle('')
      setNewOffset('')
    },
  })
  const deleteTask = trpc.templates.deleteTask.useMutation({ onSuccess: refetch })

  const tasks = (template?.tasks as Array<{
    id: string; title: string; priority: Priority; due_offset_days: number | null; position: number
  }> | null) ?? []
  const sorted = [...tasks].sort((a, b) => a.position - b.position)

  return (
    <div className="border-t border-stone-100 bg-mist/40 px-3 py-2 dark:border-night-700 dark:bg-night-700/30">
      {/* Existing tasks */}
      {sorted.length > 0 && (
        <ul className="mb-2 space-y-1">
          {sorted.map(task => (
            <li key={task.id} className="group flex items-center gap-2 rounded bg-white px-2 py-1 text-xs dark:bg-night">
              <span className="flex-1 truncate text-ink-body dark:text-stone">{task.title}</span>
              <span className="text-[10px] text-graphite">{task.priority.replace('_', ' ')}</span>
              {task.due_offset_days != null && (
                <span className="text-[10px] text-graphite">+{task.due_offset_days}d</span>
              )}
              <button
                onClick={() => deleteTask.mutate(task.id)}
                className="rounded p-0.5 text-stone md:opacity-0 hover:text-danger md:group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add */}
      <div className="flex gap-1.5">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newTitle.trim()) {
              addTask.mutate({
                templateId,
                title: newTitle.trim(),
                priority: newPriority,
                dueOffsetDays: newOffset ? parseInt(newOffset, 10) : undefined,
              })
            }
          }}
          placeholder="+ tarea de la plantilla"
          className="flex-1 rounded border border-dashed border-stone bg-transparent px-2 py-1 text-xs outline-none focus:border-signal dark:border-graphite"
        />
        <select
          value={newPriority}
          onChange={(e) => setNewPriority(e.target.value as Priority)}
          className="rounded border border-stone bg-white px-1 py-1 text-[11px] dark:border-graphite dark:bg-night-700"
        >
          {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <input
          type="number"
          inputMode="numeric"
          value={newOffset}
          onChange={(e) => setNewOffset(e.target.value)}
          placeholder="+d"
          title="Días desde el inicio del proyecto"
          className="w-12 rounded border border-stone bg-white px-1 py-1 text-center text-[11px] dark:border-graphite dark:bg-night-700"
        />
      </div>
    </div>
  )
}
