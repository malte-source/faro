import { GoogleGenAI } from '@google/genai'
import { modelFor, FLASH_MODEL, type ModelTier } from '@/lib/ai-config'
import { estimateCostUsd } from '@/lib/ai-pricing'
import { getAiContext } from '@/lib/ai-context'

/**
 * Gemini client wrapper — single place that knows about the underlying SDK,
 * the model ids (see ai-config.ts) and the call policy:
 *
 *   • hard timeout per call (25 s for text, 90 s when audio/video/images are attached)
 *   • ONE retry with jitter on 429 / 5xx / network errors — never on 4xx
 *     validation errors, never after a timeout (it already waited its budget)
 *   • one structured JSON log line per call (feature, model, tokens, latency,
 *     outcome). No prompt text, no PII — only counts and labels.
 *   • every call is METERED (token counts → estimated USD) through an injectable
 *     sink, and CHECKED against the organisation's monthly budget through an
 *     injectable guard — both registered by src/server/ai-usage.ts, so this file
 *     stays free of database imports and trivially testable.
 *
 * Migrated from the deprecated `@google/generative-ai` SDK to `@google/genai`.
 */

export { FLASH_MODEL }

// ── SDK client + test seam ──────────────────────────────────────────────────

let _client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_GEMINI_API_KEY not set')
    _client = new GoogleGenAI({ apiKey })
  }
  return _client
}

export interface TokenUsage {
  inputTokens?: number
  /** Output tokens INCLUDING thinking tokens (they are billed as output). */
  outputTokens?: number
  totalTokens?: number
  /** Part of `inputTokens` that was audio (billed at the audio rate on models that have one). */
  audioInputTokens?: number
}

interface BackendResult {
  text: string
  usage?: TokenUsage
}

type InlinePart = { inlineData: { data: string; mimeType: string } }
export type ContentParts = string | Array<string | InlinePart>

interface GenerateArgs {
  model: string
  contents: ContentParts
  config: Record<string, unknown>
  signal: AbortSignal
  timeoutMs: number
}

interface ChatArgs {
  model: string
  history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
  message: string
  config?: Record<string, unknown>
  signal: AbortSignal
  timeoutMs: number
}

/** What the wrapper needs from "a Gemini": swap it in tests, no network involved. */
interface EmbedArgs {
  model: string
  texts: string[]
  dims: number
  signal: AbortSignal
  timeoutMs: number
}

export interface GeminiBackend {
  generate(args: GenerateArgs): Promise<BackendResult>
  chat(args: ChatArgs): Promise<BackendResult>
  /** One vector per text, in order. Optional so test doubles that only fake text calls still type-check. */
  embed?(args: EmbedArgs): Promise<{ vectors: number[][]; usage?: TokenUsage }>
}

function usageOf(m?: {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
  totalTokenCount?: number
  promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>
}): TokenUsage | undefined {
  if (!m) return undefined
  const audio = (m.promptTokensDetails ?? [])
    .filter(d => String(d.modality ?? '').toUpperCase() === 'AUDIO')
    .reduce((sum, d) => sum + (d.tokenCount ?? 0), 0)
  const hasOutput = m.candidatesTokenCount !== undefined || m.thoughtsTokenCount !== undefined
  return {
    inputTokens: m.promptTokenCount,
    outputTokens: hasOutput ? (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0) : undefined,
    totalTokens: m.totalTokenCount,
    audioInputTokens: audio > 0 ? audio : undefined,
  }
}

const sdkBackend: GeminiBackend = {
  async generate({ model, contents, config, signal, timeoutMs }) {
    const response = await getClient().models.generateContent({
      model,
      contents,
      config: {
        ...config,
        abortSignal: signal,
        // One attempt at the SDK level: the retry policy below is the only one.
        httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } },
      },
    })
    return { text: response.text ?? '', usage: usageOf(response.usageMetadata) }
  },
  async chat({ model, history, message, config, signal, timeoutMs }) {
    const chat = getClient().chats.create({ model, config, history })
    const response = await chat.sendMessage({
      message,
      config: { abortSignal: signal, httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } } },
    })
    return { text: response.text ?? '', usage: usageOf(response.usageMetadata) }
  },
  async embed({ model, texts, dims, signal, timeoutMs }) {
    // Each text is its OWN Content: several parts in one Content would be fused into ONE embedding.
    // No `taskType`: gemini-embedding-2 rejects it (the task goes in the text, see ai-embed.ts).
    const response = await getClient().models.embedContent({
      model,
      contents: texts.map(text => ({ role: 'user', parts: [{ text }] })),
      config: {
        outputDimensionality: dims,
        abortSignal: signal,
        httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } },
      },
    })
    const vectors = (response.embeddings ?? []).map(e => e.values ?? [])
    // The embeddings API returns no token counts: estimate from characters (Spanish ≈ 3.5 chars/token,
    // rounded up so the budget never under-counts).
    const chars = texts.reduce((n, t) => n + t.length, 0)
    return { vectors, usage: { inputTokens: Math.ceil(chars / 3.5), outputTokens: 0 } }
  },
}

let backend: GeminiBackend = sdkBackend

// ── Metering + budget hooks (registered by src/server/ai-usage.ts) ───────────

/** One metered call, as handed to the usage sink. */
export interface AiUsageRecord {
  orgId: string | null
  userId: string | null
  feature: string
  model: string
  tier: ModelTier
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  ok: boolean
}

type UsageSink = (record: AiUsageRecord) => void
type BudgetGuard = (who: { orgId: string | null; userId: string | null; feature: string }) => Promise<void>

let usageSink: UsageSink | null = null
let budgetGuard: BudgetGuard | null = null

/** Register where metered calls go (the server registers a Supabase writer; tests pass a spy). */
export function setAiUsageSink(fn: UsageSink | null) {
  usageSink = fn
}

/** Register the pre-call budget check. It must THROW (an `AiBudgetError`) to block a call. */
export function setAiBudgetGuard(fn: BudgetGuard | null) {
  budgetGuard = fn
}

/** Tests only: replace the Gemini backend (pass `null` to restore the real SDK). */
export function setGeminiBackendForTests(next: GeminiBackend | null) {
  backend = next ?? sdkBackend
}

// ── Call policy: timeout + one retry + logging ──────────────────────────────

export class GeminiTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Gemini no respondió en ${Math.round(timeoutMs / 1000)} s.`)
    this.name = 'GeminiTimeoutError'
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
const NETWORK_CODES = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_(?:SOCKET|CONNECT|HEADERS_TIMEOUT|BODY_TIMEOUT)/i

/** Transient failures worth ONE more attempt. A timeout and any other 4xx are final. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof GeminiTimeoutError) return false
  if (typeof err !== 'object' || err === null) return false
  const e = err as { status?: unknown; name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown } }
  if (typeof e.status === 'number') return RETRYABLE_STATUS.has(e.status)
  if (e.name === 'AbortError') return false
  const code = String(e.code ?? e.cause?.code ?? '')
  if (NETWORK_CODES.test(code)) return true
  return /fetch failed|network|socket hang up|ECONNRESET/i.test(String(e.message ?? ''))
}

export interface PolicyDeps {
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  now?: () => number
}

export const DEFAULT_TEXT_TIMEOUT_MS = 25_000
/** Audio, video and image extraction legitimately takes longer than text. */
export const DEFAULT_MEDIA_TIMEOUT_MS = 90_000
const RETRY_BASE_MS = 500

function defaultTimeoutMs(parts?: ContentParts): number {
  const hasMedia = Array.isArray(parts) && parts.some(p => typeof p !== 'string' && 'inlineData' in p)
  return hasMedia ? DEFAULT_MEDIA_TIMEOUT_MS : DEFAULT_TEXT_TIMEOUT_MS
}

async function attemptWithTimeout<T>(op: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort()
      reject(new GeminiTimeoutError(timeoutMs))
    }, timeoutMs)
  })
  try {
    return await Promise.race([op(ctrl.signal), deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Run `op` with a hard per-attempt timeout and at most `maxRetries` retries of transient errors. */
export async function runWithPolicy<T>(
  op: (signal: AbortSignal) => Promise<T>,
  opts: { timeoutMs: number; maxRetries?: number; deps?: PolicyDeps },
): Promise<{ result: T; attempts: number }> {
  const sleep = opts.deps?.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const random = opts.deps?.random ?? Math.random
  const maxRetries = opts.maxRetries ?? 1
  let attempts = 0
  for (;;) {
    attempts++
    try {
      return { result: await attemptWithTimeout(op, opts.timeoutMs), attempts }
    } catch (err) {
      if (attempts > maxRetries || !isRetryable(err)) throw Object.assign(err instanceof Error ? err : new Error(String(err)), { attempts })
      await sleep(RETRY_BASE_MS + Math.floor(random() * RETRY_BASE_MS))
    }
  }
}

export interface CallOptions {
  /** Label for the log line and cost tracking, e.g. `tasks.parseAndCreate`. */
  feature?: string
  /** Organisation the call is made for (cost per empresa/grupo). */
  orgId?: string
  /** Model tier (see ai-config.ts). Defaults to `flash`. */
  tier?: ModelTier
  /** Per-attempt timeout override in ms. */
  timeoutMs?: number
}

function logCall(entry: {
  feature?: string; orgId?: string; model: string; latencyMs: number; attempts: number; ok: boolean
  usage?: TokenUsage; errorName?: string; errorStatus?: number
}) {
  // One JSON line → Cloud Logging indexes it. Failures are WARNING so they can be alerted on;
  // nothing from the prompt or the response is ever logged.
  console.log(JSON.stringify({
    severity: entry.ok ? 'INFO' : 'WARNING',
    event: 'ai.call',
    feature: entry.feature ?? 'unknown',
    model: entry.model,
    orgId: entry.orgId,
    ok: entry.ok,
    attempts: entry.attempts,
    latencyMs: entry.latencyMs,
    inputTokens: entry.usage?.inputTokens,
    outputTokens: entry.usage?.outputTokens,
    totalTokens: entry.usage?.totalTokens,
    errorName: entry.errorName,
    errorStatus: entry.errorStatus,
  }))
}

async function instrumentedRaw<T extends { usage?: TokenUsage }>(
  options: CallOptions,
  model: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  deps?: PolicyDeps,
): Promise<T> {
  const now = deps?.now ?? Date.now
  // Who/what this call is for: explicit options win, then the per-request context (set by
  // protectedProcedure / the cron), so call sites rarely need to pass anything.
  const ctx = getAiContext()
  const orgId = options.orgId ?? ctx?.orgId ?? null
  const userId = ctx?.userId ?? null
  const feature = options.feature ?? ctx?.path ?? 'unknown'
  const tier: ModelTier = options.tier ?? 'flash'

  // Over budget → refuse BEFORE spending anything. The guard fails open on its own errors.
  if (budgetGuard) await budgetGuard({ orgId, userId, feature })

  const started = now()
  const record = (ok: boolean, usage: TokenUsage | undefined) => {
    if (!usageSink || !orgId) return
    try {
      const inputTokens = usage?.inputTokens ?? 0
      const outputTokens = usage?.outputTokens ?? 0
      usageSink({
        orgId, userId, feature, model, tier, inputTokens, outputTokens, ok,
        costUsd: ok ? estimateCostUsd({ model, inputTokens, outputTokens, audioInputTokens: usage?.audioInputTokens }) : 0,
        latencyMs: now() - started,
      })
    } catch {
      /* metering is observability: it must never break the call */
    }
  }

  try {
    const { result, attempts } = await runWithPolicy(run, { timeoutMs, deps })
    logCall({ feature, orgId: orgId ?? undefined, model, latencyMs: now() - started, attempts, ok: true, usage: result.usage })
    record(true, result.usage)
    return result
  } catch (err) {
    const e = err as { name?: string; status?: number; attempts?: number }
    logCall({
      feature, orgId: orgId ?? undefined, model, latencyMs: now() - started,
      attempts: e.attempts ?? 1, ok: false, errorName: e.name ?? 'Error', errorStatus: typeof e.status === 'number' ? e.status : undefined,
    })
    record(false, undefined)
    throw err
  }
}

async function instrumented(
  options: CallOptions,
  model: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<BackendResult>,
  deps?: PolicyDeps,
): Promise<string> {
  return (await instrumentedRaw(options, model, timeoutMs, run, deps)).text
}

// ── Public API ──────────────────────────────────────────────────────────────

export const DEFAULT_EMBED_TIMEOUT_MS = 30_000

export interface EmbedBatchOptions extends CallOptions {
  /** Embedding model id (see ai-embed.ts). */
  model: string
  /** Output dimensionality (Matryoshka truncation, done by the model). */
  dims: number
}

/**
 * Embed a batch of texts: one vector per text, in input order. Same call policy as every
 * other Gemini call — budget guard first, hard timeout, one retry on transient errors,
 * a log line and a metered usage row. Use ai-embed.ts (formatting, batching, normalising)
 * instead of calling this directly.
 */
export async function embedBatch(texts: string[], options: EmbedBatchOptions): Promise<number[][]> {
  if (!texts.length) return []
  const embed = backend.embed
  if (!embed) throw new Error('El backend de Gemini no soporta embeddings.')
  const timeoutMs = options.timeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS
  const { vectors } = await instrumentedRaw(
    { ...options, tier: options.tier ?? 'lite' },
    options.model,
    timeoutMs,
    signal => embed.call(backend, { model: options.model, texts, dims: options.dims, signal, timeoutMs }),
  )
  if (vectors.length !== texts.length) {
    throw new Error(`Gemini devolvió ${vectors.length} embeddings para ${texts.length} textos.`)
  }
  return vectors
}

/** Strip a ```json ... ``` fence some responses wrap structured output in. */
export function stripJsonFence(text: string): string {
  return text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
}

interface GenerateOptions extends CallOptions {
  /** Gemini Schema for structured output (sets responseMimeType to json automatically). */
  responseSchema?: object
  /** Standard JSON Schema for structured output (alternative to responseSchema; also sets the json mime type). */
  responseJsonSchema?: object
  systemInstruction?: string
  temperature?: number
}

/**
 * One-shot content generation. `parts` accepts a plain string prompt, or an
 * array mixing strings and inline media parts (for audio/image inputs) —
 * mirrors the shape multimodal call sites (parseAudioAndCreate,
 * parseImageAndCreate) already build.
 */
export async function generateFlash(parts: ContentParts, options: GenerateOptions = {}): Promise<string> {
  const model = modelFor(options.tier ?? 'flash')
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs(parts)
  const config: Record<string, unknown> = {
    ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.responseSchema ? { responseMimeType: 'application/json', responseSchema: options.responseSchema } : {}),
    ...(options.responseJsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: options.responseJsonSchema } : {}),
  }
  return instrumented(options, model, timeoutMs, signal => backend.generate({ model, contents: parts, config, signal, timeoutMs }))
}

interface ChatTurn {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Multi-turn chat. `history` uses the app's own {role, content} shape
 * (assistant, not model) — translated to the SDK's {role, parts} here so
 * call sites don't need to know the SDK's turn format.
 */
export async function sendChatMessage(
  history: ChatTurn[],
  message: string,
  systemInstruction?: string,
  options: CallOptions = {},
): Promise<string> {
  const model = modelFor(options.tier ?? 'flash')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TEXT_TIMEOUT_MS
  const sdkHistory = history.map(m => ({
    role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
    parts: [{ text: m.content }],
  }))
  return instrumented(options, model, timeoutMs, signal =>
    backend.chat({
      model,
      history: sdkHistory,
      message,
      config: systemInstruction ? { systemInstruction } : undefined,
      signal,
      timeoutMs,
    }),
  )
}
