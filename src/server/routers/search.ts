import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { tryConsume } from '@/lib/rate-limit'
import { limitsFor } from '@/lib/plan-limits'
import { embedQuery, toPgVector } from '@/lib/ai-embed'
import { AiBudgetError } from '@/lib/ai-budget'
import {
  SEARCH_TYPES,
  escapeLike,
  foldText,
  makeSnippet,
  queryTerms,
  searchUrl,
  truncateForIndex,
  type SearchEntityType,
  type SnippetPart,
} from '@/lib/search-utils'
import { loadSearchScope, type SearchScope } from '@/server/search-scope'
import type { EmpresaRow } from '@/server/multiempresa'

// ── Query embeddings: tiny per-instance cache so retyping / pagination never pays twice ──

const EMBED_TTL_MS = 10 * 60_000
const EMBED_CACHE_MAX = 200
const embedCache = new Map<string, { vector: string; at: number }>()

async function cachedQueryEmbedding(orgId: string, q: string): Promise<string> {
  const key = `${orgId}:${foldText(q)}`
  const hit = embedCache.get(key)
  if (hit && Date.now() - hit.at < EMBED_TTL_MS) return hit.vector
  const vector = toPgVector(await embedQuery(q, { orgId, feature: 'search.query' }))
  if (embedCache.size >= EMBED_CACHE_MAX) embedCache.delete(embedCache.keys().next().value as string)
  embedCache.set(key, { vector, at: Date.now() })
  return vector
}

// ── Result shape ────────────────────────────────────────────────────────────

interface RawHit {
  entity_type: SearchEntityType
  entity_id: string
  title: string
  body: string
  project_id: string | null
  channel_id: string | null
  workspace_id: string | null
  author_id: string | null
  url: string
  source_updated_at: string
  score: number
}

export interface SearchHit {
  type: SearchEntityType
  id: string
  title: string
  snippet: SnippetPart[]
  url: string
  empresa: { id: string; name: string; color: string } | null
  projectName: string | null
  channelName: string | null
  authorName: string | null
  when: string
  score: number
}

type SearchCtx = Parameters<typeof loadSearchScope>[0] & {
  session: { user: { email?: string | null } }
}

/** Names the UI needs (project, empresa, channel, author) in four small queries for at most 30 hits. */
async function shapeHits(ctx: SearchCtx, rows: RawHit[], empresas: EmpresaRow[], terms: string[]): Promise<SearchHit[]> {
  if (!rows.length) return []
  const uniq = (xs: Array<string | null>) => Array.from(new Set(xs.filter((x): x is string => !!x)))
  const projectIds = uniq(rows.map(r => r.project_id))
  const channelIds = uniq(rows.map(r => r.channel_id))
  const authorIds = uniq(rows.filter(r => r.entity_type === 'chat').map(r => r.author_id))

  const [projects, channels, authors] = await Promise.all([
    projectIds.length ? ctx.supabase.from('projects').select('id, name, workspace_id').in('id', projectIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string; workspace_id: string }> }),
    channelIds.length ? ctx.supabase.from('chat_channels').select('id, name, kind').in('id', channelIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string; kind: string }> }),
    authorIds.length ? ctx.supabase.from('users').select('id, name').in('id', authorIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ])
  const projectById = new Map((projects.data ?? []).map(p => [p.id, p]))
  const channelById = new Map((channels.data ?? []).map(c => [c.id, c]))
  const authorById = new Map((authors.data ?? []).map(a => [a.id, a.name]))
  const empresaById = new Map(empresas.map(e => [e.id, e]))

  return rows.map(r => {
    const project = r.project_id ? projectById.get(r.project_id) : undefined
    const channel = r.channel_id ? channelById.get(r.channel_id) : undefined
    const wsId = r.workspace_id ?? project?.workspace_id ?? null
    const empresa = wsId ? empresaById.get(wsId) : undefined
    const channelName = channel ? (channel.kind === 'dm' ? 'Mensaje directo' : channel.name) : null
    const authorName = r.author_id ? (authorById.get(r.author_id) ?? null) : null
    return {
      type: r.entity_type,
      id: r.entity_id,
      title: r.entity_type === 'chat' ? `${authorName ?? 'Alguien'}${channelName ? ` en ${channelName}` : ''}` : r.title,
      snippet: makeSnippet(r.entity_type === 'chat' || r.body ? r.body : r.title, terms),
      url: r.url,
      empresa: empresa ? { id: empresa.id, name: empresa.name, color: empresa.color } : null,
      projectName: project?.name ?? null,
      channelName,
      authorName,
      when: r.source_updated_at,
      score: r.score,
    }
  })
}

// ── Basic mode: title/body ILIKE over the live tables (index not applied yet, or the RPC errored) ──

async function basicSearch(
  ctx: SearchCtx,
  scope: SearchScope,
  q: string,
  types: SearchEntityType[],
  limit: number,
): Promise<RawHit[]> {
  const org = ctx.activeOrg
  if (!org) return []
  const like = `%${escapeLike(q.trim())}%`
  const per = Math.max(4, Math.ceil(limit / 2))
  const want = (t: SearchEntityType) => types.includes(t)
  const out: RawHit[] = []

  const jobs: Array<PromiseLike<void>> = []
  if (want('task') && scope.projectIds.length) {
    jobs.push(ctx.supabase.from('tasks').select('id, title, description, project_id, reporter_id, updated_at')
      .in('project_id', scope.projectIds).neq('status', 'canceled').ilike('title', like).order('updated_at', { ascending: false }).limit(per)
      .then(({ data }) => { for (const t of data ?? []) out.push({ entity_type: 'task', entity_id: t.id, title: t.title, body: truncateForIndex(t.description ?? '', 2000), project_id: t.project_id, channel_id: null, workspace_id: null, author_id: t.reporter_id, url: searchUrl.task(t.project_id, t.id), source_updated_at: t.updated_at, score: 0 }) }))
  }
  if (want('document')) {
    let dq = ctx.supabase.from('documents').select('id, title, body_md, workspace_id, owner_id, updated_at').eq('org_id', org.id).neq('status', 'obsoleto').ilike('title', like).order('updated_at', { ascending: false }).limit(per)
    dq = scope.workspaceIds.length ? dq.or(`workspace_id.is.null,workspace_id.in.(${scope.workspaceIds.join(',')})`) : dq.is('workspace_id', null)
    jobs.push(dq.then(({ data }) => { for (const d of data ?? []) out.push({ entity_type: 'document', entity_id: d.id, title: d.title, body: truncateForIndex(d.body_md, 2000), project_id: null, channel_id: null, workspace_id: d.workspace_id, author_id: d.owner_id, url: searchUrl.document(d.id), source_updated_at: d.updated_at, score: 0 }) }))
  }
  if (want('decision')) {
    jobs.push(ctx.supabase.from('decisions').select('id, title, description, created_by, updated_at').eq('org_id', org.id).ilike('title', like).order('updated_at', { ascending: false }).limit(per)
      .then(({ data }) => { for (const d of data ?? []) out.push({ entity_type: 'decision', entity_id: d.id, title: d.title, body: d.description ?? '', project_id: null, channel_id: null, workspace_id: null, author_id: d.created_by, url: searchUrl.decision(d.id), source_updated_at: d.updated_at, score: 0 }) }))
  }
  if (want('update') && scope.projectIds.length) {
    jobs.push(ctx.supabase.from('project_updates').select('id, project_id, author_id, content, updated_at').in('project_id', scope.projectIds).ilike('content', like).order('updated_at', { ascending: false }).limit(per)
      .then(({ data }) => { for (const u of data ?? []) out.push({ entity_type: 'update', entity_id: u.id, title: truncateForIndex(u.content, 80), body: u.content, project_id: u.project_id, channel_id: null, workspace_id: null, author_id: u.author_id, url: searchUrl.update(u.project_id), source_updated_at: u.updated_at, score: 0 }) }))
  }
  if (want('chat') && scope.channelIds.length) {
    jobs.push(ctx.supabase.from('chat_messages').select('id, channel_id, author_id, body, created_at').in('channel_id', scope.channelIds).eq('kind', 'text').is('deleted_at', null).ilike('body', like).order('created_at', { ascending: false }).limit(per)
      .then(({ data }) => { for (const m of data ?? []) out.push({ entity_type: 'chat', entity_id: m.id, title: truncateForIndex(m.body, 80), body: m.body, project_id: null, channel_id: m.channel_id, workspace_id: null, author_id: m.author_id, url: searchUrl.chat(m.channel_id, m.id), source_updated_at: m.created_at, score: 0 }) }))
  }
  await Promise.all(jobs)
  return out.sort((a, b) => b.source_updated_at.localeCompare(a.source_updated_at)).slice(0, limit)
}

let warnedRpc = false

export const searchRouter = createTRPCRouter({
  /** Quick search used by the command palette: projects + tasks by title (unchanged). */
  global: protectedProcedure
    .input(z.string().min(1).max(100))
    .query(async ({ ctx, input }) => {
      // `ctx.projectIds` is already visibility-filtered (workspace/private/
      // personal per the caller's access) — searching against it instead of
      // the raw workspace project list prevents private/personal projects
      // (and their tasks) the caller has no access to from leaking into
      // search results.
      const { projectIds } = ctx
      if (!projectIds.length) return { projects: [], tasks: [] }

      const q = `%${input.trim()}%`

      const [{ data: projects }, { data: tasks }] = await Promise.all([
        ctx.supabase
          .from('projects')
          .select('id, code, name, status, color')
          .in('id', projectIds)
          .or(`name.ilike.${q},code.ilike.${q}`)
          .limit(6),
        ctx.supabase
          .from('tasks')
          .select('id, title, status, priority, project:projects(id, code, name, color)')
          .in('project_id', projectIds)
          .ilike('title', q)
          .neq('status', 'canceled')
          .limit(6),
      ])

      return {
        projects: projects ?? [],
        tasks: (tasks ?? []) as Array<{
          id: string
          title: string
          status: string
          priority: string
          project: { id: string; code: string; name: string; color: string } | null
        }>,
      }
    }),

  /**
   * Hybrid search over tasks, documents, chat, decisions and project updates.
   *
   *   hybrid  full-text + meaning (embeddings) fused with RRF, permission lists applied in SQL
   *   text    full-text only (plan without AI, over budget, embeddings down, or a very short query)
   *   basic   title/body ILIKE over the live tables (the index SQL is not applied yet)
   *
   * It never fails because of AI: every step down is automatic, and `mode` tells the UI which ran.
   */
  hybrid: protectedProcedure
    .input(z.object({
      q: z.string().trim().min(2).max(200),
      types: z.array(z.enum(SEARCH_TYPES as unknown as [SearchEntityType, ...SearchEntityType[]])).max(5).optional(),
      limit: z.number().int().min(1).max(30).default(20),
    }))
    .query(async ({ ctx, input }) => {
      if (!tryConsume(`${ctx.me.id}:search`, { tokensPerMinute: 30, maxBurst: 20 })) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Estás buscando muy rápido. Espera unos segundos.' })
      }
      const org = ctx.activeOrg
      if (!org) return { mode: 'text' as const, hits: [] as SearchHit[] }

      const { scope, empresas } = await loadSearchScope(ctx)
      const types = input.types?.length ? input.types : [...SEARCH_TYPES]
      const terms = queryTerms(input.q)

      // Meaning: best effort. Short queries, plans without AI, an exhausted budget or a model hiccup
      // simply fall through to full text.
      let embedding: string | null = null
      if (input.q.length >= 3 && limitsFor(org.plan).ai) {
        try {
          embedding = await cachedQueryEmbedding(org.id, input.q)
        } catch (err) {
          if (!(err instanceof AiBudgetError)) console.warn('[search] query embedding failed:', err instanceof Error ? err.name : 'error')
        }
      }

      const { data, error } = await ctx.supabase.rpc('search_hybrid', {
        p_org: org.id,
        p_query: input.q,
        p_embedding: embedding,
        p_project_ids: scope.projectIds,
        p_channel_ids: scope.channelIds,
        p_workspace_ids: scope.workspaceIds,
        p_types: types,
        p_limit: input.limit,
      })

      if (!error && data) {
        const hits = await shapeHits(ctx, data as RawHit[], empresas, terms)
        return { mode: (embedding ? 'hybrid' : 'text') as 'hybrid' | 'text', hits }
      }

      // The index is not there (SQL not applied) or the function errored: serve the live tables instead.
      if (!warnedRpc) {
        warnedRpc = true
        console.warn(`[search] search_hybrid unavailable (${error?.code ?? 'error'}) — using basic search`)
      }
      const raw = await basicSearch(ctx, scope, input.q, types, input.limit)
      return { mode: 'basic' as const, hits: await shapeHits(ctx, raw, empresas, terms) }
    }),
})
