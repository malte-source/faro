'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Building2, ChevronDown, ChevronLeft, Search, User } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { useMobileChrome } from '@/stores/mobile-chrome'
import { openCommandPalette } from '@/components/command/command-palette'
import { NotificationsPanel } from '@/components/notifications/notifications-panel'
import { WorkspaceSheet } from '@/components/mobile/workspace-sheet'
import { cn } from '@/lib/utils'

/** Screens that sit directly on a tab: they get the workspace chip; every other screen is "pushed" and gets Back. */
const ROOTS = new Set(['/dashboard', '/dashboard/hoy', '/dashboard/chat', '/dashboard/projects', '/dashboard/tasks', '/dashboard/mas'])

const LARGE_TITLE_H = 46
const COLLAPSE_AT = 40

/**
 * iOS "large title" navigation bar, in Faro's voice (Archivo 800, tight
 * tracking). Row 1 is the compact bar — workspace chip or Back on the left,
 * search · notifications · profile on the right; the title row below it
 * collapses into row 1 as the page scrolls.
 */
export function MobileNavBar({ title, actions }: { title: string; actions?: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const y = useMobileChrome(s => s.scrollY)
  const [spaceOpen, setSpaceOpen] = useState(false)
  const { data: active } = trpc.orgs.active.useQuery(undefined, { staleTime: 60_000 })
  const { data: me } = trpc.team.me.useQuery(undefined, { staleTime: 60_000 })

  const isRoot = ROOTS.has(pathname)
  const t = Math.min(1, y / COLLAPSE_AT)
  const initials = (me?.name ?? '?').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()

  const goBack = () => {
    if (window.history.length > 1) router.back()
    else router.push('/dashboard/mas')
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-30 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:hidden',
        'border-b transition-colors duration-200',
        t >= 1 ? 'border-border' : 'border-transparent',
      )}
    >
      <div className="relative flex h-11 items-center justify-between gap-2 px-2">
        {isRoot ? (
          <button
            type="button"
            onClick={() => setSpaceOpen(true)}
            className="flex h-9 min-w-0 max-w-[52%] items-center gap-2 rounded-full pl-1 pr-2.5 active:bg-border-soft"
            aria-label="Cambiar de espacio de trabajo"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-night text-mist dark:bg-signal dark:text-night">
              {active?.workspace_type === 'personal' ? <User className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
            </span>
            <span className="truncate text-[13px] font-semibold text-foreground">{active?.name ?? 'Faro'}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-graphite" />
          </button>
        ) : (
          <button
            type="button"
            onClick={goBack}
            className="flex h-9 items-center gap-0.5 rounded-full pl-1 pr-3 text-[15px] font-medium text-foreground active:bg-border-soft"
            aria-label="Volver"
          >
            <ChevronLeft className="h-6 w-6 text-signal-ink" strokeWidth={2.4} />
            Atrás
          </button>
        )}

        {/* Collapsed title fades in as the large one scrolls away. */}
        <span
          className="pointer-events-none absolute inset-x-24 truncate text-center font-display text-[15px] font-bold tracking-[-0.02em] text-foreground"
          style={{ opacity: t, transform: `translateY(${(1 - t) * 6}px)` }}
          aria-hidden
        >
          {!isRoot && title}
        </span>

        <div className="flex shrink-0 items-center">
          <button type="button" onClick={openCommandPalette} className="flex h-10 w-10 items-center justify-center rounded-full text-foreground active:bg-border-soft" aria-label="Buscar">
            <Search className="h-[22px] w-[22px]" />
          </button>
          <NotificationsPanel placement="sheet" />
          <Link href="/dashboard/mas" className="ml-0.5 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-night text-[11px] font-bold text-mist ring-1 ring-border dark:bg-signal dark:text-night" aria-label="Perfil y más opciones">
            {me?.avatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={me.avatar} alt="" className="h-full w-full object-cover" />
              : initials}
          </Link>
        </div>
      </div>

      <div className="overflow-hidden" style={{ height: Math.max(0, LARGE_TITLE_H * (1 - t)), opacity: 1 - t }} aria-hidden={t >= 1}>
        <h1 className="truncate px-4 pt-0.5 font-display text-[30px] font-extrabold leading-[1.1] tracking-[-0.035em] text-foreground">{title}</h1>
      </div>

      {actions && (
        <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2.5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-track>
          {actions}
        </div>
      )}

      <WorkspaceSheet open={spaceOpen} onClose={() => setSpaceOpen(false)} />
    </header>
  )
}
