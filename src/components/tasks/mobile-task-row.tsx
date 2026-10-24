'use client'

import type { ReactNode } from 'react'
import { Check, CircleDot, MoreHorizontal } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { BlockedChip } from '@/components/ui/blocked-chip'
import { DueDateChip } from '@/components/ui/due-date-chip'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { InsetGroup, ListRow } from '@/components/mobile/inset-list'
import { SwipeRow, type SwipeAction } from '@/components/mobile/swipe-row'
import { haptic } from '@/components/mobile/haptics'
import { PRIORITY, cn } from '@/lib/utils'
import type { TaskStatus } from '@/types/database'

export const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string; dot: string }> = [
  { value: 'todo', label: 'Por hacer', dot: 'bg-graphite' },
  { value: 'in_progress', label: 'En progreso', dot: 'bg-info' },
  { value: 'in_review', label: 'En revisión', dot: 'bg-signal' },
  { value: 'done', label: 'Listo', dot: 'bg-success' },
  { value: 'canceled', label: 'Cancelado', dot: 'bg-danger' },
]

export interface RowTask {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  assignee?: { name: string; avatar_url: string | null } | null
  project?: { id: string; code: string; name: string; color: string } | null
  blocking?: Parameters<typeof BlockedChip>[0]['blocking']
}

/** The brand checkbox from the mobile prototype: 22px, radius 7, 1.5px border; Señal fill + check when done. */
export function TaskCheck({ done, onToggle, label }: { done: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); haptic(done ? 'tap' : 'success'); onToggle() }}
      aria-label={label ?? (done ? 'Marcar como pendiente' : 'Marcar como hecha')}
      aria-pressed={done}
      // 44px touch target around the 22px visual box.
      className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center"
    >
      <span
        className={cn(
          'flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border-[1.5px] transition-all duration-200',
          done ? 'scale-100 border-signal bg-signal text-night' : 'border-[#C9C0B2] dark:border-graphite',
        )}
      >
        {done && <Check className="h-3.5 w-3.5" strokeWidth={3.2} />}
      </span>
    </button>
  )
}

/**
 * One task as an iOS list row: checkbox · title + meta · avatar. Swipe left for
 * "Hecho" and "Más". Rows are meant to sit inside a rounded card with hairline
 * separators (wrap them in <TaskCard>).
 */
export function MobileTaskRow({
  task, onOpen, onToggleDone, onMore, showProject, selectMode, selected, onSelectToggle, trailing,
}: {
  task: RowTask
  onOpen: () => void
  onToggleDone: () => void
  onMore?: () => void
  showProject?: boolean
  /** Bulk-select mode: the checkbox becomes a selection circle. */
  selectMode?: boolean
  selected?: boolean
  onSelectToggle?: () => void
  trailing?: ReactNode
}) {
  const isDone = task.status === 'done' || task.status === 'canceled'
  const priority = PRIORITY[task.priority as keyof typeof PRIORITY]
  const actions: SwipeAction[] = [
    isDone
      ? { label: 'Reabrir', tone: 'neutral', icon: <CircleDot className="h-5 w-5" />, onTrigger: onToggleDone }
      : { label: 'Hecho', tone: 'success', icon: <Check className="h-5 w-5" strokeWidth={3} />, onTrigger: onToggleDone },
  ]
  if (onMore) actions.push({ label: 'Más', tone: 'neutral', icon: <MoreHorizontal className="h-5 w-5" />, onTrigger: onMore })

  const body = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => (selectMode ? onSelectToggle?.() : onOpen())}
      onKeyDown={e => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (selectMode) onSelectToggle?.()
        else onOpen()
      }}
      className={cn(
        'flex min-h-[62px] w-full items-center gap-3 px-4 py-2.5 transition-colors active:bg-border-soft',
        selected && 'bg-signal-wash dark:bg-signal/10',
      )}
    >
      {selectMode ? (
        <span
          className={cn(
            'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors',
            selected ? 'border-signal bg-signal text-night' : 'border-[#C9C0B2] dark:border-graphite',
          )}
          aria-hidden
        >
          {selected && <Check className="h-3.5 w-3.5" strokeWidth={3.2} />}
        </span>
      ) : (
        <TaskCheck done={isDone} onToggle={onToggleDone} />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('flex min-w-0 items-center gap-1.5 text-[15px] font-medium leading-snug text-foreground', isDone && 'text-graphite line-through decoration-graphite/50')}>
          <span className="truncate">{task.title}</span>
          <BlockedChip blocking={task.blocking} />
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-x-2 text-xs text-graphite">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', priority?.dot ?? 'bg-graphite')} title={priority?.label} />
          {showProject && task.project && (
            <span className="flex min-w-0 items-center gap-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: task.project.color }} />
              <span className="truncate font-mono text-[11px]">{task.project.code}</span>
            </span>
          )}
          {task.due_date ? <DueDateChip date={task.due_date} isDone={isDone} variant="text" /> : <span>Sin fecha</span>}
        </p>
      </div>
      {trailing}
      {task.assignee && (
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarImage src={task.assignee.avatar_url ?? undefined} />
          <AvatarFallback className="text-[10px]">{task.assignee.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      )}
    </div>
  )

  return selectMode ? body : <SwipeRow actions={actions} className="cv-auto-row">{body}</SwipeRow>
}

/** Rounded card that holds task rows, with hairline separators. */
export function TaskCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-[14px] border border-border bg-surface [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-border-soft', className)}>
      {children}
    </div>
  )
}

/** Friendly empty state used by every task list on phones (never a blank white card). */
export function TaskEmpty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[14px] border border-dashed border-border bg-surface px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-border-soft text-graphite [&>svg]:h-7 [&>svg]:w-7">{icon}</span>
      <p className="mt-4 font-display text-lg font-extrabold tracking-[-0.03em] text-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-[17rem] text-[13px] text-graphite">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/**
 * "Más" sheet for a task: change status (list with a check) plus extra rows
 * (edit, open project, delete…) supplied by the caller.
 */
export function TaskActionsSheet({
  open, onClose, title, status, onStatus, children,
}: { open: boolean; onClose: () => void; title: string; status?: string; onStatus?: (s: TaskStatus) => void; children?: ReactNode }) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title.length > 40 ? `${title.slice(0, 38)}…` : title}>
      <div className="space-y-5 pb-3 pt-2">
        {onStatus && (
          <InsetGroup label="Estado">
            {TASK_STATUS_OPTIONS.map(o => (
              <ListRow
                key={o.value}
                title={o.label}
                leading={<span className={cn('h-3 w-3 rounded-full', o.dot)} />}
                selected={status === o.value}
                trailing={status === o.value ? <Check className="h-5 w-5 text-signal-ink" /> : undefined}
                onClick={() => { haptic(); onStatus(o.value); onClose() }}
              />
            ))}
          </InsetGroup>
        )}
        {children}
      </div>
    </BottomSheet>
  )
}
