'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, Plus, UserRound, Building2, Shirt } from 'lucide-react'
import { CaptureButton } from '@/components/captura/capture-button'
import { trpc } from '@/lib/trpc/client'
import { parseQuickAdd } from '@/lib/multiempresa'
import { useEmpresaFilter } from '@/stores/empresa-filter'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'

function shortDate(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * Always-visible bar to create a task in one line:
 *   "Pagar proveedores #mesa @andy viernes"
 * and see, while typing, how Faro reads it ("Faro entiende:" chips). The same
 * parser runs on the server, which is what actually decides.
 */
export function QuickAddBar({ embedded = false, onCreated }: { embedded?: boolean; onCreated?: () => void } = {}) {
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const { data: dir } = trpc.membership.directory.useQuery(undefined, { staleTime: 60_000, enabled: !!me?.groupMode })
  const filter = useEmpresaFilter(s => s.workspaceId)
  const utils = trpc.useUtils()
  const [text, setText] = useState('')

  const create = trpc.quickAdd.create.useMutation({
    onSuccess: ({ parsed }) => {
      setText('')
      toast.success('Tarea creada', parsed.workspaceName ? `En ${parsed.workspaceName}` : undefined)
      void utils.tasks.invalidate()
      void utils.inbox.invalidate()
      void utils.projects.invalidate()
      onCreated?.()
    },
    onError: err => toast.error('No se pudo crear la tarea', err.message),
  })

  const parsed = useMemo(() => {
    if (!dir || !me) return null
    return parseQuickAdd(text, {
      today: dir.today,
      people: dir.people,
      workspaces: dir.workspaces,
      filterWorkspaceId: filter,
      defaultAssigneeId: me.user.id,
    })
  }, [text, dir, me, filter])

  if (!me?.groupMode) return null

  const submit = () => {
    if (!text.trim() || create.isPending) return
    create.mutate({ text, filterWorkspaceId: filter })
  }

  const chipBase = 'inline-flex items-center gap-1 rounded-full bg-signal-wash px-2 py-0.5 text-[11px] font-medium text-signal-ink dark:bg-night-700 dark:text-signal'

  return (
    <div className={cn(embedded ? 'px-4 py-3' : 'border-b border-stone bg-white px-4 py-2.5 md:px-6 dark:border-night-700 dark:bg-night')}>
      <div className="mx-auto flex max-w-5xl items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Plus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite" />
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            placeholder="Nueva tarea… ej: Pagar proveedores #mesa @andy viernes"
            aria-label="Crear tarea en una línea"
            className="h-10 w-full rounded-lg border border-stone bg-mist pl-9 pr-20 text-sm text-night outline-none transition-colors placeholder:text-graphite focus:border-signal focus:bg-white focus:ring-2 focus:ring-signal/30 dark:border-night-700 dark:bg-night-700/50 dark:text-mist dark:focus:bg-night"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || create.isPending}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-night px-2.5 py-1 text-xs font-semibold text-mist transition-opacity disabled:opacity-40 dark:bg-signal dark:text-night"
          >
            {create.isPending ? 'Creando…' : 'Crear'}
          </button>
        </div>
        {!embedded && <CaptureButton className="h-10 shrink-0" />}
      </div>

      {parsed && parsed.title && (
        <div className={cn('mx-auto mt-2 flex max-w-5xl flex-wrap items-center gap-1.5 text-[11px] text-graphite')}>
          <span className="font-medium">Faro entiende:</span>
          {parsed.workspaceName && <span className={chipBase}><Building2 className="h-3 w-3" />{parsed.workspaceName}</span>}
          {parsed.assigneeId && (
            <span className={chipBase}>
              <UserRound className="h-3 w-3" />
              {dir?.people.find(p => p.id === parsed.assigneeId)?.name ?? ''}
            </span>
          )}
          {parsed.dueDate && <span className={chipBase}><CalendarDays className="h-3 w-3" />{shortDate(parsed.dueDate)}</span>}
          {parsed.hat && <span className={chipBase}><Shirt className="h-3 w-3" />como {parsed.hat}</span>}
          {!parsed.workspaceName && <span className="text-danger">Falta la empresa: usa #nombre</span>}
        </div>
      )}
    </div>
  )
}
