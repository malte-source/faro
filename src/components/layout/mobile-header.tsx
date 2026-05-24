'use client'

import Link from 'next/link'
import { Anchor, Settings, Search } from 'lucide-react'
import { NotificationsPanel } from '@/components/notifications/notifications-panel'
import { openCommandPalette } from '@/components/command/command-palette'

interface MobileHeaderProps {
  userName?: string | null
  userAvatar?: string
}

export function MobileHeader({ userName, userAvatar }: MobileHeaderProps) {
  const initials = userName
    ?.split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? '?'

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden dark:border-slate-800 dark:bg-slate-900">
      {/* Logo */}
      <Link href="/dashboard" className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
          <Anchor className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">Faro</span>
      </Link>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={openCommandPalette}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          title="Buscar (⌘K)"
        >
          <Search className="h-4 w-4" />
        </button>
        <NotificationsPanel />
        <Link
          href="/dashboard/settings"
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <Settings className="h-4 w-4" />
        </Link>
        {userAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={userAvatar} alt={userName ?? ''} className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
            {initials}
          </div>
        )}
      </div>
    </header>
  )
}
