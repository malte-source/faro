'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toCSV, downloadCSV } from '@/lib/csv'

interface ExportCsvButtonProps {
  /** Async function returning the rows to export. Called on click — keeps the
   *  bytes off the wire until the user actually wants them. */
  fetchRows: () => Promise<Array<Record<string, string | number | null | undefined>>>
  /** Filename without extension. A timestamp is appended automatically. */
  filenamePrefix: string
  label?: string
  className?: string
}

/**
 * Generic "Exportar CSV" button. Fetches rows on click, builds a CSV blob
 * client-side (UTF-8 + BOM for Excel), and triggers a download.
 *
 * Why client-side?  Cloud Run egress is free for downloads up to a few MB,
 * but doing it in the browser means no extra server-rendering route, no streaming
 * concerns, and the user gets a familiar download dialog.
 */
export function ExportCsvButton({ fetchRows, filenamePrefix, label = 'Exportar CSV', className }: ExportCsvButtonProps) {
  const [busy, setBusy] = useState(false)

  const handle = async () => {
    setBusy(true)
    try {
      const rows = await fetchRows()
      if (!rows.length) {
        // Empty result — write a header-less single-line marker so users get
        // a file (and don't think the button is broken) but it's obviously empty.
        downloadCSV(`${filenamePrefix}-vacio.csv`, 'sin datos para exportar')
        return
      }
      // YYYY-MM-DD-HHmm — sortable, no slashes/colons (Windows-safe)
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
      downloadCSV(`${filenamePrefix}-${stamp}.csv`, toCSV(rows))
    } catch (err) {
      console.error('[ExportCsv]', err)
      alert('No se pudo generar el CSV. Prueba de nuevo en un segundo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-lg border border-stone bg-white px-3 py-1.5 text-xs font-medium text-ink-body transition hover:bg-mist disabled:opacity-50 dark:border-ink-body dark:bg-night-700 dark:text-stone dark:hover:bg-ink-body'
      }
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {label}
    </button>
  )
}
