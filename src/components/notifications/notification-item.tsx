'use client'

import Link from 'next/link'
import { AtSign, CalendarClock, CheckSquare, Eye, FileText, Landmark, MessageCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface InboxItem {
  id: string
  kind: string
  title: string
  body: string | null
  url: string | null
  read: boolean
  createdAt: string
  actor: { id: string; name: string; avatar_url: string | null } | null
}

const KIND_ICON: Record<string, LucideIcon> = {
  task_assigned: CheckSquare,
  task_review: Eye,
  mention: AtSign,
  dm: MessageCircle,
  doc_review: FileText,
  doc_decision: FileText,
  cost_run: Landmark,
  deadline: CalendarClock,
}

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

/** "hace 5 min", "hace 2 h", "ayer", then a short date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diffMs = new Date(iso).getTime() - now
  const min = Math.round(diffMs / 60_000)
  if (Math.abs(min) < 1) return 'ahora'
  if (Math.abs(min) < 60) return rtf.format(min, 'minute')
  const hours = Math.round(min / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return rtf.format(days, 'day')
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

/** Split into "Hoy" (same local calendar day) and "Antes". */
export function groupByDay<T extends { createdAt: string }>(items: T[], now = new Date()): { today: T[]; earlier: T[] } {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const today: T[] = []
  const earlier: T[] = []
  for (const it of items) (new Date(it.createdAt).getTime() >= startOfToday ? today : earlier).push(it)
  return { today, earlier }
}

/** One persisted notification. Tapping it opens its page and marks it read. */
export function NotificationItem({
  item,
  onOpen,
  className,
}: {
  item: InboxItem
  onOpen: (item: InboxItem) => void
  className?: string
}) {
  const Icon = KIND_ICON[item.kind] ?? CheckSquare
  const href = item.url && item.url.startsWith('/') ? item.url : '/dashboard/bandeja'
  return (
    <Link
      href={href}
      onClick={() => onOpen(item)}
      className={cn(
        'relative flex min-h-[60px] items-start gap-3 px-4 py-3 transition-colors active:bg-border-soft md:hover:bg-border-soft',
        !item.read && 'bg-signal-wash/60 dark:bg-signal/10',
        className,
      )}
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-border-soft text-foreground">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[14px] leading-snug text-foreground', !item.read ? 'font-semibold' : 'font-medium')}>{item.title}</span>
        {item.body && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-graphite">{item.body}</span>}
        <span className="mt-1 block text-[11px] text-graphite">
          {item.actor ? `${item.actor.name.split(' ')[0]} · ` : ''}
          {relativeTime(item.createdAt)}
        </span>
      </span>
      {!item.read && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-signal" aria-label="Sin leer" />}
    </Link>
  )
}
