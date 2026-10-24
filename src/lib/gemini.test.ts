import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GeminiTimeoutError,
  DEFAULT_MEDIA_TIMEOUT_MS,
  DEFAULT_TEXT_TIMEOUT_MS,
  generateFlash,
  isRetryable,
  runWithPolicy,
  sendChatMessage,
  setGeminiBackendForTests,
  type GeminiBackend,
} from './gemini'

const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { name: 'ApiError', status })
const noSleep = { sleep: vi.fn(async () => {}), random: () => 0.5 }

describe('isRetryable', () => {
  it('retries 408, 429 and 5xx', () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(isRetryable(apiError(s))).toBe(true)
  })
  it('never retries other 4xx (validation, auth, not found)', () => {
    for (const s of [400, 401, 403, 404, 422]) expect(isRetryable(apiError(s))).toBe(false)
  })
  it('retries network failures', () => {
    expect(isRetryable(new TypeError('fetch failed'))).toBe(true)
    expect(isRetryable(Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } }))).toBe(true)
    expect(isRetryable(new Error('socket hang up'))).toBe(true)
  })
  it('never retries a timeout, an abort or an unknown error', () => {
    expect(isRetryable(new GeminiTimeoutError(1000))).toBe(false)
    expect(isRetryable(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(false)
    expect(isRetryable(new Error('boom'))).toBe(false)
    expect(isRetryable('string error')).toBe(false)
  })
})

describe('runWithPolicy', () => {
  beforeEach(() => { noSleep.sleep.mockClear() })

  it('returns on the first success without sleeping', async () => {
    const op = vi.fn().mockResolvedValue('ok')
    const out = await runWithPolicy(op, { timeoutMs: 1000, deps: noSleep })
    expect(out).toEqual({ result: 'ok', attempts: 1 })
    expect(noSleep.sleep).not.toHaveBeenCalled()
  })

  it('retries ONCE on a 503 and then succeeds, with a jittered pause', async () => {
    const op = vi.fn().mockRejectedValueOnce(apiError(503)).mockResolvedValueOnce('ok')
    const out = await runWithPolicy(op, { timeoutMs: 1000, deps: noSleep })
    expect(out).toEqual({ result: 'ok', attempts: 2 })
    expect(noSleep.sleep).toHaveBeenCalledTimes(1)
    const [ms] = noSleep.sleep.mock.calls[0] as unknown as [number]
    expect(ms).toBeGreaterThanOrEqual(500)
    expect(ms).toBeLessThan(1000)
  })

  it('gives up after the single retry and rethrows the last error with the attempt count', async () => {
    const op = vi.fn().mockRejectedValue(apiError(429))
    await expect(runWithPolicy(op, { timeoutMs: 1000, deps: noSleep })).rejects.toMatchObject({ status: 429, attempts: 2 })
    expect(op).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 400', async () => {
    const op = vi.fn().mockRejectedValue(apiError(400))
    await expect(runWithPolicy(op, { timeoutMs: 1000, deps: noSleep })).rejects.toMatchObject({ status: 400, attempts: 1 })
    expect(op).toHaveBeenCalledTimes(1)
    expect(noSleep.sleep).not.toHaveBeenCalled()
  })

  it('retries a network error once', async () => {
    const op = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(42)
    const out = await runWithPolicy(op, { timeoutMs: 1000, deps: noSleep })
    expect(out.attempts).toBe(2)
  })

  it('enforces a hard timeout, aborts the signal and does NOT retry it', async () => {
    let seen: AbortSignal | undefined
    const op = vi.fn((signal: AbortSignal) => { seen = signal; return new Promise<never>(() => {}) })
    await expect(runWithPolicy(op, { timeoutMs: 25, deps: noSleep })).rejects.toBeInstanceOf(GeminiTimeoutError)
    expect(op).toHaveBeenCalledTimes(1)
    expect(seen?.aborted).toBe(true)
  })

  it('honours maxRetries: 0', async () => {
    const op = vi.fn().mockRejectedValue(apiError(503))
    await expect(runWithPolicy(op, { timeoutMs: 1000, maxRetries: 0, deps: noSleep })).rejects.toMatchObject({ attempts: 1 })
  })
})

describe('generateFlash / sendChatMessage (fake backend, no network)', () => {
  let logs: string[]
  let generate: ReturnType<typeof vi.fn>
  let chat: ReturnType<typeof vi.fn>

  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => { logs.push(String(line)) })
    generate = vi.fn(async () => ({ text: 'hola', usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } }))
    chat = vi.fn(async () => ({ text: 'respuesta', usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } }))
    setGeminiBackendForTests({ generate, chat } as unknown as GeminiBackend)
    delete process.env.GEMINI_MODEL_FLASH
    delete process.env.GEMINI_MODEL_LITE
  })
  afterEach(() => {
    setGeminiBackendForTests(null)
    vi.restoreAllMocks()
  })

  it('logs ONE structured line per call with tokens and latency, and never the prompt', async () => {
    const SECRET = 'Contraseña-del-cliente-123'
    expect(await generateFlash(`Resume esto: ${SECRET}`, { feature: 'test.feature', orgId: 'org-1' })).toBe('hola')
    expect(logs).toHaveLength(1)
    const line = JSON.parse(logs[0])
    expect(line).toMatchObject({
      severity: 'INFO', event: 'ai.call', feature: 'test.feature', orgId: 'org-1', ok: true, attempts: 1,
      model: 'gemini-3.8-flash', inputTokens: 11, outputTokens: 7, totalTokens: 18,
    })
    expect(typeof line.latencyMs).toBe('number')
    expect(logs[0]).not.toContain(SECRET)
  })

  it('logs a failure as WARNING with the status only', async () => {
    generate.mockRejectedValue(apiError(400))
    await expect(generateFlash('x', { feature: 'test.fail' })).rejects.toMatchObject({ status: 400 })
    const line = JSON.parse(logs[0])
    expect(line).toMatchObject({ severity: 'WARNING', ok: false, errorName: 'ApiError', errorStatus: 400, feature: 'test.fail' })
    expect(line.errorMessage).toBeUndefined()
  })

  it('uses 25 s for text and 90 s when media is attached; an explicit timeout wins', async () => {
    await generateFlash('texto')
    await generateFlash(['audio', { inlineData: { data: 'AAAA', mimeType: 'audio/webm' } }])
    await generateFlash('texto largo', { timeoutMs: 60_000 })
    expect(generate.mock.calls.map(c => (c[0] as { timeoutMs: number }).timeoutMs)).toEqual([
      DEFAULT_TEXT_TIMEOUT_MS, DEFAULT_MEDIA_TIMEOUT_MS, 60_000,
    ])
    expect(DEFAULT_TEXT_TIMEOUT_MS).toBe(25_000)
  })

  it('resolves the model from the tier and the env override', async () => {
    await generateFlash('a', { tier: 'lite' })
    process.env.GEMINI_MODEL_FLASH = 'gemini-custom-flash'
    await generateFlash('b')
    const models = generate.mock.calls.map(c => (c[0] as { model: string }).model)
    expect(models).toEqual(['gemini-3.5-flash-lite', 'gemini-custom-flash'])
  })

  it('keeps the structured-output options Captura relies on', async () => {
    await generateFlash('x', { responseJsonSchema: { type: 'object' }, systemInstruction: 'sys', temperature: 0.2 })
    const { config } = generate.mock.calls[0][0] as { config: Record<string, unknown> }
    expect(config).toMatchObject({
      responseMimeType: 'application/json', responseJsonSchema: { type: 'object' }, systemInstruction: 'sys', temperature: 0.2,
    })
  })

  it('maps chat history roles to the SDK shape', async () => {
    const text = await sendChatMessage(
      [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'qué tal' }],
      'otra',
      'sistema',
      { feature: 'test.chat' },
    )
    expect(text).toBe('respuesta')
    const args = chat.mock.calls[0][0] as { history: Array<{ role: string }>; message: string; config?: { systemInstruction: string } }
    expect(args.history.map(h => h.role)).toEqual(['user', 'model'])
    expect(args.message).toBe('otra')
    expect(args.config).toEqual({ systemInstruction: 'sistema' })
    expect(JSON.parse(logs[0])).toMatchObject({ feature: 'test.chat', ok: true })
  })
})
