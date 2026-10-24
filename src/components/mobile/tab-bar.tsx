'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarCheck, FolderKanban, LayoutDashboard, CheckSquare, MessagesSquare, Menu, Plus } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { useChatUnreadTotal } from '@/components/chat/hooks'
import { cn } from '@/lib/utils'
import { haptic } from '@/components/mobile/haptics'
import dynamic from 'next/dynamic'
import { Mic } from 'lucide-react'
import { MobileCreateSheet } from '@/components/pwa/mobile-create-sheet'
import { QuickCreateModal } from '@/components/tasks/quick-create-modal'

const MobileCaptureFab = dynamic(() => import('@/components/captura/mobile-recorder').then(m => m.MobileCaptureFab), {
  ssr: false,
  loading: () => (
    <span
      aria-hidden
      className="-mt-[22px] flex h-[54px] w-[54px] items-center justify-center rounded-full bg-signal text-night shadow-[0_6px_18px_rgba(255,176,32,0.45)] ring-4 ring-surface"
    >
      <Mic className="h-6 w-6" />
    </span>
  ),
})

interface Tab {
  key: string
  label: string
  href: string
  icon: typeof CalendarCheck
  /** Paths (prefix match) that light this tab up. */
  match: string[]
  exact?: boolean
  badge?: number
  danger?: boolean
}

/**
 * Bottom tab bar — Faro's mobile spine. Five slots with the capture button
 * raised in the middle (the Señal circle from the brand prototype):
 *   Grupo mode : Hoy · Chat · (capturar) · Proyectos · Más
 *   Classic    : Inicio · Proyectos · (+) · Tareas · Más
 * Everything else lives under "Más" (an iOS-Settings-style screen) and ⌘K.
 */
export function TabBar() {
  const pathname = usePathname()
  const [sheet, setSheet] = useState(false)
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const groupMode = me?.groupMode ?? false
  const { data: counts } = trpc.inbox.counts.useQuery(undefined, { staleTime: 30_000, enabled: groupMode })
  const { data: chat } = useChatUnreadTotal(!!me?.isTeam)

  const chatBadge = chat?.total ?? 0
  const tabs: Tab[] = groupMode
    ? [
        { key: 'hoy', label: 'Hoy', href: '/dashboard/hoy', icon: CalendarCheck, match: ['/dashboard/hoy'], badge: counts?.badge },
        { key: 'chat', label: 'Chat', href: '/dashboard/chat', icon: MessagesSquare, match: ['/dashboard/chat'], badge: chatBadge, danger: (chat?.mentions ?? 0) > 0 },
        { key: 'proyectos', label: 'Proyectos', href: '/dashboard/projects', icon: FolderKanban, match: ['/dashboard/projects'] },
        { key: 'mas', label: 'Más', href: '/dashboard/mas', icon: Menu, match: [] },
      ]
    : [
        { key: 'inicio', label: 'Inicio', href: '/dashboard', icon: LayoutDashboard, match: ['/dashboard'], exact: true },
        { key: 'proyectos', label: 'Proyectos', href: '/dashboard/projects', icon: FolderKanban, match: ['/dashboard/projects'] },
        { key: 'tareas', label: 'Tareas', href: '/dashboard/tasks', icon: CheckSquare, match: ['/dashboard/tasks'] },
        { key: 'mas', label: 'Más', href: '/dashboard/mas', icon: Menu, match: [], badge: chatBadge, danger: (chat?.mentions ?? 0) > 0 },
      ]

  const direct = tabs.filter(t => t.key !== 'mas')
  const isActive = (t: Tab) =>
    t.key === 'mas'
      ? !direct.some(d => (d.exact ? pathname === d.href : d.match.some(m => pathname.startsWith(m))))
      : t.exact ? pathname === t.href : t.match.some(m => pathname.startsWith(m))

  // The raised button sits in the middle slot (after the 2nd tab).
  const left = tabs.slice(0, 2)
  const right = tabs.slice(2)

  const renderTab = (t: Tab) => {
    const active = isActive(t)
    const Icon = t.icon
    return (
      <Link
        key={t.key}
        href={t.href}
        onClick={() => haptic()}
        aria-current={active ? 'page' : undefined}
        className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 pb-0.5 pt-1.5"
      >
        <span
          className={cn(
            'relative flex h-7 w-14 items-center justify-center rounded-full transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            active ? 'bg-signal/25 dark:bg-signal/20' : 'bg-transparent',
          )}
        >
          <Icon className={cn('h-[22px] w-[22px] transition-colors', active ? 'text-foreground' : 'text-graphite')} strokeWidth={active ? 2.3 : 1.9} />
          {!!t.badge && (
            <span className={cn(
              'absolute -top-0.5 right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums ring-2 ring-surface',
              t.danger ? 'bg-danger text-white' : 'bg-signal text-night',
            )}>
              {t.badge > 99 ? '99+' : t.badge}
            </span>
          )}
        </span>
        <span className={cn('text-[11px] leading-none transition-colors', active ? 'font-semibold text-foreground' : 'font-medium text-graphite')}>{t.label}</span>
      </Link>
    )
  }

  return (
    <>
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto flex h-16 max-w-xl items-stretch px-1">
          {left.map(renderTab)}
          <div className="relative flex w-[76px] shrink-0 items-start justify-center">
            {groupMode ? (
              <MobileCaptureFab
                onTap={() => setSheet(true)}
                className="-mt-[22px] h-[54px] w-[54px] shadow-[0_6px_18px_rgba(255,176,32,0.45)] ring-4 ring-surface"
              />
            ) : (
              <button
                type="button"
                onClick={() => { haptic(); setSheet(true) }}
                aria-label="Nueva tarea"
                className="-mt-[22px] flex h-[54px] w-[54px] items-center justify-center rounded-full bg-signal text-night shadow-[0_6px_18px_rgba(255,176,32,0.45)] ring-4 ring-surface transition-transform active:scale-95"
              >
                <Plus className="h-7 w-7" strokeWidth={2.4} />
              </button>
            )}
          </div>
          {right.map(renderTab)}
        </div>
      </nav>
      {groupMode
        ? <MobileCreateSheet open={sheet} onClose={() => setSheet(false)} />
        : <QuickCreateModal open={sheet} onClose={() => setSheet(false)} />}
    </>
  )
}
