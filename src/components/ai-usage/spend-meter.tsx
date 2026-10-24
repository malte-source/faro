import { cn } from '@/lib/utils'
import { formatPct, formatUsd } from '@/components/ai-usage/format'
import type { AiUsageSummary } from '@/components/ai-usage/types'

/**
 * The headline of the page: what has been spent this month against the cap. The bar is
 * Señal while there is room, turns amber-dark at the warning threshold and danger past
 * the cap; a tick marks where the warning starts. No cap → just the number and the run rate.
 */
export function SpendMeter({ data, onEditBudget }: { data: AiUsageSummary; onEditBudget?: () => void }) {
  const { totals, budget, projectedUsd, scope } = data
  const cap = scope === 'org' ? budget.monthlyUsd : budget.perUserMonthlyUsd
  const fraction = cap === null ? null : cap === 0 ? 1 : totals.costUsd / cap
  const over = fraction !== null && fraction >= 1
  const warn = fraction !== null && !over && fraction * 100 >= budget.warnPct
  const projectedOver = cap !== null && cap > 0 && projectedUsd > cap
  const isCurrent = data.today.slice(0, 7) === data.month

  return (
    <section className="rounded-[14px] border border-border bg-surface p-4" aria-label="Gasto de IA del mes">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">
        {scope === 'org' ? 'Gasto del grupo' : 'Tu gasto'}
      </p>
      <p className={cn('mt-1 font-display text-[38px] font-extrabold leading-none tracking-[-0.035em]', over ? 'text-danger' : 'text-foreground')}>
        {formatUsd(totals.costUsd)}
      </p>
      <p className="mt-1.5 text-[13px] text-graphite">
        {cap === null
          ? 'Sin tope de gasto este mes.'
          : cap === 0
            ? 'La IA está apagada (tope de US$ 0).'
            : <>de {formatUsd(cap)} · <span className={cn('font-semibold', over ? 'text-danger' : warn ? 'text-signal-ink' : 'text-foreground')}>{formatPct(fraction ?? 0)}</span></>}
      </p>

      {cap !== null && cap > 0 && (
        <div className="relative mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((fraction ?? 0) * 100))} aria-label="Uso del presupuesto">
          <div className="h-2.5 overflow-hidden rounded-full bg-border-soft">
            <div
              className={cn('h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]', over ? 'bg-danger' : warn ? 'bg-signal-ink' : 'bg-signal')}
              style={{ width: `${Math.min(100, (fraction ?? 0) * 100)}%` }}
            />
          </div>
          {scope === 'org' && (
            <span
              className="absolute top-[-3px] h-[16px] w-px bg-graphite/60"
              style={{ left: `${budget.warnPct}%` }}
              title={`Aviso al ${budget.warnPct} %`}
              aria-hidden
            />
          )}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border-soft pt-3 text-center">
        <div>
          <dt className="text-[11px] text-graphite">Llamadas</dt>
          <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-foreground">{totals.calls.toLocaleString('es')}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-graphite">Con error</dt>
          <dd className={cn('mt-0.5 font-display text-lg font-bold tabular-nums', totals.failed > 0 ? 'text-danger' : 'text-foreground')}>{totals.failed.toLocaleString('es')}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-graphite">{isCurrent ? 'Proyección' : 'Total'}</dt>
          <dd className={cn('mt-0.5 font-display text-lg font-bold tabular-nums', projectedOver ? 'text-danger' : 'text-foreground')}>{formatUsd(isCurrent ? projectedUsd : totals.costUsd)}</dd>
        </div>
      </dl>

      {isCurrent && (
        <p className="mt-2 text-center text-[11px] text-graphite">
          Proyección a fin de mes al ritmo actual{projectedOver ? ': superaría el tope.' : '.'}
        </p>
      )}

      {onEditBudget && (
        <button
          type="button"
          onClick={onEditBudget}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-[12px] border border-border bg-background text-[14px] font-semibold text-foreground active:bg-border-soft"
        >
          {budget.hasRow ? 'Cambiar presupuesto' : 'Fijar presupuesto'}
        </button>
      )}
    </section>
  )
}
