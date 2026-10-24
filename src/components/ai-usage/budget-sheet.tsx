'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/toaster'
import { parseMoneyInput } from '@/components/ai-usage/format'

interface Initial {
  monthlyUsd: number | null
  perUserMonthlyUsd: number | null
  warnPct: number
}

const show = (n: number | null) => (n === null ? '' : String(n))

/** Dirección sets the monthly cap for the grupo and per person. Empty = no cap; 0 = AI off. */
export function BudgetSheet({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Initial }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Presupuesto de IA" description="Cuando se agota, la IA deja de responder hasta el mes siguiente o hasta que lo amplíes.">
      {/* Remount on open so the fields always start from the saved values. */}
      {open && <BudgetForm initial={initial} onDone={onClose} />}
    </BottomSheet>
  )
}

function BudgetForm({ initial, onDone }: { initial: Initial; onDone: () => void }) {
  const utils = trpc.useUtils()
  const [monthly, setMonthly] = useState(show(initial.monthlyUsd))
  const [perUser, setPerUser] = useState(show(initial.perUserMonthlyUsd))
  const [warn, setWarn] = useState(String(initial.warnPct))
  const [error, setError] = useState<string | null>(null)

  const save = trpc.aiUsage.setBudget.useMutation({
    onSuccess: () => {
      void utils.aiUsage.invalidate()
      toast.success('Presupuesto guardado')
      onDone()
    },
    onError: err => setError(err.message),
  })

  const submit = () => {
    const m = parseMoneyInput(monthly)
    const p = parseMoneyInput(perUser)
    const w = Number(warn)
    if (Number.isNaN(m) || Number.isNaN(p)) return setError('Escribe un monto válido, por ejemplo 100 o 12,50.')
    if (!Number.isInteger(w) || w < 1 || w > 100) return setError('El aviso va de 1 a 100 %.')
    setError(null)
    save.mutate({ monthlyUsd: m, perUserMonthlyUsd: p, warnPct: w })
  }

  return (
    <form
      className="space-y-4 pb-2 pt-2"
      onSubmit={e => { e.preventDefault(); submit() }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="ai-monthly">Tope mensual del grupo (US$)</Label>
        <Input id="ai-monthly" inputMode="decimal" value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="Sin tope" />
        <p className="text-xs text-graphite">Déjalo vacío para no poner tope. Con 0 la IA queda apagada.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ai-peruser">Tope mensual por persona (US$)</Label>
        <Input id="ai-peruser" inputMode="decimal" value={perUser} onChange={e => setPerUser(e.target.value)} placeholder="Sin tope" />
        <p className="text-xs text-graphite">Evita que una sola persona gaste todo el presupuesto.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ai-warn">Avisar al llegar a (%)</Label>
        <Input id="ai-warn" inputMode="numeric" value={warn} onChange={e => setWarn(e.target.value)} />
        <p className="text-xs text-graphite">Queda un aviso en el registro del servidor, una vez al día.</p>
      </div>

      {error && <p role="alert" className="rounded-[10px] bg-danger-wash px-3 py-2 text-[13px] text-danger dark:bg-danger/15">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1" onClick={onDone}>Cancelar</Button>
        <Button type="submit" className="flex-1" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</Button>
      </div>
    </form>
  )
}
