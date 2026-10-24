import { describe, expect, it } from 'vitest'
import {
  escapeLike,
  foldKeepLength,
  foldText,
  keysetFilter,
  makeSnippet,
  nextCursor,
  queryTerms,
  searchUrl,
  snippetText,
  truncateForIndex,
} from './search-utils'

describe('text folding', () => {
  it('strips accents and case, and keeps one char per char so offsets map back', () => {
    expect(foldText('  Decisión CÓMO  ')).toBe('decision como')
    const original = 'Reunión de decisión'
    expect(foldKeepLength(original)).toBe('reunion de decision')
    expect(foldKeepLength(original).length).toBe(original.length)
  })

  it('queryTerms: accent-folded, deduplicated, ≥ 2 chars, no punctuation', () => {
    expect(queryTerms('Decisión, decision! de la ñ presupuesto')).toEqual(['decision', 'de', 'la', 'presupuesto'])
    expect(queryTerms('a b')).toEqual([])
  })

  it('escapeLike neutralises wildcards', () => {
    expect(escapeLike('100%_sure\\')).toBe('100\\%\\_sure\\\\')
  })

  it('truncateForIndex cuts on a word boundary and collapses whitespace', () => {
    expect(truncateForIndex('hola   mundo\n\ncruel', 100)).toBe('hola mundo cruel')
    const cut = truncateForIndex('uno dos tres cuatro cinco seis siete', 20)
    expect(cut.length).toBeLessThanOrEqual(20)
    expect(cut.endsWith(' ')).toBe(false)
    expect('uno dos tres cuatro cinco seis siete'.startsWith(cut)).toBe(true)
  })
})

describe('makeSnippet', () => {
  it('marks hits accent-insensitively and keeps the original text', () => {
    const parts = makeSnippet('Hoy tomamos una decisión importante sobre el presupuesto.', queryTerms('decision'))
    const hit = parts.find(p => p.hit)
    expect(hit?.t).toBe('decisión')
    expect(snippetText(parts)).toBe('Hoy tomamos una decisión importante sobre el presupuesto.')
  })

  it('merges overlapping matches into one hit', () => {
    const parts = makeSnippet('presupuesto presupuestal', ['presup', 'presupuesto'])
    expect(parts.filter(p => p.hit).map(p => p.t)).toEqual(['presupuesto', 'presup'])
  })

  it('windows long text around the first hit with ellipses on both sides', () => {
    const body = `${'relleno '.repeat(40)}la palabra clave aparece aquí ${'más relleno '.repeat(40)}`
    const parts = makeSnippet(body, ['clave'], 100)
    const text = snippetText(parts)
    expect(text.startsWith('… ')).toBe(true)
    expect(text.endsWith(' …')).toBe(true)
    expect(text).toContain('clave')
    expect(text.length).toBeLessThan(130)
    expect(parts.some(p => p.hit && p.t === 'clave')).toBe(true)
  })

  it('never emits markup: dangerous text stays plain text in parts, hits are flags not tags', () => {
    const body = '<img src=x onerror=alert(1)> presupuesto <script>alert(2)</script>'
    const parts = makeSnippet(body, ['presupuesto'])
    for (const p of parts) {
      expect(Object.keys(p).sort()).toEqual(p.hit ? ['hit', 't'] : ['t'])
      expect(p.t).not.toContain('<mark')
    }
    // the dangerous characters are still present as data (React renders them as text nodes)
    expect(snippetText(parts)).toContain('<script>')
  })

  it('no terms or no match → the start of the text; empty body → no parts', () => {
    expect(snippetText(makeSnippet('hola mundo', []))).toBe('hola mundo')
    expect(makeSnippet('   ', ['x'])).toEqual([])
    const parts = makeSnippet('texto sin coincidencias', ['zzz'])
    expect(parts.some(p => p.hit)).toBe(false)
  })
})

describe('keyset pagination', () => {
  it('no cursor → no filter (start from the beginning)', () => {
    expect(keysetFilter('updated_at', { at: null, id: null })).toBeNull()
  })

  it('timestamp + id: strictly after, with ties broken by id, values quoted', () => {
    const f = keysetFilter('updated_at', { at: '2026-10-24T12:00:00.123456+00:00', id: 'abc' })
    expect(f).toBe('updated_at.gt."2026-10-24T12:00:00.123456+00:00",and(updated_at.eq."2026-10-24T12:00:00.123456+00:00",id.gt."abc")')
  })

  it('timestamp only → plain greater-than; quotes in values are dropped (no filter injection)', () => {
    expect(keysetFilter('created_at', { at: '2026-01-01T00:00:00Z', id: null })).toBe('created_at.gt."2026-01-01T00:00:00Z"')
    expect(keysetFilter('created_at', { at: '2026"),or(x', id: 'i"d' })).not.toContain('"),or(')
  })

  it('nextCursor takes the LAST row and keeps the previous cursor when there are no rows', () => {
    const rows = [
      { id: 'a', updated_at: '2026-10-01T00:00:00Z' },
      { id: 'b', updated_at: '2026-10-02T00:00:00Z' },
    ]
    expect(nextCursor(rows, 'updated_at', { at: null, id: null })).toEqual({ at: '2026-10-02T00:00:00Z', id: 'b' })
    const prev = { at: 'x', id: 'y' }
    expect(nextCursor([], 'updated_at', prev)).toBe(prev)
  })
})

describe('searchUrl', () => {
  it('builds the deep links the results open', () => {
    expect(searchUrl.task('p1', 't1')).toBe('/dashboard/projects/p1?task=t1')
    expect(searchUrl.document('d1')).toBe('/dashboard/documentos/d1')
    expect(searchUrl.decision('x')).toBe('/dashboard/decisions/x')
    expect(searchUrl.update('p1')).toBe('/dashboard/projects/p1')
    expect(searchUrl.chat('c1', 'm1')).toBe('/dashboard/chat?c=c1&m=m1')
  })
})
