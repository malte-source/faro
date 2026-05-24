'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TaskList } from './task-list'
import { TaskBoard } from './task-board'
import { ProjectInfo } from './project-info'
import { ProjectMembers } from './project-members'
import { ProjectActivity } from './project-activity'
import { PROJECT_STATUS, PRIORITY } from '@/lib/utils'
import { ArrowLeft, List, LayoutDashboard, Info, Users, Trash2, Activity, Heart, FileDown } from 'lucide-react'
import type { ProjectStatus, KanbanStage, ProjectMemberRole } from '@/types/database'

type Tab = 'list' | 'board' | 'info' | 'members' | 'activity'

function healthColor(score: number | null) {
  if (score === null) return 'text-slate-400'
  if (score >= 70) return 'text-green-600'
  if (score >= 40) return 'text-yellow-600'
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

  const { data: project, isLoading } = trpc.projects.byId.useQuery(id)
  const utils = trpc.useUtils()

  const updateProject = trpc.projects.update.useMutation({
    onSuccess: () => {
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
      <div className="flex flex-1 flex-col gap-4 px-6 py-6">
        <div className="h-8 w-64 rounded-lg bg-slate-100 animate-pulse" />
        <div className="h-4 w-40 rounded bg-slate-100 animate-pulse" />
        <div className="h-32 rounded-xl bg-slate-100 animate-pulse" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400">
        <p>Proyecto no encontrado</p>
      </div>
    )
  }

  const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
  const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'list', label: 'Tareas', icon: <List className="h-4 w-4" /> },
    { id: 'board', label: 'Kanban', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'info', label: 'Info', icon: <Info className="h-4 w-4" /> },
    { id: 'members', label: 'Miembros', icon: <Users className="h-4 w-4" /> },
    { id: 'activity', label: 'Actividad', icon: <Activity className="h-4 w-4" /> },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-start gap-4">
          <button
            onClick={() => router.back()}
            className="mt-0.5 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <div
                className="h-4 w-4 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              <span className="text-xs font-medium text-slate-400">{project.code}</span>
              <h1 className="text-xl font-semibold text-slate-900 truncate">{project.name}</h1>
            </div>

            <div className="mt-2 flex items-center gap-3 flex-wrap">
              {/* Status select */}
              <Select
                value={project.status}
                onValueChange={val => updateProject.mutate({ id, status: val as ProjectStatus })}
              >
                <SelectTrigger className="h-7 w-auto gap-1.5 border-0 bg-transparent p-0 text-xs shadow-none focus:ring-0 hover:bg-slate-100 px-2 rounded">
                  <Badge variant={statusVariant(project.status)} className="cursor-pointer">
                    {statusInfo?.label}
                  </Badge>
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

              {/* Progress */}
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-indigo-500"
                    style={{ width: `${project.progress_pct}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400">{project.progress_pct}%</span>
              </div>

              {project.department && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `${project.department.color}20`, color: project.department.color }}
                >
                  {project.department.name}
                </span>
              )}

              {/* Health score */}
              <button
                onClick={() => computeHealth.mutate(id)}
                title="Recalcular salud"
                className={`flex items-center gap-1 text-xs font-semibold ${healthColor(project.health_score)} hover:opacity-70 transition-opacity`}
              >
                <Heart className="h-3.5 w-3.5" />
                {project.health_score != null ? `${project.health_score}%` : '—'}
              </button>
            </div>
          </div>

          <a
            href={`/dashboard/projects/${id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-indigo-600 transition-colors p-1"
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
            className="text-slate-400 hover:text-red-500 transition-colors p-1"
            title="Eliminar proyecto"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
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
      <div className={`flex-1 overflow-auto px-6 py-6 ${tab === 'board' ? 'overflow-x-auto' : ''}`}>
        {tab === 'list' && <TaskList projectId={id} />}
        {tab === 'board' && <TaskBoard projectId={id} />}
        {tab === 'info' && <ProjectInfo project={project} />}
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
