'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  Users,
  Settings,
  LogOut,
  Kanban,
  CalendarDays,
  Plus,
  BarChart3,
  Sun,
  Moon,
  Monitor,
  Search,
  GanttChartSquare,
  Scale,
  Activity,
  Sparkles,
  Rocket,
  CalendarCheck,
  Flame,
  Zap,
  Gauge,
  Repeat,
  Target,
  ClipboardList,
  Map as MapIcon,
  CalendarRange,
  Grid3x3,
  Building2,
  ChevronDown,
  MessagesSquare,
  FileText,
  Landmark,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { signOutAndClear } from '@/lib/sign-out'
import { NotificationsPanel } from '@/components/notifications/notifications-panel'
import { QuickCreateModal } from '@/components/tasks/quick-create-modal'
import { MagicQuickAdd } from '@/components/tasks/magic-quick-add'
import { RunningTimerPill } from '@/components/time/running-timer-pill'
import { openCommandPalette } from '@/components/command/command-palette'
import { MeetingScheduler } from '@/components/calendar/meeting-scheduler'
import { MeetingImportModal } from '@/components/tasks/meeting-import-modal'
import { Video } from 'lucide-react'
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher'
import { FaroMark } from '@/components/brand/logo'
import { trpc } from '@/lib/trpc/client'
import { useChatUnreadTotal } from '@/components/chat/hooks'

// Grouped nav. Each group has an optional `header` (the first/primary
// group has none — those are the everyday drivers). Grouping separates
// entities (Proyectos, Tareas) from VIEWS over them (Kanban, Gantt…) from
// planning tools and analysis, cutting a flat 12-item list into 4 scannable
// clusters.
const navGroups: { header?: string; items: { href: string; label: string; icon: typeof LayoutDashboard; tooltip?: string }[] }[] = [
  {
    items: [
      { href: '/dashboard/today',      label: 'Mi día',      icon: CalendarCheck, tooltip: 'Solo TUS tareas de hoy (asignadas a ti)' },
      { href: '/dashboard/priorities', label: 'Prioridades', icon: Flame,         tooltip: 'Lo más urgente del equipo, cross-project' },
      { href: '/dashboard',            label: 'Dashboard',   icon: LayoutDashboard, tooltip: 'Resumen ejecutivo' },
      { href: '/dashboard/projects',   label: 'Proyectos',   icon: FolderKanban,  tooltip: 'Lista de proyectos visibles' },
      { href: '/dashboard/tasks',      label: 'Tareas',      icon: CheckSquare,   tooltip: 'Explorador: busca y filtra CUALQUIER tarea' },
    ],
  },
  {
    header: 'Vistas',
    items: [
      { href: '/dashboard/week',    label: 'Semana',  icon: CalendarRange, tooltip: 'Tus tareas distribuidas por día — drag para reagendar' },
      { href: '/dashboard/month',   label: 'Mes',     icon: Grid3x3,       tooltip: 'Grilla mensual con todas tus tareas con fecha' },
      { href: '/dashboard/kanban',  label: 'Kanban',  icon: Kanban, tooltip: 'Proyectos arrastrables por etapa de workflow' },
      { href: '/dashboard/gantt',   label: 'Gantt',   icon: GanttChartSquare, tooltip: 'Timeline de proyectos con dependencias' },
      { href: '/dashboard/roadmap', label: 'Roadmap', icon: MapIcon, tooltip: 'Portafolio por trimestre — vista ejecutiva' },
      // Calendario y Eisenhower siguen accesibles desde /dashboard/calendar y /dashboard/eisenhower
      // — los movimos al command palette (⌘K → "calendario" / "eisenhower") para reducir
      // el ruido del sidebar. Se usaban < 5% del tiempo según el audit.
    ],
  },
  {
    header: 'Planificación',
    items: [
      { href: '/dashboard/goals',        label: 'Objetivos',          icon: Target,   tooltip: 'OKRs / "El para qué" arriba de los proyectos' },
      { href: '/dashboard/sprints',      label: 'Sprints',            icon: Rocket },
      { href: '/dashboard/decisions',    label: 'Decisiones',         icon: Scale },
      { href: '/dashboard/documentos',   label: 'Documentos',         icon: FileText, tooltip: 'Políticas, manuales, SOPs y actas — con IA' },
      { href: '/dashboard/automations',  label: 'Automatizaciones',   icon: Zap },
      { href: '/dashboard/recurring',    label: 'Recurrentes',        icon: Repeat },
      { href: '/dashboard/forms',        label: 'Formularios',        icon: ClipboardList, tooltip: 'Forms públicos que crean tareas (clientes externos, intake)' },
    ],
  },
  {
    header: 'Análisis',
    items: [
      { href: '/dashboard/reports', label: 'Reportes', icon: BarChart3 },
      { href: '/dashboard/activity', label: 'Actividad', icon: Activity },
      { href: '/dashboard/team', label: 'Equipo', icon: Users },
      { href: '/dashboard/capacity', label: 'Capacidad', icon: Gauge },
    ],
  },
]

// Simplified navigation for grupos with several empresas (workspace-scoped
// orgs). Everything else (Kanban, Gantt, Equipo, Reportes…) stays one click
// away under "Más herramientas" and in ⌘K — it lives inside the project.
const groupNavItems: { href: string; label: string; icon: typeof LayoutDashboard; tooltip: string; direction?: boolean; badge?: 'today' | 'chat' }[] = [
  { href: '/dashboard/hoy',       label: 'Hoy',       icon: CalendarCheck, tooltip: 'Todas tus tareas, de todas tus empresas', badge: 'today' },
  { href: '/dashboard/chat',      label: 'Chat',      icon: MessagesSquare, tooltip: 'Canales por empresa, mensajes directos y hilos', badge: 'chat' },
  { href: '/dashboard/projects',  label: 'Proyectos', icon: FolderKanban,  tooltip: 'Proyectos de tus empresas' },
  { href: '/dashboard/documentos', label: 'Documentos', icon: FileText,    tooltip: 'Políticas, manuales, SOPs y actas — con IA' },
  { href: '/dashboard/personas',  label: 'Personas',  icon: Users,         tooltip: 'Quién trabaja dónde y con qué carga' },
  { href: '/dashboard/grupo',     label: 'Grupo',     icon: Building2,     tooltip: 'Vista de Dirección: todas las empresas', direction: true },
  { href: '/dashboard/costos',    label: 'Costos',    icon: Landmark,      tooltip: 'Reparto de costos del holding a las filiales (Dirección)', direction: true },
  { href: '/dashboard/ia',        label: 'Uso de IA', icon: Gauge,         tooltip: 'Gasto de IA del mes y presupuesto (Dirección)', direction: true },
]

interface SidebarProps {
  userName?: string | null
  userEmail?: string | null
  userAvatar?: string | null
}

export function Sidebar({ userName, userEmail, userAvatar }: SidebarProps) {
  const pathname = usePathname()
  const [quickCreate, setQuickCreate] = useState(false)
  const [magicAdd, setMagicAdd] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [meetImportOpen, setMeetImportOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const { data: counts } = trpc.inbox.counts.useQuery(undefined, { staleTime: 30_000, enabled: !!me?.groupMode })
  const groupMode = me?.groupMode ?? false
  const { data: chatUnread } = useChatUnreadTotal(!!me?.isTeam)

  const nextTheme = () => {
    if (theme === 'light') setTheme('dark')
    else if (theme === 'dark') setTheme('system')
    else setTheme('light')
  }

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor

  // Keyboard shortcuts: 'n' → quick create form, 'Shift+N' → magic AI add
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      if (e.key === 'N' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setMagicAdd(true)
        return
      }
      if (e.key === 'n' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setQuickCreate(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const initials = userName
    ?.split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? '?'

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-stone bg-white dark:border-night-700 dark:bg-night">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 border-b border-stone-100 px-4 dark:border-night-700">
        <FaroMark size={32} />
        <span className="font-display text-base font-extrabold tracking-[-0.03em] text-night dark:text-stone-100">Faro</span>
      </div>

      {/* Workspace switcher */}
      <WorkspaceSwitcher />

      {/* Search / Command Palette trigger */}
      <div className="px-2 py-2 border-b border-stone-100 dark:border-night-700">
        <button
          data-tour="search-trigger"
          onClick={openCommandPalette}
          className="flex w-full items-center gap-2.5 rounded-lg border border-stone bg-mist px-3 py-2 text-left text-sm text-graphite transition-all hover:border-stone hover:bg-white hover:text-graphite dark:border-ink-body dark:bg-night-700/50 dark:text-graphite dark:hover:border-graphite dark:hover:bg-night-700 dark:hover:text-graphite"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-xs">Buscar o comandos…</span>
          <kbd className="rounded border border-stone bg-white px-1.5 py-0.5 text-[10px] font-medium text-graphite shadow-sm dark:border-ink-body dark:bg-night dark:text-graphite">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Quick create — in grupo mode the top bar + Capturar replace these */}
      {!groupMode && (
      <div className="px-2 pt-2 pb-1 space-y-1">
        <button
          data-tour="quick-create"
          onClick={() => setQuickCreate(true)}
          className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-stone px-3 py-2 text-xs font-medium text-graphite transition-colors hover:border-signal/50 hover:bg-signal-wash hover:text-signal-ink dark:border-ink-body dark:text-graphite dark:hover:border-signal dark:hover:bg-signal dark:hover:text-signal"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Nueva tarea</span>
          <kbd className="ml-auto rounded border border-stone bg-stone-100 px-1 py-0.5 text-[10px] font-mono text-graphite dark:border-ink-body dark:bg-night-700 dark:text-graphite">N</kbd>
        </button>
        <button
          onClick={() => setMagicAdd(true)}
          className="flex w-full items-center gap-2.5 rounded-lg border border-stone bg-gradient-to-r from-signal-wash/60 to-white px-3 py-2 text-xs font-medium text-night transition hover:from-signal-wash hover:to-signal-wash dark:border-signal/40 dark:from-[#17313F] dark:to-night dark:text-signal"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Tarea con AI</span>
          <kbd className="ml-auto rounded border border-stone bg-white px-1 py-0.5 text-[10px] font-mono text-signal-ink dark:border-signal/40 dark:bg-night-700">⇧N</kbd>
        </button>
        <button
          onClick={() => setMeetingOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-stone px-3 py-2 text-xs font-medium text-graphite transition-colors hover:border-success hover:bg-success-wash hover:text-success dark:border-ink-body dark:text-graphite dark:hover:border-success dark:hover:bg-success dark:hover:text-success"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          <span>Schedulear reunión</span>
        </button>
        <button
          onClick={() => setMeetImportOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-stone px-3 py-2 text-xs font-medium text-graphite transition-colors hover:border-purple-400 hover:bg-purple-50 hover:text-purple-600 dark:border-ink-body dark:text-graphite dark:hover:border-purple-500 dark:hover:bg-purple-950 dark:hover:text-purple-400"
          title="Pega notas o transcripción de Meet → la AI las convierte en tareas"
        >
          <Video className="h-3.5 w-3.5" />
          <span>Reunión → Tareas</span>
        </button>
      </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groupMode && (
          <>
            <ul className="space-y-0.5">
              {groupNavItems
                .filter(i => (!i.direction || me?.isDirection) && (i.badge !== 'chat' || me?.isTeam))
                .map(({ href, label, icon: Icon, tooltip, badge }) => {
                  const active = pathname.startsWith(href)
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        title={tooltip}
                        className={cn(
                          'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-night text-mist before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-signal dark:bg-night-700'
                            : 'text-graphite hover:bg-stone-100 hover:text-night dark:text-graphite dark:hover:bg-night-700 dark:hover:text-stone-100'
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1">{label}</span>
                        {badge === 'today' && !!counts?.badge && (
                          <span className="rounded-full bg-signal px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-night">{counts.badge}</span>
                        )}
                        {badge === 'chat' && !!chatUnread?.total && (
                          <span className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                            chatUnread.mentions > 0 ? 'bg-danger text-white' : 'bg-signal text-night',
                          )}>
                            {chatUnread.total > 99 ? '99+' : chatUnread.total}
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
            </ul>

            {!!me?.memberships.length && (
              <div className="mt-5">
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-graphite">Mis sombreros</p>
                <ul className="space-y-0.5">
                  {me.memberships.map(m => (
                    <li key={m.workspaceId} className="flex items-center gap-2 px-3 py-1 text-xs text-graphite">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
                      <span className="truncate font-medium text-ink-body dark:text-stone">{m.name}</span>
                      <span className="truncate">· {m.position}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={() => setMoreOpen(v => !v)}
              aria-expanded={moreOpen}
              className="mt-5 flex w-full items-center gap-1 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-graphite hover:text-night dark:hover:text-stone-100"
            >
              Más herramientas
              <ChevronDown className={cn('h-3 w-3 transition-transform', moreOpen && 'rotate-180')} />
            </button>
          </>
        )}
        {!groupMode && me?.isTeam && (
          <Link
            href="/dashboard/chat"
            title="Canales, mensajes directos y hilos"
            className={cn(
              'relative mb-3 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              pathname.startsWith('/dashboard/chat')
                ? 'bg-night text-mist before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-signal dark:bg-night-700'
                : 'text-graphite hover:bg-stone-100 hover:text-night dark:text-graphite dark:hover:bg-night-700 dark:hover:text-stone-100'
            )}
          >
            <MessagesSquare className="h-4 w-4 shrink-0" />
            <span className="flex-1">Chat</span>
            {!!chatUnread?.total && (
              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums', chatUnread.mentions > 0 ? 'bg-danger text-white' : 'bg-signal text-night')}>
                {chatUnread.total > 99 ? '99+' : chatUnread.total}
              </span>
            )}
          </Link>
        )}
        {(!groupMode || moreOpen) && navGroups.map((group, gi) => (
          <div key={group.header ?? 'primary'} className={gi > 0 || groupMode ? 'mt-4' : ''}>
            {group.header && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-graphite dark:text-graphite">
                {group.header}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon, tooltip }) => {
                const active = href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(href)
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      title={tooltip}
                      className={cn(
                        'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-night text-mist before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-signal dark:bg-night-700'
                          : 'text-graphite hover:bg-stone-100 hover:text-night dark:text-graphite dark:hover:bg-night-700 dark:hover:text-stone-100'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}

        <div className="mt-6 border-t border-stone-100 pt-4 dark:border-night-700">
          <Link
            href="/dashboard/settings"
            className={cn(
              'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              pathname.startsWith('/dashboard/settings')
                ? 'bg-night text-mist before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-signal dark:bg-night-700'
                : 'text-graphite hover:bg-stone-100 hover:text-night dark:text-graphite dark:hover:bg-night-700 dark:hover:text-stone-100'
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            Configuración
          </Link>
        </div>
      </nav>

      {/* Active timer indicator — only renders when a timer is running */}
      <RunningTimerPill />

      {/* User */}
      <div className="border-t border-stone-100 p-3 dark:border-night-700">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          {userAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={userAvatar}
              alt={userName ?? ''}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-night text-xs font-semibold text-mist">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-night dark:text-stone-100">{userName}</p>
            <p className="truncate text-xs text-graphite dark:text-graphite">
              {groupMode
                ? (me?.isDirection ? 'Dirección del grupo' : `${me?.memberships.length ?? 0} ${me?.memberships.length === 1 ? 'sombrero' : 'sombreros'}`)
                : userEmail}
            </p>
          </div>
          <button
            onClick={nextTheme}
            className="rounded-md p-1 text-graphite transition-colors hover:bg-stone-100 hover:text-graphite dark:text-graphite dark:hover:bg-night-700 dark:hover:text-stone"
            title={`Tema: ${theme}`}
          >
            <ThemeIcon className="h-4 w-4" />
          </button>
          <NotificationsPanel />
          <QuickCreateModal open={quickCreate} onClose={() => setQuickCreate(false)} />
          <MagicQuickAdd open={magicAdd} onClose={() => setMagicAdd(false)} />
          {meetingOpen && <MeetingScheduler onClose={() => setMeetingOpen(false)} />}
          {meetImportOpen && <MeetingImportModal onClose={() => setMeetImportOpen(false)} />}
          {/* Client-side signOut avoids the Next.js 16 quirk where a logout
              server-action POSTs to the current dynamic route ([id]) and 404s. */}
          <button
            onClick={() => void signOutAndClear()}
            className="rounded-md p-1 text-graphite transition-colors hover:bg-stone-100 hover:text-graphite dark:text-graphite dark:hover:bg-night-700 dark:hover:text-stone"
            title="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
