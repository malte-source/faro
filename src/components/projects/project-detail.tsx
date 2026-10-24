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
import { ProjectBurndown } from './project-burndown'
import { ProjectCustomFields } from './project-custom-fields'
import { ProjectLinks } from './project-links'
import { ProjectDrive } from './project-drive'
import { ProjectChat } from './project-chat'
import { ProjectRecurring } from './project-recurring'
import { ProjectTaskGantt } from './project-task-gantt'
import { PROJECT_STATUS, PRIORITY, KANBAN_STAGES } from '@/lib/utils'
import {
  ArrowLeft, List, LayoutDashboard, Info, Users, Trash2, Activity, FileDown,
  FolderOpen, MessageCircle, Repeat, GitBranch, MoreHorizontal, CheckSquare, Share2,
} from 'lucide-react'
import { ProjectShareModal } from './project-share-modal'
import { ProjectChatButton } from '@/components/chat/project-chat-button'
import { ProjectEmailInbox } from './project-email-inbox'
import { ProjectWeekSummary } from './project-week-summary'
import { ProjectUpdates } from './project-updates'
import type { ProjectStatus, KanbanStage, ProjectMemberRole } from '@/types/database'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'
import { HealthChip } from '@/components/ui/health-chip'
import { DueDateChip } from '@/components/ui/due-date-chip'
import { MobileNavBar } from '@/components/mobile/nav-bar'
import { Segmented } from '@/components/mobile/segmented'
import { ProjectMobileTop, ProjectMobileTabs } from './project-detail-mobile'

/**
 * v2 nav structure: 5 visible tabs + "Más" overflow.
 *
 *   Tareas    → list | board | timeline (internal sub-toggle)
 *   Overview  → ProjectInfo + AiInsight + Burndown + Links + CustomFields
 *   Equipo    → members
 *   Archivos  → drive
 *   Más ▾     → recurring | chat | activity
 *
 * Before: 9 flat tabs that scrolled horizontally on mobile and didn't tell the
 * user which paradigm to choose (list vs board vs timeline are 3 ways to see
 * the same data — grouping them under one "Tareas" tab makes the mental model
 * obvious: "tasks of this project, viewed however you like").
 */
type Tab = 'tasks' | 'overview' | 'members' | 'drive' | 'recurring' | 'chat' | 'activity'
type TaskView = 'list' | 'board' | 'timeline'

function statusVariant(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange' {
  const map: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange'> = {
    not_started: 'secondary', in_progress: 'default', on_hold: 'warning',
    delayed: 'orange', completed: 'success', canceled: 'danger', pending: 'default',
  }
  return map[status] ?? 'secondary'
}

interface Props { id: string }

export function ProjectDetail({ id }: Props) {
  const [tab, setTab] = useState<Tab>('tasks')
  const [taskView, setTaskView] = useState<TaskView>('list')
  const [moreOpen, setMoreOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
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
    onError: (err, _input, ctx) => {
      if (ctx?.prev) utils.projects.byId.setData(id, ctx.prev)
      toast.error('No se pudo actualizar el proyecto', err.message)
    },
    onSettled: () => {
      utils.projects.invalidate()
      computeHealth.mutate(id)
    },
  })
  const computeHealth = trpc.projects.computeHealth.useMutation({
    onSuccess: () => utils.projects.invalidate(),
  })
  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success('Proyecto borrado')
      router.push('/dashboard/projects')
    },
    onError: (e) => toast.error('No se pudo borrar', e.message),
  })

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <MobileNavBar title="Proyecto" />
        {/* Header skeleton — matches actual header shape */}
        <div className="hidden border-b border-border bg-surface px-4 py-4 md:block md:px-6">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 h-5 w-5 rounded bg-border-soft animate-pulse shrink-0" />
            <div className="flex-1 space-y-3 min-w-0">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-full bg-border-soft animate-pulse shrink-0" />
                <div className="h-3 w-12 rounded bg-border-soft animate-pulse" />
                <div className="h-6 w-56 rounded bg-border-soft animate-pulse" />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="h-5 w-24 rounded-full bg-border-soft animate-pulse" />
                <div className="h-4 w-16 rounded bg-border-soft animate-pulse" />
                <div className="h-3 w-28 rounded-full bg-border-soft animate-pulse" />
              </div>
            </div>
          </div>
          {/* Tabs skeleton */}
          <div className="mt-4 flex gap-1">
            {[68, 72, 54, 80, 76].map((w, i) => (
              <div key={i} style={{ width: w }} className="h-8 rounded-lg bg-border-soft animate-pulse" />
            ))}
          </div>
        </div>
        {/* Content skeleton */}
        <div className="flex-1 px-4 py-6 md:px-6 space-y-2">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-11 rounded-lg bg-border-soft animate-pulse"
              style={{ animationDelay: `${i * 60}ms`, width: `${100 - i * 4}%` }}
            />
          ))}
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <MobileNavBar title="Proyecto" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-graphite">
          <p className="text-sm font-medium">Proyecto no encontrado</p>
          <button onClick={() => router.back()} className="inline-flex h-11 items-center rounded-full bg-foreground px-5 text-sm font-semibold text-background md:h-auto md:bg-transparent md:px-0 md:text-xs md:font-normal md:text-signal-ink md:hover:underline">
            Volver
          </button>
        </div>
      </div>
    )
  }

  const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
  const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]

  // Primary tabs — visible always. The 5-item rule keeps the bar scannable.
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'tasks',    label: 'Tareas',   icon: <CheckSquare className="h-4 w-4" /> },
    { id: 'overview', label: 'Overview', icon: <Info className="h-4 w-4" /> },
    { id: 'members',  label: 'Equipo',   icon: <Users className="h-4 w-4" /> },
    { id: 'drive',    label: 'Archivos', icon: <FolderOpen className="h-4 w-4" /> },
  ]
  // Secondary tabs — under "Más ▾" dropdown. Used less than 20% of the time.
  const moreTabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'recurring', label: 'Recurrentes', icon: <Repeat className="h-4 w-4" /> },
    { id: 'chat',      label: 'Chat IA',     icon: <MessageCircle className="h-4 w-4" /> },
    { id: 'activity',  label: 'Actividad',   icon: <Activity className="h-4 w-4" /> },
  ]
  const moreActive = moreTabs.find(t => t.id === tab)

  // Sub-toggle inside the "Tareas" tab — three ways to view the same data.
  const taskViews: { id: TaskView; label: string; icon: React.ReactNode }[] = [
    { id: 'list',     label: 'Lista',    icon: <List className="h-4 w-4" /> },
    { id: 'board',    label: 'Kanban',   icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'timeline', label: 'Timeline', icon: <GitBranch className="h-4 w-4" /> },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ProjectMobileTop
        project={{
          id,
          name: project.name,
          code: project.code,
          color: project.color,
          status: project.status,
          priority: project.priority,
          progress_pct: project.progress_pct,
          health_score: project.health_score,
          end_date: project.end_date,
          kanban_stage: (project as { kanban_stage?: string }).kanban_stage,
          department: project.department ?? null,
        }}
        onStatus={val => updateProject.mutate({ id, status: val })}
        onStage={val => updateProject.mutate({ id, kanbanStage: val })}
        onShare={() => setShareOpen(true)}
        onRecalcHealth={() => computeHealth.mutate(id)}
        recalcBusy={computeHealth.isPending}
        onDelete={async () => {
          const ok = await confirmAction({
            title: `Borrar el proyecto "${project.name}"`,
            description: 'Esta acción es PERMANENTE y borra todas sus tareas, comentarios y archivos asociados. No se puede deshacer.',
            variant: 'destructive',
            confirmLabel: 'Borrar permanentemente',
          })
          if (ok) deleteProject.mutate(id)
        }}
      />

      {/* Header (desktop) */}
      <div className="hidden border-b border-border bg-surface px-4 py-4 md:block md:px-6">
        <div className="flex items-start gap-3">
          <button
            onClick={() => router.back()}
            className="mt-0.5 rounded-md p-1 text-graphite hover:bg-border-soft hover:text-body transition-colors"
            aria-label="Volver"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
              <span className="text-xs font-medium text-graphite shrink-0">{project.code}</span>
              <h1 className="text-lg font-semibold text-foreground truncate">{project.name}</h1>
            </div>

            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {/* Status — what's the project doing at executive level */}
              <Select
                value={project.status}
                onValueChange={val => updateProject.mutate({ id, status: val as ProjectStatus })}
              >
                <SelectTrigger
                  className="h-7 w-auto gap-1.5 border-0 bg-transparent p-0 text-xs shadow-none focus:ring-0 hover:bg-stone-100 dark:hover:bg-night-700 px-2 rounded-md"
                  title="Estado ejecutivo (qué reportas)"
                >
                  <Badge variant={statusVariant(project.status)}>{statusInfo?.label}</Badge>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROJECT_STATUS).map(([v, { label }]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Kanban stage — workflow position, distinct from status */}
              <Select
                value={(project as { kanban_stage?: KanbanStage }).kanban_stage ?? 'backlog'}
                onValueChange={val => updateProject.mutate({ id, kanbanStage: val as KanbanStage })}
              >
                <SelectTrigger
                  className="h-7 w-auto gap-1.5 border border-dashed border-stone dark:border-ink-body bg-transparent p-0 px-2 text-xs shadow-none focus:ring-0 hover:bg-mist dark:hover:bg-night-700 rounded-md"
                  title="Etapa de workflow (dónde está en el flujo)"
                >
                  <span className="text-xs text-graphite dark:text-stone">
                    {KANBAN_STAGES.find(s => s.id === ((project as { kanban_stage?: string }).kanban_stage ?? 'backlog'))?.label ?? 'Backlog'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {KANBAN_STAGES.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className={`text-xs font-medium ${priorityInfo?.color ?? ''}`}>
                {priorityInfo?.label}
              </span>

              {/* Progress */}
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-100 dark:bg-night-700">
                  <div
                    className="h-full rounded-full bg-signal transition-all duration-500"
                    style={{ width: `${project.progress_pct}%` }}
                  />
                </div>
                <span className="text-xs text-graphite tabular-nums">{project.progress_pct}%</span>
              </div>

              {/* Health */}
              <button
                onClick={() => computeHealth.mutate(id)}
                disabled={computeHealth.isPending}
                title="Recalcular salud del proyecto"
                className="hover:opacity-70 transition-opacity disabled:opacity-40"
              >
                <HealthChip score={project.health_score} variant="full" />
              </button>

              {/* Due date with urgency colour */}
              {project.end_date && (
                <DueDateChip
                  date={project.end_date}
                  isDone={project.status === 'completed' || project.status === 'canceled'}
                />
              )}

              {project.department && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `${project.department.color}22`, color: project.department.color }}
                >
                  {project.department.name}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <ProjectChatButton projectId={id} className="mr-1 hidden h-8 px-2.5 text-xs sm:inline-flex" />
            <button
              onClick={() => setShareOpen(true)}
              className="rounded-md p-1.5 text-graphite hover:bg-border-soft hover:text-signal-ink transition-colors"
              title="Compartir con cliente (link público read-only)"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <a
              href={`/dashboard/projects/${id}/print`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md p-1.5 text-graphite hover:bg-border-soft hover:text-signal-ink transition-colors"
              title="Exportar reporte PDF"
            >
              <FileDown className="h-4 w-4" />
            </a>
            <button
              onClick={async () => {
                const ok = await confirmAction({
                  title: `Borrar el proyecto "${project.name}"`,
                  description: 'Esta acción es PERMANENTE y borra todas sus tareas, comentarios y archivos asociados. No se puede deshacer.',
                  variant: 'destructive',
                  confirmLabel: 'Borrar permanentemente',
                })
                if (ok) deleteProject.mutate(id)
              }}
              disabled={deleteProject.isPending}
              className="rounded-md p-1.5 text-graphite hover:bg-danger-wash hover:text-danger transition-colors disabled:opacity-40"
              title="Eliminar proyecto"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Primary tabs + Más ▾ overflow */}
        <div className="mt-4 flex items-center gap-0.5 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors active:scale-95 ${
                tab === t.id
                  ? 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal'
                  : 'text-graphite hover:bg-stone-100 hover:text-body dark:hover:bg-night-700'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}

          {/* "Más ▾" dropdown — secondary tabs */}
          <div className="relative shrink-0">
            <button
              onClick={() => setMoreOpen(o => !o)}
              onBlur={() => setTimeout(() => setMoreOpen(false), 150)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors active:scale-95 ${
                moreActive
                  ? 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal'
                  : 'text-graphite hover:bg-stone-100 hover:text-body dark:hover:bg-night-700'
              }`}
            >
              {moreActive ? moreActive.icon : <MoreHorizontal className="h-4 w-4" />}
              {moreActive ? moreActive.label : 'Más'}
            </button>
            {moreOpen && (
              <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-stone bg-white py-1 shadow-lg dark:border-ink-body dark:bg-night">
                {moreTabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setTab(t.id); setMoreOpen(false) }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      tab === t.id
                        ? 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal'
                        : 'text-graphite hover:bg-stone-100 dark:text-stone dark:hover:bg-night-700'
                    }`}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-auto px-4 pb-5 pt-0 md:px-6 md:py-5 ${tab === 'tasks' && taskView === 'board' ? 'overflow-x-auto' : ''}`}>
        <ProjectMobileTabs
          tabs={[...tabs, ...moreTabs]}
          value={tab}
          onChange={t => setTab(t)}
        />
        <div className="h-1 md:hidden" />
        {/* TAREAS — sub-toggle between Lista / Kanban / Timeline */}
        {tab === 'tasks' && (
          <div className="flex h-full flex-col">
            <Segmented
              aria-label="Vista de tareas"
              className="mb-3 md:hidden"
              value={taskView}
              onChange={setTaskView}
              options={taskViews.map(v => ({ value: v.id, label: v.label }))}
            />
            <div className="mb-4 hidden shrink-0 self-start rounded-lg border border-stone bg-white p-0.5 dark:border-night-700 dark:bg-night md:inline-flex">
              {taskViews.map(v => (
                <button
                  key={v.id}
                  onClick={() => setTaskView(v.id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors active:scale-95 ${
                    taskView === v.id
                      ? 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal'
                      : 'text-graphite hover:text-ink-body dark:hover:text-stone'
                  }`}
                >
                  {v.icon}
                  <span className="hidden sm:inline">{v.label}</span>
                </button>
              ))}
            </div>
            <div className="flex-1">
              {taskView === 'list' && <TaskList projectId={id} />}
              {taskView === 'board' && <TaskBoard projectId={id} />}
              {taskView === 'timeline' && <ProjectTaskGantt projectId={id} />}
            </div>
          </div>
        )}

        {/* OVERVIEW — consolidates info + AI insight + burndown + links + custom fields.
            Order matters: ProjectInfo first (the boring "qué proyecto es esto"), then
            insights/analytics, then the long tail. */}
        {tab === 'overview' && (
          <div className="space-y-5 max-w-4xl">
            <ProjectInfo project={project} />
            <ProjectUpdates projectId={id} />
            <ProjectWeekSummary projectId={id} />
            <ProjectAiInsight projectId={id} />
            <ProjectBurndown projectId={id} />
            <ProjectEmailInbox
              projectId={id}
              inboundToken={(project as { inbound_token?: string | null }).inbound_token ?? null}
            />
            <ProjectLinks
              projectId={id}
              notebooklmId={(project as { notebooklm_notebook_id?: string | null }).notebooklm_notebook_id ?? null}
            />
            <ProjectCustomFields
              projectId={id}
              values={(project as { custom_fields?: Record<string, string | number | null> }).custom_fields ?? {}}
            />
          </div>
        )}

        {tab === 'drive' && <ProjectDrive projectId={id} />}
        {tab === 'recurring' && <ProjectRecurring projectId={id} />}
        {tab === 'chat' && <ProjectChat projectId={id} />}
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

      {shareOpen && (
        <ProjectShareModal
          projectId={id}
          projectName={project.name}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  )
}
