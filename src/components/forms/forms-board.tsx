'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  ClipboardList, Plus, Pencil, Trash2, ExternalLink, Copy, Eye, Power,
  CheckCircle2,
} from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'
import { FormEditor } from './form-editor'
import { FormSubmissionsDrawer } from './form-submissions-drawer'

export function FormsBoard() {
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [viewingSubs, setViewingSubs] = useState<string | null>(null)
  const { data, isLoading } = trpc.forms.list.useQuery()
  const utils = trpc.useUtils()

  const remove = trpc.forms.delete.useMutation({
    onSuccess: () => { toast.success('Formulario borrado'); utils.forms.list.invalidate() },
    onError: (e) => toast.error('No se pudo borrar', e.message),
  })
  const toggle = trpc.forms.update.useMutation({
    onSuccess: () => utils.forms.list.invalidate(),
  })

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  if (isLoading) return <ListSkeleton rows={3} />

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-night px-3 py-1.5 text-xs font-semibold text-white hover:bg-night-700 active:scale-95 dark:bg-signal dark:text-night dark:hover:bg-signal/90 max-md:h-10 max-md:px-4 max-md:text-sm"
        >
          <Plus className="h-3.5 w-3.5" /> Nuevo formulario
        </button>
        <p className="ml-auto text-xs text-graphite">
          {data?.length ?? 0} formulario{data?.length === 1 ? '' : 's'}
        </p>
      </div>

      {!data?.length ? (
        <EmptyState
          icon={ClipboardList}
          title="Sin formularios todavía"
          description="Crea uno para que clientes o miembros del equipo carguen pedidos sin necesidad de tener cuenta en FARO. Cada submission se convierte automáticamente en una tarea del proyecto que elijas."
        />
      ) : (
        <ul className="space-y-3">
          {data.map(f => {
            const project = f.project as { code?: string; name?: string; color?: string } | null
            const publicUrl = `${baseUrl}/forms/${f.slug}`
            return (
              <li key={f.id} className="group rounded-xl border border-stone bg-white p-4 transition hover:border-stone dark:border-night-700 dark:bg-night dark:hover:border-ink-body">
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
                    <ClipboardList className="h-4 w-4 text-signal-ink" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-night dark:text-stone-100">{f.title}</h3>
                      {!f.is_active && (
                        <span className="rounded bg-stone px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-graphite dark:bg-ink-body dark:text-stone">
                          Inactivo
                        </span>
                      )}
                      {project && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md border border-dashed border-stone px-1.5 py-0.5 text-[10px] text-graphite dark:border-ink-body dark:text-graphite"
                          title={`Las tareas se crean en ${project.code}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: project.color }} />
                          → {project.code}
                        </span>
                      )}
                    </div>
                    {f.description && (
                      <p className="mt-1 text-xs text-graphite line-clamp-2 dark:text-graphite">{f.description}</p>
                    )}
                    {/* URL row */}
                    <div className="mt-2 flex items-center gap-2 rounded-lg bg-mist px-2 py-1.5 text-[11px] dark:bg-night-700/50">
                      <code className="flex-1 truncate font-mono text-ink-body dark:text-stone">{publicUrl}</code>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(publicUrl)
                          toast.success('URL copiada')
                        }}
                        className="rounded p-1 text-graphite hover:bg-white hover:text-body dark:hover:bg-ink-body"
                        title="Copiar URL"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <a
                        href={publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded p-1 text-graphite hover:bg-white hover:text-body dark:hover:bg-ink-body"
                        title="Abrir formulario público"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-graphite">
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {f.submission_count} submission{f.submission_count === 1 ? '' : 's'}
                      </span>
                      <span>· {(f.fields as Array<unknown>).length} campos</span>
                    </div>
                  </div>

                  {/* Hover actions */}
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => setViewingSubs(f.id)}
                      className="rounded p-1.5 text-graphite hover:bg-stone-100 hover:text-body dark:hover:bg-night-700"
                      title="Ver submissions"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => toggle.mutate({ id: f.id, isActive: !f.is_active })}
                      className={`rounded p-1.5 hover:bg-stone-100 dark:hover:bg-night-700 ${f.is_active ? 'text-success' : 'text-graphite'}`}
                      title={f.is_active ? 'Desactivar' : 'Activar'}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setEditing(f.id)}
                      className="rounded p-1.5 text-graphite hover:bg-stone-100 hover:text-body dark:hover:bg-night-700"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await confirmAction({
                          title: `Borrar formulario "${f.title}"`,
                          description: 'Las submissions ya guardadas y las tareas creadas se mantienen. La URL pública deja de funcionar.',
                          variant: 'destructive',
                        })
                        if (ok) remove.mutate(f.id)
                      }}
                      className="rounded p-1.5 text-graphite hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40"
                      title="Borrar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <FormEditor
          formId={editing === 'new' ? null : editing}
          onClose={() => { setEditing(null); utils.forms.list.invalidate() }}
        />
      )}
      {viewingSubs && (
        <FormSubmissionsDrawer formId={viewingSubs} onClose={() => setViewingSubs(null)} />
      )}
    </>
  )
}
