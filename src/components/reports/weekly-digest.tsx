'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  Sparkles, AlertTriangle, TrendingUp, HelpCircle, ArrowRight,
  RefreshCw, Copy, Check, MessageSquare,
} from 'lucide-react'

/**
 * Weekly digest card — top of the reports page.
 *
 * Auto-generates on first mount, can be regenerated on demand. The user
 * can copy a markdown version (headline + bullets) to paste into email or
 * Google Chat for the team.
 *
 * Future: scheduled via Cloud Scheduler every Monday 8am → also stored
 * persistently and pushed to Google Chat webhook.
 */
export function WeeklyDigest() {
  const digest = trpc.digests.weekly.useMutation()
  const [copied, setCopied] = useState(false)
  const [chatSent, setChatSent] = useState<'ok' | 'err' | null>(null)

  const { data: chatStatus } = trpc.chatNotifications.status.useQuery()
  const sendToChat = trpc.chatNotifications.sendDigest.useMutation({
    onSuccess: () => { setChatSent('ok'); setTimeout(() => setChatSent(null), 2500) },
    onError: () => { setChatSent('err'); setTimeout(() => setChatSent(null), 2500) },
  })

  useEffect(() => {
    digest.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const data = digest.data
  const loading = digest.isPending

  function copyMarkdown() {
    if (!data) return
    const md = [
      `**${data.headline}**`,
      '',
      data.highlights.length > 0 && `**Destacados**\n${data.highlights.map(h => `- ${h}`).join('\n')}`,
      data.risks.length > 0 && `**Riesgos**\n${data.risks.map(r => `- ${r}`).join('\n')}`,
      data.asks.length > 0 && `**Decisiones pendientes**\n${data.asks.map(a => `- ${a}`).join('\n')}`,
      data.next_week_focus && `**Foco próxima semana**\n${data.next_week_focus}`,
    ].filter(Boolean).join('\n\n')
    navigator.clipboard.writeText(md)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-xl border border-stone bg-gradient-to-br from-signal-wash/80 via-white to-white p-5 dark:border-signal/40 dark:from-[#17313F] dark:via-night dark:to-night">
      {/* Header */}
      <header className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-night text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-night dark:text-signal">
            Digest semanal
          </h2>
          <p className="text-[10px] uppercase tracking-wider text-signal-ink/80">
            {data?.ai_powered === false
              ? 'Resumen automático (Gemini no disponible)'
              : 'Resumen ejecutivo del portfolio · Gemini'}
          </p>
        </div>
        {data && chatStatus?.configured && (
          <button
            onClick={() => sendToChat.mutate({
              headline: data.headline,
              highlights: data.highlights,
              risks: data.risks,
              asks: data.asks,
              nextWeekFocus: data.next_week_focus,
            })}
            disabled={sendToChat.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone bg-white/80 px-3 py-1.5 text-xs font-medium text-night transition hover:bg-signal-wash disabled:opacity-50 dark:border-signal/40 dark:bg-night/40 dark:text-signal dark:hover:bg-signal/40"
            title="Mandar a Google Chat"
          >
            {chatSent === 'ok' ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
            {sendToChat.isPending ? 'Enviando…' : chatSent === 'ok' ? 'Enviado' : chatSent === 'err' ? 'Error' : 'Enviar a Chat'}
          </button>
        )}
        {data && (
          <button
            onClick={copyMarkdown}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone bg-white/80 px-3 py-1.5 text-xs font-medium text-night transition hover:bg-signal-wash dark:border-signal/40 dark:bg-night/40 dark:text-signal dark:hover:bg-signal/40"
            title="Copiar como markdown para mandar a email/Chat"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        )}
        <button
          onClick={() => digest.mutate()}
          disabled={loading}
          className="rounded-md p-1.5 text-signal-ink transition hover:bg-signal-wash hover:text-night disabled:opacity-50 dark:hover:bg-signal/50 dark:hover:text-signal"
          title="Regenerar"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {/* Loading */}
      {loading && !data && (
        <div className="space-y-3">
          <div className="h-5 w-2/3 animate-pulse rounded bg-signal-wash/50 dark:bg-signal/30" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-signal-wash/50 dark:bg-signal/30" />
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      {data && (
        <>
          {/* Headline */}
          <p className="mb-4 text-base font-semibold text-night-700 dark:text-stone-100">
            {data.headline}
          </p>

          <div className="grid gap-3 md:grid-cols-3">
            <DigestSection
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              tone="emerald"
              title="Destacados"
              items={data.highlights}
            />
            <DigestSection
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              tone="rose"
              title="Riesgos"
              items={data.risks}
            />
            <DigestSection
              icon={<HelpCircle className="h-3.5 w-3.5" />}
              tone="amber"
              title="Decisiones pendientes"
              items={data.asks}
            />
          </div>

          {data.next_week_focus && (
            <div className="mt-4 flex items-start gap-3 rounded-lg bg-signal-wash/50 px-4 py-3 dark:bg-signal/30">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-signal-ink" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-night dark:text-signal">
                  Foco próxima semana
                </p>
                <p className="mt-0.5 text-sm text-night dark:text-signal">
                  {data.next_week_focus}
                </p>
              </div>
            </div>
          )}

          <p className="mt-3 text-[10px] text-graphite">
            Generado {new Date(data.generated_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}
          </p>
        </>
      )}

      {digest.isError && !data && (
        <p className="text-sm text-danger">
          Error al generar el digest. Reintenta en unos segundos.
        </p>
      )}
    </section>
  )
}

function DigestSection({
  icon, title, items, tone,
}: {
  icon: React.ReactNode
  title: string
  items: string[]
  tone: 'emerald' | 'rose' | 'amber'
}) {
  const toneClasses = {
    emerald: { iconBg: 'bg-success-wash text-success', dot: 'bg-success' },
    rose:    { iconBg: 'bg-danger-wash text-danger',       dot: 'bg-danger' },
    amber:   { iconBg: 'bg-signal-wash text-signal-ink',     dot: 'bg-signal-ink' },
  }[tone]

  return (
    <div className="rounded-lg bg-white/70 p-3 dark:bg-night/40">
      <div className="mb-2 flex items-center gap-1.5">
        <span className={`flex h-5 w-5 items-center justify-center rounded ${toneClasses.iconBg}`}>
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-graphite dark:text-stone">
          {title}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-graphite italic">— sin items</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs leading-snug text-ink-body dark:text-stone">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${toneClasses.dot}`} />
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
