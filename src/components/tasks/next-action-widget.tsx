'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { Sparkles, ArrowRight, RefreshCw, ChevronRight } from 'lucide-react'

/**
 * Dashboard widget — Gemini ranks "what should I do next?" out of the user's
 * pending tasks, returning a top-3 with reasoning.  Runs on mount; user can
 * regenerate.  Falls back to a deterministic priority+due-date ranking if
 * the AI call fails.
 *
 * Phone: a Noche "hero" card (the brand's reverse-out surface) with Señal
 * numbering and full-width tappable rows. Desktop keeps the light card.
 */
export function NextActionWidget() {
  const next = trpc.tasks.nextSuggestion.useMutation()

  // Auto-run once on mount.
  useEffect(() => {
    next.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const data = next.data
  const loading = next.isPending

  return (
    <>
      {/* ───────── Phone: hero ───────── */}
      <section className="overflow-hidden rounded-[18px] border border-night bg-night p-4 text-mist md:hidden dark:border-signal/30 dark:bg-night-700">
        <header className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-signal text-night">
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-signal">Recomendado por Gemini</p>
            <h2 className="font-display text-[22px] font-extrabold leading-tight tracking-[-0.035em]">¿Qué hago ahora?</h2>
          </div>
          <button
            type="button"
            onClick={() => next.mutate()}
            disabled={loading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-mist/80 active:bg-white/10 disabled:opacity-50"
            aria-label="Regenerar recomendación"
          >
            <RefreshCw className={`h-[18px] w-[18px] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {loading && !data && (
          <div className="mt-4 space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-[12px] bg-white/10" />)}
          </div>
        )}

        {data && data.ranked.length === 0 && (
          <p className="mt-4 rounded-[12px] bg-white/8 px-3 py-4 text-center text-sm text-mist/80">{data.summary}</p>
        )}

        {data && data.ranked.length > 0 && (
          <>
            <p className="mt-3 text-[13px] leading-snug text-mist/70">{data.summary}</p>
            <ol className="mt-3 space-y-2">
              {data.ranked.map((r, i) => (
                <li key={r.taskId}>
                  <Link
                    href="/dashboard/tasks?view=mine"
                    className="flex min-h-[60px] items-center gap-3 rounded-[12px] bg-white/8 px-3 py-2.5 transition-colors active:bg-white/15"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal text-[13px] font-bold text-night">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold leading-snug">{r.title}</span>
                      <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-mist/65">{r.reason}</span>
                      {r.projectCode && (
                        <span className="mt-1 inline-block rounded bg-white/10 px-1.5 py-px font-mono text-[10px] text-mist/80">{r.projectCode}</span>
                      )}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-mist/50" />
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}

        {next.isError && (
          <p className="mt-3 text-xs text-[#F08A80]">Error al generar la recomendación. Tira para refrescar o reintenta.</p>
        )}
      </section>

      {/* ───────── Desktop ───────── */}
      <section className="hidden rounded-xl border border-border bg-gradient-to-br from-signal-wash/80 via-surface to-surface p-4 md:block dark:border-signal/40 dark:from-[#17313F] dark:via-night dark:to-night">
        <header className="mb-3 flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-night text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-foreground dark:text-signal">¿Qué hago ahora?</h2>
            <p className="text-[10px] uppercase tracking-wider text-signal-ink/80">Recomendado por Gemini</p>
          </div>
          <button
            onClick={() => next.mutate()}
            disabled={loading}
            className="rounded-md p-1 text-signal-ink transition hover:bg-signal-wash hover:text-foreground disabled:opacity-50 dark:hover:bg-signal/50 dark:hover:text-signal"
            title="Regenerar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {loading && !data && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-signal-wash/50 dark:bg-signal/30" />
            ))}
          </div>
        )}

        {data && data.ranked.length === 0 && (
          <p className="py-3 text-center text-sm text-graphite">{data.summary}</p>
        )}

        {data && data.ranked.length > 0 && (
          <>
            <p className="mb-3 text-xs italic text-graphite">{data.summary}</p>
            <ol className="space-y-2">
              {data.ranked.map((r, i) => (
                <li
                  key={r.taskId}
                  className="group flex items-start gap-3 rounded-lg bg-white p-2.5 shadow-sm transition hover:shadow-md dark:bg-night/60"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-night text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href="/dashboard/tasks?view=mine"
                      className="block text-sm font-medium text-foreground hover:text-foreground dark:text-stone-100 dark:hover:text-signal"
                    >
                      {r.title}
                    </Link>
                    <p className="mt-0.5 text-xs leading-snug text-graphite">{r.reason}</p>
                    {r.projectCode && (
                      <p className="mt-1 inline-block rounded bg-border-soft px-1.5 py-px font-mono text-[10px] text-graphite">
                        {r.projectCode}
                      </p>
                    )}
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-signal-ink opacity-0 transition group-hover:opacity-100" />
                </li>
              ))}
            </ol>
          </>
        )}

        {next.isError && (
          <p className="mt-2 text-xs text-danger">
            Error al generar la recomendación. Reintenta en unos segundos.
          </p>
        )}
      </section>
    </>
  )
}
