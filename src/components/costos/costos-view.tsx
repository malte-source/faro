'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { Segmented } from '@/components/mobile/segmented'
import { currentPeriod, periodLabel, shiftPeriod } from '@/components/costos/format'
import { PoolsTab } from '@/components/costos/pools-tab'
import { MetricsTab } from '@/components/costos/metrics-tab'
import { AllocationTab } from '@/components/costos/allocation-tab'

type Tab = 'costos' | 'datos' | 'reparto'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'costos', label: 'Costos' },
  { id: 'datos', label: 'Datos del mes' },
  { id: 'reparto', label: 'Reparto' },
]

export function CostosView() {
  const [tab, setTab] = useState<Tab>('reparto')
  const [period, setPeriod] = useState(currentPeriod)
  // Also gates the screen: every costos procedure is Dirección-only.
  const gate = trpc.costos.pools.list.useQuery(undefined, { retry: false })

  if (gate.error?.data?.code === 'FORBIDDEN') {
    return <EmptyState icon={Lock} title="Los costos intercompany son para Dirección." description="Pide acceso a quien administra el grupo." />
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <p role="note" className="rounded-[14px] border border-signal/40 bg-signal-wash px-4 py-3 text-sm text-signal-ink dark:border-signal/30 dark:bg-night-700 dark:text-signal">
        <strong>Antes de mover un guaraní entre empresas: Andrea y Diego validan la estructura.</strong>{' '}
        Cargos intercompany tocan precios de transferencia e IVA.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label="Secciones de costos"
          className="w-full md:hidden"
          value={tab}
          onChange={setTab}
          options={TABS.map(t => ({ value: t.id, label: t.label }))}
        />
        <div role="tablist" aria-label="Secciones de costos" className="hidden rounded-[10px] bg-stone-100 p-1 dark:bg-night-700 md:inline-flex">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
                tab === t.id ? 'bg-white text-night shadow-sm dark:bg-night dark:text-mist' : 'text-graphite hover:text-night dark:hover:text-mist',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== 'costos' && (
          <div className="flex w-full items-center justify-between gap-1 md:w-auto md:justify-start" role="group" aria-label="Mes">
            <Button variant="ghost" size="sm" className="h-11 w-11 md:h-8 md:w-auto" aria-label="Mes anterior" onClick={() => setPeriod(p => shiftPeriod(p, -1))}><ChevronLeft className="h-5 w-5 md:h-4 md:w-4" /></Button>
            <span className="min-w-[8.5rem] text-center font-display text-[17px] font-extrabold tracking-[-0.02em] text-night dark:text-mist md:font-sans md:text-sm md:font-semibold md:tracking-normal">{periodLabel(period)}</span>
            <Button variant="ghost" size="sm" className="h-11 w-11 md:h-8 md:w-auto" aria-label="Mes siguiente" onClick={() => setPeriod(p => shiftPeriod(p, 1))}><ChevronRight className="h-5 w-5 md:h-4 md:w-4" /></Button>
          </div>
        )}
      </div>

      <div role="tabpanel">
        {tab === 'costos' && <PoolsTab />}
        {tab === 'datos' && <MetricsTab period={period} />}
        {tab === 'reparto' && <AllocationTab period={period} />}
      </div>
    </div>
  )
}
