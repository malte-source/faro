import { describe, expect, it } from 'vitest'
import { SEQUENCE_TIMEOUT_MS, SequenceMatcher, normalizeKey } from './matcher'
import { isEditableTarget, isInteractiveTarget, shouldIgnoreShortcut } from './guards'
import { buildCatalog, displayKey, formatShortcut, hintFor, matcherDefs } from './catalog'
import { fuzzyScore, fuzzyScoreAny } from './fuzzy'
import { moveFocus, resolveFocus } from './list-focus'

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra })

describe('SequenceMatcher', () => {
  const make = () => new SequenceMatcher([
    { id: 'home', keys: ['g', 'h'] },
    { id: 'projects', keys: ['g', 'p'] },
    { id: 'create', keys: ['c'] },
    { id: 'help', keys: ['?'] },
  ])

  it('matches a single key immediately', () => {
    expect(make().feed('c', 0)).toEqual({ type: 'match', id: 'create' })
    expect(make().feed('?', 0)).toEqual({ type: 'match', id: 'help' })
  })

  it('waits after a prefix and matches the follow-up', () => {
    const m = make()
    const first = m.feed('g', 0)
    expect(first.type).toBe('pending')
    if (first.type === 'pending') expect(first.next.sort()).toEqual(['h', 'p'])
    expect(m.feed('h', 100)).toEqual({ type: 'match', id: 'home' })
    expect(m.pendingPrefix).toEqual([])
  })

  it('treats Shift+G like g', () => {
    const m = make()
    expect(m.feed('G', 0).type).toBe('pending')
    expect(m.feed('P', 10)).toEqual({ type: 'match', id: 'projects' })
  })

  it('drops the prefix after the timeout', () => {
    const m = make()
    m.feed('g', 0)
    // 'h' alone is not a sequence, so after the timeout nothing matches
    expect(m.feed('h', SEQUENCE_TIMEOUT_MS + 1)).toEqual({ type: 'none' })
  })

  it('still honours a follow-up inside the timeout', () => {
    const m = make()
    m.feed('g', 0)
    expect(m.feed('p', SEQUENCE_TIMEOUT_MS)).toEqual({ type: 'match', id: 'projects' })
  })

  it('cancels on a wrong follow-up, but lets that key start a new sequence', () => {
    const m = make()
    m.feed('g', 0)
    expect(m.feed('z', 10)).toEqual({ type: 'none' })
    m.feed('g', 20)
    // "g" then "g": the second g restarts the sequence instead of being swallowed
    expect(m.feed('g', 30).type).toBe('pending')
    expect(m.feed('h', 40)).toEqual({ type: 'match', id: 'home' })
  })

  it('a single-key shortcut fires even right after a cancelled prefix', () => {
    const m = make()
    m.feed('g', 0)
    expect(m.feed('c', 10)).toEqual({ type: 'match', id: 'create' })
  })

  it('waits when an exact match is also the prefix of a longer sequence', () => {
    const m = new SequenceMatcher([{ id: 'a', keys: ['x'] }, { id: 'b', keys: ['x', 'y'] }])
    expect(m.feed('x', 0).type).toBe('pending')
    expect(m.feed('y', 1)).toEqual({ type: 'match', id: 'b' })
  })

  it('reset clears the pending prefix', () => {
    const m = make()
    m.feed('g', 0)
    m.reset()
    expect(m.feed('h', 1)).toEqual({ type: 'none' })
  })

  it('normalizeKey keeps named keys', () => {
    expect(normalizeKey('G')).toBe('g')
    expect(normalizeKey('Enter')).toBe('Enter')
    expect(normalizeKey('?')).toBe('?')
  })
})

describe('shouldIgnoreShortcut (input-focus guard)', () => {
  it('ignores typing in inputs, textareas, selects and contenteditable', () => {
    expect(shouldIgnoreShortcut({ key: 'g', target: el('INPUT') })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'g', target: el('textarea') })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'g', target: el('SELECT') })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'g', target: el('DIV', { isContentEditable: true }) })).toBe(true)
  })

  it('ignores ARIA text-entry roles (editors, comboboxes)', () => {
    const roleOf = (role: string) => el('DIV', { getAttribute: (n: string) => (n === 'role' ? role : null) })
    expect(shouldIgnoreShortcut({ key: 'c', target: roleOf('textbox') })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'c', target: roleOf('combobox') })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'c', target: roleOf('presentation') })).toBe(false)
  })

  it('lets keys through on the page body', () => {
    expect(shouldIgnoreShortcut({ key: 'g', target: el('BODY') })).toBe(false)
    expect(shouldIgnoreShortcut({ key: 'g', target: null })).toBe(false)
  })

  it('ignores any modifier chord (browser and OS shortcuts keep working)', () => {
    expect(shouldIgnoreShortcut({ key: 'g', ctrlKey: true, target: el('BODY') })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'g', metaKey: true, target: el('BODY') })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'g', altKey: true, target: el('BODY') })).toBe(true)
  })

  it('ignores IME composition, handled events and held-down repeats', () => {
    expect(shouldIgnoreShortcut({ key: 'g', isComposing: true })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'Process' })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'g', defaultPrevented: true })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'g', repeat: true })).toBe(true)
    expect(shouldIgnoreShortcut({ key: 'j', repeat: true }, { allowRepeat: true })).toBe(false)
  })

  it('ignores everything while a dialog, sheet or the palette is open', () => {
    expect(shouldIgnoreShortcut({ key: 'g', target: el('BODY') }, { overlayOpen: true })).toBe(true)
  })

  it('knows which targets own Enter (links, buttons)', () => {
    expect(isInteractiveTarget(el('A'))).toBe(true)
    expect(isInteractiveTarget(el('button'))).toBe(true)
    expect(isInteractiveTarget(el('BODY'))).toBe(false)
    expect(isEditableTarget(undefined)).toBe(false)
  })
})

describe('catalog', () => {
  it('routes Hoy/Inicio and Personas/Equipo by grupo mode', () => {
    const group = buildCatalog({ groupMode: true })
    const classic = buildCatalog({ groupMode: false })
    expect(group.find(s => s.id === 'nav-home')?.href).toBe('/dashboard/hoy')
    expect(classic.find(s => s.id === 'nav-home')?.href).toBe('/dashboard')
    expect(group.find(s => s.id === 'nav-people')?.href).toBe('/dashboard/personas')
    expect(classic.find(s => s.id === 'nav-people')?.href).toBe('/dashboard/team')
  })

  it('has no two global shortcuts on the same keys', () => {
    for (const mode of [true, false]) {
      const defs = matcherDefs(buildCatalog({ groupMode: mode }))
      const seen = new Set(defs.map(d => d.keys.join(' ')))
      expect(seen.size).toBe(defs.length)
    }
  })

  it('every global navigation shortcut is reachable through the matcher', () => {
    const catalog = buildCatalog({ groupMode: true })
    const matcher = new SequenceMatcher(matcherDefs(catalog))
    for (const s of catalog.filter(c => c.action === 'navigate')) {
      matcher.reset()
      let last = matcher.feed(s.keys[0], 0)
      for (const k of s.keys.slice(1)) last = matcher.feed(k, 1)
      expect(last).toEqual({ type: 'match', id: s.id })
    }
  })

  it('formats sequences and chords for display', () => {
    expect(formatShortcut({ keys: ['g', 'h'] })).toBe('G H')
    expect(formatShortcut({ keys: [], chord: '⌘ K' })).toBe('⌘ K')
    expect(formatShortcut(undefined)).toBe('')
    expect(displayKey('Enter')).toBe('↵')
    expect(hintFor(buildCatalog({ groupMode: false }), 'create')).toBe('C')
    expect(hintFor(buildCatalog({ groupMode: false }), 'nope')).toBeUndefined()
  })
})

describe('fuzzyScore', () => {
  it('matches accent- and case-insensitively', () => {
    expect(fuzzyScore('configuracion', 'Configuración')).toBeGreaterThan(0)
    expect(fuzzyScore('DOC', 'Documentos')).toBeGreaterThan(0)
  })

  it('rejects text that does not contain the letters in order', () => {
    expect(fuzzyScore('zq', 'Proyectos')).toBe(0)
    expect(fuzzyScore('sy', 'Tareas')).toBe(0)
  })

  it('accepts scattered subsequences ("nt" → Nueva tarea)', () => {
    expect(fuzzyScore('nt', 'Nueva tarea')).toBeGreaterThan(0)
  })

  it('ranks a substring above a scattered match, and word starts above mid-word', () => {
    // "tar" is one run inside "Tareas"; "tas" has to skip letters to match the same word.
    expect(fuzzyScore('tar', 'Tareas')).toBeGreaterThan(fuzzyScore('tas', 'Tareas'))
    // Both are plain substrings of "Proyectos", but "pro" starts the word and "oye" sits mid-word.
    expect(fuzzyScore('oye', 'Proyectos')).toBeGreaterThan(0)
    expect(fuzzyScore('pro', 'Proyectos')).toBeGreaterThan(fuzzyScore('oye', 'Proyectos'))
  })

  it('empty query matches everything, empty text nothing', () => {
    expect(fuzzyScore('', 'x')).toBeGreaterThan(0)
    expect(fuzzyScore('x', '')).toBe(0)
  })

  it('fuzzyScoreAny weighs the label over the description', () => {
    const inLabel = fuzzyScoreAny('hoy', ['Hoy', 'otra cosa'])
    const inDescription = fuzzyScoreAny('hoy', ['otra cosa', 'Hoy'])
    expect(inLabel).toBeGreaterThan(inDescription)
    expect(fuzzyScoreAny('zzz', ['Hoy', 'algo'])).toBe(0)
  })
})

describe('list focus', () => {
  const ids = ['a', 'b', 'c']

  it('first j lands on the first row, first k on the last', () => {
    expect(moveFocus(ids, null, 1)).toBe('a')
    expect(moveFocus(ids, null, -1)).toBe('c')
  })

  it('moves one row and stops at the edges (no wrap)', () => {
    expect(moveFocus(ids, 'a', 1)).toBe('b')
    expect(moveFocus(ids, 'c', 1)).toBe('c')
    expect(moveFocus(ids, 'a', -1)).toBe('a')
    expect(moveFocus(ids, 'b', -1)).toBe('a')
  })

  it('handles empty lists and a focused row that vanished', () => {
    expect(moveFocus([], null, 1)).toBeNull()
    expect(moveFocus(ids, 'zzz', 1)).toBe('a')
  })

  it('resolveFocus keeps the ring on the same row, or on the row that took its place', () => {
    expect(resolveFocus(['a', 'b', 'c'], { id: 'b', index: 1 })).toBe('b')
    expect(resolveFocus(['a', 'c'], { id: 'b', index: 1 })).toBe('c') // b left: c now sits at index 1
    expect(resolveFocus(['a', 'b'], { id: 'c', index: 2 })).toBe('b') // clamped to the end
    expect(resolveFocus([], { id: 'a', index: 0 })).toBeNull()
    expect(resolveFocus(['a'], null)).toBeNull()
  })
})
