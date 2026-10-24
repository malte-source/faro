'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2, Undo2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { useEmpresaFilter } from '@/stores/empresa-filter'
import { EmpresaChips } from '@/components/layout/empresa-chips'
import { EmptyState } from '@/components/ui/empty-state'
import { SwipeRow } from '@/components/mobile/swipe-row'
import { haptic } from '@/components/mobile/haptics'
import { ROW_FOCUS_RING, useListNavigation } from '@/components/shortcuts/use-list-navigation'
import { changeStatusWithUndo } from '@/lib/task-undo'
import type { TaskStatus } from '@/types/database'
import { addDays, daysBetween } from '@/lib/tz'
import { cn } from '@/lib/utils'

type Item = {
  id: string
  title: string
  status: string
  dueDate: string | null
  project: { id: string; name: string } | null
  workspace: { id: string; name: string; color: string } | null
  hat: string | null
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Buen día'
  if (h < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

const WEEKDAY = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** Short due label: "hace 2 d" for late tasks, the weekday for the rest of the week. */
function dueLabel(dueDate: string | null, today: string | undefined): string | null {
  if (!dueDate || !today) return null
  const diff = daysBetween(dueDate, today)
  if (diff > 0) return `hace ${diff} d`
  if (diff === 0) return null
  return WEEKDAY[new Date(`${addDays(dueDate, 0)}T12:00:00Z`).getUTCDay()]
}

/** 22px square checkbox from the brand prototype (radius 7, 1.5px stone border). */
function Check22({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={done ? 'Deshacer: marcar como pendiente' : 'Marcar como hecha'}
      aria-pressed={done}
      className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center"
    >
      <span
        className={cn(
          'flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border-[1.5px] transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
          done ? 'scale-100 border-signal bg-signal text-night' : 'border-[#C9C0B2] bg-surface dark:border-graphite',
        )}
      >
        {done && <Check className="h-3.5 w-3.5" strokeWidth={3.2} />}
      </span>
    </button>
  )
}

function TaskRow({ t, done, onToggle, today, focused }: { t: Item; done: boolean; onToggle: () => void; today?: string; focused?: boolean }) {
  const due = dueLabel(t.dueDate, today)
  const late = !!t.dueDate && !!today && t.dueDate < today
  return (
    <SwipeRow
      className={cn(focused && ROW_FOCUS_RING)}
      actions={[
        done
          ? { label: 'Deshacer', icon: <Undo2 className="h-5 w-5" />, tone: 'neutral', onTrigger: onToggle }
          : { label: 'Hecho', icon: <Check className="h-5 w-5" strokeWidth={3} />, tone: 'success', onTrigger: onToggle },
      ]}
    >
      <div className={cn('flex min-h-[60px] items-center gap-3.5 px-4 py-2.5 transition-opacity duration-200', done && 'opacity-50')}>
        <Check22 done={done} onClick={() => { haptic(done ? 'tap' : 'success'); onToggle() }} />
        <Link href={t.project ? `/dashboard/projects/${t.project.id}` : '#'} className="min-w-0 flex-1 py-0.5 active:opacity-70">
          <p className={cn('truncate text-[15px] font-medium leading-snug text-foreground', done && 'line-through')}>{t.title}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-snug text-graphite">
            {t.workspace && <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: t.workspace.color }} />}
            <span className="truncate">
              {[t.workspace?.name, t.hat, t.project?.name].filter(Boolean).join(' · ')}
            </span>
          </p>
        </Link>
        {due && (
          <span className={cn('shrink-0 font-mono text-[11px] font-medium uppercase tracking-wide', late ? 'text-danger' : 'text-graphite')}>{due}</span>
        )}
      </div>
    </SwipeRow>
  )
}

/** "Hoy": one inbox with every task of the person, across all their empresas. */
export function HoyView() {
  const filter = useEmpresaFilter(s => s.workspaceId)
  const utils = trpc.useUtils()
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const { data, isLoading } = trpc.inbox.today.useQuery(
    { workspaceId: filter ?? undefined },
    { refetchInterval: 60_000 },
  )

  // Checked tasks stay on screen (struck through, with "Deshacer") until the
  // list refetches, so a misclick is never one reload away from lost.
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const update = trpc.tasks.update.useMutation()

  // Refetch 8 s after the last check, and when leaving the screen with checks pending.
  const refresh = useCallback(() => {
    void utils.inbox.invalidate()
    void utils.tasks.invalidate()
  }, [utils])
  const pending = useRef(false)
  useEffect(() => {
    pending.current = checked.size > 0
    if (checked.size === 0) return
    const timer = setTimeout(() => { pending.current = false; refresh() }, 8000)
    return () => clearTimeout(timer)
  }, [checked, refresh])
  useEffect(() => () => { if (pending.current) refresh() }, [refresh])

  // Single place that changes a task here: marks the row and saves the status.
  const applyStatus = (id: string, status: string) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (status === 'done') next.add(id); else next.delete(id)
      return next
    })
    update.mutate({ id, status: status as TaskStatus })
  }

  const toggle = (item: Item) => {
    if (checked.has(item.id)) {
      // Un-checking by hand puts the task back to the status it had, not always "todo".
      applyStatus(item.id, item.status === 'done' ? 'todo' : item.status)
    } else {
      // Completing opens a 6 s window: "Deshacer" (or ⌘Z) restores the previous status.
      changeStatusWithUndo({ title: item.title, from: item.status, to: 'done', apply: st => applyStatus(item.id, st) })
    }
  }

  // Keyboard: j / k move a ring over the rows, x completes, Enter or e opens the project.
  const router = useRouter()
  const rows = useMemo(() => (data ? [...data.late, ...data.dueToday, ...data.week] : []), [data])
  const { focusedId, rowProps } = useListNavigation<Item>(rows, {
    onToggle: toggle,
    onOpen: row => { if (row.project) router.push(`/dashboard/projects/${row.project.id}`) },
  })

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 pt-2 md:px-0 md:pt-0" aria-busy>
        <div className="h-5 w-40 animate-pulse rounded bg-border-soft" />
        <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
          {[0, 1, 2].map(i => <div key={i} className="m-3 h-9 animate-pulse rounded-lg bg-border-soft" />)}
        </div>
      </div>
    )
  }

  const late = data?.late ?? []
  const dueToday = data?.dueToday ?? []
  const week = data?.week ?? []
  const urgent = [...late, ...dueToday]
  const empresasToday = new Set(urgent.map(t => t.workspace?.id).filter(Boolean)).size
  const firstName = (me?.user.name ?? '').split(' ')[0]
  const today = data?.today

  const groups: Array<{ key: string; label: string; tone: string; items: Item[] }> = [
    { key: 'late', label: 'Atrasadas', tone: 'text-danger', items: late },
    { key: 'today', label: 'Hoy', tone: 'text-signal-ink', items: dueToday },
    { key: 'week', label: 'Esta semana', tone: 'text-graphite', items: week },
  ]

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-6 pt-1 md:px-0 md:pb-0 md:pt-0">
      <div className="space-y-3">
        <div>
          <h2 className="font-display text-[22px] font-extrabold tracking-[-0.035em] text-foreground md:text-2xl md:tracking-[-0.02em]">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h2>
          <p className="mt-0.5 text-[13px] text-graphite md:text-sm">
            {urgent.length === 0
              ? 'Nada pendiente para hoy.'
              : `${urgent.length} ${urgent.length === 1 ? 'tarea pendiente' : 'tareas pendientes'} para hoy${empresasToday > 0 ? ` · ${empresasToday} ${empresasToday === 1 ? 'empresa' : 'empresas'}` : ''}`}
          </p>
        </div>
        <EmpresaChips />
      </div>

      {late.length + dueToday.length + week.length === 0 ? (
        <EmptyState icon={CheckCircle2} tone="success" title="Nada pendiente." description="Cuando te asignen algo, aparece aquí." />
      ) : (
        groups.map(g => (
          <section key={g.key} aria-label={g.label}>
            <h3 className={cn('mb-1.5 flex items-center gap-2 px-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em]', g.tone)}>
              {g.label}
              <span className="tabular-nums text-graphite">{g.items.length}</span>
            </h3>
            {g.items.length === 0 ? (
              <p className="rounded-[14px] border border-dashed border-border px-4 py-3.5 text-sm text-graphite">Nada por aquí.</p>
            ) : (
              <ul className="divide-y divide-border-soft overflow-hidden rounded-[14px] border border-border bg-surface">
                {g.items.map(t => (
                  <li key={t.id} {...rowProps(t.id)}>
                    <TaskRow t={t} done={checked.has(t.id)} onToggle={() => toggle(t)} today={today} focused={focusedId === t.id} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  )
}
