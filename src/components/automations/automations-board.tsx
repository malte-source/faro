'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Zap, Plus, Pencil, Trash2, Power, History } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'
import { AutomationEditor } from './automation-editor'
import { AutomationRunsDrawer } from './automation-runs-drawer'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'

const TRIGGER_LABELS: Record<string, string> = {
  'task.created':         'Tarea creada',
  'task.status_changed':  'Tarea cambia estado',
  'task.due_soon':        'Tarea por vencer',
  'project.health_low':   'Proyecto con salud baja',
}

/**
 * Org-wide list of automations. Anyone can see them; only owner/admin can
 * create/edit/delete (server-enforced — the buttons render for everyone but
 * trying to act without privileges returns a clear FORBIDDEN).
 */
export function AutomationsBoard() {
  const { data, isLoading } = trpc.automations.list.useQuery()
  const [editing, setEditing] = useState<string | null | 'new'>(null) // null = closed, 'new' = create, string = edit by id
  const [viewingRuns, setViewingRuns] = useState<string | null>(null)
  const utils = trpc.useUtils()
  const toggle = trpc.automations.toggle.useMutation({
    onSuccess: () => utils.automations.list.invalidate(),
    onError: (e) => toast.error('No se pudo cambiar el estado', e.message),
  })
  const remove = trpc.automations.delete.useMutation({
    onSuccess: () => { toast.success('Automatización borrada'); utils.automations.list.invalidate() },
    onError: (e) => toast.error('No se pudo borrar', e.message),
  })

  if (isLoading) return <ListSkeleton rows={4} />

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-night px-3 py-1.5 text-xs font-semibold text-white hover:bg-night-700 dark:bg-signal dark:text-night dark:hover:bg-signal/90 max-md:h-10 max-md:px-4 max-md:text-sm"
        >
          <Plus className="h-3.5 w-3.5" /> Nueva automatización
        </button>
        <p className="ml-auto text-xs text-graphite">
          {data?.length ?? 0} regla{data?.length === 1 ? '' : 's'} · {data?.filter(a => a.enabled).length ?? 0} activas
        </p>
      </div>

      {!data?.length ? (
        <EmptyState
          icon={Zap}
          title="Sin reglas todavía"
          description='Ejemplos: "Cuando una tarea pasa a En revisión, asignarme como reviewer", "Cuando un proyecto baja a salud < 40, mandar alerta a Chat".'
        />
      ) : (
        <ul className="space-y-2">
          {data.map(a => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-xl border border-stone bg-white p-3 dark:border-night-700 dark:bg-night"
            >
              <button
                onClick={() => toggle.mutate({ id: a.id, enabled: !a.enabled })}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${a.enabled ? 'bg-success-wash text-success dark:bg-success/40 dark:text-success/50' : 'bg-stone-100 text-graphite dark:bg-night-700'}`}
                title={a.enabled ? 'Desactivar' : 'Activar'}
              >
                <Power className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-night dark:text-stone-100">{a.name}</p>
                <p className="mt-0.5 text-[11px] text-graphite">
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono dark:bg-night-700">{TRIGGER_LABELS[a.trigger] ?? a.trigger}</span>
                  {' → '}
                  {a.actions.map((act, i) => (
                    <span key={i} className="ml-1 rounded bg-signal-wash px-1.5 py-0.5 font-mono text-night dark:bg-signal/30 dark:text-signal">
                      {act.kind}
                    </span>
                  ))}
                  {a.run_count > 0 && <span className="ml-2 text-graphite">· {a.run_count} ejecuciones</span>}
                </p>
              </div>
              <button onClick={() => setViewingRuns(a.id)} className="rounded p-1.5 text-graphite hover:bg-stone-100 dark:hover:bg-night-700" title="Historial">
                <History className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setEditing(a.id)} className="rounded p-1.5 text-graphite hover:bg-stone-100 dark:hover:bg-night-700" title="Editar">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={async () => {
                  const ok = await confirmAction({
                    title: `Borrar automatización "${a.name}"`,
                    description: 'Las ejecuciones pasadas se mantienen en el historial, pero la regla deja de dispararse.',
                    variant: 'destructive',
                  })
                  if (ok) remove.mutate(a.id)
                }}
                className="rounded p-1.5 text-graphite hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/30"
                title="Borrar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <AutomationEditor
          automationId={editing === 'new' ? null : editing}
          onClose={() => { setEditing(null); utils.automations.list.invalidate() }}
        />
      )}
      {viewingRuns && (
        <AutomationRunsDrawer automationId={viewingRuns} onClose={() => setViewingRuns(null)} />
      )}
    </>
  )
}
