'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TaskList } from './task-list'
import { TaskBoard } from './task-board'
import { ProjectInfo } from './project-info'
import { ProjectMembers } from './project-members'
import { ProjectActivity } from './project-activity'
import { ProjectAiInsight } from './project-ai-insight'
import { PROJECT_STATUS, PRIORITY } from '@/lib/utils'
import { ArrowLeft, List, LayoutDashboard, Info, Users, Trash2, Activity, Heart, FileDown } from 'lucide-react'
import type { ProjectStatus, ProjectMemberRole } from '@/types/database'

type Tab = 'list' | 'board' | 'info' | 'members' | 'activity'

function healthColor(score: number | null) {
  if (score === null) return 'text-slate-400'
  if (score >= 70) return 'text-emerald-600'
  if (score >= 40) return 'text-amber-600'
  return 'text-red-500'
}

function statusVariant(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange' {
  const map: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange'> = {
    not_started: 'secondary', in_progress: 'default', on_hold: 'warning',
    delayed: 'orange', completed: 'success', canceled: 'danger', pending: 'default',
  }
  return map[status] ?? 'secondary'
}

interface Props { id: string }

export function ProjectDetail({ id }: Props) {
  const [tab, setTab] = useState<Tab>('list')
  const router = useRouter()

  const { data: project, isLoading, error } = trpc.projects.byId.useQuery(id)
  const utils = trpc.useUtils()

  const updateProject = trpc.projects.update.useMutation({
    onMutate: async (input) => {
      await utils.projects.byId.cancel(id)
      const prev = utils.projects.byId.getData(id)
      utils.projects.byId.setData(id, (old) => old ? { ...old, ...input, id } : old)
      return { prev }
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) utils.projects.byId.setData(id, ctx.prev)
    },
    onSettled: () => {
      utils.projects.byId.invalidate(id)
      computeHealth.mutate(id)
    },
  })
  const computeHealth = trpc.projects.computeHealth.useMutation({
    onSuccess: () => utils.projects.byId.invalidate(id),
  })
  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => router.push('/dashboard/projects'),
  })

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header skeleton — matches actual header shape */}
        <div className="border-b border-slate-200 bg-white px-4 py-4 md:px-6">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 h-5 w-5 rounded bg-slate-100 animate-pulse shrink-0" />
            <div className="flex-1 space-y-3 min-w-0">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-full bg-slate-100 animate-pulse shrink-0" />
                <div className="h-3 w-12 rounded bg-slate-100 animate-pulse" />
                <div className="h-6 w-56 rounded bg-slate-100 animate-pulse" />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="h-5 w-24 rounded-full bg-slate-100 animate-pulse" />
                <div className="h-4 w-16 rounded bg-slate-100 animate-pulse" />
                <div className="h-3 w-28 rounded-full bg-slate-100 animate-pulse" />
              </div>
            </div>
          </div>
          {/* Tabs skeleton */}
          <div className="mt-4 flex gap-1">
            {[68, 72, 54, 80, 76].map((w, i) => (
              <div key={i} style={{ width: w }} className="h-8 rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
        </div>
        {/* Content skeleton */}
        <div className="flex-1 px-4 py-6 md:px-6 space-y-2">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-11 rounded-lg bg-slate-100 animate-pulse"
              style={{ animationDelay: `${i * 60}ms`, width: `${100 - i * 4}%` }}
            />
          ))}
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex flex-1 items-center justify-center flex-col gap-2 text-slate-400">
        <p className="text-sm font-medium">Proyecto no encontrado</p>
        <button onClick={() => router.back()} className="text-xs text-indigo-600 hover:underline">
          Volver
        </button>
      </div>
    )
  }

  const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
  const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'list', label: 'Tareas', icon: <List className="h-4 w-4" /> },
    { id: 'board', label: 'Kanban', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'info', label: 'Detalles', icon: <Info className="h-4 w-4" /> },
    { id: 'members', label: 'Equipo', icon: <Users className="h-4 w-4" /> },
    { id: 'activity', label: 'Actividad', icon: <Activity className="h-4 w-4" /> },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-4 py-4 md:px-6">
        <div className="flex items-start gap-3">
          <button
            onClick={() => router.back()}
            className="mt-0.5 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            aria-label="Volver"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
              <span className="text-xs font-medium text-slate-400 shrink-0">{project.code}</span>
              <h1 className="text-lg font-semibold text-slate-900 truncate">{project.name}</h1>
            </div>

            <div className="mt-2 flex items-center gap-2.5 flex-wrap">
              {/* Status */}
              <Select
                value={project.status}
                onValueChange={val => updateProject.mutate({ id, status: val as ProjectStatus })}
              >
                <SelectTrigger className="h-7 w-auto gap-1.5 border-0 bg-transparent p-0 text-xs shadow-none focus:ring-0 hover:bg-slate-100 px-2 rounded-md">
                  <Badge variant={statusVariant(project.status)}>{statusInfo?.label}</Badge>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROJECT_STATUS).map(([v, { label }]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className={`text-xs font-medium ${priorityInfo?.color ?? ''}`}>
                {priorityInfo?.label}
              </span>

              {/* Progress bar */}
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${project.progress_pct}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400 tabular-nums">{project.progress_pct}%</span>
              </div>

              {project.department && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `${project.department.color}22`, color: project.department.color }}
                >
                  {project.department.name}
                </span>
              )}

              {/* Health score */}
              <button
                onClick={() => computeHealth.mutate(id)}
                disabled={computeHealth.isPending}
                title="Recalcular salud del proyecto"
                className={`flex items-center gap-1 text-xs font-semibold ${healthColor(project.health_score)} hover:opacity-70 transition-opacity disabled:opacity-40`}
              >
                <Heart className="h-3.5 w-3.5" />
                <span className="tabular-nums">{project.health_score != null ? `${project.health_score}%` : '—'}</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <a
              href={`/dashboard/projects/${id}/print`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
              title="Exportar reporte PDF"
            >
              <FileDown className="h-4 w-4" />
            </a>
            <button
              onClick={() => {
                if (confirm(`¿Eliminar el proyecto "${project.name}"? Esta acción no se puede deshacer.`)) {
                  deleteProject.mutate(id)
                }
              }}
              disabled={deleteProject.isPending}
              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
              title="Eliminar proyecto"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-0.5 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-auto px-4 py-5 md:px-6 ${tab === 'board' ? 'overflow-x-auto' : ''}`}>
        {tab === 'list' && <TaskList projectId={id} />}
        {tab === 'board' && <TaskBoard projectId={id} />}
        {tab === 'info' && (
          <div className="space-y-5">
            <ProjectAiInsight projectId={id} />
            <ProjectInfo project={project} />
          </div>
        )}
        {tab === 'activity' && <ProjectActivity projectId={id} />}
        {tab === 'members' && (
          <ProjectMembers
            projectId={id}
            members={(project.members ?? []) as {
              id: string
              role: ProjectMemberRole
              user: { id: string; name: string; email: string; avatar_url: string | null; position: string | null } | null
            }[]}
          />
        )}
      </div>
    </div>
  )
}
