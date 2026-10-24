'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { AlertTriangle, Lightbulb, ArrowRight, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { FaroMark } from '@/components/brand/logo'

interface Props { projectId: string }

/**
 * The one place Señal takes the lead — this block IS the "análisis IA"
 * accent moment per the brand spec. Uses FaroMark instead of a Sparkles
 * icon (the lighthouse itself is the "insight" metaphor).
 */
export function ProjectAiInsight({ projectId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [insight, setInsight] = useState<{
    summary: string
    status_assessment: string
    risks: string[]
    recommendations: string[]
    next_steps: string[]
  } | null>(null)

  const generate = trpc.projects.aiInsight.useMutation({
    onSuccess: (data) => {
      setInsight(data)
      setExpanded(true)
    },
  })

  function handleGenerate() {
    generate.mutate(projectId)
  }

  return (
    <div className="rounded-[14px] border border-signal/45 bg-signal-wash overflow-hidden">
      {/* Header */}
      <button
        onClick={() => insight ? setExpanded(v => !v) : handleGenerate()}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-signal-wash/60"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-night dark:bg-signal">
          <FaroMark plain size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display text-[15px] font-bold text-foreground">Análisis del proyecto</p>
          <p className="text-[12px] text-graphite">
            {insight ? 'Ver resumen ejecutivo generado' : 'Generar análisis del estado del proyecto'}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {insight && !generate.isPending && (
            <button
              onClick={(e) => { e.stopPropagation(); handleGenerate() }}
              className="rounded-lg p-1 text-signal-ink hover:bg-surface/60 transition-colors"
              title="Regenerar análisis"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          {generate.isPending ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-signal" />
          ) : insight ? (
            expanded ? <ChevronUp className="h-4 w-4 text-signal-ink" /> : <ChevronDown className="h-4 w-4 text-signal-ink" />
          ) : (
            <span className="rounded-lg bg-signal px-3 py-1 text-xs font-semibold text-night">
              Generar
            </span>
          )}
        </div>
      </button>

      {/* Loading state */}
      {generate.isPending && (
        <div className="border-t border-signal/25 px-4 py-5">
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-3 rounded-full bg-surface/60 animate-pulse" style={{ width: `${85 - i * 15}%` }} />
            ))}
          </div>
          <p className="mt-3 text-xs text-signal-ink">Analizando proyecto…</p>
        </div>
      )}

      {/* Error state */}
      {generate.isError && (
        <div className="border-t border-danger/20 bg-danger-wash px-4 py-3">
          <p className="text-xs text-danger">No se pudo generar el análisis. Revisa la configuración.</p>
        </div>
      )}

      {/* Insight content */}
      {insight && expanded && !generate.isPending && (
        <div className="border-t border-signal/25 px-4 py-4 space-y-4">
          {/* Summary */}
          <div>
            <p className="text-sm text-body leading-relaxed">{insight.summary}</p>
            <p className="mt-1 text-xs text-signal-ink font-medium">{insight.status_assessment}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Risks — danger, not amber (amber is the brand accent now) */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                <span className="text-xs font-semibold text-graphite">Riesgos</span>
              </div>
              <ul className="space-y-1">
                {insight.risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-graphite">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>

            {/* Recommendations — info blue */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Lightbulb className="h-3.5 w-3.5 text-info" />
                <span className="text-xs font-semibold text-graphite">Recomendaciones</span>
              </div>
              <ul className="space-y-1">
                {insight.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-graphite">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Next steps — Noche reverse-out block */}
          <div className="rounded-[12px] bg-night px-3 py-2.5 ring-1 ring-transparent dark:bg-surface dark:ring-border">
            <div className="mb-1.5 flex items-center gap-1.5">
              <ArrowRight className="h-3.5 w-3.5 text-signal" />
              <span className="text-xs font-semibold text-mist">Próximas acciones</span>
            </div>
            <ol className="space-y-0.5">
              {insight.next_steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-mist">
                  <span className="shrink-0 font-mono font-bold text-signal">{i + 1}.</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>

          <p className="text-[10px] text-graphite">
            Los análisis son orientativos.
          </p>
        </div>
      )}
    </div>
  )
}
