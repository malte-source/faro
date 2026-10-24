import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateFlash,
  sendChatMessage,
  setAiBudgetGuard,
  setAiUsageSink,
  setGeminiBackendForTests,
  type AiUsageRecord,
  type GeminiBackend,
} from './gemini'
import { runWithAiContext } from './ai-context'
import { AiBudgetError } from './ai-budget'

describe('Gemini metering and budget guard (fake backend, no network)', () => {
  let generate: ReturnType<typeof vi.fn>
  let sink: ReturnType<typeof vi.fn<(r: AiUsageRecord) => void>>

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    generate = vi.fn().mockResolvedValue({ text: 'ok', usage: { inputTokens: 2000, outputTokens: 500, totalTokens: 2500 } })
    const backend: GeminiBackend = { generate: generate as GeminiBackend['generate'], chat: vi.fn().mockResolvedValue({ text: 'hola', usage: { inputTokens: 100, outputTokens: 50 } }) }
    setGeminiBackendForTests(backend)
    sink = vi.fn<(r: AiUsageRecord) => void>()
    setAiUsageSink(sink)
    setAiBudgetGuard(null)
  })

  afterEach(() => {
    setGeminiBackendForTests(null)
    setAiUsageSink(null)
    setAiBudgetGuard(null)
    vi.restoreAllMocks()
  })

  it('meters a call from the per-request context: org, user, route as the feature, cost from tokens', async () => {
    await runWithAiContext({ orgId: 'org-1', userId: 'user-1', path: 'tasks.parseAndCreate' }, () => generateFlash('hola'))
    expect(sink).toHaveBeenCalledTimes(1)
    const r = sink.mock.calls[0][0]
    expect(r).toMatchObject({
      orgId: 'org-1', userId: 'user-1', feature: 'tasks.parseAndCreate', model: 'gemini-3.8-flash', tier: 'flash',
      inputTokens: 2000, outputTokens: 500, ok: true,
    })
    expect(r.costUsd).toBeGreaterThan(0)
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('an explicit feature/orgId/tier beats the context', async () => {
    await runWithAiContext({ orgId: 'org-ctx', userId: 'u', path: 'some.route' }, () =>
      generateFlash('x', { feature: 'documents', orgId: 'org-explicit', tier: 'lite' }),
    )
    expect(sink.mock.calls[0][0]).toMatchObject({ orgId: 'org-explicit', feature: 'documents', tier: 'lite', model: 'gemini-3.5-flash-lite' })
  })

  it('meters chat calls too', async () => {
    await runWithAiContext({ orgId: 'org-1', userId: 'user-1', path: 'chat.askFaro' }, () => sendChatMessage([], 'hola'))
    expect(sink.mock.calls[0][0]).toMatchObject({ feature: 'chat.askFaro', inputTokens: 100, outputTokens: 50, ok: true })
  })

  it('a failed call is recorded with ok:false and zero cost', async () => {
    generate.mockRejectedValue(Object.assign(new Error('bad'), { name: 'ApiError', status: 400 }))
    await expect(runWithAiContext({ orgId: 'org-1', userId: null, path: 'x.y' }, () => generateFlash('p'))).rejects.toBeTruthy()
    expect(sink.mock.calls[0][0]).toMatchObject({ ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0 })
  })

  it('does not meter a call that has no organisation (nobody to bill it to)', async () => {
    await generateFlash('sin contexto')
    expect(sink).not.toHaveBeenCalled()
  })

  it('a sink that throws never breaks the call', async () => {
    sink.mockImplementation(() => { throw new Error('db down') })
    await expect(runWithAiContext({ orgId: 'o', userId: 'u', path: 'p' }, () => generateFlash('x'))).resolves.toBe('ok')
  })

  it('the budget guard runs BEFORE the model is called and can block it', async () => {
    setAiBudgetGuard(async () => { throw new AiBudgetError('org') })
    await expect(runWithAiContext({ orgId: 'o', userId: 'u', path: 'p' }, () => generateFlash('x'))).rejects.toBeInstanceOf(AiBudgetError)
    expect(generate).not.toHaveBeenCalled()
    expect(sink).not.toHaveBeenCalled()
  })

  it('the guard receives who and what the call is for', async () => {
    const guard = vi.fn(async () => {})
    setAiBudgetGuard(guard)
    await runWithAiContext({ orgId: 'org-9', userId: 'user-9', path: 'costos.explain' }, () => generateFlash('x'))
    expect(guard).toHaveBeenCalledWith({ orgId: 'org-9', userId: 'user-9', feature: 'costos.explain' })
  })
})
