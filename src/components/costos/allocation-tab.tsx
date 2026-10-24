'use client'

import { useState } from 'react'
import { AlertTriangle, ClipboardCheck, Scale, Sparkles } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'
import { toast } from '@/components/ui/toaster'
import { METHOD_LABEL } from '@/lib/costing'
import { LAYER_BADGE, LAYER_LABEL, fmtMoney, fmtPct, periodLabel } from '@/components/costos/format'
import { ExplainPanel } from '@/components/costos/explain-panel'
import { RunsPanel } from '@/components/costos/runs-panel'
import { useIsMobile } from '@/components/mobile/use-media'

export function AllocationTab({ period }: { period: string }) {
  const utils = trpc.useUtils()
  const isMobile = useIsMobile()
  const { data, isLoading, error } = trpc.costos.preview.useQuery({ period })
  const { data: runs } = trpc.costos.runs.list.useQuery()
  const [explain, setExplain] = useState<{ text: string; disclaimer: string } | null>(null)
  const [explainingId, setExplainingId] = useState<string | null>(null)

  const activeRun = runs?.find(r => r.period === period && r.status !== 'anulado')

  const prepare = trpc.costos.runs.prepare.useMutation({
    onSuccess: ({ lines, warnings }) => {
      toast.success('Cargos preparados', `${lines} líneas en borrador. Otra persona de Dirección debe aprobarlas.`)
      if (warnings.length) toast.warning('Revisa los avisos del reparto', warnings[0])
      void utils.costos.invalidate()
    },
    onError: err => toast.error('No se pudo preparar', err.message),
  })

  const explainMut = trpc.costos.explain.useMutation({
    onSuccess: r => setExplain(r),
    onError: err => toast.error('No se pudo explicar', err.message),
    onSettled: () => setExplainingId(null),
  })

  if (isLoading) return <ListSkeleton rows={5} />
  if (error) return <EmptyState icon={Scale} title="No se pudo calcular el reparto" description={error.message} />
  if (!data) return null
  if (data.pools.length === 0) {
    return <EmptyState icon={Scale} title="No hay costos activos" description="Carga los costos del holding en la pestaña Costos para ver cómo se reparten." />
  }

  const currencies = Object.keys(data.totalsByCurrency)
  const singleCurrency = currencies.length === 1 ? currencies[0] : null
  const canPrepare = currencies.length > 0 && !activeRun

  return (
    <div className="space-y-5">
      {data.warnings.length > 0 && (
        <ul role="status" className="space-y-1 rounded-lg bg-signal-wash px-3 py-2.5 text-sm text-signal-ink dark:bg-night-700 dark:text-signal">
          {data.warnings.map(w => (
            <li key={w} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-night dark:text-mist">Reparto de {periodLabel(period)}</h2>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">
          <Button
            variant="outline"
            size="sm"
            className="h-11 flex-1 md:h-8 md:flex-none"
            disabled={explainMut.isPending || currencies.length === 0}
            onClick={() => { setExplainingId('preview'); explainMut.mutate({ period }) }}
          >
            <Sparkles className="h-3.5 w-3.5" /> {explainingId === 'preview' ? 'Explicando…' : 'Explicar con IA'}
          </Button>
          <span className="flex-1 md:flex-none" title={activeRun ? `Este mes ya tiene una corrida ${activeRun.status}.` : undefined}>
            <Button variant="signal" size="sm" className="h-11 w-full md:h-8 md:w-auto" disabled={!canPrepare || prepare.isPending} onClick={() => prepare.mutate({ period })}>
              <ClipboardCheck className="h-3.5 w-3.5" /> {prepare.isPending ? 'Preparando…' : 'Preparar cargos'}
            </Button>
          </span>
        </div>
      </div>

      {explain && <ExplainPanel text={explain.text} disclaimer={explain.disclaimer} onClose={() => setExplain(null)} />}

      {isMobile ? (
        <div className="space-y-3">
          {data.empresas.map(e => {
            const rows = data.pools
              .filter(p => !p.central)
              .map(p => ({ p, l: p.lines.find(x => x.workspaceId === e.id) }))
              .filter((x): x is { p: (typeof data.pools)[number]; l: NonNullable<typeof x.l> } => !!x.l)
            return (
              <section key={e.id} className="overflow-hidden rounded-[14px] border border-border bg-surface">
                <header className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
                  <span className="flex min-w-0 items-center gap-2 text-[16px] font-semibold text-foreground">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.color }} />
                    <span className="truncate">{e.name}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    {currencies.map(cur => (
                      <span key={cur} className="block font-display text-[17px] font-extrabold leading-tight tabular-nums text-foreground">
                        {fmtMoney(data.totalsByEmpresa[cur]?.[e.id] ?? 0, cur)}
                      </span>
                    ))}
                  </span>
                </header>
                {rows.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-graphite">Sin cargos este mes.</p>
                ) : rows.map(({ p, l }) => (
                  <div key={p.poolId} className="flex items-start justify-between gap-3 border-b border-border-soft px-4 py-2.5 last:border-b-0">
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-foreground">{p.poolName}</p>
                      <p className="text-[12px] text-graphite">{METHOD_LABEL[p.method]}{l.driverShare > 0 ? ` · ${fmtPct(l.driverShare)}` : ''}</p>
                    </div>
                    <p className="shrink-0 text-[14px] font-semibold tabular-nums text-foreground">{fmtMoney(l.amount, l.currency)}</p>
                  </div>
                ))}
              </section>
            )
          })}
          {data.pools.filter(p => p.warning).map(p => (
            <p key={p.poolId} className="rounded-lg bg-danger-wash px-3 py-2 text-[13px] text-danger dark:bg-danger/15"><strong>{p.poolName}:</strong> {p.warning}</p>
          ))}
        </div>
      ) : (
      <div className="overflow-x-auto rounded-[14px] border border-stone bg-surface dark:border-night-700">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left text-[11px] font-semibold uppercase tracking-wider text-graphite dark:border-night-700">
              <th scope="col" className="px-4 py-2.5">Concepto</th>
              {data.empresas.map(e => (
                <th key={e.id} scope="col" className="px-2 py-2.5 text-right">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: e.color }} />{e.name}</span>
                </th>
              ))}
              <th scope="col" className="px-4 py-2.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.pools.map(p => {
              const byWs = new Map(p.lines.map(l => [l.workspaceId, l]))
              return (
                <tr key={p.poolId} className="border-b border-stone-100 align-top last:border-b-0 dark:border-night-700">
                  <th scope="row" className="px-4 py-2.5 text-left">
                    <span className="block font-medium text-night dark:text-mist">{p.poolName}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant={LAYER_BADGE[p.layer]}>{LAYER_LABEL[p.layer]}</Badge>
                      <span className="text-[11px] font-normal text-graphite">{METHOD_LABEL[p.method]}</span>
                    </span>
                    {p.warning && <span className="mt-1 block text-[11px] font-normal text-danger">{p.warning}</span>}
                  </th>
                  {data.empresas.map(e => {
                    const l = byWs.get(e.id)
                    return (
                      <td key={e.id} className="px-2 py-2.5 text-right tabular-nums text-ink-body dark:text-stone" title={l?.explanation}>
                        {p.central ? <span className="text-graphite">—</span> : l ? (
                          <>
                            {fmtMoney(l.amount, l.currency)}
                            {l.driverShare > 0 && <span className="block text-[11px] text-graphite">{fmtPct(l.driverShare)}</span>}
                          </>
                        ) : <span className="text-graphite">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {p.central
                      ? <><span className="font-semibold text-night dark:text-mist">{fmtMoney(p.monthlyAmount, p.currency)}</span><span className="block text-[11px] text-graphite">Presupuesto central</span></>
                      : <span className="font-semibold text-night dark:text-mist">{fmtMoney(p.allocated, p.currency)}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            {currencies.map(cur => {
              const total = data.totalsByCurrency[cur]
              return (
                <tr key={cur} className="bg-mist text-sm font-semibold text-night dark:bg-night-700 dark:text-mist">
                  <th scope="row" className="px-4 py-2.5 text-left">Total a cobrar{currencies.length > 1 ? ` (${cur})` : ''}</th>
                  {data.empresas.map(e => {
                    const v = data.totalsByEmpresa[cur]?.[e.id] ?? 0
                    return (
                      <td key={e.id} className="px-2 py-2.5 text-right tabular-nums">
                        {fmtMoney(v, cur)}
                        {singleCurrency && total > 0 && <span className="block text-[11px] font-normal text-graphite">{fmtPct(v / total)}</span>}
                      </td>
                    )
                  })}
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(total, cur)}</td>
                </tr>
              )
            })}
          </tfoot>
        </table>
      </div>
      )}

      {Object.keys(data.centralByCurrency).length > 0 && (
        <p className="text-xs text-graphite">
          El presupuesto central ({Object.entries(data.centralByCurrency).map(([c, n]) => fmtMoney(n, c)).join(' + ')}) se muestra pero no se cobra a las empresas.
        </p>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-night dark:text-mist">Corridas de cargos</h2>
        <RunsPanel
          explainingId={explainingId}
          onExplain={runId => { setExplainingId(runId); explainMut.mutate({ runId }) }}
        />
      </div>
    </div>
  )
}
