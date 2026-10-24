import { describe, expect, it, vi } from 'vitest'
import {
  MIN_EMBED_CHARS,
  SYNC_BATCH,
  chatToDoc,
  decisionToDoc,
  documentToDoc,
  isMissingRelation,
  planEmbedding,
  runSearchIndex,
  stripMarkdown,
  syncStream,
  taskToDoc,
  updateToDoc,
  type PendingRow,
  type SyncCtx,
} from './search-index'
import type { Cursor } from '@/lib/search-utils'

describe('stripMarkdown', () => {
  it('removes headings, emphasis, links, images and code fences but keeps the words', () => {
    const md = '# Título\n\n**Importante**: ver [la política](https://x.test) ![img](a.png)\n- punto uno\n1. paso\n```js\ncode()\n```'
    const out = stripMarkdown(md)
    expect(out).toContain('Título')
    expect(out).toContain('Importante')
    expect(out).toContain('la política')
    expect(out).toContain('punto uno')
    expect(out).not.toMatch(/[#*`]|https|\.png|code\(\)/)
  })
})

describe('row → index document', () => {
  it('tasks: canceled ones are not indexed; others carry project, reporter and a deep link', () => {
    const t = { id: 't1', title: 'Pagar proveedores', description: 'urgente', project_id: 'p1', reporter_id: 'u1', status: 'todo', updated_at: '2026-10-24T10:00:00Z' }
    expect(taskToDoc({ ...t, status: 'canceled' }, 'org')).toBeNull()
    expect(taskToDoc(t, 'org')).toMatchObject({
      org_id: 'org', entity_type: 'task', entity_id: 't1', project_id: 'p1', channel_id: null, workspace_id: null,
      author_id: 'u1', url: '/dashboard/projects/p1?task=t1', body: 'urgente',
    })
  })

  it('documents: obsolete ones are removed; project_id stays null (the documents router scopes by empresa only)', () => {
    const d = { id: 'd1', org_id: 'org', workspace_id: 'w1', title: 'Política', body_md: '## Reglas\nTodo **gasto** se aprueba', status: 'aprobado', tags: ['compras', 'finanzas'], owner_id: 'u1', created_by: 'u2', updated_at: '2026-10-24T10:00:00Z' }
    expect(documentToDoc({ ...d, status: 'obsoleto' })).toBeNull()
    const doc = documentToDoc(d)!
    expect(doc).toMatchObject({ entity_type: 'document', workspace_id: 'w1', project_id: null, channel_id: null, author_id: 'u1', url: '/dashboard/documentos/d1' })
    expect(doc.body).toContain('Todo gasto se aprueba')
    expect(doc.body).toContain('compras finanzas')
    expect(doc.body).not.toContain('**')
  })

  it('decisions belong to the whole grupo (no empresa, no project gate) and include criteria/options text', () => {
    const doc = decisionToDoc({ id: 'x', org_id: 'org', title: '¿Abrir Asunción?', description: 'Evaluar', created_by: 'u1', updated_at: '2026-10-24T10:00:00Z' }, 'Costo Riesgo Opción A')
    expect(doc).toMatchObject({ entity_type: 'decision', workspace_id: null, project_id: null, url: '/dashboard/decisions/x' })
    expect(doc.body).toContain('Costo Riesgo Opción A')
  })

  it('project updates: gated by their project', () => {
    expect(updateToDoc({ id: 'u', project_id: 'p1', author_id: 'a', content: 'Avance semanal: todo en orden', updated_at: '2026-10-24T10:00:00Z' }, 'org'))
      .toMatchObject({ entity_type: 'update', project_id: 'p1', channel_id: null, url: '/dashboard/projects/p1' })
  })

  it('chat: only live text messages; gated by channel; an edit moves source_updated_at', () => {
    const m = { id: 'm1', channel_id: 'c1', author_id: 'a', kind: 'text', body: 'Revisemos el presupuesto', deleted_at: null, created_at: '2026-10-24T10:00:00Z', edited_at: null }
    expect(chatToDoc({ ...m, deleted_at: '2026-10-24T11:00:00Z' }, 'org')).toBeNull()
    expect(chatToDoc({ ...m, kind: 'system' }, 'org')).toBeNull()
    expect(chatToDoc({ ...m, kind: 'ai' }, 'org')).toBeNull()
    expect(chatToDoc({ ...m, body: '   ' }, 'org')).toBeNull()
    const doc = chatToDoc(m, 'org')!
    expect(doc).toMatchObject({ entity_type: 'chat', channel_id: 'c1', project_id: null, url: '/dashboard/chat?c=c1&m=m1', source_updated_at: '2026-10-24T10:00:00Z' })
    expect(chatToDoc({ ...m, edited_at: '2026-10-24T12:00:00Z' }, 'org')!.source_updated_at).toBe('2026-10-24T12:00:00Z')
  })

  it('long bodies are truncated for the index', () => {
    const t = { id: 't1', title: 'x', description: 'palabra '.repeat(3000), project_id: 'p1', reporter_id: null, status: 'todo', updated_at: '2026-10-24T10:00:00Z' }
    expect(taskToDoc(t, 'org')!.body.length).toBeLessThanOrEqual(6000)
  })
})

describe('planEmbedding', () => {
  const row = (id: string, org: string, text: string): PendingRow => ({ id, org_id: org, title: text, body: '', source_updated_at: '2026-10-24T10:00:00Z' })

  it('skips near-empty rows and organisations without AI; groups the rest by organisation', () => {
    const rows = [
      row('a', 'org1', 'Un texto suficientemente largo'),
      row('b', 'org1', 'ok'),
      row('c', 'org2', 'Otro texto suficientemente largo'),
      row('d', 'free', 'Texto largo pero plan sin IA aquí'),
    ]
    const { byOrg, skip } = planEmbedding(rows, org => org !== 'free')
    expect(skip.map(r => r.id).sort()).toEqual(['b', 'd'])
    expect(Array.from(byOrg.keys()).sort()).toEqual(['org1', 'org2'])
    expect(byOrg.get('org1')!.map(r => r.id)).toEqual(['a'])
    expect(MIN_EMBED_CHARS).toBeGreaterThan(2)
  })
})

describe('isMissingRelation', () => {
  it('recognises "table/function not created yet" and nothing else', () => {
    expect(isMissingRelation({ code: '42P01' })).toBe(true)
    expect(isMissingRelation({ code: 'PGRST205' })).toBe(true)
    expect(isMissingRelation({ code: 'PGRST202' })).toBe(true)
    expect(isMissingRelation({ message: 'relation "search_documents" does not exist' })).toBe(true)
    expect(isMissingRelation({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingRelation(null)).toBe(false)
  })
})

// A minimal fake of the part of supabase-js that cursor storage uses.
function fakeStateDb(initial: Cursor | null = null) {
  const saved: Array<{ stream: string; cursor: string | null; cursor_id: string | null }> = []
  const db = {
    from: (table: string) => {
      if (table !== 'search_index_state') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: initial ? { cursor: initial.at, cursor_id: initial.id } : null, error: null }) }) }),
        upsert: async (row: { stream: string; cursor: string | null; cursor_id: string | null }) => { saved.push(row); return { error: null } },
      }
    },
  }
  return { db: db as unknown as SyncCtx['db'], saved }
}

describe('syncStream — cursor batching', () => {
  const ctxFor = (db: SyncCtx['db'], timeLeft = () => true): SyncCtx => ({ db, errors: [], projectOrg: new Map(), channelOrg: new Map(), timeLeft })

  it('keeps going while batches are full, saves the cursor after EACH batch, stops on a short batch', async () => {
    const { db, saved } = fakeStateDb()
    const calls: Cursor[] = []
    const step = vi.fn(async (cursor: Cursor) => {
      calls.push(cursor)
      const n = calls.length
      const rowCount = n < 3 ? SYNC_BATCH : 37
      return { nextCursor: { at: `t${n}`, id: `id${n}` }, rowCount, indexed: rowCount, removed: 0 }
    })
    const stats = await syncStream('task', step, ctxFor(db))
    expect(step).toHaveBeenCalledTimes(3)
    expect(calls[0]).toEqual({ at: null, id: null })
    expect(calls[1]).toEqual({ at: 't1', id: 'id1' })
    expect(calls[2]).toEqual({ at: 't2', id: 'id2' })
    expect(saved.map(s => s.cursor)).toEqual(['t1', 't2', 't3'])
    expect(saved.every(s => s.stream === 'task')).toBe(true)
    expect(stats).toEqual({ scanned: SYNC_BATCH * 2 + 37, indexed: SYNC_BATCH * 2 + 37, removed: 0 })
  })

  it('resumes from the stored cursor', async () => {
    const { db } = fakeStateDb({ at: '2026-10-01T00:00:00Z', id: 'last' })
    const step = vi.fn(async (_cursor: Cursor) => ({ nextCursor: { at: 'x', id: 'y' }, rowCount: 0, indexed: 0, removed: 0 }))
    await syncStream('document', step, ctxFor(db))
    expect(step.mock.calls[0][0]).toEqual({ at: '2026-10-01T00:00:00Z', id: 'last' })
  })

  it('an empty batch saves nothing and stops', async () => {
    const { db, saved } = fakeStateDb()
    const step = vi.fn(async () => ({ nextCursor: { at: null, id: null }, rowCount: 0, indexed: 0, removed: 0 }))
    const stats = await syncStream('chat', step, ctxFor(db))
    expect(step).toHaveBeenCalledTimes(1)
    expect(saved).toHaveLength(0)
    expect(stats.scanned).toBe(0)
  })

  it('stops when the time budget is gone, without losing the cursor of finished batches', async () => {
    const { db, saved } = fakeStateDb()
    let allowed = 2
    const step = vi.fn(async () => ({ nextCursor: { at: 'a', id: 'b' }, rowCount: SYNC_BATCH, indexed: SYNC_BATCH, removed: 0 }))
    await syncStream('task', step, ctxFor(db, () => allowed-- > 0))
    expect(step).toHaveBeenCalledTimes(2)
    expect(saved).toHaveLength(2)
  })

  it('never loops forever on an endless full stream (hard cap on batches per run)', async () => {
    const { db } = fakeStateDb()
    const step = vi.fn(async () => ({ nextCursor: { at: 'a', id: 'b' }, rowCount: SYNC_BATCH, indexed: SYNC_BATCH, removed: 0 }))
    await syncStream('task', step, ctxFor(db))
    expect(step.mock.calls.length).toBeLessThanOrEqual(25)
  })
})

describe('runSearchIndex — readiness', () => {
  it('answers not_ready (no error, no work) while the SQL is not applied', async () => {
    const db = {
      from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { code: '42P01', message: 'relation "search_index_state" does not exist' } }) }) }),
    }
    const r = await runSearchIndex(db as never)
    expect(r.status).toBe('not_ready')
    expect(r.errors).toEqual([])
    expect(r.embedded).toBe(0)
  })

  it('a real database error is thrown, not hidden as not_ready', async () => {
    const db = { from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) }) }) }
    await expect(runSearchIndex(db as never)).rejects.toMatchObject({ code: '57014' })
  })
})
