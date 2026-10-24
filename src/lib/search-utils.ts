/**
 * Pure helpers for the hybrid search: text normalisation, safe highlighted
 * snippets, LIKE escaping, keyset (cursor) pagination and index truncation.
 * No I/O, so everything here is unit-tested (search-utils.test.ts).
 */

export type SearchEntityType = 'task' | 'document' | 'chat' | 'decision' | 'update'

export const SEARCH_TYPES: readonly SearchEntityType[] = ['task', 'document', 'chat', 'decision', 'update']

export const SEARCH_TYPE_LABEL: Record<SearchEntityType, string> = {
  task: 'Tareas',
  document: 'Documentos',
  chat: 'Chat',
  decision: 'Decisiones',
  update: 'Avances',
}

/** Where a result opens. One place, so the index and the basic (non-indexed) search agree. */
export const searchUrl = {
  task: (projectId: string, taskId: string) => `/dashboard/projects/${projectId}?task=${taskId}`,
  document: (id: string) => `/dashboard/documentos/${id}`,
  decision: (id: string) => `/dashboard/decisions/${id}`,
  update: (projectId: string) => `/dashboard/projects/${projectId}`,
  chat: (channelId: string, messageId: string) => `/dashboard/chat?c=${channelId}&m=${messageId}`,
}

// ── Text ────────────────────────────────────────────────────────────────────

/** One char → its lowercase base letter, keeping EXACTLY one char so indexes line up with the original text. */
function baseChar(ch: string): string {
  const folded = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return folded.charAt(0) || ch
}

/** Lowercase + strip accents, preserving string length (so match offsets map back to the original). */
export function foldKeepLength(text: string): string {
  let out = ''
  for (const ch of text) out += baseChar(ch).padEnd(ch.length, ' ').slice(0, ch.length)
  return out
}

/** Lowercase + strip accents (length may differ from the input; for comparisons only). */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** The words of a query worth highlighting / matching: ≥ 2 chars, deduplicated, accent-folded. */
export function queryTerms(q: string): string[] {
  const seen = new Set<string>()
  for (const raw of foldText(q).split(/[^a-z0-9ñ]+/)) {
    if (raw.length >= 2) seen.add(raw)
  }
  return Array.from(seen)
}

/** Escape `%`, `_` and `\` so user text can't act as LIKE wildcards. */
export function escapeLike(text: string): string {
  return text.replace(/[%_\\]/g, m => `\\${m}`)
}

/** Cut at the last whitespace before `max` so an index row never ends mid-word. */
export function truncateForIndex(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()
}

// ── Snippets ────────────────────────────────────────────────────────────────

/** A piece of snippet text; `hit` marks a matched term. Rendered as text nodes — never as HTML. */
export interface SnippetPart { t: string; hit?: true }

/**
 * A short excerpt of `body` around the first match, as parts (plain text + marked
 * hits). Returns structured parts instead of an HTML string on purpose: the UI renders
 * them as React text nodes, so user content can never inject markup.
 */
export function makeSnippet(body: string, terms: string[], max = 160): SnippetPart[] {
  const text = body.replace(/\s+/g, ' ').trim()
  if (!text) return []
  const folded = foldKeepLength(text)

  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    if (term.length < 2) continue
    let from = 0
    for (;;) {
      const i = folded.indexOf(term, from)
      if (i < 0) break
      ranges.push([i, i + term.length])
      from = i + term.length
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }

  // Window: start a little before the first hit, on a word boundary.
  let start = 0
  if (merged.length) {
    start = Math.max(0, merged[0][0] - 40)
    if (start > 0) {
      const sp = text.indexOf(' ', start)
      if (sp >= 0 && sp < merged[0][0]) start = sp + 1
    }
  }
  let end = Math.min(text.length, start + max)
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end)
    if (sp > start + max * 0.6) end = sp
  }

  const parts: SnippetPart[] = []
  if (start > 0) parts.push({ t: '… ' })
  let cursor = start
  for (const [a, b] of merged) {
    if (b <= start || a >= end) continue
    const hs = Math.max(a, start)
    const he = Math.min(b, end)
    if (hs > cursor) parts.push({ t: text.slice(cursor, hs) })
    parts.push({ t: text.slice(hs, he), hit: true })
    cursor = he
  }
  if (cursor < end) parts.push({ t: text.slice(cursor, end) })
  if (end < text.length) parts.push({ t: ' …' })
  return parts
}

/** Plain-text version of a snippet (tests, logs, fallbacks). */
export function snippetText(parts: SnippetPart[]): string {
  return parts.map(p => p.t).join('')
}

// ── Keyset pagination (index sync) ──────────────────────────────────────────

export interface Cursor { at: string | null; id: string | null }

/**
 * PostgREST `.or()` filter for "rows strictly after the cursor" ordered by (column, id):
 *   column > at  OR  (column = at AND id > cursorId)
 * Values are double-quoted so timestamps (with `+` and `:`) can't be misparsed. Returns null at the start.
 */
export function keysetFilter(column: string, cursor: Cursor): string | null {
  if (!cursor.at) return null
  const at = `"${cursor.at.replace(/"/g, '')}"`
  if (!cursor.id) return `${column}.gt.${at}`
  const id = `"${cursor.id.replace(/"/g, '')}"`
  return `${column}.gt.${at},and(${column}.eq.${at},id.gt.${id})`
}

/** The cursor to store after processing `rows` (the last one), or the previous cursor when empty. */
export function nextCursor<T extends { id: string }>(rows: T[], column: keyof T, previous: Cursor): Cursor {
  const last = rows[rows.length - 1]
  if (!last) return previous
  return { at: String(last[column]), id: last.id }
}
