'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { PRIORITY, PROJECT_STATUS, daysUntil, KANBAN_STAGES } from '@/lib/utils'
import { Calendar, Users } from 'lucide-react'

function statusVariant(s: string): 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange' {
  const map: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange'> = {
    not_started: 'secondary', in_progress: 'default', on_hold: 'warning',
    delayed: 'orange', completed: 'success', canceled: 'danger', pending: 'default',
  }
  return map[s] ?? 'secondary'
}

export function ProjectKanban() {
  const { data: projects, isLoading } = trpc.projects.list.useQuery()
  const utils = trpc.useUtils()

  const update = trpc.projects.update.useMutation({
    onSuccess: () => utils.projects.list.invalidate(),
  })

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {KANBAN_STAGES.map(s => (
          <div key={s.id} className="w-60 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="h-4 w-28 rounded bg-slate-100 animate-pulse" />
            {[...Array(2)].map((_, i) => <div key={i} className="h-24 rounded-lg bg-slate-100 animate-pulse" />)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {KANBAN_STAGES.map(stage => {
        const stageProjects = projects?.filter(p => p.kanban_stage === stage.id) ?? []

        return (
          <div key={stage.id} className="flex w-64 shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-50">
            <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-700">{stage.label}</span>
              <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                {stageProjects.length}
              </span>
            </div>

            <div className="flex flex-col gap-2 p-2 flex-1">
              {stageProjects.map(project => {
                const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]
                const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
                const days = project.end_date ? daysUntil(project.end_date) : null
                const isOverdue = days !== null && days < 0 && project.status !== 'completed'
                const members = (project.members as unknown[]) ?? []

                return (
                  <div
                    key={project.id}
                    className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <Link href={`/dashboard/projects/${project.id}`} className="block">
                      <div className="flex items-start gap-2 mb-2">
                        <div
                          className="mt-0.5 h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: project.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-mono text-slate-400 block">{project.code}</span>
                          <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">{project.name}</p>
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
                        <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                          <span>Progreso</span>
                          <span>{project.progress_pct}%</span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-indigo-500"
                            style={{ width: `${project.progress_pct}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        {project.end_date && (
                          <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
                            <Calendar className="h-3 w-3" />
                            {isOverdue ? `${Math.abs(days!)}d` : `${days}d`}
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

                    {/* Move to another stage */}
                    <div className="mt-2 pt-2 border-t border-slate-50 flex gap-1 flex-wrap">
                      {KANBAN_STAGES
                        .filter(s => s.id !== stage.id)
                        .slice(0, 3)
                        .map(s => (
                          <button
                            key={s.id}
                            onClick={() => update.mutate({ id: project.id, kanbanStage: s.id as 'ideas' | 'backlog' | 'pending' | 'in_progress' | 'on_hold' | 'completed' | 'canceled' })}
                            className="rounded px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-400 hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
                          >
                            → {s.label.replace(/^[^\s]+\s/, '')}
                          </button>
                        ))}
                    </div>
                  </div>
                )
              })}

              {stageProjects.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-300">Sin proyectos</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
