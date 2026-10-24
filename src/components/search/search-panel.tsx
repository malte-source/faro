'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, Search, SearchX, Sparkles, X } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { SEARCH_TYPE_LABEL, type SearchEntityType } from '@/lib/search-utils'
import { cn } from '@/lib/utils'
import { clearRecent, pushRecent, readRecent } from '@/components/search/format'
import { SearchResultRow } from '@/components/search/search-result-row'

type TypeFilter = 'all' | SearchEntityType

const CHIPS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: 'Todo' },
  { value: 'task', label: 'Tareas' },
  { value: 'document', label: 'Documentos' },
  { value: 'chat', label: 'Chat' },
  { value: 'decision', label: 'Decisiones' },
]

/** Order of the groups under "Todo" (avances only appear here). */
const GROUP_ORDER: SearchEntityType[] = ['task', 'document', 'decision', 'update', 'chat']

const EXAMPLES = ['presupuesto de octubre', 'quién aprobó la política de compras', 'contrato de alquiler']

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export interface SearchPanelProps {
  initialQuery?: string
  autoFocus?: boolean
  /** Called right after a result is opened (close the sheet that hosts the panel). */
  onNavigate?: () => void
  /** Reports the typed text (the page keeps `?q=` in the URL). */
  onQueryChange?: (q: string) => void
  /** Fill the parent and scroll the results inside (sheets). Default: results flow with the page. */
  fill?: boolean
  className?: string
}

/**
 * The search experience: one input, type chips, grouped results with highlighted
 * snippets, keyboard navigation (↑ ↓ Enter, Esc clears). Hybrid on the server — full
 * text plus meaning — and it degrades by itself, so this component only renders what
 * comes back and says so when the index is not active yet.
 */
export function SearchPanel({ initialQuery = '', autoFocus = false, onNavigate, onQueryChange, fill = false, className }: SearchPanelProps) {
  const router = useRouter()
  const [q, setQ] = useState(initialQuery)
  const [type, setType] = useState<TypeFilter>('all')
  const [recent, setRecent] = useState<string[]>([])
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  // Recent searches come from localStorage: read after mount (never during render, so SSR matches).
  useEffect(() => {
    const t = setTimeout(() => setRecent(readRecent()), 0)
    return () => clearTimeout(t)
  }, [])

  const debounced = useDebouncedValue(q.trim(), 250)
  const enabled = debounced.length >= 2
  const query = trpc.search.hybrid.useQuery(
    { q: debounced, types: type === 'all' ? undefined : [type], limit: 20 },
    { enabled, placeholderData: prev => prev, staleTime: 30_000, retry: false },
  )

  const data = enabled ? query.data : undefined
  const groups = useMemo(() => {
    const hits = data?.hits ?? []
    if (type !== 'all') return hits.length ? [{ type: type as SearchEntityType, hits }] : []
    return GROUP_ORDER
      .map(t => ({ type: t, hits: hits.filter(h => h.type === t) }))
      .filter(g => g.hits.length > 0)
  }, [data, type])
  const flat = useMemo(() => groups.flatMap(g => g.hits), [groups])
  // Index of each group's first row in `flat`, so rows get stable ids without mutating anything in render.
  const groupStart = useMemo(
    () => groups.map((_, i) => groups.slice(0, i).reduce((n, g) => n + g.hits.length, 0)),
    [groups],
  )

  // The highlighted row resets to the first result whenever the result set changes (derived, no effect needed).
  const signature = flat.map(h => `${h.type}:${h.id}`).join(',')
  const [activeState, setActiveState] = useState({ signature: '', index: 0 })
  const activeIndex = activeState.signature === signature ? Math.min(activeState.index, Math.max(0, flat.length - 1)) : 0
  const setActive = useCallback((index: number) => setActiveState({ signature, index }), [signature])

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, signature])

  const change = (value: string) => {
    setQ(value)
    onQueryChange?.(value)
  }

  const open = (hit: { url: string }) => {
    pushRecent(q)
    router.push(hit.url)
    onNavigate?.()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && flat.length) {
      e.preventDefault()
      setActive((activeIndex + 1) % flat.length)
    } else if (e.key === 'ArrowUp' && flat.length) {
      e.preventDefault()
      setActive((activeIndex - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter' && flat[activeIndex]) {
      e.preventDefault()
      open(flat[activeIndex])
    } else if (e.key === 'Escape' && q) {
      // First Esc clears the text; a second one (empty input) is left to the sheet to close.
      e.preventDefault()
      e.stopPropagation()
      change('')
    }
  }

  const loading = enabled && query.isFetching && !data
  const refreshing = enabled && query.isFetching && !!data
  const showEmptyState = enabled && !query.isFetching && !query.error && data && flat.length === 0

  return (
    <div className={cn('flex min-h-0 flex-col', fill && 'h-full', className)}>
      <div className="shrink-0 space-y-2.5 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-graphite" aria-hidden />
          <input
            value={q}
            onChange={e => change(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus={autoFocus}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            role="combobox"
            aria-label="Buscar en Faro"
            aria-expanded={flat.length > 0}
            aria-controls="search-results"
            aria-activedescendant={flat.length ? `search-opt-${activeIndex}` : undefined}
            placeholder="Buscar tareas, documentos, chat…"
            className="h-12 w-full rounded-[14px] border border-border bg-surface pl-11 pr-11 text-base text-foreground outline-none transition-colors placeholder:text-graphite focus:border-signal focus:ring-2 focus:ring-signal/30 [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button
              type="button"
              onClick={() => change('')}
              aria-label="Borrar búsqueda"
              className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-graphite active:bg-border-soft"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <span
            className={cn('pointer-events-none absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full transition-opacity', refreshing ? 'opacity-100' : 'opacity-0')}
            aria-hidden
          >
            <span className="block h-full w-full animate-pulse rounded-full bg-signal" />
          </span>
        </div>

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-track role="tablist" aria-label="Tipo de resultado">
          {CHIPS.map(c => {
            const selected = c.value === type
            return (
              <button
                key={c.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setType(c.value)}
                className={cn(
                  'h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
                  selected
                    ? 'border-night bg-night text-mist dark:border-signal dark:bg-signal dark:text-night'
                    : 'border-border bg-surface text-graphite active:bg-border-soft',
                )}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      </div>

      <div id="search-results" role="listbox" aria-label="Resultados" className={cn('min-h-0', fill && 'flex-1 overflow-y-auto overscroll-contain pb-4')}>
        {!enabled && (
          <div className="space-y-5 px-1 pt-2">
            {recent.length > 0 && (
              <section>
                <div className="mb-1 flex items-center justify-between px-2">
                  <h3 className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">Recientes</h3>
                  <button type="button" onClick={() => { clearRecent(); setRecent([]) }} className="text-xs text-graphite underline-offset-2 active:underline">Borrar</button>
                </div>
                {recent.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => change(r)}
                    className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 text-left text-[15px] text-foreground active:bg-border-soft"
                  >
                    <Clock className="h-4 w-4 shrink-0 text-graphite" aria-hidden />
                    <span className="truncate">{r}</span>
                  </button>
                ))}
              </section>
            )}
            <section className="px-2">
              <h3 className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">Prueba con</h3>
              <ul className="space-y-1 text-[13px] text-graphite">
                {EXAMPLES.map(e => (
                  <li key={e}>
                    <button type="button" onClick={() => change(e)} className="text-left underline-offset-2 active:underline">«{e}»</button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex items-start gap-1.5 text-xs text-graphite">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-ink" aria-hidden />
                Busca por significado, no solo por las palabras exactas.
              </p>
            </section>
          </div>
        )}

        {loading && (
          <div className="space-y-2 px-1 pt-1" aria-busy="true">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex gap-3 rounded-xl px-3 py-2.5">
                <div className="h-8 w-8 animate-pulse rounded-[10px] bg-border-soft" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-border-soft" />
                  <div className="h-3 w-full animate-pulse rounded bg-border-soft" />
                </div>
              </div>
            ))}
          </div>
        )}

        {enabled && query.error && !data && (
          <div className="mx-1 mt-2 rounded-xl border border-danger/30 bg-danger-wash p-4 text-sm text-danger dark:bg-danger/10" role="alert">
            <p className="font-medium">No se pudo buscar</p>
            <p className="mt-0.5 text-[13px]">{query.error.message}</p>
            <button type="button" onClick={() => void query.refetch()} className="mt-2 h-9 rounded-full border border-danger/40 px-4 text-[13px] font-medium active:bg-danger/10">
              Intentar de nuevo
            </button>
          </div>
        )}

        {showEmptyState && (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <SearchX className="h-8 w-8 text-graphite" aria-hidden />
            <p className="mt-3 text-[15px] font-medium text-foreground">Sin resultados para «{debounced}»</p>
            <p className="mt-1 text-[13px] text-graphite">
              {type === 'all' ? 'Prueba con otras palabras o con menos palabras.' : 'Prueba en «Todo» o con otras palabras.'}
            </p>
          </div>
        )}

        {groups.map((g, gi) => (
          <section key={g.type} className="px-1 pt-1" aria-label={SEARCH_TYPE_LABEL[g.type]}>
            {type === 'all' && (
              <h3 className="px-3 pb-0.5 pt-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">{SEARCH_TYPE_LABEL[g.type]}</h3>
            )}
            {g.hits.map((hit, hi) => {
              const i = groupStart[gi] + hi
              return (
                <SearchResultRow
                  key={`${hit.type}:${hit.id}`}
                  ref={el => { rowRefs.current[i] = el }}
                  id={`search-opt-${i}`}
                  hit={hit}
                  active={i === activeIndex}
                  onSelect={() => open(hit)}
                  onHover={() => { if (i !== activeIndex) setActive(i) }}
                />
              )
            })}
          </section>
        ))}

        {data?.mode === 'basic' && flat.length > 0 && (
          <p className="px-4 pb-2 pt-3 text-center text-[11px] text-graphite">
            Búsqueda básica por título y texto. La búsqueda inteligente se activa cuando termine de indexarse el contenido.
          </p>
        )}
      </div>
    </div>
  )
}
