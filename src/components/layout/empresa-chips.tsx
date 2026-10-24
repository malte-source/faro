'use client'

import { trpc } from '@/lib/trpc/client'
import { useEmpresaFilter } from '@/stores/empresa-filter'
import { cn } from '@/lib/utils'

/**
 * Chips "Todo · Empresa 1 · Empresa 2…" with a pending-task counter. Shared by
 * Hoy, Proyectos and Personas; the selected empresa lives in the zustand
 * store so it persists while moving between sections.
 *
 * Renders nothing when the grupo has a single empresa — a filter with one
 * option is just noise.
 */
export function EmpresaChips({ className }: { className?: string }) {
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const { data: counts } = trpc.inbox.counts.useQuery(undefined, { staleTime: 30_000 })
  const selected = useEmpresaFilter(s => s.workspaceId)
  const setSelected = useEmpresaFilter(s => s.setWorkspaceId)

  const empresas = me?.empresas ?? []
  if (empresas.length < 2) return null

  const chip = (active: boolean) =>
    cn(
      'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors active:scale-[0.97] md:h-auto md:px-3 md:py-1 md:text-xs',
      active
        ? 'border-night bg-night text-mist dark:border-signal dark:bg-signal dark:text-night'
        : 'border-stone bg-white text-graphite hover:border-graphite hover:text-night dark:border-night-700 dark:bg-night dark:text-stone dark:hover:text-mist',
    )

  return (
    <div
      className={cn('-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:overflow-visible md:px-0', className)}
      role="group"
      aria-label="Filtrar por empresa"
      data-no-track
      data-no-ptr
    >
      <button type="button" onClick={() => setSelected(null)} className={chip(selected === null)} aria-pressed={selected === null}>
        Todo
        {counts && <span className="tabular-nums opacity-70">{counts.total}</span>}
      </button>
      {empresas.map(e => (
        <button
          key={e.id}
          type="button"
          onClick={() => setSelected(selected === e.id ? null : e.id)}
          className={chip(selected === e.id)}
          aria-pressed={selected === e.id}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
          {e.name}
          {counts && <span className="tabular-nums opacity-70">{counts.byWorkspace[e.id] ?? 0}</span>}
        </button>
      ))}
    </div>
  )
}
