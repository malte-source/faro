/**
 * Minimal CSV builder — no deps. Handles RFC-4180 quoting (wrap fields with
 * commas / quotes / newlines in double quotes, escape inner quotes by doubling).
 *
 * Output is UTF-8 with a BOM so Excel opens accents correctly without prompting.
 */
export function toCSV(rows: Array<Record<string, string | number | null | undefined>>): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))]
  return lines.join('\r\n')
}

/** Trigger a download of CSV text as a file in the browser. */
export function downloadCSV(filename: string, csv: string) {
  // Prepend BOM so Excel detects UTF-8 (otherwise "ñ" / "á" render broken).
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
