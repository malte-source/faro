'use client'

import { Fragment, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Download, FileClock, Sparkles, Ban } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'
import { fmtMoney, fmtPct, periodLabel } from '@/components/costos/format'
import { useIsMobile } from '@/components/mobile/use-media'

const STATUS: Record<string, { label: string; variant: 'warning' | 'success' | 'outline' }> = {
  borrador: { label: 'Borrador', variant: 'warning' },
  aprobado: { label: 'Aprobado', variant: 'success' },
  anulado: { label: 'Anulada', variant: 'outline' },
}

const SEGREGATION_HINT = 'Quien prepara no aprueba: necesita otra persona de Dirección.'

export function RunsPanel({ onExplain, explainingId }: { onExplain: (runId: string) => void; explainingId: string | null }) {
  const utils = trpc.useUtils()
  const { data: runs, isLoading, error } = trpc.costos.runs.list.useQuery()
  const [open, setOpen] = useState<string | null>(null)

  const refresh = () => void utils.costos.invalidate()
  const approve = trpc.costos.runs.approve.useMutation({
    onSuccess: () => { toast.success('Cargos aprobados'); refresh() },
    onError: err => toast.error('No se pudo aprobar', err.message),
  })
  const voidRun = trpc.costos.runs.void.useMutation({
    onSuccess: () => { toast.success('Corrida anulada'); refresh() },
    onError: err => toast.error('No se pudo anular', err.message),
  })

  async function downloadCsv(runId: string) {
    try {
      const { filename, csv } = await utils.costos.runs.exportCsv.fetch({ runId })
      const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      toast.error('No se pudo descargar', e instanceof Error ? e.message : undefined)
    }
  }

  if (isLoading) return <div className="h-24 animate-pulse rounded-[14px] bg-stone-100 dark:bg-night-700" />
  if (error) return <EmptyState icon={FileClock} title="No se pudieron cargar las corridas" description={error.message} />
  if (!runs?.length) {
    return <EmptyState icon={FileClock} title="Todavía no hay corridas de cargos" description="Prepara los cargos del mes para dejar un borrador que otra persona de Dirección apruebe." py={6} />
  }

  return (
    <div className="overflow-hidden rounded-[14px] border border-stone bg-surface dark:border-night-700">
      {runs.map(r => {
        const st = STATUS[r.status]
        const expanded = open === r.id
        return (
          <Fragment key={r.id}>
            <div className="grid gap-2 border-b border-stone-100 px-4 py-3 dark:border-night-700 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : r.id)}
                  aria-expanded={expanded}
                  className="flex items-center gap-2 text-left text-sm font-semibold text-night dark:text-mist"
                >
                  {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  {periodLabel(r.period)}
                  <Badge variant={st.variant}>{st.label}</Badge>
                  {r.total !== null && <span className="font-normal tabular-nums text-graphite">{fmtMoney(r.total)}</span>}
                </button>
                <p className="ml-6 mt-0.5 text-xs text-graphite">
                  Preparó {r.preparedByName ?? '—'}
                  {r.approvedByName && ` · aprobó ${r.approvedByName}`}
                  {r.note && ` · ${r.note}`}
                </p>
              </div>

              <div className="ml-6 flex flex-wrap items-center gap-1.5 md:ml-0 md:justify-end">
                {r.status === 'borrador' && (
                  <span title={r.mine ? SEGREGATION_HINT : undefined}>
                    <Button size="sm" className="h-10 md:h-8" disabled={r.mine || approve.isPending} onClick={() => approve.mutate({ runId: r.id })}>
                      <Check className="h-3.5 w-3.5" /> Aprobar
                    </Button>
                  </span>
                )}
                <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => void downloadCsv(r.id)}><Download className="h-3.5 w-3.5" /> CSV</Button>
                <Button variant="outline" size="sm" className="h-10 md:h-8" disabled={explainingId === r.id} onClick={() => onExplain(r.id)}>
                  <Sparkles className="h-3.5 w-3.5" /> {explainingId === r.id ? 'Explicando…' : 'Explicar'}
                </Button>
                {r.status !== 'anulado' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 w-10 md:h-8 md:w-auto"
                    aria-label={`Anular la corrida de ${periodLabel(r.period)}`}
                    disabled={voidRun.isPending}
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: `Anular los cargos de ${periodLabel(r.period)}`,
                        description: r.status === 'aprobado'
                          ? 'La corrida ya está aprobada. Anularla libera el mes para preparar otra, pero deja el registro.'
                          : 'El borrador queda anulado y el mes se libera para preparar otro.',
                        variant: 'destructive',
                        confirmLabel: 'Anular',
                      })
                      if (ok) voidRun.mutate({ runId: r.id })
                    }}
                  >
                    <Ban className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            {r.status === 'borrador' && r.mine && (
              <p className="border-b border-stone-100 bg-mist px-4 py-1.5 pl-10 text-xs text-graphite dark:border-night-700 dark:bg-night-700">{SEGREGATION_HINT}</p>
            )}
            {expanded && <RunDetail runId={r.id} />}
          </Fragment>
        )
      })}
    </div>
  )
}

function RunDetail({ runId }: { runId: string }) {
  const isMobile = useIsMobile()
  const { data, isLoading } = trpc.costos.runs.get.useQuery({ runId })
  if (isLoading || !data) return <div className="h-16 animate-pulse bg-mist dark:bg-night-700" />
  if (isMobile) {
    return (
      <div className="space-y-2 border-b border-border-soft bg-background px-4 py-3">
        {data.lines.map(l => (
          <div key={l.id} className="rounded-[12px] border border-border bg-surface px-3.5 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: l.empresaColor }} />
                <span className="truncate">{l.empresaName}</span>
              </span>
              <span className="shrink-0 text-[14px] font-semibold tabular-nums text-foreground">{fmtMoney(l.amount, l.currency)}</span>
            </div>
            <p className="mt-0.5 text-[13px] text-body">{l.poolName}</p>
            <p className="mt-0.5 text-[12px] text-graphite">{l.driverShare > 0 ? `${fmtPct(l.driverShare)} · ` : ''}{l.explanation}</p>
          </div>
        ))}
        {Object.entries(data.totalsByCurrency).map(([cur, total]) => (
          <p key={cur} className="flex justify-between px-1 pt-1 text-[14px] font-semibold text-foreground">
            <span>Total {cur}</span><span className="tabular-nums">{fmtMoney(total, cur)}</span>
          </p>
        ))}
      </div>
    )
  }
  return (
    <div className="overflow-x-auto border-b border-stone-100 bg-mist px-4 py-3 dark:border-night-700 dark:bg-night-700">
      <table className="w-full min-w-[560px] text-xs">
        <thead>
          <tr className="text-left font-semibold uppercase tracking-wider text-graphite">
            <th scope="col" className="py-1.5 pr-2">Empresa</th>
            <th scope="col" className="py-1.5 pr-2">Concepto</th>
            <th scope="col" className="py-1.5 pr-2 text-right">Monto</th>
            <th scope="col" className="py-1.5 pl-2">Cómo se calculó</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map(l => (
            <tr key={l.id} className="border-t border-stone dark:border-night">
              <td className="py-1.5 pr-2 font-medium text-night dark:text-mist">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: l.empresaColor }} />{l.empresaName}</span>
              </td>
              <td className="py-1.5 pr-2 text-ink-body dark:text-stone">{l.poolName}</td>
              <td className="py-1.5 pr-2 text-right font-semibold tabular-nums text-night dark:text-mist">{fmtMoney(l.amount, l.currency)}</td>
              <td className="py-1.5 pl-2 text-graphite">{l.driverShare > 0 ? `${fmtPct(l.driverShare)} · ` : ''}{l.explanation}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {Object.entries(data.totalsByCurrency).map(([cur, total]) => (
            <tr key={cur} className="border-t border-stone font-semibold text-night dark:border-night dark:text-mist">
              <td className="py-1.5" colSpan={2}>Total {cur}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmtMoney(total, cur)}</td>
              <td />
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  )
}
