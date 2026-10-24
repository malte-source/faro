'use client'

import { useEffect, useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { FileSpreadsheet, Search, AlertTriangle, Play, Sparkles, CheckCircle2 } from 'lucide-react'
import { PROJECT_FIELDS, TASK_FIELDS } from '@/lib/sheet-import-mapping'
import { confirmAction } from '@/components/ui/confirm'

type Kind = 'projects' | 'tasks' | 'skip'

/**
 * Settings → Integraciones → import from Google Sheets.
 *
 * Flow:
 *   1. Paste URL → inspect → backend returns tab previews + suggested mapping.
 *   2. User reviews/edits the mapping per tab (kind selector + column → field).
 *   3. "Simular" runs a dry-run → preview counts. "Importar" commits.
 *
 * Mapping state is local and seeded from the backend's suggestion.
 */
export function SheetImportCard() {
  const [url, setUrl] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string>('')
  // tabTitle → { kind, mapping: field → columnIndex|null }
  const [config, setConfig] = useState<Record<string, { kind: Kind; mapping: Record<string, number | null> }>>({})

  const inspect = trpc.sheetImport.inspect.useMutation()
  const runImport = trpc.sheetImport.runImport.useMutation()
  const { data: workspaces } = trpc.workspaces.list.useQuery()

  // Default workspace = first one (usually the only one for now).
  useEffect(() => {
    if (!workspaceId && workspaces && workspaces.length > 0) setWorkspaceId(workspaces[0].id)
  }, [workspaces, workspaceId])

  // Seed mapping state from server's suggestion when inspect resolves.
  useEffect(() => {
    if (!inspect.data) return
    const next: typeof config = {}
    for (const p of inspect.data.previews) {
      next[p.tab] = { kind: p.suggestedKind, mapping: { ...p.suggestedMapping } }
    }
    setConfig(next)
  }, [inspect.data])

  const sheetsPayload = useMemo(
    () => Object.entries(config).map(([tabTitle, cfg]) => ({ tabTitle, kind: cfg.kind, mapping: cfg.mapping, headerRow: 0 })),
    [config],
  )

  const runWith = (dryRun: boolean) => {
    if (!workspaceId) return
    runImport.mutate({ url: url.trim(), workspaceId, dryRun, sheets: sheetsPayload })
  }

  return (
    <div className="rounded-xl border border-stone bg-white p-5 dark:border-night-700 dark:bg-night">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-wash dark:bg-success/40">
          <FileSpreadsheet className="h-5 w-5 text-success" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-night dark:text-stone-100">Importar desde Google Sheets</h3>
          <p className="text-xs text-graphite">
            Migra la &ldquo;Matriz de Proyectos TPY&rdquo;. Inspecciona, ajusta el mapeo y corre una simulación antes de importar.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Pega la URL del Google Sheet"
          className="flex-1 rounded-lg border border-stone px-3 py-2 text-sm outline-none focus:border-signal dark:border-ink-body dark:bg-night-700"
        />
        <button
          onClick={() => inspect.mutate({ url: url.trim() })}
          disabled={!url.trim() || inspect.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-night px-4 py-2 text-sm font-semibold text-white hover:bg-night-700 disabled:opacity-50 dark:bg-signal dark:text-night dark:hover:bg-signal/90"
        >
          <Search className="h-3.5 w-3.5" />
          {inspect.isPending ? 'Leyendo…' : 'Inspeccionar'}
        </button>
      </div>

      {inspect.isError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {inspect.error.message}
        </p>
      )}

      {inspect.data && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-mist px-3 py-2 text-xs dark:bg-night-700/60">
            <span className="font-medium text-ink-body dark:text-stone">📄 {inspect.data.title}</span>
            <span className="text-graphite">·</span>
            <span className="text-graphite">{inspect.data.tabs.length} pestañas</span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <label className="text-graphite">Workspace destino:</label>
              <select
                value={workspaceId}
                onChange={e => setWorkspaceId(e.target.value)}
                className="rounded border border-stone bg-white px-2 py-0.5 text-xs dark:border-ink-body dark:bg-night-700"
              >
                {(workspaces ?? []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </span>
          </div>

          {inspect.data.previews.map(p => {
            const cfg = config[p.tab] ?? { kind: 'skip' as Kind, mapping: {} }
            const fields = cfg.kind === 'projects' ? PROJECT_FIELDS : cfg.kind === 'tasks' ? TASK_FIELDS : []
            return (
              <details key={p.tab} open={cfg.kind !== 'skip'} className="rounded-lg border border-stone dark:border-ink-body">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink-body dark:text-stone">
                  <span className="font-semibold">{p.tab}</span>
                  <span className="ml-2 text-graphite">· {p.totalRows} filas · {p.headers.length} columnas</span>
                  {cfg.kind !== 'skip' && (
                    <span className="ml-2 rounded-full bg-signal-wash px-2 py-0.5 text-[10px] font-semibold uppercase text-night dark:bg-signal/40 dark:text-signal">
                      <Sparkles className="mr-1 inline h-2.5 w-2.5" /> {cfg.kind}
                    </span>
                  )}
                </summary>

                <div className="border-t border-stone-100 p-3 dark:border-night-700 space-y-3">
                  {/* Kind selector */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-graphite dark:text-stone">Importar como:</span>
                    {(['projects', 'tasks', 'skip'] as const).map(k => (
                      <label key={k} className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          checked={cfg.kind === k}
                          onChange={() => setConfig(c => ({ ...c, [p.tab]: { kind: k, mapping: k === 'skip' ? {} : (c[p.tab]?.mapping ?? {}) } }))}
                        />
                        {k === 'projects' ? 'Proyectos' : k === 'tasks' ? 'Tareas' : 'Ignorar'}
                      </label>
                    ))}
                  </div>

                  {/* Header preview */}
                  {p.headers.length > 0 && (
                    <div className="overflow-x-auto rounded border border-stone-100 dark:border-night-700">
                      <table className="text-[10px]">
                        <thead className="bg-mist dark:bg-night-700/50">
                          <tr>
                            {p.headers.map((h, i) => (
                              <th key={i} className="border border-stone px-1.5 py-0.5 text-left font-semibold dark:border-ink-body">
                                <span className="text-graphite">{i}.</span> {h || `col${i}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {p.sampleRows.map((row, ri) => (
                            <tr key={ri}>{row.map((c, ci) => <td key={ci} className="border border-stone-100 px-1.5 py-0.5 align-top dark:border-night-700">{c}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Mapping editor */}
                  {cfg.kind !== 'skip' && fields.length > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-graphite">Mapeo de campos</p>
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-3">
                        {fields.map(field => (
                          <label key={field} className="flex items-center gap-1.5 text-xs">
                            <span className="w-28 shrink-0 text-graphite dark:text-stone">{field}</span>
                            <select
                              value={cfg.mapping[field] ?? ''}
                              onChange={e => {
                                const v = e.target.value === '' ? null : parseInt(e.target.value, 10)
                                setConfig(c => ({ ...c, [p.tab]: { ...c[p.tab], mapping: { ...c[p.tab].mapping, [field]: v } } }))
                              }}
                              className="flex-1 rounded border border-stone bg-white px-1.5 py-0.5 text-xs dark:border-ink-body dark:bg-night-700"
                            >
                              <option value="">— sin mapear —</option>
                              {p.headers.map((h, i) => <option key={i} value={i}>{i}. {h || `col${i}`}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )
          })}

          <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 dark:border-night-700">
            <button
              onClick={() => runWith(true)}
              disabled={runImport.isPending || !workspaceId}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone px-3 py-1.5 text-xs font-medium hover:bg-mist disabled:opacity-50 dark:border-graphite dark:hover:bg-night-700"
            >
              <Sparkles className="h-3 w-3" /> Simular (dry-run)
            </button>
            <button
              onClick={async () => {
                const ok = await confirmAction({
                  title: 'Importar al workspace seleccionado',
                  description: 'Esta acción crea proyectos y tareas en FARO. Es idempotente — los códigos/títulos ya existentes se omiten.',
                  variant: 'warning',
                  confirmLabel: 'Importar',
                })
                if (ok) runWith(false)
              }}
              disabled={runImport.isPending || !workspaceId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-xs font-semibold text-white hover:bg-success disabled:opacity-50"
            >
              <Play className="h-3 w-3" /> {runImport.isPending ? 'Importando…' : 'Importar de verdad'}
            </button>
          </div>

          {runImport.isError && (
            <p className="flex items-start gap-1.5 rounded-lg bg-danger-wash px-3 py-2 text-xs text-danger dark:bg-danger/30 dark:text-danger/50">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {runImport.error.message}
            </p>
          )}

          {runImport.data && (
            <div className="rounded-lg border border-success/30 bg-success-wash/60 px-3 py-2 text-xs dark:border-success/40 dark:bg-success/20">
              <p className="font-semibold text-success dark:text-success/30">
                <CheckCircle2 className="mr-1 inline h-3 w-3" />
                {runImport.data.dryRun ? 'Simulación completa' : 'Import completo'}
              </p>
              <p className="mt-1 text-success dark:text-success/50">
                {runImport.data.projectsCreated} proyectos {runImport.data.dryRun ? 'a crear' : 'creados'} · {runImport.data.projectsSkipped} omitidos ·{' '}
                {runImport.data.tasksCreated} tareas {runImport.data.dryRun ? 'a crear' : 'creadas'} · {runImport.data.tasksSkipped} omitidas
              </p>
              {runImport.data.warnings.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] text-signal-ink">{runImport.data.warnings.length} advertencias</summary>
                  <ul className="mt-1 list-disc pl-4 text-[10px] text-signal-ink dark:text-signal/50 space-y-0.5">
                    {runImport.data.warnings.slice(0, 30).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
