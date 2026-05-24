'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PROJECT_STATUS, PRIORITY, formatDate, daysUntil } from '@/lib/utils'
import { ArrowRight, Calendar } from 'lucide-react'

function statusBadgeVariant(status: string) {
  const map: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'danger' | 'orange'> = {
    not_started: 'secondary',
    in_progress: 'default',
    on_hold: 'warning',
    delayed: 'orange',
    completed: 'success',
    canceled: 'danger',
    pending: 'default',
  }
  return map[status] ?? 'secondary'
}

export function RecentProjects() {
  const { data: projects, isLoading } = trpc.projects.list.useQuery(undefined, {
    select: (data) => data?.slice(0, 8) ?? [],
  })

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Project list */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle>Proyectos recientes</CardTitle>
            <Link
              href="/dashboard/projects"
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
            >
              Ver todos <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="divide-y divide-slate-100">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-6 py-3">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                ))}
              </div>
            ) : !projects?.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <p className="text-sm">No hay proyectos todavía</p>
                <Link href="/dashboard/projects/new" className="mt-2 text-xs text-indigo-600 hover:underline">
                  Crear el primero
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {projects.map((project) => {
                  const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
                  const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]
                  return (
                    <Link
                      key={project.id}
                      href={`/dashboard/projects/${project.id}`}
                      className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-slate-50"
                    >
                      <div
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          <span className="mr-1.5 text-slate-400">{project.code}</span>
                          {project.name}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className={`text-xs font-medium ${priorityInfo?.color ?? 'text-slate-500'}`}>
                            {priorityInfo?.label}
                          </span>
                          {project.end_date && (
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              <Calendar className="h-3 w-3" />
                              {formatDate(project.end_date)}
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge variant={statusBadgeVariant(project.status)}>
                        {statusInfo?.label}
                      </Badge>
                      <div className="flex w-16 flex-col gap-1">
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>{project.progress_pct}%</span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-indigo-500 transition-all"
                            style={{ width: `${project.progress_pct}%` }}
                          />
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Due soon */}
      <div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Vencen pronto</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DueSoonList />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function DueSoonList() {
  const { data, isLoading } = trpc.projects.dashboard.useQuery()

  if (isLoading) {
    return (
      <div className="divide-y divide-slate-100">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="px-6 py-3 space-y-1">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    )
  }

  const dueSoon = data?.dueSoon ?? []

  if (!dueSoon.length) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <p className="text-sm">Sin vencimientos esta semana</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-slate-100">
      {dueSoon.map((project) => {
        const days = project.end_date ? daysUntil(project.end_date) : null
        return (
          <Link
            key={project.id}
            href={`/dashboard/projects/${project.id}`}
            className="block px-6 py-3 transition-colors hover:bg-slate-50"
          >
            <p className="text-sm font-medium text-slate-900 truncate">
              <span className="mr-1 text-slate-400 text-xs">{(project as { code?: string }).code}</span>
              {(project as { name?: string }).name ?? project.id}
            </p>
            {days !== null && (
              <p className={`text-xs mt-0.5 ${days <= 0 ? 'text-red-600 font-medium' : days <= 2 ? 'text-orange-600' : 'text-slate-400'}`}>
                {days <= 0 ? 'Vencido' : `Vence en ${days} día${days !== 1 ? 's' : ''}`}
              </p>
            )}
          </Link>
        )
      })}
    </div>
  )
}
