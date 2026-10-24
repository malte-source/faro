'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { X, CheckSquare, Trash2, User, Flag, Clock, ChevronDown, Check } from 'lucide-react'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import type { TaskStatus, Priority } from '@/types/database'
import { BulkActionsMobile } from '@/components/tasks/bulk-actions-mobile'

interface Props {
  selectedIds: string[]
  onClear: () => void
}

/**
 * Floating action bar shown when one or more tasks are selected via
 * checkboxes in the tasks overview. Lets the user apply bulk changes
 * (assignee, status, priority, due date, delete) in one round-trip.
 *
 * Positioned `fixed bottom-4 center` over the page; hidden when count = 0.
 */
export function BulkActionsBar({ selectedIds, onClear }: Props) {
  const utils = trpc.useUtils()
  const { data: members } = trpc.team.members.useQuery()
  const [open, setOpen] = useState<null | 'status' | 'priority' | 'assignee' | 'due'>(null)
  const [dueDate, setDueDate] = useState('')

  const bulkUpdate = trpc.tasks.bulkUpdate.useMutation({
    onSuccess: () => {
      utils.tasks.invalidate()
      utils.tasks.invalidate()
      onClear()
      setOpen(null)
    },
  })

  const bulkDelete = trpc.tasks.bulkDelete.useMutation({
    onSuccess: () => {
      utils.tasks.invalidate()
      utils.tasks.invalidate()
      onClear()
    },
  })

  if (selectedIds.length === 0) return null

  const count = selectedIds.length
  const pending = bulkUpdate.isPending || bulkDelete.isPending

  return (
    <>
    <BulkActionsMobile
      count={count}
      pending={pending}
      members={members ?? []}
      onStatus={s => bulkUpdate.mutate({ ids: selectedIds, changes: { status: s } })}
      onPriority={p => bulkUpdate.mutate({ ids: selectedIds, changes: { priority: p } })}
      onAssignee={id => bulkUpdate.mutate({ ids: selectedIds, changes: { assigneeId: id } })}
      onDue={d => bulkUpdate.mutate({ ids: selectedIds, changes: { dueDate: d } })}
      onClear={onClear}
      onDelete={async () => {
        const ok = await confirmAction({
          title: `Borrar ${count} ${count === 1 ? 'tarea' : 'tareas'}`,
          description: 'No se puede deshacer.',
          variant: 'destructive',
          confirmLabel: `Borrar ${count}`,
        })
        if (ok) bulkDelete.mutate({ ids: selectedIds })
      }}
    />
    <div className="fixed bottom-4 left-1/2 z-40 hidden -translate-x-1/2 md:block">
      <div className="flex items-center gap-2 rounded-2xl border border-stone bg-white px-3 py-2 shadow-2xl dark:border-ink-body dark:bg-night-700">
        <span className="rounded-md bg-foreground px-2 py-0.5 text-xs font-semibold text-background">
          {count} {count === 1 ? 'tarea' : 'tareas'}
        </span>

        <div className="h-5 w-px bg-stone dark:bg-ink-body" />

        {/* Status */}
        <DropdownButton
          icon={<CheckSquare className="h-3.5 w-3.5" />}
          label="Estado"
          open={open === 'status'}
          onToggle={() => setOpen(open === 'status' ? null : 'status')}
        >
          {(['todo', 'in_progress', 'in_review', 'done', 'canceled'] as TaskStatus[]).map(s => (
            <DropdownItem
              key={s}
              onClick={() => bulkUpdate.mutate({ ids: selectedIds, changes: { status: s } })}
            >
              {STATUS_LABELS[s]}
            </DropdownItem>
          ))}
        </DropdownButton>

        {/* Priority */}
        <DropdownButton
          icon={<Flag className="h-3.5 w-3.5" />}
          label="Prioridad"
          open={open === 'priority'}
          onToggle={() => setOpen(open === 'priority' ? null : 'priority')}
        >
          {(['very_high', 'high', 'medium', 'low', 'very_low'] as Priority[]).map(p => (
            <DropdownItem
              key={p}
              onClick={() => bulkUpdate.mutate({ ids: selectedIds, changes: { priority: p } })}
            >
              {PRIORITY_LABELS[p]}
            </DropdownItem>
          ))}
        </DropdownButton>

        {/* Assignee */}
        <DropdownButton
          icon={<User className="h-3.5 w-3.5" />}
          label="Asignar"
          open={open === 'assignee'}
          onToggle={() => setOpen(open === 'assignee' ? null : 'assignee')}
        >
          <DropdownItem onClick={() => bulkUpdate.mutate({ ids: selectedIds, changes: { assigneeId: null } })}>
            <span className="text-graphite italic">Sin asignar</span>
          </DropdownItem>
          {(members ?? []).map(m => (
            <DropdownItem
              key={m.id}
              onClick={() => bulkUpdate.mutate({ ids: selectedIds, changes: { assigneeId: m.id } })}
            >
              {m.name}
            </DropdownItem>
          ))}
        </DropdownButton>

        {/* Due date */}
        <DropdownButton
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Vencimiento"
          open={open === 'due'}
          onToggle={() => setOpen(open === 'due' ? null : 'due')}
        >
          <div className="px-3 py-2 space-y-2">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border border-stone px-2 py-1 text-xs dark:border-ink-body dark:bg-night-700"
            />
            <button
              onClick={() => bulkUpdate.mutate({ ids: selectedIds, changes: { dueDate } })}
              disabled={!dueDate}
              className="w-full rounded-md bg-foreground px-3 py-1 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-50"
            >
              Aplicar
            </button>
            <button
              onClick={() => bulkUpdate.mutate({ ids: selectedIds, changes: { dueDate: null } })}
              className="w-full rounded-md text-xs text-graphite hover:text-body"
            >
              Limpiar fecha
            </button>
          </div>
        </DropdownButton>

        <div className="h-5 w-px bg-stone dark:bg-ink-body" />

        {/* Delete */}
        <button
          onClick={async () => {
            const ok = await confirmAction({
              title: `Borrar ${count} ${count === 1 ? 'tarea' : 'tareas'}`,
              description: 'No se puede deshacer.',
              variant: 'destructive',
              confirmLabel: `Borrar ${count}`,
            })
            if (ok) bulkDelete.mutate({ ids: selectedIds })
          }}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger transition hover:bg-danger-wash disabled:opacity-50 dark:hover:bg-danger/40"
          title="Eliminar"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        <button
          onClick={onClear}
          className="ml-1 rounded-md p-1 text-graphite hover:bg-stone-100 hover:text-body dark:hover:bg-ink-body"
          title="Cancelar selección"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
    </>
  )
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  done: 'Listo',
  canceled: 'Cancelado',
}

const PRIORITY_LABELS: Record<Priority, string> = {
  very_high: 'Muy alta',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
  very_low: 'Muy baja',
}

function DropdownButton({
  icon, label, open, onToggle, children,
}: {
  icon: React.ReactNode
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition',
          open
            ? 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal'
            : 'text-graphite hover:bg-mist dark:text-stone dark:hover:bg-ink-body',
        )}
      >
        {icon}{label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[160px] overflow-hidden rounded-lg border border-stone bg-white shadow-lg dark:border-ink-body dark:bg-night">
          {children}
        </div>
      )}
    </div>
  )
}

function DropdownItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-body transition hover:bg-signal-wash hover:text-night dark:text-stone dark:hover:bg-signal/40 dark:hover:text-signal"
    >
      <Check className="h-3 w-3 opacity-0" />
      {children}
    </button>
  )
}
