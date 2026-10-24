'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { Plus, Trash2, Trophy, ArrowLeft, CheckCircle2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'

interface Props { decisionId: string }

/**
 * Decision Matrix editor — a spreadsheet-style grid.
 *
 * Rows = criteria with a weight slider (1-10).
 * Columns = options being evaluated.
 * Cells = scores (1-10), edited inline.
 *
 * Total per option = Σ (cellScore × criterionWeight).
 * The highest-total option gets a Trophy and is offered as the "resolve"
 * action — clicking it marks the decision as resolved with that option.
 */
export function DecisionEditor({ decisionId }: Props) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.decisions.byId.useQuery(decisionId)

  // ── Mutations ──────────────────────────────────────────────────────
  const refetch = () => utils.decisions.byId.invalidate(decisionId)

  const updateDecision = trpc.decisions.updateDecision.useMutation({ onSuccess: refetch })
  const addCrit = trpc.decisions.addCriterion.useMutation({ onSuccess: refetch })
  const updateCrit = trpc.decisions.updateCriterion.useMutation({ onSuccess: refetch })
  const deleteCrit = trpc.decisions.deleteCriterion.useMutation({ onSuccess: refetch })
  const addOpt = trpc.decisions.addOption.useMutation({ onSuccess: refetch })
  const updateOpt = trpc.decisions.updateOption.useMutation({ onSuccess: refetch })
  const deleteOpt = trpc.decisions.deleteOption.useMutation({ onSuccess: refetch })
  const setScore = trpc.decisions.setScore.useMutation({ onSuccess: refetch })
  const deleteDecision = trpc.decisions.delete.useMutation({
    onSuccess: () => { toast.success('Decisión borrada'); router.push('/dashboard/decisions') },
    onError: (e) => toast.error('No se pudo borrar', e.message),
  })

  // ── Local edit state for newly-added rows/cols ────────────────────
  const [newCritLabel, setNewCritLabel] = useState('')
  const [newOptLabel, setNewOptLabel] = useState('')

  // Build the scores map for O(1) lookup
  const scoreMap = useMemo(() => {
    if (!data) return new Map<string, number>()
    const m = new Map<string, number>()
    for (const s of data.scores) m.set(`${s.criterion_id}|${s.option_id}`, s.score)
    return m
  }, [data])

  // Compute totals per option
  const totals = useMemo(() => {
    if (!data) return new Map<string, number>()
    const m = new Map<string, number>()
    for (const opt of data.options) {
      let total = 0
      for (const c of data.criteria) {
        const s = scoreMap.get(`${c.id}|${opt.id}`) ?? 0
        total += s * c.weight
      }
      m.set(opt.id, total)
    }
    return m
  }, [data, scoreMap])

  const winnerId = useMemo(() => {
    if (!data || !data.options.length) return null
    let best: string | null = null
    let bestTotal = -1
    for (const opt of data.options) {
      const t = totals.get(opt.id) ?? 0
      if (t > bestTotal) { bestTotal = t; best = opt.id }
    }
    return bestTotal > 0 ? best : null
  }, [data, totals])

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <div className="h-10 w-2/3 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />
        <div className="h-64 animate-pulse rounded-xl bg-stone-100 dark:bg-night-700" />
      </div>
    )
  }

  const isResolved = data.status === 'resolved'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => router.back()}
          className="mt-1 rounded-md p-1 text-graphite hover:bg-stone-100 hover:text-body dark:hover:bg-night-700"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <input
            value={data.title}
            onChange={e => updateDecision.mutate({ id: decisionId, title: e.target.value })}
            className="w-full bg-transparent text-xl font-semibold text-night outline-none dark:text-stone-100"
          />
          <textarea
            value={data.description ?? ''}
            onChange={e => updateDecision.mutate({ id: decisionId, description: e.target.value })}
            placeholder="Describe la decisión que estás evaluando…"
            rows={2}
            className="mt-1 w-full resize-none bg-transparent text-sm text-graphite outline-none placeholder:text-graphite"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isResolved ? (
            <button
              onClick={() => updateDecision.mutate({ id: decisionId, status: 'draft', resolvedOptionId: null })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone px-3 py-1.5 text-xs font-medium text-graphite hover:bg-mist dark:border-ink-body dark:text-stone dark:hover:bg-night-700"
            >
              <RotateCcw className="h-3 w-3" />
              Reabrir
            </button>
          ) : winnerId && (
            <button
              onClick={() => updateDecision.mutate({ id: decisionId, status: 'resolved', resolvedOptionId: winnerId })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-xs font-semibold text-white hover:bg-success"
            >
              <CheckCircle2 className="h-3 w-3" />
              Resolver con ganador
            </button>
          )}
          <button
            onClick={async () => {
              const ok = await confirmAction({
                title: 'Borrar esta matriz de decisión',
                description: 'Se borran también todos los criterios, opciones y scores. No se puede deshacer.',
                variant: 'destructive',
              })
              if (ok) deleteDecision.mutate(decisionId)
            }}
            className="rounded-md p-1.5 text-graphite hover:bg-danger-wash hover:text-danger dark:hover:bg-danger/40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Matrix grid */}
      <div className="overflow-x-auto rounded-xl border border-stone bg-white dark:border-night-700 dark:bg-night" data-no-ptr>
        <table className="min-w-full text-sm">
          <thead className="border-b border-stone-100 bg-mist/50 dark:border-night-700 dark:bg-night-700/40">
            <tr>
              <th className="sticky left-0 z-10 w-36 bg-background px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-graphite md:w-56 dark:bg-[#12293A]">
                Criterio · Peso
              </th>
              {data.options.map(opt => (
                <th key={opt.id} className="px-2 py-2 text-center min-w-[140px]">
                  <div className="group inline-flex items-center gap-1">
                    {opt.id === winnerId && totals.get(opt.id)! > 0 && (
                      <Trophy className={cn('h-3.5 w-3.5', isResolved ? 'text-success' : 'text-signal-ink')} />
                    )}
                    <input
                      defaultValue={opt.label}
                      onBlur={e => { if (e.target.value !== opt.label) updateOpt.mutate({ id: opt.id, label: e.target.value }) }}
                      className="w-24 bg-transparent text-center text-xs font-semibold uppercase tracking-wider text-ink-body outline-none focus:bg-signal-wash focus:rounded-md dark:text-stone dark:focus:bg-signal/40"
                    />
                    <button
                      onClick={async () => {
                        const ok = await confirmAction({ title: `Borrar opción "${opt.label}"`, variant: 'destructive' })
                        if (ok) deleteOpt.mutate(opt.id)
                      }}
                      className="md:opacity-0 transition md:group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3 text-graphite hover:text-danger" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-center">
                <input
                  value={newOptLabel}
                  onChange={e => setNewOptLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newOptLabel.trim()) {
                      addOpt.mutate({ decisionId, label: newOptLabel.trim() })
                      setNewOptLabel('')
                    }
                  }}
                  placeholder="+ opción"
                  className="w-24 rounded border border-dashed border-stone bg-transparent px-1.5 py-0.5 text-center text-[11px] outline-none focus:border-signal dark:border-ink-body"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {data.criteria.map(crit => (
              <tr key={crit.id} className="group border-t border-stone-100 dark:border-night-700">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 dark:bg-night">
                  <div className="flex items-center gap-2">
                    <input
                      defaultValue={crit.label}
                      onBlur={e => { if (e.target.value !== crit.label) updateCrit.mutate({ id: crit.id, label: e.target.value }) }}
                      className="flex-1 min-w-0 bg-transparent text-sm font-medium text-ink-body outline-none focus:bg-signal-wash focus:rounded-md dark:text-stone dark:focus:bg-signal/40"
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1} max={10}
                      defaultValue={crit.weight}
                      onBlur={e => {
                        const w = parseInt(e.target.value, 10)
                        if (w >= 1 && w <= 10 && w !== crit.weight) updateCrit.mutate({ id: crit.id, weight: w })
                      }}
                      className="w-10 rounded border border-stone bg-white px-1 py-0.5 text-center text-xs tabular-nums dark:border-ink-body dark:bg-night-700"
                      title="Peso del criterio (1-10)"
                    />
                    <button
                      onClick={async () => {
                        const ok = await confirmAction({ title: `Borrar criterio "${crit.label}"`, variant: 'destructive' })
                        if (ok) deleteCrit.mutate(crit.id)
                      }}
                      className="md:opacity-0 transition md:group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3 text-graphite hover:text-danger" />
                    </button>
                  </div>
                </td>
                {data.options.map(opt => {
                  const score = scoreMap.get(`${crit.id}|${opt.id}`) ?? 5
                  return (
                    <td key={opt.id} className="px-2 py-1.5 text-center">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1} max={10}
                        defaultValue={score}
                        onBlur={e => {
                          const s = parseInt(e.target.value, 10)
                          if (s >= 1 && s <= 10 && s !== score) {
                            setScore.mutate({ decisionId, criterionId: crit.id, optionId: opt.id, score: s })
                          }
                        }}
                        className="w-12 rounded-md border border-stone bg-white px-1 py-1 text-center text-sm tabular-nums focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal dark:border-ink-body dark:bg-night-700"
                      />
                    </td>
                  )
                })}
                <td className="px-3" />
              </tr>
            ))}

            {/* Totals row */}
            <tr className="border-t-2 border-stone bg-signal-wash/40 font-semibold dark:border-signal/50 dark:bg-signal/20">
              <td className="sticky left-0 z-10 bg-signal-wash px-3 py-2 text-xs uppercase tracking-wider text-night dark:bg-[#2A2410] dark:text-signal">
                Total ponderado
              </td>
              {data.options.map(opt => {
                const total = totals.get(opt.id) ?? 0
                return (
                  <td
                    key={opt.id}
                    className={cn(
                      'px-2 py-2 text-center text-sm tabular-nums',
                      opt.id === winnerId && total > 0 && 'text-success dark:text-success/50',
                    )}
                  >
                    {total}
                  </td>
                )
              })}
              <td className="px-3" />
            </tr>

            {/* New criterion row */}
            <tr className="border-t border-stone-100 dark:border-night-700">
              <td colSpan={data.options.length + 2} className="px-3 py-2">
                <input
                  value={newCritLabel}
                  onChange={e => setNewCritLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newCritLabel.trim()) {
                      addCrit.mutate({ decisionId, label: newCritLabel.trim() })
                      setNewCritLabel('')
                    }
                  }}
                  placeholder="+ nuevo criterio (enter para agregar)"
                  className="w-full rounded-md border border-dashed border-stone bg-transparent px-2 py-1 text-sm text-graphite outline-none focus:border-signal dark:border-ink-body"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-graphite">
        💡 Cada celda es un score 1-10 de cómo la opción cumple ese criterio. El peso del criterio (columna derecha) multiplica esos scores. La opción con mayor total es la recomendada.
      </p>
    </div>
  )
}
