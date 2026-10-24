'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldSelect } from '@/components/personas/field-select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'
import { METHOD_LABEL, parseNumber, type PoolLayer, type PoolMethod } from '@/lib/costing'
import { LAYER_LABEL, METHOD_HELP, fmtInt } from '@/components/costos/format'

export interface PoolForm {
  id?: string
  name: string
  layer: PoolLayer
  method: PoolMethod
  monthlyAmount: number
  currency: string
  variablePct: number
  notes: string | null
  isActive: boolean
}

/** The plan's default method for each layer (editable). */
const DEFAULT_METHOD: Record<PoolLayer, PoolMethod> = { gobierno: 'revenue', coe: 'central', sso: 'headcount' }

export function emptyPool(): PoolForm {
  return { name: '', layer: 'sso', method: 'headcount', monthlyAmount: 0, currency: 'PYG', variablePct: 0, notes: null, isActive: true }
}

export function PoolDialog({ pool, onClose }: { pool: PoolForm; onClose: () => void }) {
  const utils = trpc.useUtils()
  const [form, setForm] = useState(pool)
  const [amount, setAmount] = useState(pool.monthlyAmount ? fmtInt(pool.monthlyAmount) : '')
  const [error, setError] = useState<string | null>(null)

  const save = trpc.costos.pools.upsert.useMutation({
    onSuccess: () => {
      void utils.costos.invalidate()
      toast.success(form.id ? 'Costo actualizado' : 'Costo creado')
      onClose()
    },
    onError: err => { setError(err.message); toast.error('No se pudo guardar', err.message) },
  })

  const set = <K extends keyof PoolForm>(k: K, v: PoolForm[K]) => setForm(f => ({ ...f, [k]: v }))
  const parsedAmount = parseNumber(amount) ?? 0
  const valid = form.name.trim().length >= 2 && /^[A-Za-z]{3}$/.test(form.currency) && parsedAmount >= 0

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Editar costo' : 'Nuevo costo'}</DialogTitle>
          <DialogDescription>Lo que cuesta por mes una capa o un servicio del holding y cómo se reparte.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-6">
          <div className="space-y-1.5">
            <Label htmlFor="pool-name">Nombre</Label>
            <Input id="pool-name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ej: Contabilidad e impuestos" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Capa</Label>
              <FieldSelect
                value={form.layer}
                onChange={v => { const l = v as PoolLayer; setForm(f => ({ ...f, layer: l, method: DEFAULT_METHOD[l] })) }}
                options={(Object.keys(LAYER_LABEL) as PoolLayer[]).map(l => ({ value: l, label: LAYER_LABEL[l] }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Método de reparto</Label>
              <FieldSelect
                value={form.method}
                onChange={v => set('method', v as PoolMethod)}
                options={(Object.keys(METHOD_LABEL) as PoolMethod[]).map(m => ({ value: m, label: METHOD_LABEL[m] }))}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-graphite">{METHOD_HELP[form.method]}</p>

          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <div className="space-y-1.5">
              <Label htmlFor="pool-amount">{form.method === 'central' ? 'Presupuesto mensual' : form.method === 'base_plus_variable' ? 'Base fija mensual' : 'Monto mensual a repartir'}</Label>
              <Input
                id="pool-amount"
                inputMode="decimal"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                onBlur={() => { const n = parseNumber(amount); if (n !== null) setAmount(fmtInt(n)) }}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pool-currency">Moneda</Label>
              <Input id="pool-currency" value={form.currency} maxLength={3} onChange={e => set('currency', e.target.value.toUpperCase())} />
            </div>
          </div>

          {form.method === 'base_plus_variable' && (
            <div className="space-y-1.5">
              <Label htmlFor="pool-var">Variable sobre venta atribuida (%)</Label>
              <Input
                id="pool-var"
                inputMode="decimal"
                value={String(form.variablePct).replace('.', ',')}
                onChange={e => { const n = parseNumber(e.target.value); set('variablePct', n === null ? 0 : Math.min(100, Math.max(0, n))) }}
              />
              <p className="text-xs text-graphite">El variable es ingreso adicional del servicio: no forma parte de la base.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pool-notes">Notas</Label>
            <Textarea id="pool-notes" rows={2} value={form.notes ?? ''} onChange={e => set('notes', e.target.value || null)} placeholder="Qué incluye, quién lo aprueba…" />
          </div>

          <label className="flex min-h-[44px] items-center gap-3 text-sm text-body">
            <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} className="h-5 w-5 accent-[#FFB020]" />
            Activo (entra en el reparto del mes)
          </label>

          {error && <p role="alert" className="rounded-lg bg-danger-wash px-3 py-2 text-xs text-danger dark:bg-danger/15">{error}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" className="h-12 sm:h-9" onClick={onClose}>Cancelar</Button>
            <Button
              className="h-12 sm:h-9"
              disabled={!valid || save.isPending}
              onClick={() => { setError(null); save.mutate({ ...form, name: form.name.trim(), monthlyAmount: parsedAmount, notes: form.notes }) }}
            >
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
