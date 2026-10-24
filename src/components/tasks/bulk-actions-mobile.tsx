'use client'

import { useState } from 'react'
import { ArrowLeft, Check, CheckSquare, Clock, Flag, Trash2, User, X } from 'lucide-react'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'
import { SheetActions, Field, FIELD_CLASS, useStableCallback } from '@/components/projects/mobile-bits'
import { TASK_STATUS_OPTIONS } from '@/components/tasks/mobile-task-row'
import { haptic } from '@/components/mobile/haptics'
import type { Priority, TaskStatus } from '@/types/database'

const PRIORITIES: Array<{ value: Priority; label: string }> = [
  { value: 'very_high', label: 'Muy alta' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Media' },
  { value: 'low', label: 'Baja' },
  { value: 'very_low', label: 'Muy baja' },
]

type Screen = 'root' | 'status' | 'priority' | 'assignee' | 'due'

/**
 * Phone version of the bulk-actions bar: a pill pinned above the tab bar
 * ("3 tareas · Acciones") that opens a sheet with iOS-style push navigation.
 */
export function BulkActionsMobile({
  count, pending, members, onStatus, onPriority, onAssignee, onDue, onDelete, onClear,
}: {
  count: number
  pending: boolean
  members: Array<{ id: string; name: string }>
  onStatus: (s: TaskStatus) => void
  onPriority: (p: Priority) => void
  onAssignee: (id: string | null) => void
  onDue: (date: string | null) => void
  onDelete: () => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [screen, setScreen] = useState<Screen>('root')
  const [date, setDate] = useState('')

  const close = () => { setOpen(false); setTimeout(() => setScreen('root'), 300) }
  const act = (fn: () => void) => { haptic('success'); fn(); close() }
  const stableClose = useStableCallback(close)

  const titles: Record<Screen, string> = { root: `${count} ${count === 1 ? 'tarea' : 'tareas'}`, status: 'Estado', priority: 'Prioridad', assignee: 'Asignar a', due: 'Vencimiento' }

  return (
    <>
      <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 md:hidden">
        <div className="mx-auto flex max-w-md items-center gap-2 rounded-full border border-border bg-surface/95 p-1.5 pl-4 shadow-[0_8px_30px_rgba(10,26,38,0.25)] backdrop-blur-xl">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {count} {count === 1 ? 'seleccionada' : 'seleccionadas'}
          </span>
          <button
            type="button"
            onClick={() => { haptic(); setOpen(true) }}
            disabled={pending}
            className="h-10 rounded-full bg-signal px-5 text-sm font-bold text-night active:opacity-90 disabled:opacity-50"
          >
            Acciones
          </button>
          <button type="button" onClick={onClear} aria-label="Cancelar selección" className="flex h-10 w-10 items-center justify-center rounded-full text-graphite active:bg-border-soft">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <BottomSheet
        open={open}
        onClose={stableClose}
        title={
          screen === 'root' ? titles.root : (
            <button type="button" onClick={() => setScreen('root')} className="-ml-1 inline-flex items-center gap-1 text-left">
              <ArrowLeft className="h-5 w-5 text-signal-ink" />
              {titles[screen]}
            </button>
          )
        }
        footer={screen === 'due' ? (
          <SheetActions
            primaryLabel="Aplicar fecha"
            onPrimary={() => act(() => onDue(date))}
            disabled={!date}
            secondaryLabel="Quitar fecha"
            onSecondary={() => act(() => onDue(null))}
          />
        ) : undefined}
      >
        <div className="space-y-5 pb-3 pt-2">
          {screen === 'root' && (
            <>
              <InsetGroup>
                <ListRow title="Estado" leading={<IconTile tone="neutral"><CheckSquare /></IconTile>} chevron onClick={() => setScreen('status')} />
                <ListRow title="Prioridad" leading={<IconTile tone="neutral"><Flag /></IconTile>} chevron onClick={() => setScreen('priority')} />
                <ListRow title="Asignar a" leading={<IconTile tone="neutral"><User /></IconTile>} chevron onClick={() => setScreen('assignee')} />
                <ListRow title="Vencimiento" leading={<IconTile tone="neutral"><Clock /></IconTile>} chevron onClick={() => setScreen('due')} />
              </InsetGroup>
              <InsetGroup>
                <ListRow title={`Borrar ${count} ${count === 1 ? 'tarea' : 'tareas'}`} destructive leading={<IconTile tone="danger"><Trash2 /></IconTile>} onClick={() => { close(); onDelete() }} />
              </InsetGroup>
            </>
          )}
          {screen === 'status' && (
            <InsetGroup>
              {TASK_STATUS_OPTIONS.map(o => (
                <ListRow key={o.value} title={o.label} leading={<span className={`h-3 w-3 rounded-full ${o.dot}`} />} onClick={() => act(() => onStatus(o.value))} />
              ))}
            </InsetGroup>
          )}
          {screen === 'priority' && (
            <InsetGroup>
              {PRIORITIES.map(p => <ListRow key={p.value} title={p.label} onClick={() => act(() => onPriority(p.value))} />)}
            </InsetGroup>
          )}
          {screen === 'assignee' && (
            <InsetGroup>
              <ListRow title="Sin asignar" subtitle="Quitar responsable" trailing={<Check className="h-5 w-5 opacity-0" />} onClick={() => act(() => onAssignee(null))} />
              {members.map(m => <ListRow key={m.id} title={m.name} onClick={() => act(() => onAssignee(m.id))} />)}
            </InsetGroup>
          )}
          {screen === 'due' && (
            <Field label="Nueva fecha">
              <input type="date" className={FIELD_CLASS} value={date} onChange={e => setDate(e.target.value)} />
            </Field>
          )}
        </div>
      </BottomSheet>
    </>
  )
}
