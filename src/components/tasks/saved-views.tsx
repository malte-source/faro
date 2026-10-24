'use client'

import { useEffect, useState } from 'react'
import { Bookmark, Plus, Trash2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'
import { FilterChip, Field, FIELD_CLASS, SheetActions, useStableCallback } from '@/components/projects/mobile-bits'

/**
 * Saved filter views for the tasks page. Stored in localStorage (no DB
 * schema needed) because they're personal per-browser, not shared.
 *
 * The hosting component passes the current filter state in via `current`;
 * applying a view emits the saved state via `onApply`.
 *
 * Two built-in (non-removable) views are always present:
 *   - "Mis vencidas"   → onlyMine + statusFilter !== done/canceled + due < today
 *   - "Esta semana"    → due in next 7 days
 * These are not stored — they're just convenience filters.
 */

export interface ViewFilters {
  view: 'all' | 'mine'
  statusFilter: string
  priorityFilter: string
  projectFilter: string
  sortBy: string
}

interface SavedView {
  id: string
  name: string
  filters: ViewFilters
}

const STORAGE_KEY = 'faro:taskViews:v1'

function load(): SavedView[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch { return [] }
}
function save(views: SavedView[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views))
}

interface Props {
  current: ViewFilters
  onApply: (f: ViewFilters) => void
}

/** Desktop keeps the compact inline chips; phones get a scrolling chip row + a management sheet. */
export function SavedViews(props: Props) {
  return (
    <>
      <div className="hidden md:block"><SavedViewsDesktop {...props} /></div>
      <div className="md:hidden"><SavedViewsMobile {...props} /></div>
    </>
  )
}

function SavedViewsMobile({ current, onApply }: Props) {
  const [views, setViews] = useState<SavedView[]>([])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const closeSheet = useStableCallback(() => setOpen(false))

  // localStorage only exists on the client: hydrate after mount (same approach as the desktop list).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setViews(load()) }, [])
  const persist = (next: SavedView[]) => { setViews(next); save(next) }
  const isActive = (v: SavedView) => JSON.stringify(v.filters) === JSON.stringify(current)
  const saveCurrent = () => {
    if (!name.trim()) return
    persist([...views, { id: `${Date.now()}`, name: name.trim(), filters: current }])
    setName('')
  }

  return (
    <>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-track data-no-ptr>
        <FilterChip onClick={() => setOpen(true)}>
          <Bookmark className="h-4 w-4" />
          {views.length ? 'Vistas' : 'Guardar vista'}
        </FilterChip>
        {views.map(v => (
          <FilterChip key={v.id} selected={isActive(v)} onClick={() => onApply(v.filters)}>{v.name}</FilterChip>
        ))}
      </div>

      <BottomSheet
        open={open}
        onClose={closeSheet}
        title="Vistas guardadas"
        description="Guardan tus filtros actuales en este dispositivo."
        footer={<SheetActions primaryLabel="Guardar vista actual" onPrimary={saveCurrent} disabled={!name.trim()} />}
      >
        <div className="space-y-5 pb-3 pt-2">
          <Field label="Nombre de la vista">
            <input className={FIELD_CLASS} value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Mis vencidas" onKeyDown={e => { if (e.key === 'Enter') saveCurrent() }} />
          </Field>
          {views.length > 0 && (
            <InsetGroup label="Tus vistas">
              {views.map(v => (
                <ListRow
                  key={v.id}
                  title={v.name}
                  leading={<IconTile tone={isActive(v) ? 'signal' : 'neutral'}><Bookmark /></IconTile>}
                  onClick={() => { onApply(v.filters); setOpen(false) }}
                  trailing={
                    <button
                      type="button"
                      aria-label={`Eliminar la vista ${v.name}`}
                      onClick={e => { e.stopPropagation(); persist(views.filter(x => x.id !== v.id)) }}
                      className="flex h-10 w-10 items-center justify-center rounded-full text-danger active:bg-danger-wash"
                    >
                      <Trash2 className="h-[18px] w-[18px]" />
                    </button>
                  }
                />
              ))}
            </InsetGroup>
          )}
        </div>
      </BottomSheet>
    </>
  )
}

function SavedViewsDesktop({ current, onApply }: Props) {
  const [views, setViews] = useState<SavedView[]>([])
  const [naming, setNaming] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => { setViews(load()) }, [])

  function persist(next: SavedView[]) {
    setViews(next)
    save(next)
  }

  function handleSave() {
    if (!newName.trim()) return
    const id = `${Date.now()}`
    const next = [...views, { id, name: newName.trim(), filters: current }]
    persist(next)
    setNaming(false)
    setNewName('')
  }

  function isActive(v: SavedView): boolean {
    return JSON.stringify(v.filters) === JSON.stringify(current)
  }

  if (views.length === 0 && !naming) {
    return (
      <button
        onClick={() => setNaming(true)}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-stone px-2 py-1 text-[11px] text-graphite hover:border-signal/50 hover:text-signal-ink dark:border-ink-body dark:text-graphite"
      >
        <Bookmark className="h-3 w-3" />
        Guardar vista
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.map(v => (
        <div key={v.id} className="group inline-flex items-center">
          <button
            onClick={() => onApply(v.filters)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
              isActive(v)
                ? 'bg-foreground text-background'
                : 'border border-stone text-graphite hover:bg-signal-wash hover:text-night dark:border-ink-body dark:text-stone dark:hover:bg-signal/40',
            )}
          >
            {isActive(v) && <Check className="h-3 w-3" />}
            {v.name}
          </button>
          <button
            onClick={() => persist(views.filter(x => x.id !== v.id))}
            className="ml-0.5 rounded p-0.5 text-stone opacity-0 hover:text-danger group-hover:opacity-100"
            title="Eliminar vista"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}

      {naming ? (
        <div className="flex items-center gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') { setNaming(false); setNewName('') }
            }}
            autoFocus
            placeholder="Nombre de la vista"
            className="rounded border border-stone px-2 py-0.5 text-[11px] dark:border-ink-body dark:bg-night-700"
          />
          <button
            onClick={handleSave}
            disabled={!newName.trim()}
            className="rounded bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
          >OK</button>
        </div>
      ) : (
        <button
          onClick={() => setNaming(true)}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-stone px-2 py-1 text-[11px] text-graphite hover:border-signal/50 hover:text-signal-ink dark:border-ink-body dark:text-graphite"
        >
          <Plus className="h-3 w-3" />
          Guardar vista actual
        </button>
      )}
    </div>
  )
}
