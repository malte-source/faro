'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Sparkles, AlertTriangle, Lightbulb, ArrowRight, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props { projectId: string }

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
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-b from-indigo-50/60 to-white overflow-hidden">
      {/* Header */}
      <button
        onClick={() => insight ? setExpanded(v => !v) : handleGenerate()}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-indigo-50/50"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-indigo-900">Análisis IA</p>
          <p className="text-xs text-indigo-500">
            {insight ? 'Ver resumen ejecutivo generado por Gemini' : 'Generar análisis con Gemini'}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {insight && !generate.isPending && (
            <button
              onClick={(e) => { e.stopPropagation(); handleGenerate() }}
              className="rounded-lg p-1 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 transition-colors"
              title="Regenerar análisis"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          {generate.isPending ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
          ) : insight ? (
            expanded ? <ChevronUp className="h-4 w-4 text-indigo-400" /> : <ChevronDown className="h-4 w-4 text-indigo-400" />
          ) : (
            <span className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">
              Generar
            </span>
          )}
        </div>
      </button>

      {/* Loading state */}
      {generate.isPending && (
        <div className="border-t border-indigo-100 px-4 py-5">
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-3 rounded-full bg-indigo-100 animate-pulse" style={{ width: `${85 - i * 15}%` }} />
            ))}
          </div>
          <p className="mt-3 text-xs text-indigo-400">Analizando proyecto con Gemini…</p>
        </div>
      )}

      {/* Error state */}
      {generate.isError && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-3">
          <p className="text-xs text-red-600">Error al generar el análisis. Verificá que la API key de Gemini esté configurada.</p>
        </div>
      )}

      {/* Insight content */}
      {insight && expanded && !generate.isPending && (
        <div className="border-t border-indigo-100 px-4 py-4 space-y-4">
          {/* Summary */}
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">{insight.summary}</p>
            <p className="mt-1 text-xs text-indigo-600 font-medium">{insight.status_assessment}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Risks */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-xs font-semibold text-slate-600">Riesgos</span>
              </div>
              <ul className="space-y-1">
                {insight.risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>

            {/* Recommendations */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Lightbulb className="h-3.5 w-3.5 text-indigo-500" />
                <span className="text-xs font-semibold text-slate-600">Recomendaciones</span>
              </div>
              <ul className="space-y-1">
                {insight.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Next steps */}
          <div className="rounded-lg bg-indigo-50 px-3 py-2.5">
            <div className="mb-1.5 flex items-center gap-1.5">
              <ArrowRight className="h-3.5 w-3.5 text-indigo-600" />
              <span className="text-xs font-semibold text-indigo-700">Próximas acciones</span>
            </div>
            <ol className="space-y-0.5">
              {insight.next_steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-indigo-700">
                  <span className="shrink-0 font-bold">{i + 1}.</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>

          <p className="text-[10px] text-slate-400">
            Generado por Gemini 1.5 Flash · Los análisis IA son orientativos
          </p>
        </div>
      )}
    </div>
  )
}
