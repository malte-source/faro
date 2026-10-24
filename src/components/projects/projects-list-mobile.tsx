'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckSquare, FolderKanban, Moon, Plus, SlidersHorizontal } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { PROJECT_STATUS, KANBAN_STAGES } from '@/lib/utils'
import { useEmpresaFilter } from '@/stores/empresa-filter'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { InsetGroup, ListRow } from '@/components/mobile/inset-list'
import { Segmented } from '@/components/mobile/segmented'
import { DueDateChip } from '@/components/ui/due-date-chip'
import { HealthChip } from '@/components/ui/health-chip'
import { Skeleton } from '@/components/ui/skeleton'
import { FilterChip, IosSwitch, SheetActions } from '@/components/projects/mobile-bits'
import { cn } from '@/lib/utils'

export type SortKey = 'smart' | 'updated' | 'health' | 'due' | 'name'

export interface MobileProject {
  id: string
  code: string
  name: string
  status: string
  color: string
  end_date: string | null
  progress_pct: number
  health_score: number | null
  updated_at: string
  members?: unknown
  _taskTotal?: number
  _taskDone?: number
  _lastActivity?: string | null
  _empresa?: { id: string; name: string; color: string } | null
  _sharedWith?: Array<{ id: string; name: string }>
}

export interface MobileFilters {
  status: string
  stage: string
  scope: 'mine' | 'all'
  sort: SortKey
  stale: boolean
}

const QUICK: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'delayed', label: 'Atrasados' },
  { value: 'on_hold', label: 'En pausa' },
  { value: 'completed', label: 'Completados' },
]
const SORTS: Array<{ value: SortKey; label: string; sub: string }> = [
  { value: 'smart', label: 'Inteligente', sub: 'Los que más atención necesitan, primero' },
  { value: 'updated', label: 'Más recientes', sub: 'Última actividad' },
  { value: 'health', label: 'Salud', sub: 'Peor salud primero' },
  { value: 'due', label: 'Vencimiento', sub: 'El más próximo primero' },
  { value: 'name', label: 'Nombre', sub: 'A–Z' },
]
const STALE_DAYS = 14

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function statusTone(status: string): string {
  switch (status) {
    case 'in_progress': return 'bg-info/10 text-info'
    case 'delayed': return 'bg-signal-wash text-signal-ink dark:bg-signal/15'
    case 'completed': return 'bg-success-wash text-success dark:bg-success/15'
    case 'canceled': return 'bg-danger-wash text-danger dark:bg-danger/15'
    case 'on_hold': return 'bg-signal-wash text-signal-ink dark:bg-signal/15'
    default: return 'bg-border-soft text-graphite'
  }
}

/** Horizontal, scrollable empresa chips (the shared EmpresaChips wraps to many lines with 11 empresas). */
function EmpresaScroller() {
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const selected = useEmpresaFilter(s => s.workspaceId)
  const setSelected = useEmpresaFilter(s => s.setWorkspaceId)
  const empresas = me?.empresas ?? []
  if (empresas.length < 2) return null
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-track data-no-ptr role="group" aria-label="Filtrar por empresa">
      <FilterChip selected={selected === null} onClick={() => setSelected(null)}>Todo</FilterChip>
      {empresas.map(e => (
        <FilterChip key={e.id} selected={selected === e.id} onClick={() => setSelected(selected === e.id ? null : e.id)}>
          <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
          {e.name}
        </FilterChip>
      ))}
    </div>
  )
}

export function ProjectsListMobile({
  projects, isLoading, error, filters, apply, isAdmin, groupMode, total,
}: {
  projects: MobileProject[]
  isLoading: boolean
  error: boolean
  filters: MobileFilters
  apply: (patch: Partial<Record<'status' | 'stage' | 'scope' | 'sort' | 'stale', string | null>>) => void
  isAdmin: boolean
  groupMode: boolean
  total: number
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(filters)
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000, enabled: groupMode })
  const empresaFilter = useEmpresaFilter(s => s.workspaceId)
  const setEmpresa = useEmpresaFilter(s => s.setWorkspaceId)
  const [draftEmpresa, setDraftEmpresa] = useState<string | null>(empresaFilter)

  // Everything beyond the quick status chips counts as an "extra" filter on the button.
  const extras =
    (filters.stage !== 'all' ? 1 : 0) +
    (filters.sort !== 'smart' ? 1 : 0) +
    (filters.stale ? 1 : 0) +
    (!groupMode && isAdmin && filters.scope === 'all' ? 1 : 0) +
    (groupMode && empresaFilter ? 1 : 0) +
    (filters.status !== 'all' && !QUICK.some(q => q.value === filters.status) ? 1 : 0)

  const openSheet = () => { setDraft(filters); setDraftEmpresa(empresaFilter); setOpen(true) }
  const applyDraft = () => {
    apply({
      status: draft.status === 'all' ? null : draft.status,
      stage: draft.stage === 'all' ? null : draft.stage,
      scope: draft.scope === 'mine' ? null : draft.scope,
      sort: draft.sort === 'smart' ? null : draft.sort,
      stale: draft.stale ? '1' : null,
    })
    if (groupMode) setEmpresa(draftEmpresa)
    setOpen(false)
  }
  const clearDraft = () => {
    apply({ status: null, stage: null, scope: null, sort: null, stale: null })
    if (groupMode) setEmpresa(null)
    setOpen(false)
  }

  const hasAny = filters.status !== 'all' || extras > 0

  return (
    <div className="space-y-3 md:hidden">
      {groupMode && <EmpresaScroller />}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-track data-no-ptr role="group" aria-label="Filtrar por estado">
        <FilterChip onClick={openSheet} count={extras} className="border-border">
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
        </FilterChip>
        {QUICK.map(q => (
          <FilterChip key={q.value} selected={filters.status === q.value} onClick={() => apply({ status: q.value === 'all' ? null : q.value })}>
            {q.label}
          </FilterChip>
        ))}
      </div>

      {error ? (
        <div className="flex flex-col items-center rounded-[14px] border border-dashed border-danger/30 bg-danger-wash px-6 py-12 text-center text-danger dark:bg-danger/10">
          <AlertCircle className="mb-2 h-6 w-6" />
          <p className="text-sm font-semibold">No se pudieron cargar los proyectos</p>
          <p className="mt-1 text-xs opacity-80">Desliza hacia abajo para reintentar.</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-2.5">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[112px] rounded-[14px]" />)}</div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center rounded-[14px] border border-dashed border-border bg-surface px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-border-soft text-graphite"><FolderKanban className="h-7 w-7" /></span>
          <p className="mt-4 font-display text-lg font-extrabold tracking-[-0.03em] text-foreground">{hasAny ? 'Nada con esos filtros' : 'Aún no hay proyectos'}</p>
          <p className="mt-1 max-w-[16rem] text-[13px] text-graphite">
            {hasAny ? 'Prueba quitando algún filtro.' : 'Crea el primero para empezar a organizar el trabajo.'}
          </p>
          {hasAny ? (
            <button type="button" onClick={clearDraft} className="mt-5 h-11 rounded-full bg-foreground px-5 text-sm font-semibold text-background active:opacity-90">Limpiar filtros</button>
          ) : (
            <Link href="/dashboard/projects/new" className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-signal px-5 text-sm font-bold text-night active:opacity-90">
              <Plus className="h-4 w-4" /> Nuevo proyecto
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {projects.map(p => {
            const isDone = p.status === 'completed' || p.status === 'canceled'
            const members = (p.members as Array<{ role: string; user: { name: string } | null }> | null) ?? []
            const lead = members.find(m => m.role === 'lead')?.user?.name
            const stale = daysSince(p._lastActivity ?? p.updated_at)
            const isStale = stale !== null && stale >= STALE_DAYS && !isDone
            const status = PROJECT_STATUS[p.status as keyof typeof PROJECT_STATUS]
            return (
              <li key={p.id}>
                <Link
                  href={`/dashboard/projects/${p.id}`}
                  className="block rounded-[14px] border border-border bg-surface p-3.5 transition-colors active:bg-border-soft"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">
                        {groupMode && p._empresa && (
                          <>
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: p._empresa.color }} />
                            <span className="truncate">{p._empresa.name}</span>
                            <span aria-hidden>·</span>
                          </>
                        )}
                        <span className="shrink-0">{p.code}</span>
                      </p>
                      <p className="mt-0.5 truncate font-display text-base font-bold tracking-[-0.02em] text-foreground">{p.name}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold', statusTone(p.status))}>{status?.label}</span>
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border-soft">
                    <div className="h-full rounded-full bg-signal transition-all duration-500" style={{ width: `${p.progress_pct}%` }} />
                  </div>

                  <div className="mt-2.5 flex min-w-0 items-center gap-x-2.5 text-xs text-graphite">
                    <span className="truncate">{lead ?? 'Sin líder'}</span>
                    {p.end_date && <span className="shrink-0"><DueDateChip date={p.end_date} isDone={isDone} variant="text" /></span>}
                    <span className="ml-auto shrink-0 font-semibold tabular-nums text-foreground">{p.progress_pct}%</span>
                  </div>

                  {(p.health_score !== null || (p._taskTotal ?? 0) > 0 || isStale || !!p._sharedWith?.length) && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-graphite">
                      <HealthChip score={p.health_score} />
                      {(p._taskTotal ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1"><CheckSquare className="h-3 w-3" /><span className="tabular-nums">{p._taskDone ?? 0}/{p._taskTotal}</span></span>
                      )}
                      {isStale && <span className="inline-flex items-center gap-1 text-signal-ink"><Moon className="h-3 w-3" />Inactivo {stale}d</span>}
                    </div>
                  )}
                  {groupMode && !!p._sharedWith?.length && (
                    <p className="mt-2.5 rounded-lg bg-signal-wash px-2.5 py-1.5 text-[11px] font-medium text-signal-ink dark:bg-signal/10">
                      Compartido con {p._sharedWith.map(w => w.name).join(', ')}
                    </p>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {!isLoading && projects.length > 0 && (
        <p className="pb-2 text-center text-xs text-graphite">
          {projects.length} proyecto{projects.length !== 1 ? 's' : ''}{filters.stale && total !== projects.length ? ` · filtrados de ${total}` : ''}
        </p>
      )}

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Filtros"
        tall
        footer={<SheetActions primaryLabel="Aplicar" onPrimary={applyDraft} secondaryLabel="Limpiar" onSecondary={clearDraft} />}
      >
        <div className="space-y-6 pb-2 pt-2">
          {groupMode && !!me?.empresas.length && (
            <div className="space-y-2">
              <h3 className="px-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">Empresa</h3>
              <div className="flex flex-wrap gap-2">
                <FilterChip selected={draftEmpresa === null} onClick={() => setDraftEmpresa(null)}>Todas</FilterChip>
                {me.empresas.map(e => (
                  <FilterChip key={e.id} selected={draftEmpresa === e.id} onClick={() => setDraftEmpresa(e.id)}>
                    <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />{e.name}
                  </FilterChip>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="px-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">Estado</h3>
            <div className="flex flex-wrap gap-2">
              <FilterChip selected={draft.status === 'all'} onClick={() => setDraft(d => ({ ...d, status: 'all' }))}>Todos</FilterChip>
              {Object.entries(PROJECT_STATUS).map(([value, { label }]) => (
                <FilterChip key={value} selected={draft.status === value} onClick={() => setDraft(d => ({ ...d, status: value }))}>{label}</FilterChip>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="px-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">Etapa del workflow</h3>
            <div className="flex flex-wrap gap-2">
              <FilterChip selected={draft.stage === 'all'} onClick={() => setDraft(d => ({ ...d, stage: 'all' }))}>Todas</FilterChip>
              {KANBAN_STAGES.map(s => (
                <FilterChip key={s.id} selected={draft.stage === s.id} onClick={() => setDraft(d => ({ ...d, stage: s.id }))}>{s.label}</FilterChip>
              ))}
            </div>
          </div>

          {!groupMode && isAdmin && (
            <div className="space-y-2">
              <h3 className="px-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">Alcance</h3>
              <Segmented
                aria-label="Alcance"
                value={draft.scope}
                onChange={v => setDraft(d => ({ ...d, scope: v }))}
                options={[{ value: 'mine', label: 'Mis proyectos' }, { value: 'all', label: 'Toda la organización' }]}
              />
            </div>
          )}

          <InsetGroup label="Ordenar por">
            {SORTS.map(s => (
              <ListRow
                key={s.value}
                title={s.label}
                subtitle={s.sub}
                selected={draft.sort === s.value}
                onClick={() => setDraft(d => ({ ...d, sort: s.value }))}
                trailing={draft.sort === s.value ? <span className="text-signal-ink">✓</span> : undefined}
              />
            ))}
          </InsetGroup>

          <InsetGroup footer={`Proyectos sin movimiento hace ${STALE_DAYS}+ días (excluye completados).`}>
            <div className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1 text-[15px] font-medium text-foreground">Solo sin movimiento</span>
              <IosSwitch checked={draft.stale} onChange={v => setDraft(d => ({ ...d, stale: v }))} label="Solo proyectos sin movimiento" />
            </div>
          </InsetGroup>
        </div>
      </BottomSheet>
    </div>
  )
}
