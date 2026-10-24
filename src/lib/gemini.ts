import { GoogleGenAI } from '@google/genai'
import { modelFor, FLASH_MODEL, type ModelTier } from '@/lib/ai-config'

/**
 * Gemini client wrapper — single place that knows about the underlying SDK,
 * the model ids (see ai-config.ts) and the call policy:
 *
 *   • hard timeout per call (25 s for text, 90 s when audio/video/images are attached)
 *   • ONE retry with jitter on 429 / 5xx / network errors — never on 4xx
 *     validation errors, never after a timeout (it already waited its budget)
 *   • one structured JSON log line per call (feature, model, tokens, latency,
 *     outcome). No prompt text, no PII — only counts and labels.
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
  outputTokens?: number
  totalTokens?: number
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
export interface GeminiBackend {
  generate(args: GenerateArgs): Promise<BackendResult>
  chat(args: ChatArgs): Promise<BackendResult>
}

function usageOf(m?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }): TokenUsage | undefined {
  if (!m) return undefined
  return { inputTokens: m.promptTokenCount, outputTokens: m.candidatesTokenCount, totalTokens: m.totalTokenCount }
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
}

let backend: GeminiBackend = sdkBackend

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

async function instrumented(
  options: CallOptions,
  model: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<BackendResult>,
  deps?: PolicyDeps,
): Promise<string> {
  const now = deps?.now ?? Date.now
  const started = now()
  try {
    const { result, attempts } = await runWithPolicy(run, { timeoutMs, deps })
    logCall({ feature: options.feature, orgId: options.orgId, model, latencyMs: now() - started, attempts, ok: true, usage: result.usage })
    return result.text
  } catch (err) {
    const e = err as { name?: string; status?: number; attempts?: number }
    logCall({
      feature: options.feature, orgId: options.orgId, model, latencyMs: now() - started,
      attempts: e.attempts ?? 1, ok: false, errorName: e.name ?? 'Error', errorStatus: typeof e.status === 'number' ? e.status : undefined,
    })
    throw err
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

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
