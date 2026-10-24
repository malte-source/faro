'use client'

import { useState } from 'react'
import { Landmark, Pencil, Plus, Trash2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'
import { METHOD_LABEL } from '@/lib/costing'
import { LAYER_BADGE, LAYER_LABEL, fmtMoney } from '@/components/costos/format'
import { PoolDialog, emptyPool, type PoolForm } from '@/components/costos/pool-dialog'

/** The four pools of the plan's cost model, created at 0 so Dirección only fills in amounts. */
const PLAN_POOLS: PoolForm[] = [
  { name: 'Gobierno del grupo', layer: 'gobierno', method: 'revenue', monthlyAmount: 0, currency: 'PYG', variablePct: 0, notes: 'Prorrateo por facturación de la filial.', isActive: true },
  { name: 'Centros de Excelencia', layer: 'coe', method: 'central', monthlyAmount: 0, currency: 'PYG', variablePct: 0, notes: 'Presupuesto central: no se reparte.', isActive: true },
  { name: 'Servicios Compartidos', layer: 'sso', method: 'headcount', monthlyAmount: 0, currency: 'PYG', variablePct: 0, notes: 'Año 1: prorrateo por headcount. Objetivo: cobro por uso medido.', isActive: true },
  { name: 'Ventas (SSO)', layer: 'sso', method: 'base_plus_variable', monthlyAmount: 0, currency: 'PYG', variablePct: 0, notes: 'Base fija + variable sobre la venta atribuida.', isActive: true },
]

export function PoolsTab() {
  const utils = trpc.useUtils()
  const { data: pools, isLoading, error } = trpc.costos.pools.list.useQuery()
  const [editing, setEditing] = useState<PoolForm | null>(null)

  const remove = trpc.costos.pools.remove.useMutation({
    onSuccess: () => { void utils.costos.invalidate(); toast.success('Costo eliminado') },
    onError: err => toast.error('No se pudo eliminar', err.message),
  })
  const seed = trpc.costos.pools.upsert.useMutation()
  const [seeding, setSeeding] = useState(false)

  async function createPlanPools() {
    setSeeding(true)
    try {
      for (const p of PLAN_POOLS) await seed.mutateAsync(p)
      void utils.costos.invalidate()
      toast.success('Estructura del plan creada', 'Completa los montos de cada capa.')
    } catch (e) {
      toast.error('No se pudo crear la estructura', e instanceof Error ? e.message : undefined)
    } finally {
      setSeeding(false)
    }
  }

  if (isLoading) return <ListSkeleton rows={4} />
  if (error) return <EmptyState icon={Landmark} title="No se pudieron cargar los costos" description={error.message} />

  const list = pools ?? []
  const active = list.filter(p => p.isActive)
  const sum = (pred: (p: (typeof list)[number]) => boolean) => {
    const out: Record<string, number> = {}
    for (const p of active.filter(pred)) out[p.currency] = (out[p.currency] ?? 0) + p.monthlyAmount
    return out
  }
  const allocatable = sum(p => p.method !== 'central')
  const central = sum(p => p.method === 'central')
  const show = (o: Record<string, number>) => Object.entries(o).map(([c, n]) => fmtMoney(n, c)).join(' + ') || fmtMoney(0)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[14px] border border-stone bg-surface p-4 dark:border-night-700">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-graphite">A repartir entre empresas (por mes)</p>
          <p className="mt-1 font-display text-2xl font-extrabold tracking-[-0.02em] text-night dark:text-mist">{show(allocatable)}</p>
        </div>
        <div className="rounded-[14px] border border-stone bg-surface p-4 dark:border-night-700">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-graphite">Presupuesto central (no se reparte)</p>
          <p className="mt-1 font-display text-2xl font-extrabold tracking-[-0.02em] text-night dark:text-mist">{show(central)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-night dark:text-mist">Costos del holding</h2>
        <Button size="sm" className="h-10 md:h-8" onClick={() => setEditing(emptyPool())}><Plus className="h-4 w-4" /> Nuevo costo</Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Todavía no hay costos cargados"
          description="El plan define cuatro: Gobierno (por facturación), Centros de Excelencia (presupuesto central), Servicios Compartidos (por headcount) y Ventas (base + variable)."
          action={<Button variant="signal" onClick={() => void createPlanPools()} disabled={seeding}>{seeding ? 'Creando…' : 'Crear la estructura del plan'}</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-stone bg-surface dark:border-night-700">
          {list.map(p => (
            <div key={p.id} className="grid gap-2 border-b border-stone-100 px-4 py-3 last:border-b-0 dark:border-night-700 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-night dark:text-mist">
                  {p.name}
                  {!p.isActive && <Badge variant="outline">Inactivo</Badge>}
                </p>
                {p.notes && <p className="mt-0.5 truncate text-xs text-graphite">{p.notes}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={LAYER_BADGE[p.layer]}>{LAYER_LABEL[p.layer]}</Badge>
                <span className="text-xs text-graphite">
                  {METHOD_LABEL[p.method]}{p.method === 'base_plus_variable' ? ` · ${String(p.variablePct).replace('.', ',')} %` : ''}
                </span>
              </div>
              <p className="text-sm font-semibold tabular-nums text-night md:text-right dark:text-mist">{fmtMoney(p.monthlyAmount, p.currency)}</p>
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" className="h-11 w-11 md:h-8 md:w-auto" aria-label={`Editar ${p.name}`} onClick={() => setEditing(p)}><Pencil className="h-4 w-4 md:h-3.5 md:w-3.5" /></Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 w-11 md:h-8 md:w-auto"
                  aria-label={`Eliminar ${p.name}`}
                  disabled={remove.isPending}
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: `Eliminar «${p.name}»`,
                      description: 'Las corridas de cargos ya preparadas conservan sus montos. Si solo quieres sacarlo del reparto, mejor márcalo como inactivo.',
                      variant: 'destructive',
                      confirmLabel: 'Eliminar',
                    })
                    if (ok) remove.mutate({ id: p.id })
                  }}
                >
                  <Trash2 className="h-4 w-4 md:h-3.5 md:w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <PoolDialog pool={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
