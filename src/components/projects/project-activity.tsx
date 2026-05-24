'use client'

import { trpc } from '@/lib/trpc/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Clock } from 'lucide-react'

const ACTION_LABELS: Record<string, string> = {
  created: 'creó el proyecto',
  updated: 'actualizó',
  deleted: 'eliminó',
}

const FIELD_LABELS: Record<string, string> = {
  status: 'el estado',
  kanban_stage: 'la etapa',
  progress_pct: 'el progreso',
  name: 'el nombre',
  description: 'la descripción',
  end_date: 'la fecha de fin',
  start_date: 'la fecha de inicio',
  priority: 'la prioridad',
}

const STATUS_ES: Record<string, string> = {
  not_started: 'No iniciado', in_progress: 'En progreso', on_hold: 'En pausa',
  delayed: 'Retrasado', completed: 'Completado', canceled: 'Cancelado', pending: 'Pendiente',
  ideas: '💡 Ideas', backlog: '📋 Backlog',
  todo: 'Por hacer', in_review: 'En revisión', done: 'Listo',
}

function humanizeValue(field: string | null, value: string | null): string {
  if (!value) return '—'
  if (field === 'progress_pct') return `${value}%`
  return STATUS_ES[value] ?? value
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'hace un momento'
  if (minutes < 60) return `hace ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `hace ${days}d`
  return new Date(dateStr).toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

interface Props { projectId: string }

export function ProjectActivity({ projectId }: Props) {
  const { data: events, isLoading } = trpc.audit.byProject.useQuery({ projectId })

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="h-7 w-7 rounded-full bg-slate-100 animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5 py-1">
              <div className="h-3 w-48 rounded bg-slate-100 animate-pulse" />
              <div className="h-3 w-24 rounded bg-slate-100 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!events?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Clock className="mb-2 h-7 w-7" />
        <p className="text-sm">Sin actividad registrada todavía</p>
      </div>
    )
  }

  return (
    <div className="relative max-w-xl">
      {/* vertical line */}
      <div className="absolute left-3.5 top-0 h-full w-px bg-slate-100" />

      <div className="space-y-4">
        {events.map(ev => {
          const user = ev.user as { id: string; name: string; avatar_url: string | null } | null
          const actionLabel = ACTION_LABELS[ev.action] ?? ev.action
          const fieldLabel = ev.field_changed ? FIELD_LABELS[ev.field_changed] ?? ev.field_changed : null

          return (
            <div key={ev.id} className="relative flex gap-3">
              <div className="relative z-10 shrink-0">
                {user ? (
                  <Avatar className="h-7 w-7 border-2 border-white">
                    <AvatarImage src={user.avatar_url ?? undefined} />
                    <AvatarFallback className="text-[10px] bg-indigo-100 text-indigo-700">
                      {user.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="h-7 w-7 rounded-full border-2 border-white bg-slate-200 flex items-center justify-center">
                    <Clock className="h-3 w-3 text-slate-400" />
                  </div>
                )}
              </div>

              <div className="flex-1 pb-1">
                <p className="text-sm text-slate-700">
                  <span className="font-medium">{user?.name ?? 'Sistema'}</span>
                  {' '}{actionLabel}
                  {fieldLabel && <span className="text-slate-500"> {fieldLabel}</span>}
                </p>

                {ev.field_changed && (ev.old_value || ev.new_value) && (
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    {ev.old_value && (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-600 line-through">
                        {humanizeValue(ev.field_changed, ev.old_value)}
                      </span>
                    )}
                    {ev.new_value && (
                      <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-600">
                        {humanizeValue(ev.field_changed, ev.new_value)}
                      </span>
                    )}
                  </div>
                )}

                <p className="mt-0.5 text-xs text-slate-400">{timeAgo(ev.changed_at)}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
