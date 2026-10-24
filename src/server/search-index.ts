import type { createAdminSupabaseClient } from '@/lib/supabase'
import { AiBudgetError } from '@/lib/ai-budget'
import { chunk, embedTexts, formatDocumentForEmbedding, toPgVector, MAX_EMBED_BATCH } from '@/lib/ai-embed'
import { limitsFor } from '@/lib/plan-limits'
import { keysetFilter, nextCursor, searchUrl, truncateForIndex, type Cursor, type SearchEntityType } from '@/lib/search-utils'
import '@/server/ai-usage' // registers the metering sink + budget guard (this runs outside tRPC, from the cron)

/**
 * PULL-BASED search indexing. A cron job (every ~5 min) reads each source table past
 * a stored cursor, writes plain-text rows into `search_documents`, embeds what is
 * pending, and reconciles rows whose source was deleted. Nothing is hooked into the
 * write paths: no added latency on saving a task or sending a message, and no router
 * has to know the index exists.
 *
 * Everything degrades safely: before the SQL (20261027_search.sql) is applied the run
 * answers `not_ready`; if embeddings are unavailable (no key, over budget, plan without
 * AI) the text index still fills and search keeps working on full text.
 */

type Db = ReturnType<typeof createAdminSupabaseClient>

/** Doc excerpt kept in the index for FTS, snippets and embedding. */
export const MAX_BODY_CHARS = 6000
export const SYNC_BATCH = 200
const SWEEP_BATCH = 500
const IN_CHUNK = 100
/** Below this many characters a row is searchable by text but not worth an embedding call ("ok", "gracias"). */
export const MIN_EMBED_CHARS = 12

/** Postgres/PostgREST codes meaning "that table or function does not exist (yet)". */
const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205'])
export function isMissingRelation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return (err.code !== undefined && MISSING.has(err.code)) || /does not exist|schema cache/i.test(err.message ?? '')
}

// ── Row → index document (pure) ─────────────────────────────────────────────

export interface IndexDoc {
  org_id: string
  workspace_id: string | null
  entity_type: SearchEntityType
  entity_id: string
  title: string
  body: string
  project_id: string | null
  channel_id: string | null
  author_id: string | null
  url: string
  source_updated_at: string
}

/** Markdown noise out, readable text in (snippets and embeddings are better without `##`, `**`, link syntax). */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, '')
    .replace(/[*_`|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface TaskSrc { id: string; title: string; description: string | null; project_id: string; reporter_id: string | null; status: string; updated_at: string }
interface DocSrc { id: string; org_id: string; workspace_id: string | null; title: string; body_md: string; status: string; tags: string[] | null; owner_id: string | null; created_by: string | null; updated_at: string }
interface DecisionSrc { id: string; org_id: string; title: string; description: string | null; created_by: string | null; updated_at: string }
interface UpdateSrc { id: string; project_id: string; author_id: string | null; content: string; updated_at: string }
interface ChatSrc { id: string; channel_id: string; author_id: string | null; kind: string; body: string; deleted_at: string | null; created_at: string; edited_at: string | null }

/** Canceled tasks are not searchable (the old global search hid them too). */
export function taskToDoc(t: TaskSrc, orgId: string): IndexDoc | null {
  if (t.status === 'canceled') return null
  return {
    org_id: orgId, workspace_id: null, entity_type: 'task', entity_id: t.id,
    title: truncateForIndex(t.title, 300),
    body: truncateForIndex(t.description ?? '', MAX_BODY_CHARS),
    project_id: t.project_id, channel_id: null, author_id: t.reporter_id,
    url: searchUrl.task(t.project_id, t.id),
    source_updated_at: t.updated_at,
  }
}

/**
 * Obsolete documents are removed from the index. `project_id` stays null on purpose: the
 * documents router scopes by empresa only (a linked project is not an access rule), and the
 * index must not be stricter or looser than the router it mirrors.
 */
export function documentToDoc(d: DocSrc): IndexDoc | null {
  if (d.status === 'obsoleto') return null
  const tags = (d.tags ?? []).join(' ')
  return {
    org_id: d.org_id, workspace_id: d.workspace_id, entity_type: 'document', entity_id: d.id,
    title: truncateForIndex(d.title, 300),
    body: truncateForIndex(`${stripMarkdown(d.body_md)} ${tags}`, MAX_BODY_CHARS),
    project_id: null, channel_id: null, author_id: d.owner_id ?? d.created_by,
    url: searchUrl.document(d.id),
    source_updated_at: d.updated_at,
  }
}

/** Decisions belong to the whole grupo (decisions.ts filters by org only), so no project/empresa gate. */
export function decisionToDoc(d: DecisionSrc, extraText: string): IndexDoc {
  return {
    org_id: d.org_id, workspace_id: null, entity_type: 'decision', entity_id: d.id,
    title: truncateForIndex(d.title, 300),
    body: truncateForIndex(`${d.description ?? ''} ${extraText}`, MAX_BODY_CHARS),
    project_id: null, channel_id: null, author_id: d.created_by,
    url: searchUrl.decision(d.id),
    source_updated_at: d.updated_at,
  }
}

export function updateToDoc(u: UpdateSrc, orgId: string): IndexDoc {
  const body = truncateForIndex(u.content, MAX_BODY_CHARS)
  return {
    org_id: orgId, workspace_id: null, entity_type: 'update', entity_id: u.id,
    title: truncateForIndex(u.content, 80),
    body,
    project_id: u.project_id, channel_id: null, author_id: u.author_id,
    url: searchUrl.update(u.project_id),
    source_updated_at: u.updated_at,
  }
}

/** Only plain text messages that are not deleted; system and AI messages are noise in search. */
export function chatToDoc(m: ChatSrc, orgId: string): IndexDoc | null {
  if (m.deleted_at || m.kind !== 'text' || !m.body.trim()) return null
  return {
    org_id: orgId, workspace_id: null, entity_type: 'chat', entity_id: m.id,
    title: truncateForIndex(m.body, 80),
    body: truncateForIndex(m.body, MAX_BODY_CHARS),
    project_id: null, channel_id: m.channel_id, author_id: m.author_id,
    url: searchUrl.chat(m.channel_id, m.id),
    source_updated_at: m.edited_at && m.edited_at > m.created_at ? m.edited_at : m.created_at,
  }
}

// ── Embedding plan (pure) ───────────────────────────────────────────────────

export interface PendingRow { id: string; org_id: string; title: string; body: string; source_updated_at: string }

/**
 * Which pending rows get a vector and which are only marked as done:
 *   • rows with almost no text ("ok") are skipped (searchable by text only),
 *   • rows of organisations whose plan has no AI are skipped (no spend without the feature),
 * the rest are grouped by organisation so each call is metered against the right budget.
 */
export function planEmbedding(
  rows: PendingRow[],
  orgHasAi: (orgId: string) => boolean,
): { byOrg: Map<string, PendingRow[]>; skip: PendingRow[] } {
  const byOrg = new Map<string, PendingRow[]>()
  const skip: PendingRow[] = []
  for (const r of rows) {
    if (`${r.title}${r.body}`.trim().length < MIN_EMBED_CHARS || !orgHasAi(r.org_id)) {
      skip.push(r)
      continue
    }
    const list = byOrg.get(r.org_id) ?? []
    list.push(r)
    byOrg.set(r.org_id, list)
  }
  return { byOrg, skip }
}

// ── Cursor state ────────────────────────────────────────────────────────────

async function loadCursor(db: Db, stream: string): Promise<Cursor> {
  const { data } = await db.from('search_index_state').select('cursor, cursor_id').eq('stream', stream).maybeSingle()
  return { at: data?.cursor ?? null, id: data?.cursor_id ?? null }
}

async function saveCursor(db: Db, stream: string, cursor: Cursor) {
  await db.from('search_index_state').upsert(
    { stream, cursor: cursor.at, cursor_id: cursor.id, updated_at: new Date().toISOString() },
    { onConflict: 'stream' },
  )
}

// ── Run ─────────────────────────────────────────────────────────────────────

export interface StreamStats { scanned: number; indexed: number; removed: number }

export interface SearchIndexResult {
  status: 'ok' | 'not_ready'
  streams: Record<string, StreamStats>
  embedded: number
  embedSkipped: number
  /** Rows still waiting for a vector after this run. */
  pendingEmbedding: number
  errors: string[]
  /** Why the run stopped early, if it did. */
  stoppedBy: 'time' | 'budget' | null
  durationMs: number
}

export interface RunOptions {
  /** Wall-clock budget for the whole run (ms). */
  budgetMs?: number
  /** Cap on rows embedded in one run. */
  embedLimit?: number
  now?: () => number
}

type OrgOfProject = Map<string, string>

/** project id → org id, through projects → workspaces (two small queries per batch, cached for the run). */
async function orgsOfProjects(db: Db, projectIds: string[], cache: OrgOfProject): Promise<void> {
  const need = Array.from(new Set(projectIds.filter(id => !cache.has(id))))
  for (const ids of chunk(need, IN_CHUNK)) {
    const { data: projects } = await db.from('projects').select('id, workspace_id').in('id', ids)
    const wsIds = Array.from(new Set((projects ?? []).map(p => p.workspace_id)))
    const { data: workspaces } = wsIds.length ? await db.from('workspaces').select('id, org_id').in('id', wsIds) : { data: [] as Array<{ id: string; org_id: string }> }
    const orgOfWs = new Map((workspaces ?? []).map(w => [w.id, w.org_id]))
    for (const p of projects ?? []) {
      const org = orgOfWs.get(p.workspace_id)
      if (org) cache.set(p.id, org)
    }
  }
}

async function orgsOfChannels(db: Db, channelIds: string[], cache: Map<string, string>): Promise<void> {
  const need = Array.from(new Set(channelIds.filter(id => !cache.has(id))))
  for (const ids of chunk(need, IN_CHUNK)) {
    const { data } = await db.from('chat_channels').select('id, org_id').in('id', ids)
    for (const c of data ?? []) cache.set(c.id, c.org_id)
  }
}

async function upsertDocs(db: Db, docs: IndexDoc[], errors: string[]): Promise<number> {
  if (!docs.length) return 0
  // A changed source resets the vector: it is re-embedded with the new text.
  const rows = docs.map(d => ({ ...d, embedding: null, embedded_at: null }))
  let ok = 0
  for (const part of chunk(rows, SYNC_BATCH)) {
    const { error } = await db.from('search_documents').upsert(part, { onConflict: 'entity_type,entity_id' })
    if (!error) { ok += part.length; continue }
    // One bad row (a foreign key racing a delete) must not block the whole stream: retry row by row.
    for (const row of part) {
      const { error: rowErr } = await db.from('search_documents').upsert(row, { onConflict: 'entity_type,entity_id' })
      if (rowErr) errors.push(`upsert ${row.entity_type}:${row.entity_id}: ${rowErr.code ?? rowErr.message}`)
      else ok++
    }
  }
  return ok
}

async function removeDocs(db: Db, type: SearchEntityType, entityIds: string[]): Promise<number> {
  let removed = 0
  for (const ids of chunk(entityIds, IN_CHUNK)) {
    const { data } = await db.from('search_documents').delete().eq('entity_type', type).in('entity_id', ids).select('id')
    removed += data?.length ?? 0
  }
  return removed
}

export interface SyncCtx {
  db: Db
  errors: string[]
  projectOrg: OrgOfProject
  channelOrg: Map<string, string>
  timeLeft: () => boolean
}

/** Sync one stream until it runs dry or the time budget ends. Returns stats; advances the stored cursor only past rows handled. */
export async function syncStream(
  stream: string,
  step: (cursor: Cursor, ctx: SyncCtx) => Promise<{ nextCursor: Cursor; rowCount: number; indexed: number; removed: number }>,
  ctx: SyncCtx,
): Promise<StreamStats> {
  const stats: StreamStats = { scanned: 0, indexed: 0, removed: 0 }
  let cursor = await loadCursor(ctx.db, stream)
  for (let i = 0; i < 25 && ctx.timeLeft(); i++) {
    const r = await step(cursor, ctx)
    stats.scanned += r.rowCount
    stats.indexed += r.indexed
    stats.removed += r.removed
    if (r.rowCount === 0) break
    cursor = r.nextCursor
    await saveCursor(ctx.db, stream, cursor)
    if (r.rowCount < SYNC_BATCH) break
  }
  return stats
}

function applyKeyset<T extends { or: (f: string) => T }>(q: T, column: string, cursor: Cursor): T {
  const f = keysetFilter(column, cursor)
  return f ? q.or(f) : q
}

// ── Streams ─────────────────────────────────────────────────────────────────

async function stepTasks(cursor: Cursor, c: SyncCtx) {
  const q = c.db.from('tasks').select('id, title, description, project_id, reporter_id, status, updated_at').order('updated_at').order('id').limit(SYNC_BATCH)
  const { data, error } = await applyKeyset(q, 'updated_at', cursor)
  if (error) throw error
  const rows = data ?? []
  await orgsOfProjects(c.db, rows.map(r => r.project_id), c.projectOrg)
  const docs: IndexDoc[] = []
  const drop: string[] = []
  for (const r of rows) {
    const org = c.projectOrg.get(r.project_id)
    const doc = org ? taskToDoc(r, org) : null
    if (doc) docs.push(doc)
    else drop.push(r.id)
  }
  const indexed = await upsertDocs(c.db, docs, c.errors)
  const removed = await removeDocs(c.db, 'task', drop)
  return { nextCursor: nextCursor(rows, 'updated_at', cursor), rowCount: rows.length, indexed, removed }
}

async function stepDocuments(cursor: Cursor, c: SyncCtx) {
  const q = c.db.from('documents').select('id, org_id, workspace_id, title, body_md, status, tags, owner_id, created_by, updated_at').order('updated_at').order('id').limit(SYNC_BATCH)
  const { data, error } = await applyKeyset(q, 'updated_at', cursor)
  if (error) throw error
  const rows = data ?? []
  const docs: IndexDoc[] = []
  const drop: string[] = []
  for (const r of rows) {
    const doc = documentToDoc(r)
    if (doc) docs.push(doc)
    else drop.push(r.id)
  }
  const indexed = await upsertDocs(c.db, docs, c.errors)
  const removed = await removeDocs(c.db, 'document', drop)
  return { nextCursor: nextCursor(rows, 'updated_at', cursor), rowCount: rows.length, indexed, removed }
}

async function stepDecisions(cursor: Cursor, c: SyncCtx) {
  const q = c.db.from('decisions').select('id, org_id, title, description, created_by, updated_at').order('updated_at').order('id').limit(SYNC_BATCH)
  const { data, error } = await applyKeyset(q, 'updated_at', cursor)
  if (error) throw error
  const rows = data ?? []
  // The criteria and options are what the decision is ABOUT: cheap to include, valuable to find by.
  const extra = new Map<string, string[]>()
  const ids = rows.map(r => r.id)
  for (const part of chunk(ids, IN_CHUNK)) {
    const [crit, opts] = await Promise.all([
      c.db.from('decision_criteria').select('decision_id, label').in('decision_id', part),
      c.db.from('decision_options').select('decision_id, label, notes').in('decision_id', part),
    ])
    for (const x of crit.data ?? []) extra.set(x.decision_id, [...(extra.get(x.decision_id) ?? []), x.label])
    for (const x of opts.data ?? []) extra.set(x.decision_id, [...(extra.get(x.decision_id) ?? []), x.label, x.notes ?? ''])
  }
  const docs = rows.map(r => decisionToDoc(r, (extra.get(r.id) ?? []).join(' ')))
  const indexed = await upsertDocs(c.db, docs, c.errors)
  return { nextCursor: nextCursor(rows, 'updated_at', cursor), rowCount: rows.length, indexed, removed: 0 }
}

async function stepUpdates(cursor: Cursor, c: SyncCtx) {
  const q = c.db.from('project_updates').select('id, project_id, author_id, content, updated_at').order('updated_at').order('id').limit(SYNC_BATCH)
  const { data, error } = await applyKeyset(q, 'updated_at', cursor)
  if (error) throw error
  const rows = data ?? []
  await orgsOfProjects(c.db, rows.map(r => r.project_id), c.projectOrg)
  const docs = rows.flatMap(r => {
    const org = c.projectOrg.get(r.project_id)
    return org ? [updateToDoc(r, org)] : []
  })
  const indexed = await upsertDocs(c.db, docs, c.errors)
  return { nextCursor: nextCursor(rows, 'updated_at', cursor), rowCount: rows.length, indexed, removed: 0 }
}

const CHAT_COLS = 'id, channel_id, author_id, kind, body, deleted_at, created_at, edited_at'

async function chatDocs(rows: ChatSrc[], c: SyncCtx): Promise<IndexDoc[]> {
  await orgsOfChannels(c.db, rows.map(r => r.channel_id), c.channelOrg)
  return rows.flatMap(r => {
    const org = c.channelOrg.get(r.channel_id)
    const doc = org ? chatToDoc(r, org) : null
    return doc ? [doc] : []
  })
}

async function stepChatNew(cursor: Cursor, c: SyncCtx) {
  const q = c.db.from('chat_messages').select(CHAT_COLS).order('created_at').order('id').limit(SYNC_BATCH)
  const { data, error } = await applyKeyset(q, 'created_at', cursor)
  if (error) throw error
  const rows = (data ?? []) as ChatSrc[]
  const indexed = await upsertDocs(c.db, await chatDocs(rows, c), c.errors)
  return { nextCursor: nextCursor(rows, 'created_at', cursor), rowCount: rows.length, indexed, removed: 0 }
}

/** Edited messages: re-index with the new text (their created_at is behind the "new" cursor). */
async function stepChatEdited(cursor: Cursor, c: SyncCtx) {
  const q = c.db.from('chat_messages').select(CHAT_COLS).not('edited_at', 'is', null).order('edited_at').order('id').limit(SYNC_BATCH)
  const { data, error } = await applyKeyset(q, 'edited_at', cursor)
  if (error) throw error
  const rows = (data ?? []) as ChatSrc[]
  const indexed = await upsertDocs(c.db, await chatDocs(rows, c), c.errors)
  return { nextCursor: nextCursor(rows, 'edited_at', cursor), rowCount: rows.length, indexed, removed: 0 }
}

/** Deleted messages disappear from the index. */
async function stepChatDeleted(cursor: Cursor, c: SyncCtx) {
  const q = c.db.from('chat_messages').select('id, deleted_at').not('deleted_at', 'is', null).order('deleted_at').order('id').limit(SYNC_BATCH)
  const { data, error } = await applyKeyset(q, 'deleted_at', cursor)
  if (error) throw error
  const rows = data ?? []
  const removed = await removeDocs(c.db, 'chat', rows.map(r => r.id))
  return { nextCursor: nextCursor(rows, 'deleted_at', cursor), rowCount: rows.length, indexed: 0, removed }
}

// ── Rolling sweep: sources deleted outright ─────────────────────────────────

const SWEEP_SOURCE: Record<SearchEntityType, 'tasks' | 'documents' | 'decisions' | 'project_updates' | 'chat_messages'> = {
  task: 'tasks', document: 'documents', decision: 'decisions', update: 'project_updates', chat: 'chat_messages',
}

/**
 * A cursor scans a source's UPDATES, so a row deleted outright is invisible to it. Each run
 * checks the next window of indexed rows (ordered by entity_id, wrapping around) and deletes
 * those whose source row no longer exists. Cheap, bounded, and eventually complete.
 */
async function sweepType(db: Db, type: SearchEntityType): Promise<number> {
  const stream = `sweep:${type}`
  const state = await loadCursor(db, stream)
  let q = db.from('search_documents').select('entity_id').eq('entity_type', type).order('entity_id').limit(SWEEP_BATCH)
  if (state.id) q = q.gt('entity_id', state.id)
  const { data, error } = await q
  if (error) throw error
  const ids = (data ?? []).map(r => r.entity_id)
  let removed = 0
  const missing: string[] = []
  for (const part of chunk(ids, IN_CHUNK)) {
    const { data: found, error: e } = await db.from(SWEEP_SOURCE[type]).select('id').in('id', part)
    if (e) throw e
    const alive = new Set((found ?? []).map(r => r.id))
    for (const id of part) if (!alive.has(id)) missing.push(id)
  }
  if (missing.length) removed = await removeDocs(db, type, missing)
  // Wrap to the start once the end is reached.
  await saveCursor(db, stream, { at: null, id: ids.length < SWEEP_BATCH ? null : ids[ids.length - 1] })
  return removed
}

// ── Embedding pass ──────────────────────────────────────────────────────────

async function embedPending(
  db: Db,
  limit: number,
  timeLeft: () => boolean,
  errors: string[],
): Promise<{ embedded: number; skipped: number; stoppedBy: 'time' | 'budget' | null }> {
  const { data, error } = await db
    .from('search_documents')
    .select('id, org_id, title, body, source_updated_at')
    .is('embedded_at', null)
    .order('source_updated_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  const rows = (data ?? []) as PendingRow[]
  if (!rows.length) return { embedded: 0, skipped: 0, stoppedBy: null }

  const orgIds = Array.from(new Set(rows.map(r => r.org_id)))
  const { data: orgs } = await db.from('organizations').select('id, plan').in('id', orgIds)
  const hasAi = new Map((orgs ?? []).map(o => [o.id, limitsFor(o.plan).ai]))
  const { byOrg, skip } = planEmbedding(rows, orgId => hasAi.get(orgId) ?? false)

  const now = new Date().toISOString()
  // Conditional on the row being unchanged since we read it: a concurrent edit keeps its newer pending state.
  const markDone = (row: PendingRow, vector: number[] | null) =>
    db.from('search_documents')
      .update({ embedding: vector ? toPgVector(vector) : null, embedded_at: now })
      .eq('id', row.id)
      .eq('source_updated_at', row.source_updated_at)
      .is('embedded_at', null)

  const runLimited = async (items: Array<() => PromiseLike<unknown>>, concurrency = 10) => {
    for (const part of chunk(items, concurrency)) await Promise.all(part.map(fn => fn()))
  }

  await runLimited(skip.map(r => () => markDone(r, null)))

  let embedded = 0
  let stoppedBy: 'time' | 'budget' | null = null
  outer: for (const [orgId, orgRows] of byOrg) {
    for (const batch of chunk(orgRows, MAX_EMBED_BATCH)) {
      if (!timeLeft()) { stoppedBy = 'time'; break outer }
      try {
        const vectors = await embedTexts(batch.map(r => formatDocumentForEmbedding(r.title, r.body)), { orgId, feature: 'search.index' })
        await runLimited(batch.map((r, i) => () => markDone(r, vectors[i])))
        embedded += batch.length
      } catch (err) {
        if (err instanceof AiBudgetError) { stoppedBy = 'budget'; break outer }
        // Anything else (no key, timeout, 5xx): leave the rows pending, report it, and stop hammering this run.
        errors.push(`embed ${orgId}: ${err instanceof Error ? err.name : 'error'}`)
        break outer
      }
    }
  }
  return { embedded, skipped: skip.length, stoppedBy }
}

/** One full indexing run: sync every source, reconcile deletions, embed what is pending. */
export async function runSearchIndex(db: Db, options: RunOptions = {}): Promise<SearchIndexResult> {
  const now = options.now ?? Date.now
  const started = now()
  const budgetMs = options.budgetMs ?? 25_000
  const timeLeft = () => now() - started < budgetMs
  const errors: string[] = []
  const done = (r: Omit<SearchIndexResult, 'durationMs'>): SearchIndexResult => ({ ...r, durationMs: now() - started })

  // Ready? Before the SQL is applied the state table does not exist: answer, don't fail.
  const probe = await db.from('search_index_state').select('stream').limit(1)
  if (probe.error) {
    if (isMissingRelation(probe.error)) return done({ status: 'not_ready', streams: {}, embedded: 0, embedSkipped: 0, pendingEmbedding: 0, errors, stoppedBy: null })
    throw probe.error
  }

  const ctx: SyncCtx = { db, errors, projectOrg: new Map(), channelOrg: new Map(), timeLeft }
  const streams: Record<string, StreamStats> = {}
  const order: Array<[string, Parameters<typeof syncStream>[1]]> = [
    ['task', stepTasks], ['document', stepDocuments], ['decision', stepDecisions], ['update', stepUpdates],
    ['chat', stepChatNew], ['chat_edit', stepChatEdited], ['chat_del', stepChatDeleted],
  ]
  let stoppedBy: 'time' | 'budget' | null = null
  for (const [name, step] of order) {
    if (!timeLeft()) { stoppedBy = 'time'; break }
    try {
      streams[name] = await syncStream(name, step, ctx)
    } catch (err) {
      // One failing source must not stop the others.
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  for (const type of ['task', 'document', 'decision', 'update', 'chat'] as SearchEntityType[]) {
    if (!timeLeft()) { stoppedBy ??= 'time'; break }
    try {
      const removed = await sweepType(db, type)
      if (removed) streams[`sweep:${type}`] = { scanned: 0, indexed: 0, removed }
    } catch (err) {
      errors.push(`sweep ${type}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  let embedded = 0
  let embedSkipped = 0
  if (timeLeft()) {
    try {
      const e = await embedPending(db, options.embedLimit ?? 300, timeLeft, errors)
      embedded = e.embedded
      embedSkipped = e.skipped
      stoppedBy ??= e.stoppedBy
    } catch (err) {
      errors.push(`embedding: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    stoppedBy ??= 'time'
  }

  const { count } = await db.from('search_documents').select('id', { count: 'exact', head: true }).is('embedded_at', null)
  return done({ status: 'ok', streams, embedded, embedSkipped, pendingEmbedding: count ?? 0, errors, stoppedBy })
}
