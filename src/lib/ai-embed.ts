import { embedBatch } from '@/lib/gemini'
import { truncateForIndex } from '@/lib/search-utils'

/**
 * Embeddings for the hybrid search — `gemini-embedding-2`, 768 dimensions.
 *
 * Facts from Google's docs (ai.google.dev/gemini-api/docs/embeddings, read 2026-10-24):
 *   • `gemini-embedding-2` does NOT accept `taskType`. The intent goes in the TEXT:
 *       query    →  "task: search result | query: {text}"
 *       document →  "title: {title or none} | text: {text}"
 *   • `outputDimensionality` supports 128–3072 (recommended 768 / 1536 / 3072) and the model
 *     re-normalises truncated vectors itself. We still re-normalise (idempotent) so a
 *     misbehaving response can never poison the cosine distances.
 *   • To get ONE vector PER text, each text must be its own Content (several parts in one
 *     Content are fused into a single embedding) — the SDK backend does that wrapping.
 *   • The vector space is incompatible with older embedding models, so the dimension is
 *     chosen ONCE here: changing it later means re-embedding everything.
 */

export const EMBED_DIMS = 768
export const EMBED_MODEL_DEFAULT = 'gemini-embedding-2'
/** Texts per request. The docs state no maximum; 50 keeps requests small and failures cheap. */
export const MAX_EMBED_BATCH = 50
/** Characters of a document body that reach the embedder (the model itself accepts up to 8,192 tokens). */
export const MAX_DOC_CHARS = 6000
export const MAX_QUERY_CHARS = 500

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{2,63}$/i

/** Embedding model id; GEMINI_MODEL_EMBED overrides it (validated like the other tiers). */
export function embedModel(env: Record<string, string | undefined> = process.env): string {
  const override = env.GEMINI_MODEL_EMBED?.trim()
  return override && MODEL_ID.test(override) ? override : EMBED_MODEL_DEFAULT
}

export function formatQueryForEmbedding(query: string): string {
  return `task: search result | query: ${truncateForIndex(query, MAX_QUERY_CHARS)}`
}

export function formatDocumentForEmbedding(title: string, body: string): string {
  const t = truncateForIndex(title, 200) || 'none'
  return `title: ${t} | text: ${truncateForIndex(body, MAX_DOC_CHARS)}`
}

/** Unit-length copy of `v` (zero vectors are returned unchanged). */
export function l2Normalize(v: number[]): number[] {
  let sum = 0
  for (const x of v) sum += x * x
  const norm = Math.sqrt(sum)
  return norm === 0 ? v.slice() : v.map(x => x / norm)
}

/**
 * Matryoshka truncation: keep the first `dims` values and re-normalise. A vector that is
 * already `dims` long is only re-normalised; a shorter one is an error (it would corrupt the index).
 */
export function fitDimensions(v: number[], dims: number = EMBED_DIMS): number[] {
  if (v.length < dims) throw new Error(`Embedding de ${v.length} dimensiones; se esperaban ${dims}.`)
  return l2Normalize(v.length === dims ? v : v.slice(0, dims))
}

/** pgvector text literal: `[0.1,0.2,…]` with 6 decimals (enough for cosine distance, 40 % smaller). */
export function toPgVector(v: number[]): string {
  return `[${v.map(x => (Math.round(x * 1e6) / 1e6).toString()).join(',')}]`
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be ≥ 1')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface EmbedOptions {
  /** Cost attribution (the metering sink needs an organisation to record the call). */
  orgId?: string
  feature?: string
  timeoutMs?: number
  model?: string
}

/**
 * Embed already-formatted texts (see formatQueryForEmbedding / formatDocumentForEmbedding).
 * Batches of MAX_EMBED_BATCH, one metered call each (budget guard included), vectors
 * returned in input order, every one 768-d and unit length.
 */
export async function embedTexts(texts: string[], options: EmbedOptions = {}): Promise<number[][]> {
  const model = options.model ?? embedModel()
  const out: number[][] = []
  for (const batch of chunk(texts, MAX_EMBED_BATCH)) {
    const vectors = await embedBatch(batch, {
      model,
      dims: EMBED_DIMS,
      feature: options.feature ?? 'search.embed',
      orgId: options.orgId,
      timeoutMs: options.timeoutMs,
    })
    for (const v of vectors) out.push(fitDimensions(v))
  }
  return out
}

/** One query vector for a search box entry. */
export async function embedQuery(query: string, options: EmbedOptions = {}): Promise<number[]> {
  const [v] = await embedTexts([formatQueryForEmbedding(query)], { feature: 'search.query', ...options })
  return v
}
