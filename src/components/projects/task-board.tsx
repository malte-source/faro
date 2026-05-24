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
import { PRIORITY, formatDate, daysUntil } from '@/lib/utils'
import { Plus, Calendar, AlertCircle, GripVertical } from 'lucide-react'
import type { TaskStatus } from '@/types/database'

const COLUMNS: { id: TaskStatus; label: string; accent: string; headerBg: string }[] = [
  { id: 'todo',        label: 'Por hacer',   accent: 'bg-slate-300',  headerBg: 'bg-slate-50'  },
  { id: 'in_progress', label: 'En progreso', accent: 'bg-blue-400',   headerBg: 'bg-blue-50'   },
  { id: 'in_review',   label: 'En revisión', accent: 'bg-yellow-400', headerBg: 'bg-yellow-50' },
  { id: 'done',        label: 'Listo',       accent: 'bg-emerald-400',headerBg: 'bg-emerald-50'},
  { id: 'canceled',   label: 'Cancelado',   accent: 'bg-red-300',    headerBg: 'bg-red-50'    },
]

/* ──────────────────────────── task card ──────────────────────────── */

interface TaskType {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  assignee: { name: string; avatar_url: string | null } | null
}

function TaskCardContent({ task }: { task: TaskType; listeners?: Record<string, unknown> }) {
  const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
  const days = task.due_date ? daysUntil(task.due_date) : null
  const isOverdue = days !== null && days < 0 && task.status !== 'done' && task.status !== 'canceled'

  return (
    <>
      <p className="text-sm font-medium text-slate-800 leading-snug pr-1">{task.title}</p>
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${priorityInfo?.dot ?? 'bg-slate-300'}`} />
          <span className={`text-[11px] font-medium ${priorityInfo?.color ?? 'text-slate-500'}`}>
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
        <div className={`mt-1.5 flex items-center gap-1 text-[11px] ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
          <Calendar className="h-3 w-3" />
          {isOverdue ? `Vencida ${Math.abs(days!)}d` : formatDate(task.due_date)}
        </div>
      )}
    </>
  )
}

/* Draggable wrapper */
function DraggableCard({ task, onClick }: { task: TaskType; onClick: () => void }) {
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
      className="group relative rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer"
    >
      {/* Drag handle */}
      <button
        {...listeners}
        {...attributes}
        className="absolute right-2 top-2.5 cursor-grab active:cursor-grabbing text-slate-200 hover:text-slate-400 transition-colors opacity-0 group-hover:opacity-100"
        onClick={e => e.stopPropagation()}
        title="Arrastrar"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Clicking the card (not the handle) opens detail panel */}
      <div onClick={onClick}>
        <TaskCardContent task={task} />
      </div>
    </div>
  )
}

/* Overlay card rendered by DragOverlay */
function OverlayCard({ task }: { task: TaskType }) {
  return (
    <div className="w-64 rounded-lg border border-indigo-300 bg-white p-3 shadow-xl ring-2 ring-indigo-400/30 rotate-2 scale-105">
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
}: {
  col: typeof COLUMNS[number]
  tasks: TaskType[]
  isLoading: boolean
  onAdd: (status: TaskStatus) => void
  onCardClick: (taskId: string) => void
}) {
  const { isOver, setNodeRef } = useDroppable({ id: col.id })

  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-xl border transition-all duration-150 ${
        isOver ? 'border-indigo-400 bg-indigo-50/40 shadow-md' : 'border-slate-200 bg-slate-50'
      }`}
    >
      {/* Header */}
      <div className={`flex items-center justify-between rounded-t-xl px-3 py-2.5 border-b ${isOver ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 ' + col.headerBg}`}>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${col.accent}`} />
          <span className="text-xs font-semibold text-slate-700">{col.label}</span>
          <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 tabular-nums">
            {isLoading ? '…' : tasks.length}
          </span>
        </div>
        <button
          onClick={() => onAdd(col.id)}
          className="rounded p-0.5 text-slate-400 hover:bg-white/60 hover:text-slate-700 transition-colors"
          title="Agregar tarea"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cards area */}
      <div className="flex flex-col gap-2 p-2 flex-1 min-h-[80px]">
        {isLoading ? (
          // Skeleton
          [...Array(col.id === 'todo' ? 3 : col.id === 'in_progress' ? 2 : 1)].map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-white border border-slate-100 animate-pulse" />
          ))
        ) : tasks.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center rounded-lg border border-dashed py-6 text-slate-400 transition-colors ${
              isOver ? 'border-indigo-300 bg-indigo-50 text-indigo-400' : 'border-slate-200 hover:border-slate-300 hover:bg-white hover:text-slate-500'
            }`}
          >
            {isOver ? (
              <span className="text-xs font-medium text-indigo-500">Soltar aquí</span>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                <button
                  onClick={() => onAdd(col.id)}
                  className="mt-1 text-[11px] hover:text-slate-700 transition-colors"
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
    onSettled: () => utils.tasks.byProject.invalidate(projectId),
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
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <AlertCircle className="mb-2 h-6 w-6" />
        <p className="text-sm">Error al cargar el tablero</p>
      </div>
    )
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map(col => {
            const colTasks = (tasks ?? []).filter(t => t.status === col.id) as TaskType[]
            return (
              <DroppableColumn
                key={col.id}
                col={col}
                tasks={colTasks}
                isLoading={isLoading}
                onAdd={(status) => { setAddStatus(status); setAddOpen(true) }}
                onCardClick={setSelectedTaskId}
              />
            )
          })}
        </div>

        {/* Ghost card during drag */}
        <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
          {activeTask && <OverlayCard task={activeTask as TaskType} />}
        </DragOverlay>
      </DndContext>

      <AddTaskDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        projectId={projectId}
        defaultStatus={addStatus}
      />

      <TaskDetailPanel
        taskId={selectedTaskId}
        projectId={projectId}
        onClose={() => setSelectedTaskId(null)}
      />
    </>
  )
}
