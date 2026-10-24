'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { X, Target } from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { useEscapeClose } from '@/hooks/use-escape-close'
import type { GoalStatus } from '@/types/database'

interface Props {
  goalId: string | null  // null = create new
  existing?: {
    id: string
    title: string
    description: string | null
    parent_goal_id: string | null
    owner_id: string | null
    status: GoalStatus
    progress_pct: number
    progress_manual: boolean
    target_date: string | null
    quarter: string | null
  }
  allGoals: Array<{ id: string; title: string }>
  onClose: () => void
}

const STATUS_OPTIONS: Array<{ value: GoalStatus; label: string }> = [
  { value: 'not_started', label: 'No iniciado' },
  { value: 'on_track',    label: 'En camino' },
  { value: 'at_risk',     label: 'En riesgo' },
  { value: 'off_track',   label: 'Atrasado' },
  { value: 'achieved',    label: 'Logrado' },
  { value: 'canceled',    label: 'Cancelado' },
]

/** Auto-generate quarter options around the current year — 2 past, current, 2 future. */
function currentQuarterOptions(): Array<{ value: string; label: string }> {
  const now = new Date()
  const year = now.getFullYear()
  const quarter = Math.floor(now.getMonth() / 3) + 1
  const opts: Array<{ value: string; label: string }> = []
  for (let yOff = -1; yOff <= 1; yOff++) {
    for (let q = 1; q <= 4; q++) {
      const y = year + yOff
      const value = `${y}-Q${q}`
      const isCurrent = y === year && q === quarter
      opts.push({ value, label: `${value}${isCurrent ? ' (actual)' : ''}` })
    }
  }
  return opts
}

export function GoalEditor({ goalId, existing, allGoals, onClose }: Props) {
  const isNew = goalId === null
  const utils = trpc.useUtils()
  const { data: members } = trpc.team.members.useQuery()
  useEscapeClose(onClose)

  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [parentGoalId, setParentGoalId] = useState(existing?.parent_goal_id ?? '')
  const [ownerId, setOwnerId] = useState(existing?.owner_id ?? '')
  const [status, setStatus] = useState<GoalStatus>(existing?.status ?? 'not_started')
  const [progressPct, setProgressPct] = useState(existing?.progress_pct ?? 0)
  const [progressManual, setProgressManual] = useState(existing?.progress_manual ?? false)
  const [targetDate, setTargetDate] = useState(existing?.target_date ?? '')
  const [quarter, setQuarter] = useState(existing?.quarter ?? '')

  useEffect(() => {
    if (existing) {
      setTitle(existing.title)
      setDescription(existing.description ?? '')
      setParentGoalId(existing.parent_goal_id ?? '')
      setOwnerId(existing.owner_id ?? '')
      setStatus(existing.status)
      setProgressPct(existing.progress_pct)
      setProgressManual(existing.progress_manual)
      setTargetDate(existing.target_date ?? '')
      setQuarter(existing.quarter ?? '')
    }
  }, [existing])

  const create = trpc.goals.create.useMutation({
    onSuccess: () => { toast.success('Objetivo creado'); onClose() },
    onError: (e) => toast.error('No se pudo crear', e.message),
  })
  const update = trpc.goals.update.useMutation({
    onSuccess: () => { toast.success('Objetivo actualizado'); utils.goals.invalidate(); onClose() },
    onError: (e) => toast.error('No se pudo actualizar', e.message),
  })

  function handleSave() {
    if (!title.trim()) { toast.warning('Falta el título'); return }
    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      parentGoalId: parentGoalId || undefined,
      ownerId: ownerId || undefined,
      status,
      progressPct,
      progressManual,
      targetDate: targetDate || undefined,
      quarter: quarter || undefined,
    }
    if (isNew) create.mutate(payload)
    else update.mutate({
      id: goalId!,
      ...payload,
      description: description.trim() || null,
      parentGoalId: parentGoalId || null,
      ownerId: ownerId || null,
      targetDate: targetDate || null,
      quarter: quarter || null,
    })
  }

  const quarterOptions = currentQuarterOptions()

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 md:items-center md:p-4 animate-in fade-in" onClick={onClose}>
      <div
        className="max-h-[92dvh] md:max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-[26px] rounded-b-none md:rounded-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-5 shadow-2xl dark:bg-night animate-in slide-in-from-bottom md:zoom-in-95 md:slide-in-from-bottom-0"
        onClick={e => e.stopPropagation()}
      ><span className="mx-auto -mt-2 mb-3 block h-1 w-10 shrink-0 rounded-full bg-stone dark:bg-border md:hidden" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-wash dark:bg-signal/40">
              <Target className="h-4 w-4 text-signal-ink" />
            </span>
            <h2 className="text-base font-semibold text-night dark:text-stone-100">
              {isNew ? 'Nuevo objetivo' : 'Editar objetivo'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-graphite dark:text-stone">Título</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder='Ej: Crecer revenue 30% Q4 · Lanzar versión 2.0 · Mejorar NPS'
              className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-graphite dark:text-stone">Descripción</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder="Contexto, KR, métricas de éxito…"
              className="mt-1 w-full resize-none rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-graphite dark:text-stone">Estado</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as GoalStatus)}
                className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
              >
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-graphite dark:text-stone">Dueño</label>
              <select
                value={ownerId}
                onChange={e => setOwnerId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
              >
                <option value="">Sin dueño</option>
                {(members ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-graphite dark:text-stone">Fecha objetivo</label>
              <input
                type="date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-graphite dark:text-stone">Trimestre</label>
              <select
                value={quarter}
                onChange={e => setQuarter(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
              >
                <option value="">Sin trimestre</option>
                {quarterOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-graphite dark:text-stone">Objetivo padre (opcional)</label>
            <select
              value={parentGoalId}
              onChange={e => setParentGoalId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone px-3 py-2 text-sm dark:border-ink-body dark:bg-night-700"
            >
              <option value="">Sin padre (top-level)</option>
              {allGoals.filter(g => g.id !== goalId).map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>

          {/* Progress — manual override toggle */}
          <div className="rounded-lg border border-stone p-3 dark:border-ink-body">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={progressManual}
                onChange={e => setProgressManual(e.target.checked)}
                className="h-3.5 w-3.5 accent-signal"
              />
              <span className="text-xs font-medium text-graphite dark:text-stone">
                Forzar progreso manualmente (en vez de calcularlo desde proyectos)
              </span>
            </label>
            {progressManual && (
              <div className="mt-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={progressPct}
                  onChange={e => setProgressPct(parseInt(e.target.value))}
                  className="w-full accent-signal"
                />
                <p className="mt-1 text-xs text-graphite">{progressPct}%</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-stone-100 pt-3 dark:border-night-700">
          <button onClick={onClose} className="rounded-lg border border-stone px-3 py-1.5 text-xs hover:bg-mist dark:border-ink-body dark:hover:bg-night-700">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={create.isPending || update.isPending}
            className="rounded-lg bg-night px-4 py-1.5 text-xs font-semibold text-white hover:bg-night-700 disabled:opacity-50 dark:bg-signal dark:text-night dark:hover:bg-signal/90"
          >
            {create.isPending || update.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
