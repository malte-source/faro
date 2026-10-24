'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { ExternalLink, BookOpen, Save, Check } from 'lucide-react'

interface Props {
  projectId: string
  notebooklmId: string | null
}

/**
 * NotebookLM link card on the project Info tab. Accepts either:
 *   - a full URL (e.g. https://notebooklm.google.com/notebook/<id>)
 *   - the raw notebook id
 *
 * What we store in the DB is the id only (sanitized). The "Abrir" button
 * always reconstructs the full URL.
 */
function extractNotebookId(input: string): string | null {
  if (!input) return null
  const trimmed = input.trim()
  const m = trimmed.match(/\/notebook\/([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed
  return null
}

export function ProjectLinks({ projectId, notebooklmId }: Props) {
  const utils = trpc.useUtils()
  const [draft, setDraft] = useState(notebooklmId ?? '')
  const [saved, setSaved] = useState(false)

  useEffect(() => { setDraft(notebooklmId ?? '') }, [notebooklmId])

  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.invalidate()
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    },
  })

  function commit() {
    const id = draft.trim() ? extractNotebookId(draft) : null
    update.mutate({ id: projectId, notebooklmId: id })
  }

  const fullUrl = notebooklmId ? `https://notebooklm.google.com/notebook/${notebooklmId}` : null

  return (
    <div className="rounded-xl border border-stone bg-white p-4 dark:border-night-700 dark:bg-night">
      <div className="mb-2 flex items-center gap-2">
        <BookOpen className="h-3.5 w-3.5 text-graphite" />
        <h3 className="text-sm font-semibold text-ink-body dark:text-stone">NotebookLM del proyecto</h3>
        {fullUrl && (
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-signal-wash px-2 py-1 text-xs font-medium text-night hover:bg-signal-wash dark:bg-signal/40 dark:text-signal"
          >
            Abrir <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <p className="mb-2 text-xs text-graphite">
        Centraliza la memoria del proyecto. El link queda accesible para todo el equipo.
      </p>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="URL o ID del notebook (notebooklm.google.com/notebook/...)"
          className="flex-1 rounded-lg border border-stone px-3 py-2 text-sm outline-none focus:border-signal dark:border-ink-body dark:bg-night-700"
        />
        <button
          onClick={commit}
          disabled={update.isPending || draft === (notebooklmId ?? '')}
          className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
        >
          {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          {saved ? 'Guardado' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}
