'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FolderKanban, CheckSquare, Users, Kanban } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: 'Proyectos', icon: FolderKanban },
  { href: '/dashboard/kanban', label: 'Kanban', icon: Kanban },
  { href: '/dashboard/tasks', label: 'Tareas', icon: CheckSquare },
  { href: '/dashboard/team', label: 'Equipo', icon: Users },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-sm md:hidden">
      <div className="flex items-center justify-around px-1 pb-safe">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] font-medium transition-colors',
                active
                  ? 'text-indigo-600'
                  : 'text-slate-500 active:text-slate-700'
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', active && 'drop-shadow-sm')} />
              <span>{label}</span>
              {active && (
                <span className="absolute top-0 mx-auto h-0.5 w-8 rounded-full bg-indigo-600" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
