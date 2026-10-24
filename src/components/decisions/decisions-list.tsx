'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { Plus, Scale, CheckCircle2, Archive } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * List of decision matrices in the org — entry point at /dashboard/decisions.
 * Clicking a row opens the matrix editor.
 */
export function DecisionsList() {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const { data: decisions, isLoading } = trpc.decisions.list.useQuery()
  const utils = trpc.useUtils()

  const create = trpc.decisions.create.useMutation({
    onSuccess: (d) => {
      utils.decisions.list.invalidate()
      setCreating(false)
      setNewTitle('')
      router.push(`/dashboard/decisions/${d.id}`)
    },
  })

  function handleCreate() {
    if (!newTitle.trim()) return
    create.mutate({ title: newTitle.trim() })
  }

  return (
    <div className="space-y-4">
      {/* New decision row */}
      {creating ? (
        <div className="flex items-center gap-2 rounded-xl border border-signal/40 bg-signal-wash/50 p-3 dark:border-signal/60 dark:bg-signal/30">
          <Scale className="h-4 w-4 text-signal-ink" />
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false) }}
            placeholder='Ej: "¿Qué stack usamos para el cliente X?"'
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-graphite"
          />
          <button
            onClick={handleCreate}
            disabled={!newTitle.trim() || create.isPending}
            className="rounded-md bg-night px-3 py-1 text-xs font-semibold text-white hover:bg-night-700 disabled:opacity-50 dark:bg-signal dark:text-night dark:hover:bg-signal/90"
          >
            {create.isPending ? 'Creando…' : 'Crear'}
          </button>
          <button
            onClick={() => { setCreating(false); setNewTitle('') }}
            className="rounded-md px-2 py-1 text-xs text-graphite hover:bg-stone-100 dark:hover:bg-night-700"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone px-4 py-3 text-sm font-medium text-graphite transition hover:border-signal/50 hover:bg-signal-wash/40 hover:text-night dark:border-ink-body dark:hover:bg-signal/30"
        >
          <Plus className="h-4 w-4" />
          Nueva matriz de decisión
        </button>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-100 dark:bg-night-700" />
          ))}
        </div>
      ) : !decisions?.length ? (
        <div className="rounded-xl border border-stone bg-white p-12 text-center dark:border-night-700 dark:bg-night">
          <Scale className="mx-auto h-8 w-8 text-stone" />
          <p className="mt-3 text-sm text-graphite">
            Sin matrices todavía. Crea la primera para evaluar opciones de forma estructurada.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {decisions.map(d => {
            const numOpts = (d.options as { id: string }[] | null)?.length ?? 0
            const numCrit = (d.criteria as { id: string }[] | null)?.length ?? 0
            return (
              <li key={d.id}>
                <Link
                  href={`/dashboard/decisions/${d.id}`}
                  className="block rounded-xl border border-stone bg-white p-4 transition hover:border-signal/40 hover:shadow-sm dark:border-night-700 dark:bg-night dark:hover:border-signal/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-night dark:text-stone-100">{d.title}</h3>
                        <StatusBadge status={d.status} />
                      </div>
                      {d.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-graphite">{d.description}</p>
                      )}
                    </div>
                    <p className="shrink-0 text-[10px] uppercase tracking-wider text-graphite">
                      {numOpts} opciones · {numCrit} criterios
                    </p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string; icon: typeof Scale }> = {
    draft:     { label: 'Borrador',  classes: 'bg-stone-100 text-graphite dark:bg-night-700 dark:text-stone', icon: Scale },
    resolved:  { label: 'Resuelta',  classes: 'bg-success-wash text-success dark:bg-success/40 dark:text-success/50', icon: CheckCircle2 },
    archived:  { label: 'Archivada', classes: 'bg-stone-100 text-graphite dark:bg-night-700 dark:text-graphite', icon: Archive },
  }
  const s = map[status] ?? map.draft
  const Icon = s.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', s.classes)}>
      <Icon className="h-2.5 w-2.5" />
      {s.label}
    </span>
  )
}
