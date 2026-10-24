import { describe, expect, it } from 'vitest'
import {
  GUEST_HAT,
  nextWeekday,
  parseQuickAdd,
  proposalWarning,
  weekBounds,
  type DirectoryPerson,
  type DirectoryWorkspace,
} from './multiempresa'

const workspaces: DirectoryWorkspace[] = [
  { id: 'ws-mesa', name: 'Mesa Inteligente' },
  { id: 'ws-tpy', name: 'TPY' },
  { id: 'ws-eventero', name: 'Eventero' },
]
const people: DirectoryPerson[] = [
  { id: 'u-malte', name: 'Malte Melgarejo', memberships: [{ workspaceId: 'ws-tpy', position: 'Dirección' }] },
  { id: 'u-andy', name: 'Andy Gómez', memberships: [{ workspaceId: 'ws-mesa', position: 'Administración' }, { workspaceId: 'ws-tpy', position: 'Finanzas' }] },
  { id: 'u-flavia', name: 'Flavia Zimny', memberships: [{ workspaceId: 'ws-eventero', position: 'Comercial' }] },
]

// 2026-10-22 is a Thursday.
const TODAY = '2026-10-22'
const ctx = { today: TODAY, people, workspaces, defaultAssigneeId: 'u-malte' }

describe('dates', () => {
  it('finds the next occurrence of a weekday, never today', () => {
    expect(nextWeekday(TODAY, 5)).toBe('2026-10-23') // viernes
    expect(nextWeekday(TODAY, 4)).toBe('2026-10-29') // jueves → next week
  })
  it('returns Monday–Sunday of the week', () => {
    expect(weekBounds(TODAY)).toEqual({ monday: '2026-10-19', sunday: '2026-10-25' })
    expect(weekBounds('2026-10-25')).toEqual({ monday: '2026-10-19', sunday: '2026-10-25' })
  })
})

describe('parseQuickAdd', () => {
  it('reads empresa, person and weekday from a single line', () => {
    const r = parseQuickAdd('Pagar proveedores #mesa @andy viernes', ctx)
    expect(r.title).toBe('Pagar proveedores')
    expect(r.workspaceId).toBe('ws-mesa')
    expect(r.assigneeId).toBe('u-andy')
    expect(r.dueDate).toBe('2026-10-23')
    expect(r.hat).toBe('Administración')
  })

  it('uses the cargo of the assignee in THAT empresa (same person, different hat)', () => {
    expect(parseQuickAdd('Cierre #tpy @andy hoy', ctx).hat).toBe('Finanzas')
    expect(parseQuickAdd('Cierre #mesa @andy hoy', ctx).hat).toBe('Administración')
  })

  it('marks the assignee as Invitado when they have no hat in the empresa', () => {
    const r = parseQuickAdd('Revisar contrato #eventero @andy', ctx)
    expect(r.workspaceId).toBe('ws-eventero')
    expect(r.hat).toBe(GUEST_HAT)
  })

  it('falls back to the active empresa filter, then to the first membership', () => {
    expect(parseQuickAdd('Llamar a banco', { ...ctx, filterWorkspaceId: 'ws-eventero' }).workspaceId).toBe('ws-eventero')
    expect(parseQuickAdd('Llamar a banco @flavia', ctx).workspaceId).toBe('ws-eventero')
  })

  it('defaults the assignee to the author', () => {
    const r = parseQuickAdd('Preparar informe #tpy mañana', ctx)
    expect(r.assigneeId).toBe('u-malte')
    expect(r.dueDate).toBe('2026-10-23')
    expect(r.hat).toBe('Dirección')
  })

  it('parses dd/mm and rolls past dates to next year', () => {
    expect(parseQuickAdd('Renovar seguro 5/11', ctx).dueDate).toBe('2026-11-05')
    expect(parseQuickAdd('Renovar seguro 5/10', ctx).dueDate).toBe('2027-10-05')
  })

  it('keeps unknown #tags and @names in the title instead of dropping them', () => {
    const r = parseQuickAdd('Hablar con #zzz sobre el precio', ctx)
    expect(r.title).toBe('Hablar con #zzz sobre el precio')
  })

  it('ignores one-letter aliases', () => {
    const r = parseQuickAdd('Algo #m', ctx)
    expect(r.title).toBe('Algo #m') // not consumed
    expect(r.workspaceId).toBe('ws-tpy') // falls back to the author's own empresa
  })

  it('defaults to the only visible empresa', () => {
    const r = parseQuickAdd('Tarea suelta', { ...ctx, people: [], workspaces: [workspaces[0]], defaultAssigneeId: null })
    expect(r.workspaceId).toBe('ws-mesa')
  })
})

describe('proposalWarning', () => {
  it('flags a proposal nobody took', () => {
    expect(proposalWarning({ assigneeId: null, workspaceId: 'ws-tpy', loadPct: null }, people)).toBe('sin_responsable')
  })
  it('flags an assignee with no hat in the empresa', () => {
    expect(proposalWarning({ assigneeId: 'u-flavia', workspaceId: 'ws-tpy', loadPct: 20 }, people)).toBe('sin_membresia')
  })
  it('flags overload from 120%', () => {
    expect(proposalWarning({ assigneeId: 'u-andy', workspaceId: 'ws-mesa', loadPct: 119 }, people)).toBeNull()
    expect(proposalWarning({ assigneeId: 'u-andy', workspaceId: 'ws-mesa', loadPct: 120 }, people)).toBe('sobrecarga')
  })
})
