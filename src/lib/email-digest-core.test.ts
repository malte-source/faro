import { describe, expect, it } from 'vitest'
import {
  bucketTasks,
  emptyBucket,
  groupBucket,
  hasContent,
  taskCount,
  type RawTask,
  type WorkspaceInfo,
} from './email-digest-core'

// 2026-10-22 is a Thursday → its week ends Sunday 2026-10-25. 2026-10-26 is the next Monday (week ends 2026-11-01).
const task = (id: string, due: string, over: Partial<RawTask> = {}): RawTask => ({
  id, title: `Tarea ${id}`, due_date: due, project_id: `p-${id}`, project_name: 'Proyecto', workspace_id: 'ws-a', ...over,
})
const WS = new Map<string, WorkspaceInfo>([
  ['ws-a', { id: 'ws-a', name: 'Mesa Inteligente', color: '#8C5BA8' }],
  ['ws-b', { id: 'ws-b', name: 'TPY', color: '#3E7CB1' }],
])
const HATS = new Map([['ws-a', 'Administración']])

describe('bucketTasks', () => {
  const tasks = [
    task('late', '2026-10-20'),
    task('today', '2026-10-22'),
    task('fri', '2026-10-23'),
    task('sun', '2026-10-25'),
    task('next', '2026-10-26'), // after Sunday: not in this week
  ]

  it('daily splits overdue / today / rest of the week and drops what is further out', () => {
    const b = bucketTasks(tasks, '2026-10-22', 'daily')
    expect(b.overdue.map(t => t.id)).toEqual(['late'])
    expect(b.today.map(t => t.id)).toEqual(['today'])
    expect(b.week.map(t => t.id)).toEqual(['fri', 'sun'])
  })

  it('weekly (Monday) folds today into the week and has no "today" bucket', () => {
    const b = bucketTasks([task('late', '2026-10-24'), task('mon', '2026-10-26'), task('sun', '2026-11-01'), task('far', '2026-11-02')], '2026-10-26', 'weekly')
    expect(b.overdue.map(t => t.id)).toEqual(['late'])
    expect(b.today).toEqual([])
    expect(b.week.map(t => t.id)).toEqual(['mon', 'sun'])
  })

  it('ignores tasks without a date', () => {
    const b = bucketTasks([{ ...task('x', ''), due_date: '' }], '2026-10-22', 'daily')
    expect(b).toEqual({ overdue: [], today: [], week: [] })
  })
})

describe('groupBucket', () => {
  it('groups by empresa, attaches the cargo and links to the project', () => {
    const g = groupBucket(
      [task('1', '2026-10-22'), task('2', '2026-10-22', { workspace_id: 'ws-b' }), task('3', '2026-10-23')],
      WS, HATS, 10,
    )
    expect(g.total).toBe(3)
    expect(g.more).toBe(0)
    expect(g.groups.map(x => x.empresa)).toEqual(['Mesa Inteligente', 'TPY'])
    expect(g.groups[0]).toMatchObject({ hat: 'Administración', color: '#8C5BA8' })
    expect(g.groups[0].items.map(i => i.title)).toEqual(['Tarea 1', 'Tarea 3'])
    expect(g.groups[1].hat).toBeNull()
    expect(g.groups[0].items[0].url).toBe('/dashboard/projects/p-1')
  })

  it('orders items by due date and shows at most `limit`, counting the rest', () => {
    const tasks = ['2026-10-25', '2026-10-23', '2026-10-24', '2026-10-22'].map((d, i) => task(String(i), d))
    const g = groupBucket(tasks, WS, HATS, 2)
    expect(g.total).toBe(4)
    expect(g.more).toBe(2)
    expect(g.groups[0].items.map(i => i.due)).toEqual(['2026-10-22', '2026-10-23'])
  })

  it('an unknown empresa does not crash', () => {
    const g = groupBucket([task('1', '2026-10-22', { workspace_id: 'gone' })], WS, HATS, 5)
    expect(g.groups[0]).toMatchObject({ empresa: 'Sin empresa', color: null, hat: null })
  })

  it('is empty for no tasks', () => {
    expect(groupBucket([], WS, HATS, 5)).toEqual(emptyBucket())
  })
})

describe('hasContent / taskCount', () => {
  const empty = { overdue: emptyBucket(), today: emptyBucket(), week: emptyBucket(), approvals: [], unread: { total: 0, items: [] } }
  it('nothing to say → false (the digest is skipped)', () => {
    expect(hasContent(empty)).toBe(false)
    expect(taskCount(empty)).toBe(0)
  })
  it('any task, approval or unread notification → true', () => {
    expect(hasContent({ ...empty, today: { total: 1, groups: [], more: 0 } })).toBe(true)
    expect(hasContent({ ...empty, approvals: [{ title: 'Manual', label: 'documento', url: '/x' }] })).toBe(true)
    expect(hasContent({ ...empty, unread: { total: 2, items: [] } })).toBe(true)
  })
})
