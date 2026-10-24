'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PROJECT_STATUS, PRIORITY, formatDate, daysUntil } from '@/lib/utils'
import { ArrowRight, Calendar } from 'lucide-react'

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange' {
  const map: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange'> = {
    not_started: 'secondary', in_progress: 'default', on_hold: 'warning',
    delayed: 'orange', completed: 'success', canceled: 'danger', pending: 'default',
  }
  return map[status] ?? 'secondary'
}

type ProjectRow = {
  id: string; code: string; name: string; status: string; priority: string
  end_date: string | null; progress_pct: number; color: string
}

function ProjectList({ projects, isLoading }: { projects?: ProjectRow[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="divide-y divide-border-soft">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 md:px-6">
            <Skeleton className="h-4 w-4 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  if (!projects?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-graphite">
        <p className="text-sm">No hay proyectos todavía</p>
        <Link href="/dashboard/projects/new" className="mt-2 text-xs text-signal-ink hover:underline">
          Crear el primero
        </Link>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border-soft">
      {projects.map(project => {
        const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
        const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]
        return (
          <Link
            key={project.id}
            href={`/dashboard/projects/${project.id}`}
            className="flex min-h-[60px] items-center gap-3 px-4 py-3 transition-colors active:bg-border-soft md:gap-4 md:px-6 md:hover:bg-background"
          >
            <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                <span className="mr-1.5 text-graphite">{project.code}</span>
                {project.name}
              </p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className={`text-xs font-medium ${priorityInfo?.color ?? 'text-graphite'}`}>
                  {priorityInfo?.label}
                </span>
                {project.end_date && (
                  <span className="flex items-center gap-1 text-xs text-graphite">
                    <Calendar className="h-3 w-3" />
                    {formatDate(project.end_date)}
                  </span>
                )}
              </div>
            </div>
            <Badge variant={statusBadgeVariant(project.status)} className="hidden sm:inline-flex">{statusInfo?.label}</Badge>
            <div className="flex w-12 flex-col gap-1 sm:w-16">
              <span className="text-xs text-graphite">{project.progress_pct}%</span>
              <div className="h-1 w-full overflow-hidden rounded-full bg-border-soft">
                <div className="h-full rounded-full bg-signal" style={{ width: `${project.progress_pct}%` }} />
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

interface RecentProjectsProps { compact?: boolean }

export function RecentProjects({ compact }: RecentProjectsProps) {
  const { data: projects, isLoading } = trpc.projects.list.useQuery(undefined, {
    select: (data) => data?.slice(0, 8) as ProjectRow[] ?? [],
  })

  if (compact) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between p-4 pb-2 md:p-6 md:pb-2">
          <CardTitle>Proyectos recientes</CardTitle>
          <Link href="/dashboard/projects" className="flex min-h-[44px] items-center gap-1 text-[13px] font-medium text-signal-ink md:min-h-0 md:text-xs md:hover:text-foreground">
            Ver todos <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <ProjectList projects={projects} isLoading={isLoading} />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle>Proyectos recientes</CardTitle>
            <Link href="/dashboard/projects" className="flex items-center gap-1 text-xs text-signal-ink hover:text-foreground">
              Ver todos <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <ProjectList projects={projects} isLoading={isLoading} />
          </CardContent>
        </Card>
      </div>
      <div>
        <Card>
          <CardHeader className="pb-2"><CardTitle>Vencen pronto</CardTitle></CardHeader>
          <CardContent className="p-0"><DueSoonList /></CardContent>
        </Card>
      </div>
    </div>
  )
}

function DueSoonList() {
  const { data, isLoading } = trpc.projects.dashboard.useQuery()

  if (isLoading) {
    return (
      <div className="divide-y divide-border-soft">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="space-y-1 px-4 py-3 md:px-6">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    )
  }

  const dueSoon = data?.dueSoon ?? []
  if (!dueSoon.length) {
    return <div className="flex items-center justify-center py-8 text-graphite text-sm">Sin vencimientos esta semana</div>
  }

  return (
    <div className="divide-y divide-border-soft">
      {dueSoon.map(project => {
        const days = project.end_date ? daysUntil(project.end_date) : null
        return (
          <Link key={project.id} href={`/dashboard/projects/${project.id}`}
            className="block min-h-[56px] px-4 py-3 transition-colors active:bg-border-soft md:px-6 md:hover:bg-background"
          >
            <p className="text-sm font-medium text-foreground truncate">
              <span className="mr-1 text-graphite text-xs">{(project as { code?: string }).code}</span>
              {(project as { name?: string }).name ?? project.id}
            </p>
            {days !== null && (
              <p className={`text-xs mt-0.5 ${days <= 0 ? 'text-danger font-medium' : days <= 2 ? 'text-signal-ink' : 'text-graphite'}`}>
                {days <= 0 ? 'Vencido' : `Vence en ${days} día${days !== 1 ? 's' : ''}`}
              </p>
            )}
          </Link>
        )
      })}
    </div>
  )
}
