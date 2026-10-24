'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { BellRing, Check, Inbox, Loader2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { EmptyState } from '@/components/ui/empty-state'
import { InsetGroup } from '@/components/mobile/inset-list'
import { Segmented } from '@/components/mobile/segmented'
import { SwipeRow } from '@/components/mobile/swipe-row'
import { NotificationItem, groupByDay, type InboxItem } from '@/components/notifications/notification-item'
import { usePush } from '@/components/notifications/use-push'

type View = 'unread' | 'all'

/** The whole inbox: persisted events, newest first, by day, with infinite scroll and swipe-to-mark-read. */
export function BandejaView() {
  const utils = trpc.useUtils()
  const [view, setView] = useState<View>('unread')
  const onlyUnread = view === 'unread'

  const q = trpc.notifications.inbox.useInfiniteQuery(
    { onlyUnread },
    { getNextPageParam: last => last.nextCursor ?? undefined, refetchInterval: 45_000 },
  )
  const { data: unread = 0 } = trpc.notifications.unreadCount.useQuery(undefined, { refetchInterval: 45_000 })
  const { state: pushState } = usePush()

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.inbox.invalidate()
      void utils.notifications.unreadCount.invalidate()
    },
  })

  const items = useMemo(() => (q.data?.pages.flatMap(p => p.items) ?? []) as InboxItem[], [q.data])
  const groups = useMemo(() => groupByDay(items), [items])

  // Infinite scroll: fetch the next page when the sentinel enters the view.
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    }, { rootMargin: '240px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const open = (item: InboxItem) => { if (!item.read) markRead.mutate({ ids: [item.id] }) }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-8 pt-3 md:px-0 md:pt-0">
      {pushState === 'off' && (
        <Link
          href="/dashboard/ajustes-avisos"
          className="flex items-center gap-3 rounded-[14px] border border-signal/40 bg-signal-wash p-3 text-[14px] text-foreground active:opacity-80 dark:bg-signal/10"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-signal text-night"><BellRing className="h-[18px] w-[18px]" /></span>
          <span className="min-w-0 flex-1"><strong className="font-semibold">Activa los avisos</strong> y entérate sin abrir Faro.</span>
        </Link>
      )}

      <div className="flex items-center gap-3">
        <Segmented
          className="flex-1"
          aria-label="Filtro de la bandeja"
          value={view}
          onChange={setView}
          options={[
            { value: 'unread', label: 'Sin leer', count: unread || undefined },
            { value: 'all', label: 'Todo' },
          ]}
        />
        {unread > 0 && (
          <button
            type="button"
            onClick={() => markRead.mutate({ all: true })}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-signal-ink active:bg-border-soft"
          >
            <Check className="h-4 w-4" />
            Todo leído
          </button>
        )}
      </div>

      {q.isLoading ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-[14px] bg-border-soft" />)}
        </div>
      ) : q.error ? (
        <EmptyState icon={Inbox} title="No se pudo cargar la bandeja" description="Desliza hacia abajo para reintentar." />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          tone="success"
          title={onlyUnread ? 'Todo al día' : 'Aún no hay novedades'}
          description={onlyUnread ? 'No tienes avisos sin leer.' : 'Cuando te asignen algo, te mencionen o te pidan revisar algo, aparece aquí.'}
        />
      ) : (
        <>
          {([['Hoy', groups.today], ['Antes', groups.earlier]] as const).map(([label, rows]) =>
            rows.length === 0 ? null : (
              <InsetGroup key={label} label={label}>
                {rows.map(item =>
                  item.read ? (
                    <div key={item.id} className="cv-auto-row"><NotificationItem item={item} onOpen={open} /></div>
                  ) : (
                    <SwipeRow
                      key={item.id}
                      className="cv-auto-row"
                      actions={[{ label: 'Leído', tone: 'success', icon: <Check className="h-4 w-4" />, onTrigger: () => markRead.mutate({ ids: [item.id] }) }]}
                    >
                      <NotificationItem item={item} onOpen={open} />
                    </SwipeRow>
                  ),
                )}
              </InsetGroup>
            ),
          )}
          <div ref={sentinel} className="flex h-10 items-center justify-center text-graphite">
            {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
            {!hasNextPage && items.length > 8 && <span className="text-xs">Llegaste al final</span>}
          </div>
        </>
      )}
    </div>
  )
}
