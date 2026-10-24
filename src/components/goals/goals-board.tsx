'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Target, Plus, Pencil, Trash2, TrendingUp, AlertTriangle, CheckCircle2, Pause, XCircle, Clock, FolderKanban } from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'
import { GoalEditor } from './goal-editor'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { DueDateChip } from '@/components/ui/due-date-chip'
import type { GoalStatus } from '@/types/database'

/**
 * Org-wide Goals board. Lists top-level goals; clicking expands to children
 * and linked projects.
 *
 * Why a single flat list (not a tree by default)? Most orgs have ~5-15 active
 * goals at once — a tree wastes space. We show parent labels inline as
 * breadcrumbs, and a "show children" toggle when relevant.
 */

const STATUS_LABEL: Record<GoalStatus, string> = {
  not_started: 'No iniciado',
  on_track: 'En camino',
  at_risk: 'En riesgo',
  off_track: 'Atrasado',
  achieved: 'Logrado',
  canceled: 'Cancelado',
}

const STATUS_STYLE: Record<GoalStatus, { color: string; icon: React.ReactNode }> = {
  not_started: { color: 'bg-stone-100 text-graphite dark:bg-night-700 dark:text-graphite',          icon: <Pause className="h-3 w-3" /> },
  on_track:    { color: 'bg-success-wash text-success dark:bg-success/40 dark:text-success/50', icon: <TrendingUp className="h-3 w-3" /> },
  at_risk:     { color: 'bg-signal-wash text-signal-ink dark:bg-signal/40 dark:text-signal/50',         icon: <AlertTriangle className="h-3 w-3" /> },
  off_track:   { color: 'bg-danger-wash text-danger dark:bg-danger/40 dark:text-danger/50',             icon: <AlertTriangle className="h-3 w-3" /> },
  achieved:    { color: 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal',             icon: <CheckCircle2 className="h-3 w-3" /> },
  canceled:    { color: 'bg-stone-100 text-graphite dark:bg-night-700 dark:text-graphite',            icon: <XCircle className="h-3 w-3" /> },
}

export function GoalsBoard() {
  const [editingId, setEditingId] = useState<string | null | 'new'>(null)
  const { data, isLoading } = trpc.goals.list.useQuery()
  const utils = trpc.useUtils()

  const remove = trpc.goals.delete.useMutation({
    onSuccess: () => { toast.success('Objetivo borrado'); utils.goals.list.invalidate() },
    onError: (e) => toast.error('No se pudo borrar', e.message),
  })

  if (isLoading) return <ListSkeleton rows={5} />

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setEditingId('new')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-night px-3 py-1.5 text-xs font-semibold text-white hover:bg-night-700 active:scale-95 dark:bg-signal dark:text-night dark:hover:bg-signal/90 max-md:h-10 max-md:px-4 max-md:text-sm"
        >
          <Plus className="h-3.5 w-3.5" /> Nuevo objetivo
        </button>
        <p className="ml-auto text-xs text-graphite">
          {data?.length ?? 0} objetivo{data?.length === 1 ? '' : 's'}
        </p>
      </div>

      {!data?.length ? (
        <EmptyState
          icon={Target}
          title="Sin objetivos todavía"
          description='Crea un objetivo (ej: "Crecer revenue 30% Q4", "Lanzar versión 2.0") y conecta los proyectos que lo materializan. El progreso se calcula automáticamente.'
        />
      ) : (
        <ul className="space-y-3">
          {data.map(g => {
            const status = (g.status ?? 'not_started') as GoalStatus
            const style = STATUS_STYLE[status]
            const progress = g._effectiveProgress ?? g.progress_pct
            const owner = g.owner as { name?: string; avatar_url?: string | null } | null
            const parent = (g as unknown as { parent: { id: string; title: string } | null }).parent
            const isDone = status === 'achieved' || status === 'canceled'
            return (
              <li key={g.id} className="group rounded-xl border border-stone bg-white p-4 transition hover:border-stone dark:border-night-700 dark:bg-night dark:hover:border-ink-body">
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-signal-wash dark:bg-signal/40">
                    <Target className="h-4 w-4 text-signal-ink" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* Title + status pill */}
                    <div className="flex items-start gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-night dark:text-stone-100">{g.title}</h3>
                      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${style.color}`}>
                        {style.icon}
                        {STATUS_LABEL[status]}
                      </span>
                      {g.quarter && (
                        <span className="rounded-md border border-dashed border-stone px-1.5 py-0.5 text-[10px] text-graphite dark:border-ink-body dark:text-graphite">
                          {g.quarter}
                        </span>
                      )}
                    </div>
                    {/* Description (1 line truncated) */}
                    {g.description && (
                      <p className="mt-1 text-xs text-graphite line-clamp-2 dark:text-graphite">{g.description}</p>
                    )}
                    {/* Meta */}
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-graphite flex-wrap">
                      {parent && (
                        <span className="inline-flex items-center gap-1" title="Objetivo padre">
                          ↳ {parent.title}
                        </span>
                      )}
                      {g._projectCount > 0 && (
                        <span className="inline-flex items-center gap-1" title="Proyectos vinculados">
                          <FolderKanban className="h-3 w-3" />
                          {g._projectCount} proyecto{g._projectCount === 1 ? '' : 's'}
                        </span>
                      )}
                      {g.target_date && (
                        <DueDateChip date={g.target_date} isDone={isDone} compact />
                      )}
                      {owner && (
                        <span className="inline-flex items-center gap-1">
                          <Avatar className="h-4 w-4">
                            <AvatarImage src={owner.avatar_url ?? undefined} />
                            <AvatarFallback className="text-[8px]">{(owner.name ?? '?').slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          {owner.name}
                        </span>
                      )}
                      {g.progress_manual && (
                        <span className="text-signal-ink dark:text-signal-ink" title="Progreso seteado manualmente">
                          <Clock className="h-3 w-3 inline" /> manual
                        </span>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div className="mt-3 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-night-700">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            progress >= 80 ? 'bg-success' :
                            progress >= 50 ? 'bg-signal' :
                            progress >= 20 ? 'bg-signal-ink' :
                                             'bg-stone'
                          }`}
                          style={{ width: `${Math.max(2, progress)}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold tabular-nums text-ink-body dark:text-stone">{progress}%</span>
                    </div>
                  </div>

                  {/* Hover actions */}
                  <div className="flex flex-col gap-1 md:opacity-0 transition-opacity md:group-hover:opacity-100">
                    <button
                      onClick={() => setEditingId(g.id)}
                      className="rounded p-1 text-graphite hover:bg-stone-100 hover:text-body dark:hover:bg-night-700"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        const ok = await confirmAction({
                          title: `Borrar objetivo "${g.title}"`,
                          description: 'Los proyectos vinculados se desvinculan pero se mantienen. No se puede deshacer.',
                          variant: 'destructive',
                        })
                        if (ok) remove.mutate(g.id)
                      }}
                      className="rounded p-1 text-graphite hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40"
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

      {editingId && (
        <GoalEditor
          goalId={editingId === 'new' ? null : editingId}
          existing={editingId !== 'new' ? data?.find(g => g.id === editingId) : undefined}
          allGoals={data ?? []}
          onClose={() => { setEditingId(null); utils.goals.list.invalidate() }}
        />
      )}
    </>
  )
}
