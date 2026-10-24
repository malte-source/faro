import { InsetGroup, ListRow } from '@/components/mobile/inset-list'
import { cn } from '@/lib/utils'
import { formatInt, formatUsd, shortDate } from '@/components/ai-usage/format'
import type { AiUsageSummary } from '@/components/ai-usage/types'

/** Heads-up for price rises Google has already announced (they change the run rate without any change in usage). */
export function PriceNotice({ changes }: { changes: AiUsageSummary['priceChanges'] }) {
  if (changes.length === 0) return null
  return (
    <aside className="rounded-[14px] border border-signal/40 bg-signal-wash p-3.5 dark:bg-signal/10" aria-label="Aumentos de precio anunciados">
      <p className="text-[13px] font-semibold text-foreground">Suben los precios de la IA</p>
      <ul className="mt-1.5 space-y-1 text-[12.5px] text-body">
        {changes.map(c => (
          <li key={`${c.model}-${c.from}`}>
            <span className="font-mono text-[11.5px]">{c.model}</span> desde el {shortDate(c.from)}: {formatUsd(c.inputPerM)} entrada y {formatUsd(c.outputPerM)} salida por millón de tokens.
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-graphite">El gasto de abajo usa la tarifa vigente el día de cada llamada.</p>
    </aside>
  )
}

/** Where the money goes: one row per AI feature with a bar relative to the biggest. */
export function FeatureBars({ rows }: { rows: AiUsageSummary['byFeature'] }) {
  if (rows.length === 0) return null
  const max = Math.max(...rows.map(r => r.costUsd), 0.000001)
  return (
    <InsetGroup label="Por función">
      {rows.map(r => (
        <div key={r.feature} className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[15px] font-medium text-foreground">{r.label}</span>
            <span className="shrink-0 text-[14px] font-semibold tabular-nums text-foreground">{formatUsd(r.costUsd)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border-soft" aria-hidden>
            <div className="h-full rounded-full bg-signal" style={{ width: `${Math.max(2, (r.costUsd / max) * 100)}%` }} />
          </div>
          <p className="mt-1 text-[12px] text-graphite">
            {formatInt(r.calls)} {r.calls === 1 ? 'llamada' : 'llamadas'} · {formatInt(r.tokens)} tokens
            {r.failed > 0 && <span className="text-danger"> · {r.failed} con error</span>}
          </p>
        </div>
      ))}
    </InsetGroup>
  )
}

/** Who spends: Dirección only. */
export function PeopleList({ rows }: { rows: AiUsageSummary['people'] }) {
  if (rows.length === 0) return null
  const total = rows.reduce((sum, r) => sum + r.costUsd, 0) || 1
  return (
    <InsetGroup label="Por persona">
      {rows.map(r => (
        <ListRow
          key={r.userId ?? 'system'}
          title={r.name}
          subtitle={`${formatInt(r.calls)} ${r.calls === 1 ? 'llamada' : 'llamadas'} · ${Math.round((r.costUsd / total) * 100)} % del gasto`}
          trailing={<span className="text-[14px] font-semibold tabular-nums text-foreground">{formatUsd(r.costUsd)}</span>}
        />
      ))}
    </InsetGroup>
  )
}

/** One bar per day of the month; today is Señal, the rest Noche (Señal-on-Noche in dark). */
export function DailyBars({ daily, today }: { daily: AiUsageSummary['daily']; today: string }) {
  if (daily.length === 0) return null
  const max = Math.max(...daily.map(d => d.costUsd), 0.000001)
  return (
    <section aria-label="Gasto por día">
      <h3 className="px-4 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">Por día</h3>
      <div className="rounded-[14px] border border-border bg-surface p-3.5">
        <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`Gasto diario, máximo ${formatUsd(max)}`}>
          {daily.map(d => (
            <div key={d.day} className="flex h-full min-w-0 flex-1 items-end" title={`${shortDate(d.day)}: ${formatUsd(d.costUsd)}`}>
              <div
                className={cn('w-full rounded-t-[3px]', d.day === today ? 'bg-signal' : 'bg-night/80 dark:bg-border')}
                style={{ height: `${d.costUsd > 0 ? Math.max(4, (d.costUsd / max) * 100) : 2}%`, opacity: d.costUsd > 0 ? 1 : 0.3 }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-graphite">
          <span>{daily[0].day.slice(8)}</span>
          <span>{daily[daily.length - 1].day.slice(8)}</span>
        </div>
      </div>
    </section>
  )
}
