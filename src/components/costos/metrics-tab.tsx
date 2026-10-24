'use client'

import { useMemo, useState } from 'react'
import { Copy, Lock, Table2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'
import { toast } from '@/components/ui/toaster'
import { parseNumber, previousPeriod } from '@/lib/costing'
import { fmtInt, periodLabel } from '@/components/costos/format'
import { useIsMobile } from '@/components/mobile/use-media'

interface Row { workspaceId: string; name: string; color: string; revenue: number; headcount: number; attributedSales: number }
type Draft = Record<string, { revenue: string; headcount: string; attributedSales: string }>

const toDraft = (rows: Row[]): Draft =>
  Object.fromEntries(rows.map(r => [r.workspaceId, {
    revenue: r.revenue ? fmtInt(r.revenue) : '',
    headcount: r.headcount ? String(r.headcount) : '',
    attributedSales: r.attributedSales ? fmtInt(r.attributedSales) : '',
  }]))

export function MetricsTab({ period }: { period: string }) {
  const { data, isLoading, error, dataUpdatedAt } = trpc.costos.metrics.get.useQuery({ period })
  if (isLoading) return <ListSkeleton rows={5} />
  if (error) return <EmptyState icon={Table2} title="No se pudieron cargar los datos" description={error.message} />
  if (!data || data.rows.length === 0) {
    return <EmptyState icon={Table2} title="No hay empresas que cargar" description="Los cargos se reparten entre las empresas del grupo, sin contar el Holding." />
  }
  // Remount (fresh draft) whenever the server data or the month changes.
  return <MetricsGrid key={`${period}-${dataUpdatedAt}`} period={period} rows={data.rows} locked={data.locked} />
}

function MetricsGrid({ period, rows, locked }: { period: string; rows: Row[]; locked: boolean }) {
  const utils = trpc.useUtils()
  const [draft, setDraft] = useState<Draft>(() => toDraft(rows))
  const [dirty, setDirty] = useState(false)
  const [copying, setCopying] = useState(false)
  const isMobile = useIsMobile()

  const save = trpc.costos.metrics.set.useMutation({
    onSuccess: ({ saved }) => {
      toast.success('Datos guardados', `${saved} empresas · ${periodLabel(period)}`)
      void utils.costos.invalidate()
    },
    onError: err => toast.error('No se pudo guardar', err.message),
  })

  const parsed = useMemo(
    () => rows.map(r => {
      const d = draft[r.workspaceId]
      return {
        workspaceId: r.workspaceId,
        revenue: Math.max(0, parseNumber(d.revenue) ?? 0),
        headcount: Math.max(0, Math.round(parseNumber(d.headcount) ?? 0)),
        attributedSales: Math.max(0, parseNumber(d.attributedSales) ?? 0),
      }
    }),
    [rows, draft],
  )
  const totals = parsed.reduce((a, r) => ({ revenue: a.revenue + r.revenue, headcount: a.headcount + r.headcount, sales: a.sales + r.attributedSales }), { revenue: 0, headcount: 0, sales: 0 })

  const edit = (id: string, field: 'revenue' | 'headcount' | 'attributedSales', value: string) => {
    setDraft(d => ({ ...d, [id]: { ...d[id], [field]: value } }))
    setDirty(true)
  }
  const tidy = (id: string, field: 'revenue' | 'attributedSales') => {
    const n = parseNumber(draft[id][field])
    setDraft(d => ({ ...d, [id]: { ...d[id], [field]: n === null || n === 0 ? '' : fmtInt(n) } }))
  }

  async function copyPrevious() {
    setCopying(true)
    try {
      const prev = await utils.costos.metrics.get.fetch({ period: previousPeriod(period) })
      const byId = new Map(prev.rows.map(r => [r.workspaceId, r]))
      const next = toDraft(rows.map(r => ({ ...r, ...(byId.get(r.workspaceId) ?? {}) })))
      setDraft(next)
      setDirty(true)
      const hasData = prev.rows.some(r => r.revenue || r.headcount || r.attributedSales)
      if (!hasData) toast.info('El mes anterior no tiene datos cargados')
      else toast.info(`Copiado de ${periodLabel(previousPeriod(period))}`, 'Revisa y guarda.')
    } catch (e) {
      toast.error('No se pudo copiar', e instanceof Error ? e.message : undefined)
    } finally {
      setCopying(false)
    }
  }

  const inputCls = 'h-9 text-right tabular-nums'
  const phoneInputCls = 'h-12 text-right text-[16px] tabular-nums'

  return (
    <div className="space-y-4">
      {locked && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-signal-wash px-3 py-2 text-sm text-signal-ink dark:bg-night-700 dark:text-signal">
          <Lock className="h-4 w-4 shrink-0" />
          Este mes ya tiene cargos aprobados. Para cambiar los datos, anula la corrida en la pestaña Reparto.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-graphite">Datos de {periodLabel(period)} que usan los métodos de reparto.</p>
        <div className="flex w-full gap-2 md:w-auto">
          <Button variant="outline" size="sm" className="h-11 flex-1 md:h-8 md:flex-none" onClick={() => void copyPrevious()} disabled={locked || copying}>
            <Copy className="h-3.5 w-3.5" /> {copying ? 'Copiando…' : 'Copiar del mes anterior'}
          </Button>
          <Button
            size="sm"
            className="h-11 flex-1 md:h-8 md:flex-none"
            disabled={locked || !dirty || save.isPending}
            onClick={() => save.mutate({ period, rows: parsed })}
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>

      {isMobile ? (
        <div className="space-y-3">
          {rows.map(r => (
            <section key={r.workspaceId} className="rounded-[14px] border border-border bg-surface p-4">
              <p className="mb-3 flex items-center gap-2 text-[16px] font-semibold text-foreground">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                {r.name}
              </p>
              <div className="grid gap-3">
                <label className="block">
                  <span className="mb-1 block text-[12px] text-graphite">Facturación</span>
                  <Input aria-label={`Facturación de ${r.name}`} className={phoneInputCls} inputMode="decimal" disabled={locked}
                    value={draft[r.workspaceId].revenue} placeholder="0"
                    onChange={e => edit(r.workspaceId, 'revenue', e.target.value)} onBlur={() => tidy(r.workspaceId, 'revenue')} />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-[12px] text-graphite">Headcount</span>
                    <Input aria-label={`Headcount de ${r.name}`} className={phoneInputCls} inputMode="numeric" disabled={locked}
                      value={draft[r.workspaceId].headcount} placeholder="0"
                      onChange={e => edit(r.workspaceId, 'headcount', e.target.value.replace(/[^\d]/g, ''))} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[12px] text-graphite">Ventas atribuidas</span>
                    <Input aria-label={`Ventas atribuidas de ${r.name}`} className={phoneInputCls} inputMode="decimal" disabled={locked}
                      value={draft[r.workspaceId].attributedSales} placeholder="0"
                      onChange={e => edit(r.workspaceId, 'attributedSales', e.target.value)} onBlur={() => tidy(r.workspaceId, 'attributedSales')} />
                  </label>
                </div>
              </div>
            </section>
          ))}
          <section className="rounded-[14px] bg-night p-4 text-mist">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-signal">Total del mes</p>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div><dt className="text-[11px] text-stone">Facturación</dt><dd className="font-display text-[15px] font-extrabold tabular-nums">{fmtInt(totals.revenue)}</dd></div>
              <div><dt className="text-[11px] text-stone">Headcount</dt><dd className="font-display text-[15px] font-extrabold tabular-nums">{fmtInt(totals.headcount)}</dd></div>
              <div><dt className="text-[11px] text-stone">Ventas</dt><dd className="font-display text-[15px] font-extrabold tabular-nums">{fmtInt(totals.sales)}</dd></div>
            </dl>
          </section>
        </div>
      ) : (
      <div className="overflow-x-auto rounded-[14px] border border-stone bg-surface dark:border-night-700">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left text-[11px] font-semibold uppercase tracking-wider text-graphite dark:border-night-700">
              <th scope="col" className="px-4 py-2.5">Empresa</th>
              <th scope="col" className="px-2 py-2.5 text-right">Facturación</th>
              <th scope="col" className="px-2 py-2.5 text-right">Headcount</th>
              <th scope="col" className="px-4 py-2.5 text-right">Ventas atribuidas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.workspaceId} className="border-b border-stone-100 last:border-b-0 dark:border-night-700">
                <th scope="row" className="px-4 py-2 text-left font-medium text-night dark:text-mist">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
                    {r.name}
                  </span>
                </th>
                <td className="px-2 py-1.5">
                  <Input aria-label={`Facturación de ${r.name}`} className={inputCls} inputMode="decimal" disabled={locked}
                    value={draft[r.workspaceId].revenue} placeholder="0"
                    onChange={e => edit(r.workspaceId, 'revenue', e.target.value)} onBlur={() => tidy(r.workspaceId, 'revenue')} />
                </td>
                <td className="px-2 py-1.5">
                  <Input aria-label={`Headcount de ${r.name}`} className={`${inputCls} w-24`} inputMode="numeric" disabled={locked}
                    value={draft[r.workspaceId].headcount} placeholder="0"
                    onChange={e => edit(r.workspaceId, 'headcount', e.target.value.replace(/[^\d]/g, ''))} />
                </td>
                <td className="px-4 py-1.5">
                  <Input aria-label={`Ventas atribuidas de ${r.name}`} className={inputCls} inputMode="decimal" disabled={locked}
                    value={draft[r.workspaceId].attributedSales} placeholder="0"
                    onChange={e => edit(r.workspaceId, 'attributedSales', e.target.value)} onBlur={() => tidy(r.workspaceId, 'attributedSales')} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-mist text-sm font-semibold text-night dark:bg-night-700 dark:text-mist">
              <th scope="row" className="px-4 py-2.5 text-left">Total</th>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtInt(totals.revenue)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtInt(totals.headcount)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtInt(totals.sales)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      )}
      <p className="text-xs text-graphite">Puedes pegar números con puntos, comas o espacios (1.234.567). La facturación y las ventas van en la moneda de cada costo.</p>
    </div>
  )
}
