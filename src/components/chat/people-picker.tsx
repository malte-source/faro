'use client'

import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalize } from '@/components/chat/chat-utils'
import { UserAvatar } from '@/components/chat/user-avatar'
import type { DirectoryPerson } from '@/components/chat/types'

/**
 * Searchable list of people. With `onPick` each row is a single action
 * (e.g. open a DM); with `selected` + `onToggle` rows are checkboxes.
 */
export function PeoplePicker({
  people,
  selected,
  onToggle,
  onPick,
  className,
}: {
  people: DirectoryPerson[]
  selected?: Set<string>
  onToggle?: (id: string) => void
  onPick?: (id: string) => void
  className?: string
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = normalize(query)
    return q ? people.filter(p => normalize(p.name).includes(q)) : people
  }, [people, query])

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar persona…"
          aria-label="Buscar persona"
          className="h-9 w-full rounded-[10px] border border-stone bg-surface pl-9 pr-3 text-sm text-night placeholder:text-graphite focus:border-night focus:outline-none focus:ring-2 focus:ring-signal/40 dark:border-[#1E3A4C] dark:bg-[#12293A] dark:text-mist"
        />
      </div>
      <ul className="max-h-64 overflow-y-auto rounded-[10px] border border-stone dark:border-[#1E3A4C]" role={onPick ? 'list' : 'listbox'} aria-multiselectable={!onPick}>
        {filtered.length === 0 ? (
          <li className="px-3 py-4 text-center text-sm text-graphite">Nadie coincide con la búsqueda.</li>
        ) : (
          filtered.map(p => {
            const isSelected = selected?.has(p.id) ?? false
            const cargos = p.memberships.length
            return (
              <li key={p.id} role={onPick ? 'listitem' : 'option'} aria-selected={onPick ? undefined : isSelected}>
                <button
                  type="button"
                  onClick={() => (onPick ? onPick(p.id) : onToggle?.(p.id))}
                  className="flex min-h-[44px] w-full items-center gap-3 border-b border-stone-100 px-3 py-2 text-left last:border-b-0 hover:bg-stone-100/70 focus-visible:bg-stone-100 dark:border-night-700 dark:hover:bg-night-700"
                >
                  <UserAvatar name={p.name} src={p.avatarUrl} className="h-7 w-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-night dark:text-mist">{p.name}</span>
                    {cargos > 0 && <span className="block truncate text-xs text-graphite">{p.memberships[0].position}{cargos > 1 ? ` · +${cargos - 1}` : ''}</span>}
                  </span>
                  {!onPick && (
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border', isSelected ? 'border-signal bg-signal text-night' : 'border-graphite')}>
                      {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                  )}
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
