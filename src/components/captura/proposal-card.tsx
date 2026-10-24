'use client'

import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'
import { initials, formatDay, type EmpresaData, type DirectoryPersonData, type WarningNote } from './captura-utils'

export interface ProposalView {
  id: string
  title: string
  quote: string
  quoteAt: string | null
  assigneeId: string | null
  workspaceId: string | null
  dueDate: string | null
  projectName: string | null
  included: boolean
  /** "Sombrero" of the assignee in the empresa: cargo, "Invitado" or "Sin asignar". */
  hat: string
  note: WarningNote | null
}

/**
 * One proposed task. The assignee and empresa are native selects (the
 * prototype's pattern): fast, accessible and identical on desktop and mobile.
 * Empty assignee = "Elegir…" on signal-wash — the task can't be confirmed
 * until someone takes it.
 */
export function ProposalCard({
  p,
  people,
  empresas,
  highlighted,
  onHover,
  onChange,
}: {
  p: ProposalView
  people: DirectoryPersonData[]
  empresas: EmpresaData[]
  highlighted: boolean
  onHover: (hovering: boolean) => void
  onChange: (patch: { included?: boolean; assigneeId?: string | null; workspaceId?: string | null; dueDate?: string | null }) => void
}) {
  const person = people.find(x => x.id === p.assigneeId)
  const empresa = empresas.find(e => e.id === p.workspaceId)
  const unassigned = !p.assigneeId

  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        'flex flex-col gap-3 rounded-[14px] border-[1.5px] bg-surface p-3.5 transition-colors sm:gap-2.5 sm:px-4',
        highlighted ? 'border-signal' : 'border-border',
        !p.included && 'opacity-50',
        p.included && unassigned && 'border-dashed border-signal/60',
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={p.included}
          aria-label={p.included ? 'Excluir tarea' : 'Incluir tarea'}
          onClick={() => onChange({ included: !p.included })}
          className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center"
        >
          <span
            className={cn(
              'flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border-[1.5px] transition-colors',
              p.included ? 'border-signal bg-signal text-night' : 'border-[#C9C0B2] bg-surface dark:border-graphite',
            )}
          >
            {p.included && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-snug text-foreground sm:text-[15px]">{p.title}</p>
          <p className="mt-1 text-xs italic leading-snug text-graphite">“{p.quote}”{p.quoteAt ? ` · ${p.quoteAt}` : ''}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:pl-8">
        <label
          className={cn(
            'flex min-h-[44px] items-center gap-2 rounded-full border p-1 pr-3 sm:min-h-0 sm:gap-1.5 sm:pr-1',
            unassigned ? 'border-signal/50 bg-signal-wash dark:bg-signal/10' : 'border-border bg-surface',
          )}
        >
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-night text-[11px] font-bold text-mist sm:h-[22px] sm:w-[22px] sm:text-[9px]">
            {person ? initials(person.name) : '?'}
          </span>
          <span className="w-[76px] shrink-0 text-xs text-graphite sm:hidden">Responsable</span>
          <select
            aria-label="Responsable"
            value={p.assigneeId ?? ''}
            onChange={e => onChange({ assigneeId: e.target.value || null })}
            className={cn(
              'min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent pr-1 text-[15px] font-medium outline-none sm:max-w-[10rem] sm:flex-none sm:text-[13px]',
              unassigned ? 'text-signal-ink' : 'text-foreground',
            )}
          >
            <option value="">Elegir…</option>
            {people.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>

        <label className="flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-surface px-3 text-[13px] sm:min-h-0 sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-xs">
          <span className="w-[76px] shrink-0 pl-px text-xs text-graphite sm:hidden">Empresa</span>
          <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: empresa?.color ?? 'var(--stone)' }} />
          <select
            aria-label="Empresa"
            value={p.workspaceId ?? ''}
            onChange={e => onChange({ workspaceId: e.target.value || null })}
            className="min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent text-[15px] text-foreground outline-none sm:max-w-[9rem] sm:flex-none sm:text-xs"
          >
            {!empresa && <option value="">Elegir empresa…</option>}
            {empresas.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <span className="shrink-0 whitespace-nowrap text-graphite">· {p.hat}</span>
        </label>

        <label className="relative flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-surface px-3 text-[13px] text-foreground sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-xs">
          <span className="w-[76px] shrink-0 pl-px text-xs text-graphite sm:hidden">Fecha</span>
          <span className="whitespace-nowrap text-[15px] sm:text-xs">{formatDay(p.dueDate)}</span>
          <input
            type="date"
            aria-label="Fecha límite"
            value={p.dueDate ?? ''}
            onChange={e => onChange({ dueDate: e.target.value || null })}
            onClick={e => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>

        <span className="px-1 text-xs text-graphite sm:whitespace-nowrap sm:px-0">Proyecto: {p.projectName ?? 'Bandeja'}</span>
      </div>

      {p.note && (
        <p
          className={cn(
            'rounded-lg px-2.5 py-2 text-[13px] leading-snug sm:ml-8 sm:py-1.5 sm:text-xs',
            p.note.tone === 'danger' ? 'bg-danger-wash text-danger dark:bg-danger/15' : 'bg-signal-wash text-signal-ink dark:bg-signal/10',
          )}
        >
          {p.note.text}
        </p>
      )}
    </div>
  )
}
