'use client'

import { Segmented } from '@/components/mobile/segmented'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { AlertOctagon, Calendar, Users, Trash2, CheckSquare } from 'lucide-react'

/**
 * Eisenhower matrix view of tasks.
 *
 * Axis:
 *   Urgent     = due in next 3 days (or already overdue)
 *   Important  = priority is "high" or "very_high"
 *
 * Quadrants:
 *   Q1 — Urgente + Importante   → "Hacer ya"        (red)
 *   Q2 — Importante NO urgente  → "Planificar"      (cyan)
 *   Q3 — Urgente NO importante  → "Delegar"         (amber)
 *   Q4 — Ni urgente ni importante → "Postponer"     (slate)
 */

const URGENT_DAYS = 3
const DAY_MS = 86_400_000

type Task = {
  id: string
  title: string
  priority: 'very_high' | 'high' | 'medium' | 'low' | 'very_low'
  due_date: string | null
  status: string
  assignee?: { id: string; name: string; avatar_url: string | null } | null
  project?: { id: string; code: string; name: string; color: string } | null
}

function isUrgent(t: Task): boolean {
  if (!t.due_date) return false
  const due = new Date(t.due_date + 'T23:59:59').getTime()
  const now = Date.now()
  return due - now <= URGENT_DAYS * DAY_MS
}

function isImportant(t: Task): boolean {
  return t.priority === 'high' || t.priority === 'very_high'
}

function classify(t: Task): 1 | 2 | 3 | 4 {
  const u = isUrgent(t)
  const i = isImportant(t)
  if (u && i) return 1
  if (!u && i) return 2
  if (u && !i) return 3
  return 4
}

function fmtDate(s: string | null): string | null {
  if (!s) return null
  const d = new Date(s + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / DAY_MS)
  if (days < 0) return `Vencida hace ${Math.abs(days)}d`
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Mañana'
  if (days < 7) return `En ${days}d`
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' })
}

const QUADRANTS = [
  {
    n: 1 as const,
    title: 'Hacer ya',
    subtitle: 'Urgente · Importante',
    icon: AlertOctagon,
    classes: {
      card: 'border-danger/30 bg-danger-wash/60 dark:border-danger/50 dark:bg-danger/30',
      header: 'text-danger dark:text-danger/50',
      icon: 'bg-danger text-white',
    },
  },
  {
    n: 2 as const,
    title: 'Planificar',
    subtitle: 'Importante · No urgente',
    icon: Calendar,
    classes: {
      card: 'border-stone bg-signal-wash/60 dark:border-signal/50 dark:bg-signal/30',
      header: 'text-night dark:text-signal',
      icon: 'bg-night text-white',
    },
  },
  {
    n: 3 as const,
    title: 'Delegar',
    subtitle: 'Urgente · No importante',
    icon: Users,
    classes: {
      card: 'border-signal/30 bg-signal-wash/60 dark:border-signal-ink/50 dark:bg-signal/30',
      header: 'text-signal-ink dark:text-signal/50',
      icon: 'bg-signal-ink text-white',
    },
  },
  {
    n: 4 as const,
    title: 'Postponer / Eliminar',
    subtitle: 'Ni urgente ni importante',
    icon: Trash2,
    classes: {
      card: 'border-stone bg-mist dark:border-night-700 dark:bg-night/40',
      header: 'text-graphite dark:text-graphite',
      icon: 'bg-graphite text-white',
    },
  },
]

export function EisenhowerMatrix() {
  const [onlyMine, setOnlyMine] = useState(true)
  const utils = trpc.useUtils()

  const { data: rawTasks, isLoading } = trpc.tasks.list.useQuery({ onlyMine })

  const tasks = useMemo(() => {
    if (!rawTasks) return []
    return rawTasks.filter(
      t => t.status !== 'done' && t.status !== 'canceled',
    ) as Task[]
  }, [rawTasks])

  const grouped = useMemo(() => {
    const g: Record<1 | 2 | 3 | 4, Task[]> = { 1: [], 2: [], 3: [], 4: [] }
    for (const t of tasks) g[classify(t)].push(t)
    return g
  }, [tasks])

  const markDone = trpc.tasks.update.useMutation({
    onSuccess: () => utils.tasks.invalidate(),
  })

  return (
    <div className="space-y-4">
      {/* Filter toolbar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Segmented
          className="md:hidden"
          aria-label="Alcance"
          value={onlyMine ? 'mine' : 'all'}
          onChange={v => setOnlyMine(v === 'mine')}
          options={[{ value: 'mine', label: 'Mis tareas' }, { value: 'all', label: 'Todas' }]}
        />
        <p className="text-sm text-graphite">
          {tasks.length} {tasks.length === 1 ? 'tarea pendiente' : 'tareas pendientes'} ·
          urgente = vence en ≤ {URGENT_DAYS} días · importante = prioridad alta
        </p>
        <div className="hidden rounded-lg border border-stone p-0.5 md:inline-flex dark:border-ink-body">
          <button
            onClick={() => setOnlyMine(true)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition',
              onlyMine
                ? 'bg-night text-white dark:bg-signal dark:text-night'
                : 'text-graphite hover:text-ink-body dark:text-graphite dark:hover:text-stone',
            )}
          >Mis tareas</button>
          <button
            onClick={() => setOnlyMine(false)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition',
              !onlyMine
                ? 'bg-night text-white dark:bg-signal dark:text-night'
                : 'text-graphite hover:text-ink-body dark:text-graphite dark:hover:text-stone',
            )}
          >Todas</button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {QUADRANTS.map(q => {
          const list = grouped[q.n]
          const Icon = q.icon
          return (
            <section
              key={q.n}
              className={cn(
                'rounded-xl border p-4',
                q.classes.card,
              )}
            >
              <header className="mb-3 flex items-center gap-2.5">
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', q.classes.icon)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="flex-1">
                  <h2 className={cn('text-sm font-semibold', q.classes.header)}>{q.title}</h2>
                  <p className="text-[10px] uppercase tracking-wider text-graphite">{q.subtitle}</p>
                </div>
                <span className="rounded-md bg-white/60 px-2 py-0.5 text-xs font-bold tabular-nums text-ink-body dark:bg-night/60 dark:text-stone">
                  {list.length}
                </span>
              </header>

              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-md bg-white/40 dark:bg-night/40" />
                  ))}
                </div>
              ) : list.length === 0 ? (
                <p className="py-6 text-center text-xs text-graphite">
                  Sin tareas en este cuadrante.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {list.slice(0, 8).map(t => (
                    <li
                      key={t.id}
                      className="group flex items-start gap-2 rounded-lg bg-white/70 p-2 transition hover:bg-white dark:bg-night/40 dark:hover:bg-night/70"
                    >
                      <button
                        onClick={() => markDone.mutate({ id: t.id, status: 'done' })}
                        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-stone transition hover:border-success hover:bg-success-wash dark:border-graphite"
                        title="Marcar completada"
                      >
                        <CheckSquare className="h-3 w-3 text-success md:opacity-0 md:group-hover:opacity-100" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={t.project ? `/dashboard/projects/${t.project.id}` : '#'}
                          className="block truncate text-sm font-medium text-night-700 hover:text-night dark:text-stone dark:hover:text-signal"
                        >
                          {t.title}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-graphite">
                          {t.project && (
                            <span className="flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.project.color }} />
                              {t.project.code}
                            </span>
                          )}
                          {t.due_date && (
                            <span className={cn(
                              isUrgent(t) && 'font-semibold text-danger',
                            )}>{fmtDate(t.due_date)}</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                  {list.length > 8 && (
                    <li className="pt-1 text-center text-[10px] text-graphite">
                      + {list.length - 8} más
                    </li>
                  )}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
