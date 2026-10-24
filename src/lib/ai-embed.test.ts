import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMBED_DIMS,
  MAX_DOC_CHARS,
  MAX_EMBED_BATCH,
  chunk,
  embedModel,
  embedQuery,
  embedTexts,
  fitDimensions,
  formatDocumentForEmbedding,
  formatQueryForEmbedding,
  l2Normalize,
  toPgVector,
} from './ai-embed'
import { setAiBudgetGuard, setAiUsageSink, setGeminiBackendForTests, type AiUsageRecord, type GeminiBackend } from './gemini'
import { AiBudgetError } from './ai-budget'
import { estimateCostUsd } from './ai-pricing'

const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))

describe('formatting (gemini-embedding-2 takes the task in the text, not in taskType)', () => {
  it('query and document prefixes follow Google\'s documented format', () => {
    expect(formatQueryForEmbedding('presupuesto 2027')).toBe('task: search result | query: presupuesto 2027')
    expect(formatDocumentForEmbedding('Política de compras', 'Todo gasto…')).toBe('title: Política de compras | text: Todo gasto…')
    expect(formatDocumentForEmbedding('   ', 'solo cuerpo')).toBe('title: none | text: solo cuerpo')
  })

  it('bounds what reaches the model', () => {
    expect(formatDocumentForEmbedding('t', 'palabra '.repeat(5000)).length).toBeLessThanOrEqual(MAX_DOC_CHARS + 20)
    expect(formatQueryForEmbedding('x'.repeat(2000)).length).toBeLessThan(600)
  })
})

describe('vectors', () => {
  it('l2Normalize gives unit length and leaves a zero vector alone', () => {
    expect(norm(l2Normalize([3, 4]))).toBeCloseTo(1, 9)
    expect(l2Normalize([0, 0])).toEqual([0, 0])
  })

  it('fitDimensions truncates Matryoshka-style then re-normalises; a short vector is an error', () => {
    const long = Array.from({ length: 3072 }, (_, i) => (i < EMBED_DIMS ? 1 : 100))
    const fitted = fitDimensions(long)
    expect(fitted).toHaveLength(EMBED_DIMS)
    expect(norm(fitted)).toBeCloseTo(1, 9)
    // truncation kept the FIRST dims (all equal after normalising), not the big tail
    expect(fitted[0]).toBeCloseTo(1 / Math.sqrt(EMBED_DIMS), 9)
    expect(() => fitDimensions([1, 2, 3])).toThrow(/768/)
    expect(norm(fitDimensions(Array.from({ length: EMBED_DIMS }, () => 5)))).toBeCloseTo(1, 9)
  })

  it('toPgVector writes a pgvector literal rounded to 6 decimals', () => {
    expect(toPgVector([0.1234567891, -1, 0])).toBe('[0.123457,-1,0]')
  })

  it('chunk splits in order and rejects a zero size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
    expect(() => chunk([1], 0)).toThrow()
  })

  it('embedModel: default, valid override, malformed override ignored', () => {
    expect(embedModel({})).toBe('gemini-embedding-2')
    expect(embedModel({ GEMINI_MODEL_EMBED: 'gemini-embedding-3' })).toBe('gemini-embedding-3')
    expect(embedModel({ GEMINI_MODEL_EMBED: '../etc/passwd' })).toBe('gemini-embedding-2')
  })
})

describe('embedTexts (fake backend, no network)', () => {
  let embed: ReturnType<typeof vi.fn>
  let sink: ReturnType<typeof vi.fn<(r: AiUsageRecord) => void>>

  /** A 3072-d vector (what the API returns when the dimension is not honoured) whose first value encodes the text length. */
  const fakeVector = (len: number) => Array.from({ length: 3072 }, (_, i) => (i === 0 ? len + 1 : 0.001))

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    embed = vi.fn(async (args: { texts: string[] }) => ({
      vectors: args.texts.map(t => fakeVector(t.length)),
      usage: { inputTokens: args.texts.reduce((n, t) => n + Math.ceil(t.length / 3.5), 0), outputTokens: 0 },
    }))
    const backend: GeminiBackend = {
      generate: vi.fn() as GeminiBackend['generate'],
      chat: vi.fn() as GeminiBackend['chat'],
      embed: embed as unknown as NonNullable<GeminiBackend['embed']>,
    }
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

  it('splits into batches of MAX_EMBED_BATCH, keeps order, returns unit 768-d vectors', async () => {
    const texts = Array.from({ length: MAX_EMBED_BATCH * 2 + 20 }, (_, i) => `texto ${'x'.repeat(i)}`)
    const out = await embedTexts(texts, { orgId: 'org-1' })
    expect(embed.mock.calls.map(c => (c[0] as { texts: string[] }).texts.length)).toEqual([MAX_EMBED_BATCH, MAX_EMBED_BATCH, 20])
    expect(out).toHaveLength(texts.length)
    for (const v of out) {
      expect(v).toHaveLength(EMBED_DIMS)
      expect(norm(v)).toBeCloseTo(1, 6)
    }
    // order preserved: vector i was made from texts[i] (first component grows with the text length)
    expect(out[5][0]).toBeGreaterThan(out[0][0])
    expect(out[100][0]).toBeGreaterThan(out[99][0])
  })

  it('asks for 768 dimensions with the configured model and NO taskType', async () => {
    await embedTexts(['hola'], { orgId: 'org-1' })
    const args = embed.mock.calls[0][0] as Record<string, unknown>
    expect(args).toMatchObject({ model: 'gemini-embedding-2', dims: 768 })
    expect(args).not.toHaveProperty('taskType')
  })

  it('meters every call against the organisation, priced at the embedding rate', async () => {
    await embedTexts(['uno', 'dos'], { orgId: 'org-1', feature: 'search.index' })
    expect(sink).toHaveBeenCalledTimes(1)
    const r = sink.mock.calls[0][0]
    expect(r).toMatchObject({ orgId: 'org-1', feature: 'search.index', model: 'gemini-embedding-2', tier: 'lite', ok: true, outputTokens: 0 })
    expect(r.inputTokens).toBeGreaterThan(0)
    expect(r.costUsd).toBe(estimateCostUsd({ model: 'gemini-embedding-2', inputTokens: r.inputTokens, outputTokens: 0 }))
    expect(estimateCostUsd({ model: 'gemini-embedding-2', inputTokens: 1_000_000, outputTokens: 0 }, '2026-10-24')).toBe(0.2)
  })

  it('an exhausted budget blocks the call BEFORE spending: backend never runs', async () => {
    setAiBudgetGuard(async () => { throw new AiBudgetError('org') })
    await expect(embedTexts(['hola'], { orgId: 'org-1' })).rejects.toBeInstanceOf(AiBudgetError)
    expect(embed).not.toHaveBeenCalled()
  })

  it('a response with the wrong number of vectors is an error, not silent misalignment', async () => {
    embed.mockResolvedValueOnce({ vectors: [fakeVector(3)], usage: {} })
    await expect(embedTexts(['a', 'b'], { orgId: 'org-1' })).rejects.toThrow(/1 embeddings para 2 textos/)
  })

  it('embedQuery returns ONE vector, formatted as a query', async () => {
    const v = await embedQuery('presupuesto', { orgId: 'org-1' })
    expect(v).toHaveLength(EMBED_DIMS)
    expect((embed.mock.calls[0][0] as { texts: string[] }).texts).toEqual(['task: search result | query: presupuesto'])
  })

  it('no texts → no call', async () => {
    expect(await embedTexts([], { orgId: 'org-1' })).toEqual([])
    expect(embed).not.toHaveBeenCalled()
  })
})
