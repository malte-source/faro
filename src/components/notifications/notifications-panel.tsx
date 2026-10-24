'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc/client'
import { Bell, AlertCircle, Clock, Calendar, X, ChevronRight, CheckCheck } from 'lucide-react'
import { formatDate, daysUntil } from '@/lib/utils'
import { ScrollFade } from '@/components/ui/scroll-fade'
import { NotificationItem, groupByDay, type InboxItem } from '@/components/notifications/notification-item'

export function NotificationsPanel({ placement = 'sidebar' }: { placement?: 'sidebar' | 'sheet' } = {}) {
  const sheet = placement === 'sheet'
  const [open, setOpen] = useState(false)

  const { data, isLoading } = trpc.notifications.list.useQuery(undefined, {
    refetchInterval: 60_000, // refresh every minute
    staleTime: 30_000,
  })

  // Persisted events (assigned, mentioned, asked to review…) — newest page only; the full list lives in /dashboard/bandeja.
  const utils = trpc.useUtils()
  const { data: inbox } = trpc.notifications.inbox.useQuery(undefined, { refetchInterval: 45_000, staleTime: 20_000, retry: false })
  const { data: unread = 0 } = trpc.notifications.unreadCount.useQuery(undefined, { refetchInterval: 45_000, staleTime: 20_000, retry: false })
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.unreadCount.invalidate()
      void utils.notifications.inbox.invalidate()
    },
  })
  const persisted = useMemo(() => (inbox?.items ?? []) as InboxItem[], [inbox])
  const grouped = useMemo(() => groupByDay(persisted), [persisted])

  const derivedCount = data?.totalCount ?? 0
  const totalCount = derivedCount + unread

  // App-icon badge (installed PWA on Android/iOS; harmless elsewhere).
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    try {
      if (unread > 0) void nav.setAppBadge?.(unread)
      else void nav.clearAppBadge?.()
    } catch {
      /* badges are decoration */
    }
  }, [unread])

  const openItem = (item: InboxItem) => {
    if (!item.read) markRead.mutate({ ids: [item.id] })
    setOpen(false)
  }

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={sheet
          ? 'relative flex h-10 w-10 items-center justify-center rounded-full text-foreground active:bg-border-soft'
          : 'relative flex h-7 w-7 items-center justify-center rounded-md text-graphite transition-colors hover:bg-border-soft hover:text-graphite'}
        title="Notificaciones"
        aria-label="Notificaciones"
      >
        <Bell className={sheet ? 'h-[22px] w-[22px]' : 'h-4 w-4'} />
        {totalCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <>
          {/* Backdrop */}
          <div className={sheet ? 'fixed inset-0 z-[60] bg-night/50 backdrop-blur-[2px]' : 'fixed inset-0 z-40'} onClick={() => setOpen(false)} />

          <div className={sheet
            ? 'fixed inset-x-0 bottom-0 z-[61] flex max-h-[85dvh] flex-col overflow-hidden rounded-t-[26px] bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_40px_rgba(10,26,38,0.25)]'
            : 'absolute bottom-full left-0 z-50 mb-2 w-80 overflow-hidden rounded-xl bg-surface shadow-xl ring-1 ring-stone'}>
            {sheet && <span className="mx-auto mt-2.5 block h-1 w-10 shrink-0 rounded-full bg-stone dark:bg-border" aria-hidden />}
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-graphite" />
                <span className="text-sm font-semibold text-foreground">Notificaciones</span>
                {totalCount > 0 && (
                  <span className="rounded-full bg-danger-wash px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                    {totalCount}
                  </span>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-graphite hover:text-graphite"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <ScrollFade className={sheet ? 'min-h-0 flex-1 overflow-y-auto' : 'max-h-[420px] overflow-y-auto'}>
              {isLoading && (
                <div className="flex items-center justify-center py-8 text-graphite text-sm">
                  Cargando...
                </div>
              )}

              {!isLoading && derivedCount === 0 && persisted.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-10">
                  <Bell className="h-8 w-8 text-stone" />
                  <p className="text-sm font-medium text-success">¡Todo al día!</p>
                  <p className="text-xs text-graphite">No tienes notificaciones pendientes</p>
                </div>
              )}

              {/* Persisted events */}
              {persisted.length > 0 && (
                <div>
                  <div className="flex items-center justify-between bg-border-soft px-4 py-2">
                    <span className="text-xs font-semibold text-foreground">
                      Novedades{unread > 0 ? ` (${unread} sin leer)` : ''}
                    </span>
                    {unread > 0 && (
                      <button
                        type="button"
                        onClick={() => markRead.mutate({ all: true })}
                        className="flex items-center gap-1 text-[11px] font-medium text-signal-ink"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                        Marcar todo como leído
                      </button>
                    )}
                  </div>
                  {([['Hoy', grouped.today], ['Antes', grouped.earlier]] as const).map(([label, rows]) =>
                    rows.length === 0 ? null : (
                      <div key={label}>
                        <p className="px-4 pb-0.5 pt-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-graphite">{label}</p>
                        <div className="divide-y divide-border-soft">
                          {rows.map(item => <NotificationItem key={item.id} item={item} onOpen={openItem} />)}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}

              {/* Overdue tasks */}
              {(data?.overdueTasks.length ?? 0) > 0 && (
                <div>
                  <div className="flex items-center gap-2 bg-danger-wash px-4 py-2">
                    <AlertCircle className="h-3.5 w-3.5 text-danger" />
                    <span className="text-xs font-semibold text-danger">
                      Vencidas ({data!.overdueTasks.length})
                    </span>
                  </div>
                  {data!.overdueTasks.map(task => {
                    const days = task.due_date ? daysUntil(task.due_date) : null
                    return (
                      <Link
                        key={task.id}
                        href={task.project ? `/dashboard/projects/${task.project.id}` : '/dashboard/tasks'}
                        onClick={() => setOpen(false)}
                        className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-background"
                      >
                        <div
                          className="mt-1 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: task.project?.color ?? '#94a3b8' }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{task.title}</p>
                          <p className="mt-0.5 text-[11px] font-medium text-danger">
                            {days !== null ? `Venció hace ${Math.abs(days)} día${Math.abs(days) !== 1 ? 's' : ''}` : 'Vencida'}
                            {task.project && <span className="ml-1.5 font-normal text-graphite">· {task.project.code}</span>}
                          </p>
                        </div>
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone" />
                      </Link>
                    )
                  })}
                </div>
              )}

              {/* Due soon tasks */}
              {(data?.dueSoonTasks.length ?? 0) > 0 && (
                <div className={(data?.overdueTasks.length ?? 0) > 0 ? 'border-t border-border-soft' : ''}>
                  <div className="flex items-center gap-2 bg-signal-wash px-4 py-2">
                    <Clock className="h-3.5 w-3.5 text-signal-ink" />
                    <span className="text-xs font-semibold text-signal-ink">
                      Próximas 3 días ({data!.dueSoonTasks.length})
                    </span>
                  </div>
                  {data!.dueSoonTasks.map(task => {
                    const days = task.due_date ? daysUntil(task.due_date) : null
                    return (
                      <Link
                        key={task.id}
                        href={task.project ? `/dashboard/projects/${task.project.id}` : '/dashboard/tasks'}
                        onClick={() => setOpen(false)}
                        className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-background"
                      >
                        <div
                          className="mt-1 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: task.project?.color ?? '#94a3b8' }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{task.title}</p>
                          <p className="mt-0.5 text-[11px] text-signal-ink">
                            {days === 0 ? 'Vence hoy' : days === 1 ? 'Vence mañana' : `Vence en ${days} días`}
                            {task.project && <span className="ml-1.5 text-graphite">· {task.project.code}</span>}
                          </p>
                        </div>
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone" />
                      </Link>
                    )
                  })}
                </div>
              )}

              {/* Due projects */}
              {(data?.dueProjects.length ?? 0) > 0 && (
                <div className={((data?.overdueTasks.length ?? 0) + (data?.dueSoonTasks.length ?? 0)) > 0 ? 'border-t border-border-soft' : ''}>
                  <div className="flex items-center gap-2 bg-info/10 px-4 py-2">
                    <Calendar className="h-3.5 w-3.5 text-info" />
                    <span className="text-xs font-semibold text-info">
                      Proyectos — próximos 7 días ({data!.dueProjects.length})
                    </span>
                  </div>
                  {data!.dueProjects.map(project => {
                    const days = project.end_date ? daysUntil(project.end_date) : null
                    return (
                      <Link
                        key={project.id}
                        href={`/dashboard/projects/${project.id}`}
                        onClick={() => setOpen(false)}
                        className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-background"
                      >
                        <div
                          className="mt-1 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: project.color }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">
                            <span className="mr-1 text-graphite">{project.code}</span>
                            {project.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-info">
                            {days === 0 ? 'Vence hoy' : days === 1 ? 'Vence mañana' : `Vence en ${days} días`}
                            {project.end_date && <span className="ml-1.5 text-graphite">· {formatDate(project.end_date)}</span>}
                          </p>
                        </div>
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone" />
                      </Link>
                    )
                  })}
                </div>
              )}
            </ScrollFade>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border-soft px-4 py-2.5">
              <Link
                href="/dashboard/bandeja"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-signal-ink hover:text-foreground hover:underline"
              >
                Ver toda la bandeja →
              </Link>
              <Link
                href="/dashboard/ajustes-avisos"
                onClick={() => setOpen(false)}
                className="text-xs text-graphite hover:text-foreground hover:underline"
              >
                Ajustes de avisos
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
