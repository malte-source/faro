'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  UniqueIdentifier,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AddTaskDialog } from './add-task-dialog'
import { TaskDetailPanel } from './task-detail-panel'
import { PRIORITY } from '@/lib/utils'
import { Plus, AlertCircle, GripVertical } from 'lucide-react'
import type { TaskStatus } from '@/types/database'
import { DueDateChip } from '@/components/ui/due-date-chip'
import { BlockedChip } from '@/components/ui/blocked-chip'
import { TaskActionsSheet } from '@/components/tasks/mobile-task-row'
import { FilterChip } from './mobile-bits'

const COLUMNS: { id: TaskStatus; label: string; accent: string; headerBg: string }[] = [
  { id: 'todo',        label: 'Por hacer',   accent: 'bg-stone',  headerBg: 'bg-background'  },
  { id: 'in_progress', label: 'En progreso', accent: 'bg-info',   headerBg: 'bg-info/10'   },
  { id: 'in_review',   label: 'En revisión', accent: 'bg-yellow-400', headerBg: 'bg-signal-wash dark:bg-signal/10' },
  { id: 'done',        label: 'Listo',       accent: 'bg-success',headerBg: 'bg-success-wash dark:bg-success/15'},
  { id: 'canceled',   label: 'Cancelado',   accent: 'bg-danger/50',    headerBg: 'bg-danger-wash dark:bg-danger/15'    },
]

/* ──────────────────────────── task card ──────────────────────────── */

interface TaskType {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  assignee: { name: string; avatar_url: string | null } | null
  blocking?: Array<{ id: string; depends_on: { id: string; title: string; status: string } | null }>
}

function TaskCardContent({ task }: { task: TaskType; listeners?: Record<string, unknown> }) {
  const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
  const isDone = task.status === 'done' || task.status === 'canceled'

  return (
    <>
      <p className="text-sm font-medium text-foreground leading-snug pr-8 md:pr-1 inline-flex items-center gap-1.5">
        <span className="line-clamp-2">{task.title}</span>
        <BlockedChip blocking={task.blocking} />
      </p>
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${priorityInfo?.dot ?? 'bg-stone'}`} />
          <span className={`text-[11px] font-medium ${priorityInfo?.color ?? 'text-graphite'}`}>
            {priorityInfo?.label}
          </span>
        </div>
        {task.assignee && (
          <Avatar className="h-5 w-5">
            <AvatarImage src={task.assignee.avatar_url ?? undefined} />
            <AvatarFallback className="text-[9px]">
              {task.assignee.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
      {task.due_date && (
        <div className="mt-1.5">
          <DueDateChip date={task.due_date} isDone={isDone} variant="text" />
        </div>
      )}
    </>
  )
}

/* Draggable wrapper */
function DraggableCard({ task, onClick, onMove }: { task: TaskType; onClick: () => void; onMove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative rounded-lg border border-border bg-surface p-3 shadow-sm hover:shadow-md hover:border-border transition-all cursor-pointer"
    >
      {/* Drag handle */}
      <button
        {...listeners}
        {...attributes}
        className="absolute right-1 top-1 flex h-9 w-9 touch-none cursor-grab items-center justify-center text-graphite/70 transition-colors active:cursor-grabbing md:right-2 md:top-2.5 md:h-auto md:w-auto md:text-stone md:hover:text-graphite opacity-100 md:opacity-0 md:group-hover:opacity-100"
        onClick={e => e.stopPropagation()}
        title="Arrastrar"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Clicking the card (not the handle) opens detail panel */}
      <div onClick={onClick}>
        <TaskCardContent task={task} />
      </div>
      {/* Phones: moving between columns without a long-press drag */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onMove() }}
        className="mt-2.5 inline-flex h-8 items-center rounded-full bg-border-soft px-3 text-xs font-medium text-graphite active:bg-border md:hidden"
      >
        Mover a… ›
      </button>
    </div>
  )
}

/* Overlay card rendered by DragOverlay */
function OverlayCard({ task }: { task: TaskType }) {
  return (
    <div className="w-64 rounded-lg border border-signal/40 bg-surface p-3 shadow-xl ring-2 ring-signal/30 rotate-2 scale-105">
      <TaskCardContent task={task} />
    </div>
  )
}

/* ──────────────────────────── droppable column ──────────────────────── */

function DroppableColumn({
  col,
  tasks,
  isLoading,
  onAdd,
  onCardClick,
  onMove,
}: {
  col: typeof COLUMNS[number]
  tasks: TaskType[]
  isLoading: boolean
  onAdd: (status: TaskStatus) => void
  onCardClick: (taskId: string) => void
  onMove: (taskId: string) => void
}) {
  const { isOver, setNodeRef } = useDroppable({ id: col.id })

  return (
    <div
      ref={setNodeRef}
      id={`col-${col.id}`}
      className={`flex w-[80vw] max-w-[320px] shrink-0 snap-center flex-col rounded-xl border transition-all duration-150 md:w-64 md:max-w-none ${
        isOver ? 'border-signal/50 bg-signal-wash/40 shadow-md' : 'border-border bg-background'
      }`}
    >
      {/* Header */}
      <div className={`flex items-center justify-between rounded-t-xl px-3 py-2.5 border-b ${isOver ? 'border-border bg-signal-wash' : 'border-border ' + col.headerBg}`}>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${col.accent}`} />
          <span className="text-xs font-semibold text-body">{col.label}</span>
          <span className="rounded-full bg-border-soft px-1.5 py-0.5 text-[10px] font-medium text-graphite tabular-nums">
            {isLoading ? '…' : tasks.length}
          </span>
        </div>
        <button
          onClick={() => onAdd(col.id)}
          className="flex h-9 w-9 items-center justify-center rounded-full p-0.5 text-graphite transition-colors hover:bg-surface/60 hover:text-body active:bg-surface md:h-auto md:w-auto md:rounded"
          title="Agregar tarea"
          aria-label={`Agregar tarea a ${col.label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cards area */}
      <div className="flex flex-col gap-2 p-2 flex-1 min-h-[80px]">
        {isLoading ? (
          // Skeleton
          [...Array(col.id === 'todo' ? 3 : col.id === 'in_progress' ? 2 : 1)].map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-surface border border-border-soft animate-pulse" />
          ))
        ) : tasks.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center rounded-lg border border-dashed py-6 text-graphite transition-colors ${
              isOver ? 'border-signal/40 bg-signal-wash text-signal-ink' : 'border-border hover:border-border hover:bg-surface hover:text-graphite'
            }`}
          >
            {isOver ? (
              <span className="text-xs font-medium text-signal-ink">Soltar aquí</span>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                <button
                  onClick={() => onAdd(col.id)}
                  className="mt-1 py-1.5 text-xs hover:text-body transition-colors md:py-0 md:text-[11px]"
                >
                  Agregar tarea
                </button>
              </>
            )}
          </div>
        ) : (
          tasks.map(task => (
            <DraggableCard
              key={task.id}
              task={task}
              onClick={() => onCardClick(task.id)}
              onMove={() => onMove(task.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

/* ──────────────────────────── main board ─────────────────────────── */

interface Props { projectId: string }

export function TaskBoard({ projectId }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [addStatus, setAddStatus] = useState<TaskStatus>('todo')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [moveTaskId, setMoveTaskId] = useState<string | null>(null)

  const { data: tasks, isLoading, error } = trpc.tasks.byProject.useQuery(projectId)
  const utils = trpc.useUtils()

  const updateTask = trpc.tasks.update.useMutation({
    onMutate: async (input) => {
      await utils.tasks.byProject.cancel(projectId)
      const prev = utils.tasks.byProject.getData(projectId)
      utils.tasks.byProject.setData(projectId, (old) =>
        old?.map(t => t.id === input.id ? { ...t, ...input } : t) ?? []
      )
      return { prev }
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) utils.tasks.byProject.setData(projectId, ctx.prev)
    },
    onSettled: () => void Promise.all([utils.tasks.invalidate(), utils.projects.invalidate()]),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const activeTask = tasks?.find(t => t.id === active.id)
    if (!activeTask) return

    // `over.id` is the column status ID
    const targetStatus = over.id as TaskStatus
    if (COLUMNS.some(c => c.id === targetStatus) && activeTask.status !== targetStatus) {
      updateTask.mutate({ id: activeTask.id, status: targetStatus })
    }
  }

  const activeTask = tasks?.find(t => t.id === activeId)

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-graphite">
        <AlertCircle className="mb-2 h-6 w-6" />
        <p className="text-sm">Error al cargar el tablero</p>
      </div>
    )
  }

  return (
    <>
      {/* Phones: jump between columns */}
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden" data-no-track data-no-ptr>
        {COLUMNS.map(col => (
          <FilterChip
            key={col.id}
            onClick={() => document.getElementById(`col-${col.id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })}
            count={(tasks ?? []).filter(t => t.status === col.id).length}
          >
            <span className={`h-2 w-2 rounded-full ${col.accent}`} />
            {col.label}
          </FilterChip>
        ))}
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:snap-none md:px-0" data-no-track data-no-ptr>
          {COLUMNS.map(col => {
            const colTasks = (tasks ?? []).filter(t => t.status === col.id) as unknown as TaskType[]
            return (
              <DroppableColumn
                key={col.id}
                col={col}
                tasks={colTasks}
                isLoading={isLoading}
                onAdd={(status) => { setAddStatus(status); setAddOpen(true) }}
                onCardClick={setSelectedTaskId}
                onMove={setMoveTaskId}
              />
            )
          })}
        </div>

        {/* Ghost card during drag */}
        <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
          {activeTask && <OverlayCard task={activeTask as unknown as TaskType} />}
        </DragOverlay>
      </DndContext>

      <AddTaskDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={projectId}
        defaultStatus={addStatus}
      />

      <TaskActionsSheet
        open={!!moveTaskId}
        onClose={() => setMoveTaskId(null)}
        title="Mover a…"
        status={tasks?.find(t => t.id === moveTaskId)?.status}
        onStatus={st => moveTaskId && updateTask.mutate({ id: moveTaskId, status: st })}
      />

      <TaskDetailPanel
        taskId={selectedTaskId}
        projectId={projectId}
        onClose={() => setSelectedTaskId(null)}
      />
    </>
  )
}
