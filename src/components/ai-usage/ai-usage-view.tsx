'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, DatabaseZap, Sparkles } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { EmptyState } from '@/components/ui/empty-state'
import { BudgetSheet } from '@/components/ai-usage/budget-sheet'
import { SpendMeter } from '@/components/ai-usage/spend-meter'
import { DailyBars, FeatureBars, PeopleList, PriceNotice } from '@/components/ai-usage/usage-lists'
import { monthLabel, shiftMonth } from '@/components/ai-usage/format'

/**
 * AI meter: what the AI cost this month, where it went and against which cap.
 * Dirección sees the whole grupo and can set the budget; everyone else sees
 * only their own usage.
 */
export function AiUsageView() {
  const [month, setMonth] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const { data, isLoading, error } = trpc.aiUsage.summary.useQuery(month ? { month } : undefined, { staleTime: 30_000 })

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-4">
        {[0, 1, 2].map(i => <div key={i} className="h-32 animate-pulse rounded-[14px] bg-border-soft" />)}
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-6">
        <EmptyState icon={Sparkles} title="No se pudo cargar el medidor" description={error?.message ?? 'Intenta de nuevo en un momento.'} />
      </div>
    )
  }

  const isOrg = data.scope === 'org'
  const currentMonth = data.today.slice(0, 7)
  const label = monthLabel(data.month)
  const nothingYet = data.available && data.totals.calls === 0

  return (
    <div className="mx-auto w-full max-w-xl space-y-5 px-4 pb-8 pt-3">
      {/* Month selector */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(data.month, -1))}
          aria-label="Mes anterior"
          className="flex h-11 w-11 items-center justify-center rounded-full text-foreground active:bg-border-soft"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="font-display text-base font-bold capitalize tracking-[-0.02em] text-foreground" aria-live="polite">{label}</p>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(data.month, 1))}
          disabled={data.month >= currentMonth}
          aria-label="Mes siguiente"
          className="flex h-11 w-11 items-center justify-center rounded-full text-foreground active:bg-border-soft disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {!data.available ? (
        <section className="rounded-[14px] border border-border bg-surface p-4 text-center" role="status">
          <DatabaseZap className="mx-auto h-7 w-7 text-signal-ink" />
          <p className="mt-2 text-[15px] font-semibold text-foreground">El medidor aún no está activo</p>
          <p className="mt-1 text-[13px] text-graphite">
            Falta aplicar la migración <span className="font-mono text-[12px]">20261026_ai_usage.sql</span> en Supabase. Mientras tanto la IA funciona con normalidad, sin medir ni limitar.
          </p>
        </section>
      ) : (
        <>
          <PriceNotice changes={data.priceChanges} />
          <SpendMeter data={data} onEditBudget={isOrg ? () => setEditing(true) : undefined} />

          {!isOrg && (
            <p className="px-1 text-center text-[12px] text-graphite">
              Aquí ves solo tu propio uso. Dirección ve el del grupo completo y fija el presupuesto.
            </p>
          )}

          {nothingYet ? (
            <EmptyState icon={Sparkles} title={`Sin uso de IA en ${label}`} description="Cuando alguien use la captura, el chat con @faro o los documentos con IA, aparece aquí." />
          ) : (
            <>
              <DailyBars daily={data.daily} today={data.today} />
              <FeatureBars rows={data.byFeature} />
              {isOrg && <PeopleList rows={data.people} />}
            </>
          )}

          <p className="px-2 text-center text-[11.5px] leading-relaxed text-graphite">
            Montos estimados en dólares a partir de los tokens de cada llamada, con la tarifa vigente ese día. La factura de Google es la cifra oficial.
          </p>
        </>
      )}

      {isOrg && (
        <BudgetSheet
          open={editing}
          onClose={() => setEditing(false)}
          initial={{ monthlyUsd: data.budget.monthlyUsd, perUserMonthlyUsd: data.budget.perUserMonthlyUsd, warnPct: data.budget.warnPct }}
        />
      )}
    </div>
  )
}
