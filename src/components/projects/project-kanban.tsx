'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { PRIORITY, PROJECT_STATUS, daysUntil, KANBAN_STAGES } from '@/lib/utils'
import { Calendar, Users, GripVertical } from 'lucide-react'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/routers'

type RouterOutputs = inferRouterOutputs<AppRouter>
type Project = RouterOutputs['projects']['list'][number]
type KanbanStage = (typeof KANBAN_STAGES)[number]['id']

function statusVariant(s: string): 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange' {
  const map: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange'> = {
    not_started: 'secondary', in_progress: 'default', on_hold: 'warning',
    delayed: 'orange', completed: 'success', canceled: 'danger', pending: 'default',
  }
  return map[s] ?? 'secondary'
}

/* ── Draggable project card ───────────────────────────────────────── */
function ProjectCard({ project, isDragging }: { project: Project; isDragging?: boolean }) {
  const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]
  const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
  const days = project.end_date ? daysUntil(project.end_date) : null
  const isOverdue = days !== null && days < 0 && project.status !== 'completed'
  const members = (project.members as unknown[]) ?? []

  return (
    <div
      className={`rounded-lg border bg-white p-3 shadow-sm transition-all dark:bg-slate-800 ${
        isDragging
          ? 'border-indigo-300 shadow-lg ring-2 ring-indigo-400/30 opacity-50 dark:border-indigo-600'
          : 'border-slate-200 hover:shadow-md dark:border-slate-700'
      }`}
    >
      <Link href={`/dashboard/projects/${project.id}`} className="block" onClick={e => isDragging && e.preventDefault()}>
        <div className="flex items-start gap-2 mb-2">
          <div
            className="mt-0.5 h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: project.color }}
          />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-mono text-slate-400 block dark:text-slate-500">{project.code}</span>
            <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2 dark:text-slate-100">{project.name}</p>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <Badge variant={statusVariant(project.status)} className="text-[10px] px-1.5 py-0.5">
            {statusInfo?.label}
          </Badge>
          <span className={`text-[10px] font-medium ${priorityInfo?.color ?? ''}`}>
            {priorityInfo?.label}
          </span>
        </div>

        {/* Progress */}
        <div className="mb-2">
          <div className="flex justify-between text-[10px] text-slate-400 mb-1 dark:text-slate-500">
            <span>Progreso</span>
            <span>{project.progress_pct}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-indigo-500"
              style={{ width: `${project.progress_pct}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
          {project.end_date && (
            <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
              <Calendar className="h-3 w-3" />
              {isOverdue ? `${Math.abs(days!)}d vencido` : `${days}d`}
            </span>
          )}
          {members.length > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {members.length}
            </span>
          )}
        </div>
      </Link>
    </div>
  )
}

/* ── Draggable wrapper ───────────────────────────────────────────── */
function DraggableCard({ project }: { project: Project }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: project.id,
    data: { project },
  })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    cursor: isDragging ? 'grabbing' : 'grab',
    touchAction: 'none',
  }

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <ProjectCard project={project} isDragging={isDragging} />
    </div>
  )
}

/* ── Droppable column ────────────────────────────────────────────── */
function DroppableColumn({
  stage,
  projects,
  isOver,
}: {
  stage: (typeof KANBAN_STAGES)[number]
  projects: Project[]
  isOver: boolean
}) {
  const { setNodeRef } = useDroppable({ id: stage.id })

  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-xl border transition-colors ${
        isOver
          ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-600 dark:bg-indigo-950/30'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40'
      }`}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-700">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{stage.label}</span>
        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-400">
          {projects.length}
        </span>
      </div>

      <div className="flex flex-col gap-2 p-2 flex-1 min-h-[80px]">
        {projects.map(project => (
          <DraggableCard key={project.id} project={project} />
        ))}

        {projects.length === 0 && !isOver && (
          <p className="py-6 text-center text-xs text-slate-300 dark:text-slate-600">
            Sin proyectos
          </p>
        )}
        {isOver && projects.length === 0 && (
          <div className="flex-1 rounded-lg border-2 border-dashed border-indigo-300 dark:border-indigo-700" />
        )}
      </div>
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────────── */
export function ProjectKanban() {
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const { data: projects, isLoading } = trpc.projects.list.useQuery()
  const utils = trpc.useUtils()

  const update = trpc.projects.update.useMutation({
    onMutate: async ({ id, kanbanStage }) => {
      await utils.projects.list.cancel()
      const prev = utils.projects.list.getData()
      utils.projects.list.setData(undefined, old =>
        old?.map(p => p.id === id ? { ...p, kanban_stage: kanbanStage! } : p)
      )
      return { prev }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) utils.projects.list.setData(undefined, ctx.prev)
    },
    onSettled: () => utils.projects.list.invalidate(),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const proj = event.active.data.current?.project as Project | undefined
    if (proj) setActiveProject(proj)
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverId(event.over ? String(event.over.id) : null)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    setActiveProject(null)
    setOverId(null)

    if (!over) return
    const projectId = active.id as string
    const newStage = over.id as KanbanStage

    const project = projects?.find(p => p.id === projectId)
    if (!project || project.kanban_stage === newStage) return

    update.mutate({ id: projectId, kanbanStage: newStage })
  }, [projects, update])

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {KANBAN_STAGES.map(s => (
          <div key={s.id} className="w-64 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="h-4 w-28 rounded bg-slate-100 animate-pulse dark:bg-slate-700" />
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-slate-100 animate-pulse dark:bg-slate-700" />
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {KANBAN_STAGES.map(stage => {
          const stageProjects = projects?.filter(p => p.kanban_stage === stage.id) ?? []
          return (
            <DroppableColumn
              key={stage.id}
              stage={stage}
              projects={stageProjects}
              isOver={overId === stage.id}
            />
          )
        })}
      </div>

      {/* Drag overlay — renders on top of everything while dragging */}
      <DragOverlay dropAnimation={null}>
        {activeProject ? (
          <div className="w-64 rotate-2 scale-105">
            <ProjectCard project={activeProject} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
