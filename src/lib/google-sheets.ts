/**
 * Google Sheets read-only helper (raw fetch — no googleapis dependency).
 * Used to import the legacy "Matriz de Proyectos TPY" spreadsheet.
 */

/** Extract the spreadsheet ID from a full URL or accept a bare ID. */
export function extractSheetId(input: string): string | null {
  const trimmed = input.trim()
  const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed
  return null
}

export interface SheetTab {
  title: string
  rowCount: number
  colCount: number
}

async function call<T>(accessToken: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Sheets ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** List the tabs (sheets) inside a spreadsheet + their dimensions. */
export async function getSpreadsheetTabs(accessToken: string, sheetId: string): Promise<{ title: string; tabs: SheetTab[] }> {
  const data = await call<{
    properties: { title: string }
    sheets: { properties: { title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[]
  }>(accessToken, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title,sheets.properties`)
  return {
    title: data.properties.title,
    tabs: data.sheets.map(s => ({
      title: s.properties.title,
      rowCount: s.properties.gridProperties?.rowCount ?? 0,
      colCount: s.properties.gridProperties?.columnCount ?? 0,
    })),
  }
}

/**
 * Read all values from a tab (or a range). Returns a 2D array of strings.
 * Empty cells come back as ''. Caller treats row 0 as headers typically.
 */
export async function getTabValues(accessToken: string, sheetId: string, tabTitle: string, maxRows = 1000): Promise<string[][]> {
  const range = encodeURIComponent(`${tabTitle}!A1:Z${maxRows}`)
  const data = await call<{ values?: string[][] }>(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
  )
  // Normalise ragged rows so every row has the same length as the header.
  const rows = data.values ?? []
  const width = Math.max(0, ...rows.map(r => r.length))
  return rows.map(r => {
    const padded = [...r.map(c => (c == null ? '' : String(c)))]
    while (padded.length < width) padded.push('')
    return padded
  })
}
