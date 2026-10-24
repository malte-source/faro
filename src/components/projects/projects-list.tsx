'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PROJECT_STATUS, PRIORITY, KANBAN_STAGES } from '@/lib/utils'
import { Plus, AlertCircle, GitBranch, Users, CheckSquare, Clock, Moon } from 'lucide-react'
import type { ProjectStatus, KanbanStage } from '@/types/database'
import { DueDateChip } from '@/components/ui/due-date-chip'
import { HealthChip } from '@/components/ui/health-chip'
import { EmpresaChips } from '@/components/layout/empresa-chips'
import { useEmpresaFilter } from '@/stores/empresa-filter'
import { ProjectsListMobile, type MobileProject } from '@/components/projects/projects-list-mobile'

/** Lookup map for kanban-stage labels (used in card meta). */
const KANBAN_LABEL: Record<string, string> = Object.fromEntries(KANBAN_STAGES.map(s => [s.id, s.label]))

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  ...Object.entries(PROJECT_STATUS).map(([value, { label }]) => ({ value, label })),
]
const KANBAN_OPTIONS = [
  { value: 'all', label: 'Todas las etapas' },
  ...KANBAN_STAGES.map(({ id, label }) => ({ value: id, label })),
]
const SORT_OPTIONS = [
  { value: 'smart', label: '🧠 Inteligente (peores primero)' },
  { value: 'updated', label: 'Más recientes' },
  { value: 'health', label: 'Salud (peor primero)' },
  { value: 'due', label: 'Vencimiento (más próximo)' },
  { value: 'name', label: 'Nombre (A-Z)' },
] as const
type SortKey = typeof SORT_OPTIONS[number]['value']

function statusVariant(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange' {
  const map: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange'> = {
    not_started: 'secondary', in_progress: 'default', on_hold: 'warning',
    delayed: 'orange', completed: 'success', canceled: 'danger', pending: 'default',
  }
  return map[status] ?? 'secondary'
}

/** Days since a TIMESTAMPTZ string. Returns null if missing. */
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / 86_400_000)
}

const STALE_THRESHOLD_DAYS = 14

export function ProjectsList() {
  const router = useRouter()
  const params = useSearchParams()

  // Filters persisted in URL — shareable links + survives back-nav.
  const statusFilter = params.get('status') ?? 'all'
  const kanbanFilter = params.get('stage') ?? 'all'
  const scope = (params.get('scope') as 'mine' | 'all' | null) ?? 'mine'
  const sortBy = (params.get('sort') as SortKey | null) ?? 'smart'
  const showStale = params.get('stale') === '1'

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString())
    if (value && value !== 'all' && value !== '') next.set(key, value)
    else next.delete(key)
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  /** Several params at once (the phone filter sheet): one router.replace so they don't overwrite each other. */
  function applyParams(patch: Partial<Record<'status' | 'stage' | 'scope' | 'sort' | 'stale', string | null>>) {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value && value !== 'all' && value !== '') next.set(key, value)
      else next.delete(key)
    }
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  const { data: me } = trpc.team.me.useQuery()
  const isAdmin = me?.isAdmin ?? false
  // Grupo mode: empresa chips replace the mine/all toggle.
  const { data: grupo } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const groupMode = grupo?.groupMode ?? false
  const empresaFilter = useEmpresaFilter(s => s.workspaceId)

  const { data: projects, isLoading, error } = trpc.projects.list.useQuery({
    status: statusFilter !== 'all' ? (statusFilter as ProjectStatus) : undefined,
    kanbanStage: kanbanFilter !== 'all' ? (kanbanFilter as KanbanStage) : undefined,
    scope,
    workspaceId: groupMode && empresaFilter ? empresaFilter : undefined,
  })

  // Type guard — server now returns task counts + last activity
  type EnrichedProject = NonNullable<typeof projects>[number] & {
    _taskTotal?: number
    _taskDone?: number
    _lastActivity?: string | null
    _empresa?: { id: string; name: string; color: string } | null
    _sharedWith?: Array<{ id: string; name: string }>
  }

  /**
   * Smart sort: bring the projects most in need of attention to the top.
   *   1. Low health first (null health stays in the middle, not penalised).
   *   2. Then closest deadline (overdue → today → soon → far → no date).
   *   3. Tie-breaker: status priority (delayed > in_progress > others).
   */
  const sortedAndFiltered = useMemo(() => {
    if (!projects) return [] as EnrichedProject[]
    const arr = projects as EnrichedProject[]
    const filtered = showStale
      ? arr.filter(p => {
          const d = daysSince(p._lastActivity ?? p.updated_at)
          return d !== null && d >= STALE_THRESHOLD_DAYS &&
            p.status !== 'completed' && p.status !== 'canceled'
        })
      : arr
    const sorted = [...filtered]
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'health':
        sorted.sort((a, b) => (a.health_score ?? 999) - (b.health_score ?? 999)); break
      case 'due':
        sorted.sort((a, b) => (a.end_date ?? 'zzz').localeCompare(b.end_date ?? 'zzz')); break
      case 'updated':
        sorted.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')); break
      case 'smart':
      default: {
        const statusWeight: Record<string, number> = {
          delayed: 0, in_progress: 1, on_hold: 2, pending: 3, not_started: 4, completed: 5, canceled: 6,
        }
        sorted.sort((a, b) => {
          // 1. Worse health first. nulls treated as 50 (neutral).
          const ha = a.health_score ?? 50, hb = b.health_score ?? 50
          if (ha !== hb) return ha - hb
          // 2. Soonest deadline first.
          const da = a.end_date ?? '9999', db = b.end_date ?? '9999'
          if (da !== db) return da.localeCompare(db)
          // 3. Status urgency tie-breaker.
          return (statusWeight[a.status] ?? 99) - (statusWeight[b.status] ?? 99)
        })
        break
      }
    }
    return sorted
  }, [projects, sortBy, showStale])

  const hasFilters = statusFilter !== 'all' || kanbanFilter !== 'all' || showStale

  return (
    <>
    <ProjectsListMobile
      projects={sortedAndFiltered as MobileProject[]}
      isLoading={isLoading}
      error={!!error}
      filters={{ status: statusFilter, stage: kanbanFilter, scope, sort: sortBy, stale: showStale }}
      apply={applyParams}
      isAdmin={isAdmin}
      groupMode={groupMode}
      total={projects?.length ?? 0}
    />
    <div className="hidden space-y-4 md:block">
      {groupMode && <EmpresaChips />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Scope toggle — visible only for owner/admin (not in grupo mode, where empresa chips apply) */}
        {isAdmin && !groupMode && (
          <div className="inline-flex rounded-lg border border-stone p-0.5 dark:border-ink-body">
            <button
              onClick={() => setParam('scope', 'mine')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${scope === 'mine' ? 'bg-foreground text-background' : 'text-graphite hover:text-ink-body dark:text-graphite'}`}
              title="Solo proyectos donde eres miembro"
            >Mis proyectos</button>
            <button
              onClick={() => setParam('scope', 'all')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${scope === 'all' ? 'bg-foreground text-background' : 'text-graphite hover:text-ink-body dark:text-graphite'}`}
              title="Todos los proyectos del org (solo owner/admin)"
            >Todo el org</button>
          </div>
        )}

        <Select value={statusFilter} onValueChange={v => setParam('status', v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={kanbanFilter} onValueChange={v => setParam('stage', v)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {KANBAN_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={v => setParam('sort', v === 'smart' ? null : v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Stale toggle — "zombie projects" without activity 14+ days */}
        <button
          onClick={() => setParam('stale', showStale ? null : '1')}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            showStale
              ? 'border-signal-ink bg-signal-wash text-signal-ink dark:border-signal-ink dark:bg-signal/40 dark:text-signal/50'
              : 'border-stone text-graphite hover:text-ink-body dark:border-ink-body dark:text-graphite'
          }`}
          title={`Proyectos sin movimiento hace ${STALE_THRESHOLD_DAYS}+ días (excluye completados)`}
        >
          <Moon className="h-3.5 w-3.5" />
          Sin movimiento
        </button>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setParam('status', null); setParam('stage', null); setParam('stale', null)
            }}
          >
            Limpiar filtros
          </Button>
        )}

        <div className="ml-auto">
          <Link href="/dashboard/projects/new">
            <Button size="sm">
              <Plus className="h-4 w-4" /> Nuevo proyecto
            </Button>
          </Link>
        </div>
      </div>

      {/* List */}
      {error ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-danger/30 bg-danger-wash py-16 text-danger">
          <AlertCircle className="mb-2 h-6 w-6" />
          <p className="text-sm font-medium">Error al cargar proyectos</p>
          <p className="mt-1 text-xs text-danger/50">Intenta recargar la página</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-3 w-3 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-64" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-4 w-16" />
              </div>
            </Card>
          ))}
        </div>
      ) : !sortedAndFiltered.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone bg-white py-20 text-graphite dark:border-ink-body dark:bg-night">
          <AlertCircle className="mb-3 h-8 w-8" />
          <p className="text-sm font-medium">No hay proyectos</p>
          <p className="mt-1 text-xs">
            {hasFilters ? 'Ningún proyecto coincide con los filtros activos' : 'Crea el primer proyecto para empezar'}
          </p>
          {!hasFilters && (
            <Link href="/dashboard/projects/new" className="mt-4">
              <Button size="sm"><Plus className="h-4 w-4" />Nuevo proyecto</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {sortedAndFiltered.map((project) => {
            const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
            const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]
            const isDone = project.status === 'completed' || project.status === 'canceled'
            const members = (project.members as Array<{
              id: string
              user: { id: string; name: string; avatar_url: string | null } | null
            }> | null) ?? []
            const taskTotal = project._taskTotal ?? 0
            const taskDone = project._taskDone ?? 0
            const stale = daysSince(project._lastActivity ?? project.updated_at)
            const isStale = stale !== null && stale >= STALE_THRESHOLD_DAYS && !isDone

            return (
              <Link key={project.id} href={`/dashboard/projects/${project.id}`} className="block touch-manipulation">
                <Card className="cursor-pointer p-4 transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] active:shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {groupMode && project._empresa && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-body dark:text-stone">
                            <span className="h-2 w-2 rounded-full" style={{ background: project._empresa.color }} />
                            {project._empresa.name}
                          </span>
                        )}
                        <span className="text-xs font-medium text-graphite">{project.code}</span>
                        <span className="text-sm font-semibold text-night truncate dark:text-stone-100">{project.name}</span>
                        <HealthChip score={project.health_score} />
                        {isStale && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-signal-wash px-1.5 py-0.5 text-[10px] font-semibold text-signal-ink dark:bg-signal/40 dark:text-signal/50"
                            title={`Sin movimiento hace ${stale} días`}
                          >
                            <Moon className="h-2.5 w-2.5" />
                            Inactivo {stale}d
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-graphite flex-wrap">
                        <span className={`font-medium ${priorityInfo?.color ?? ''}`}>{priorityInfo?.label}</span>
                        {(project as { kanban_stage?: string }).kanban_stage && (
                          <>
                            <span className="text-stone">·</span>
                            <span
                              className="inline-flex items-center gap-1 rounded-md border border-dashed border-stone px-1.5 py-0.5 text-[10px] text-graphite dark:border-ink-body dark:text-graphite"
                              title="Etapa del workflow"
                            >
                              <GitBranch className="h-2.5 w-2.5" />
                              {KANBAN_LABEL[(project as { kanban_stage: string }).kanban_stage]}
                            </span>
                          </>
                        )}
                        {project.end_date && (
                          <>
                            <span className="text-stone">·</span>
                            <DueDateChip date={project.end_date} isDone={isDone} variant="text" />
                          </>
                        )}
                      </div>

                      {groupMode && !!project._sharedWith?.length && (
                        <p className="mt-1.5 inline-block rounded-md bg-signal-wash px-2 py-0.5 text-[11px] font-medium text-signal-ink dark:bg-night-700 dark:text-signal">
                          Compartido con {project._sharedWith.map(w => w.name).join(', ')}
                        </p>
                      )}

                      {/* New: task counter + member avatars + last activity */}
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-graphite flex-wrap">
                        {taskTotal > 0 && (
                          <span className="inline-flex items-center gap-1" title={`${taskDone} de ${taskTotal} tareas completadas`}>
                            <CheckSquare className="h-3 w-3" />
                            <span className="tabular-nums">{taskDone}/{taskTotal}</span>
                          </span>
                        )}
                        {members.length > 0 && (
                          <span className="inline-flex items-center gap-1" title={`${members.length} miembro${members.length === 1 ? '' : 's'}`}>
                            <Users className="h-3 w-3" />
                            <div className="flex -space-x-1.5">
                              {members.slice(0, 3).map(m => (
                                <Avatar key={m.id} className="h-4 w-4 ring-1 ring-white dark:ring-night">
                                  <AvatarImage src={m.user?.avatar_url ?? undefined} />
                                  <AvatarFallback className="text-[7px]">{(m.user?.name ?? '?').slice(0, 2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                              ))}
                              {members.length > 3 && (
                                <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-stone text-[7px] font-semibold text-graphite ring-1 ring-white dark:bg-ink-body dark:text-stone dark:ring-night">
                                  +{members.length - 3}
                                </span>
                              )}
                            </div>
                          </span>
                        )}
                        {stale !== null && (
                          <span className="inline-flex items-center gap-1" title={`Última actividad ${new Date(project._lastActivity ?? project.updated_at).toLocaleDateString('es-AR')}`}>
                            <Clock className="h-3 w-3" />
                            {stale === 0 ? 'hoy' : stale === 1 ? 'ayer' : `hace ${stale}d`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="hidden sm:flex w-28 flex-col gap-1">
                      <div className="flex justify-between text-xs text-graphite">
                        <span>Progreso</span>
                        <span>{project.progress_pct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-night-700">
                        <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${project.progress_pct}%` }} />
                      </div>
                    </div>

                    <Badge variant={statusVariant(project.status)} className="shrink-0">
                      {statusInfo?.label}
                    </Badge>
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {sortedAndFiltered.length > 0 && (
        <p className="text-right text-xs text-graphite">
          {sortedAndFiltered.length} proyecto{sortedAndFiltered.length !== 1 ? 's' : ''}
          {showStale && projects && projects.length !== sortedAndFiltered.length && (
            <span className="ml-1 text-signal-ink">(filtrados de {projects.length})</span>
          )}
        </p>
      )}
    </div>
    </>
  )
}
