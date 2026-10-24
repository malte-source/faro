'use client'

import {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import {
  Search, LayoutDashboard, FolderKanban, Kanban, CheckSquare,
  CalendarDays, BarChart3, Users, Settings, Plus, LogOut,
  ArrowRight, FolderOpen, Hash,
  LayoutGrid, GanttChartSquare, CalendarCheck, Flame, Zap, Repeat, Gauge,
  MessagesSquare, FileText, Building2, Landmark, Sparkles, Keyboard, SunMoon,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { PROJECT_STATUS, PRIORITY } from '@/lib/utils'
import type { TaskStatus } from '@/types/database'
import { signOutAndClear } from '@/lib/sign-out'
import { openSearch } from '@/components/search/search-sheet'
import { buildCatalog, hintFor } from '@/components/shortcuts/catalog'
import { fuzzyScoreAny } from '@/components/shortcuts/fuzzy'
import { createTask, createTaskWithAI } from '@/components/shortcuts/actions'
import { openShortcutsHelp } from '@/components/shortcuts/shortcuts-store'
import { cn } from '@/lib/utils'

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  done: 'Listo',
  canceled: 'Cancelado',
}

/* ── Static command groups ────────────────────────────────────────── */
type CommandItem = {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  action: () => void
  shortcut?: string
  group: string
}

/* ── Palette state (singleton via a global event) ─────────────────── */
const PALETTE_EVENT = 'faro:palette'

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT))
}

/* ── Component ────────────────────────────────────────────────────── */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const { theme, setTheme } = useTheme()
  const isGroup = me?.groupMode ?? false
  const isDirection = me?.isDirection ?? false
  const isTeam = me?.isTeam ?? false

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(t)
  }, [query])

  // Every way of opening starts from a clean slate (empty query, first row selected).
  const openFresh = useCallback(() => {
    setQuery('')
    setDebouncedQuery('')
    setSelectedIndex(0)
    setOpen(true)
  }, [])

  // Open via global event
  useEffect(() => {
    window.addEventListener(PALETTE_EVENT, openFresh)
    return () => window.removeEventListener(PALETTE_EVENT, openFresh)
  }, [openFresh])

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (open) setOpen(false)
        else openFresh()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, openFresh])

  // Focus input on open
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 40)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    document.body.dataset.paletteOpen = ''
    return () => { delete document.body.dataset.paletteOpen }
  }, [open])

  function close() { setOpen(false) }

  function navigate(href: string) {
    close()
    router.push(href)
  }

  /* static commands — shortcut hints come from the same catalog that binds the keys */
  const catalog = useMemo(() => buildCatalog({ groupMode: isGroup }), [isGroup])
  const themeName = (theme ?? 'system') as 'light' | 'dark' | 'system'
  const nextTheme = themeName === 'light' ? 'dark' : themeName === 'dark' ? 'system' : 'light'
  const THEME_LABEL = { light: 'claro', dark: 'oscuro', system: 'del sistema' } as const

  const staticCommands = useMemo<CommandItem[]>(() => {
    const hint = (id: string) => hintFor(catalog, id)
    const nav = (id: string, label: string, description: string, icon: React.ReactNode, href: string, hintId?: string): CommandItem =>
      ({ id, label, description, icon, action: () => navigate(href), group: 'Navegar', shortcut: hintId ? hint(hintId) : undefined })
    const ic = 'h-4 w-4'
    return [
      // Navigation
      isGroup
        ? nav('nav-home', 'Hoy', 'Todas tus tareas, de todas tus empresas', <CalendarCheck className={ic} />, '/dashboard/hoy', 'nav-home')
        : nav('nav-home', 'Inicio', 'Vista general', <LayoutDashboard className={ic} />, '/dashboard', 'nav-home'),
      nav('nav-projects', 'Proyectos', 'Lista de proyectos', <FolderKanban className={ic} />, '/dashboard/projects', 'nav-projects'),
      nav('nav-tasks', 'Tareas', 'Todas las tareas', <CheckSquare className={ic} />, '/dashboard/tasks', 'nav-tasks'),
      ...(isTeam ? [nav('nav-chat', 'Chat', 'Canales y mensajes directos', <MessagesSquare className={ic} />, '/dashboard/chat', 'nav-chat')] : []),
      nav('nav-docs', 'Documentos', 'Políticas, manuales, SOPs y actas', <FileText className={ic} />, '/dashboard/documentos', 'nav-docs'),
      isGroup
        ? nav('nav-people', 'Personas', 'Quién trabaja dónde y con qué carga', <Users className={ic} />, '/dashboard/personas', 'nav-people')
        : nav('nav-people', 'Equipo', 'Gestión del equipo', <Users className={ic} />, '/dashboard/team', 'nav-people'),
      ...(isGroup ? [nav('nav-capture', 'Capturar', 'Audio, foto, video o texto → tareas', <Sparkles className={ic} />, '/dashboard/capturar')] : []),
      ...(isGroup && isDirection
        ? [
            nav('nav-group', 'Grupo', 'Vista de Dirección: todas las empresas', <Building2 className={ic} />, '/dashboard/grupo'),
            nav('nav-costs', 'Costos', 'Reparto del holding a las filiales', <Landmark className={ic} />, '/dashboard/costos'),
          ]
        : []),
      nav('nav-kanban', 'Kanban', 'Portafolio por etapa', <Kanban className={ic} />, '/dashboard/kanban', 'nav-kanban'),
      nav('nav-calendar', 'Calendario', 'Vista de calendario', <CalendarDays className={ic} />, '/dashboard/calendar'),
      nav('nav-eisenhower', 'Matriz Eisenhower', 'Urgente vs Importante', <LayoutGrid className={ic} />, '/dashboard/eisenhower'),
      nav('nav-gantt', 'Gantt', 'Timeline de proyectos', <GanttChartSquare className={ic} />, '/dashboard/gantt'),
      ...(!isGroup ? [nav('nav-today', 'Mi día', 'Tus tareas de hoy', <CalendarCheck className={ic} />, '/dashboard/today')] : []),
      nav('nav-priorities', 'Prioridades', 'Lo más urgente del equipo', <Flame className={ic} />, '/dashboard/priorities'),
      nav('nav-automations', 'Automatizaciones', 'Reglas si-esto-entonces-aquello', <Zap className={ic} />, '/dashboard/automations'),
      nav('nav-recurring', 'Recurrentes', 'Tareas que se materializan automáticamente', <Repeat className={ic} />, '/dashboard/recurring'),
      nav('nav-capacity', 'Capacidad del equipo', 'Carga real por persona', <Gauge className={ic} />, '/dashboard/capacity'),
      nav('nav-reports', 'Reportes', 'Métricas y analytics', <BarChart3 className={ic} />, '/dashboard/reports'),
      ...(isGroup ? [nav('nav-team', 'Equipo y organigrama', 'Miembros, áreas y líneas de reporte', <Users className={ic} />, '/dashboard/team')] : []),
      nav('nav-settings', 'Configuración', 'Ajustes de la cuenta', <Settings className={ic} />, '/dashboard/settings', 'nav-settings'),
      // Actions
      { id: 'act-new-task', label: 'Nueva tarea', description: 'Crear una tarea rápida', icon: <Plus className={ic} />, action: () => { close(); createTask() }, group: 'Acciones', shortcut: hint('create') },
      { id: 'act-new-task-ai', label: 'Nueva tarea con IA', description: 'Describe la tarea y Faro la arma', icon: <Sparkles className={ic} />, action: () => { close(); createTaskWithAI() }, group: 'Acciones', shortcut: hint('create-ai') },
      { id: 'act-new-project', label: 'Nuevo proyecto', description: 'Crear un proyecto', icon: <FolderOpen className={ic} />, action: () => navigate('/dashboard/projects?new=1'), group: 'Acciones' },
      { id: 'act-shortcuts', label: 'Ver atajos de teclado', description: 'Todos los atajos de Faro', icon: <Keyboard className={ic} />, action: () => { close(); openShortcutsHelp() }, group: 'Acciones', shortcut: hint('help') },
      { id: 'act-theme', label: 'Cambiar tema', description: `Ahora: ${THEME_LABEL[themeName]} · siguiente: ${THEME_LABEL[nextTheme]}`, icon: <SunMoon className={ic} />, action: () => { setTheme(nextTheme); close() }, group: 'Acciones' },
      { id: 'act-logout', label: 'Cerrar sesión', description: 'Salir de Faro', icon: <LogOut className={ic} />, action: async () => { close(); await signOutAndClear() }, group: 'Acciones' },
    ]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, isGroup, isDirection, isTeam, themeName])

  const isSearching = debouncedQuery.trim().length >= 2
  const { data: searchData, isFetching } = trpc.search.global.useQuery(
    debouncedQuery.trim() || '_',
    { enabled: isSearching, staleTime: 10_000 }
  )

  /* filtered static items — accent-insensitive fuzzy match, best first (stable for equal scores) */
  const filteredStatic = useMemo(() => {
    const q = query.trim()
    if (!q) return staticCommands
    return staticCommands
      .map((c, i) => ({ c, i, score: fuzzyScoreAny(q, [c.label, c.description, c.group]) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map(x => x.c)
  }, [query, staticCommands])

  /* all items to render in order */
  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [...filteredStatic]

    if (isSearching && searchData) {
      for (const p of searchData.projects) {
        const statusInfo = PROJECT_STATUS[p.status as keyof typeof PROJECT_STATUS]
        items.push({
          id: `proj-${p.id}`,
          label: p.name,
          description: `${p.code} · ${statusInfo?.label ?? p.status}`,
          icon: <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />,
          action: () => navigate(`/dashboard/projects/${p.id}`),
          group: 'Proyectos',
        })
      }
      for (const t of searchData.tasks) {
        const priorityInfo = PRIORITY[t.priority as keyof typeof PRIORITY]
        items.push({
          id: `task-${t.id}`,
          label: t.title,
          description: `${TASK_STATUS_LABEL[t.status as TaskStatus] ?? t.status} · ${priorityInfo?.label ?? ''}`,
          icon: <Hash className="h-4 w-4" />,
          action: () => t.project ? navigate(`/dashboard/projects/${t.project.id}`) : close(),
          group: 'Tareas',
        })
      }
    }

    if (isSearching) {
      const q = debouncedQuery.trim()
      items.push({
        id: 'search-all',
        label: `Buscar «${q}» en todo`,
        description: 'Tareas, documentos, chat y decisiones — por texto y por significado',
        icon: <Search className="h-4 w-4" />,
        action: () => { close(); openSearch(q) },
        group: 'Buscar',
      })
    }

    return items
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredStatic, isSearching, searchData, debouncedQuery])

  /* group them */
  const groupedItems = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {}
    for (const item of allItems) {
      if (!groups[item.group]) groups[item.group] = []
      groups[item.group].push(item)
    }
    return groups
  }, [allItems])

  /* keyboard navigation */
  useEffect(() => {
    if (!open) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, allItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        allItems[selectedIndex]?.action()
      } else if (e.key === 'Escape') {
        close()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, allItems, selectedIndex])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open) return null

  /* render flat index so we can track selectedIndex */
  let flatIdx = -1

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-night/60 backdrop-blur-sm"
        onClick={close}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-stone bg-white shadow-2xl dark:border-ink-body dark:bg-night">
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3.5 dark:border-night-700">
          <Search className="h-4 w-4 shrink-0 text-graphite dark:text-graphite" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0) }}
            placeholder="Buscar o escribir un comando…"
            className="flex-1 bg-transparent text-sm text-night outline-none placeholder:text-graphite dark:text-stone-100 dark:placeholder:text-graphite"
          />
          {isFetching && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone border-t-signal dark:border-ink-body dark:border-t-signal" />
          )}
          <kbd className="hidden rounded border border-stone bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-graphite sm:inline dark:border-ink-body dark:bg-night-700 dark:text-graphite">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1">
          {allItems.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-graphite dark:text-graphite">
              <p className="text-sm">Sin resultados para <strong>&quot;{query}&quot;</strong></p>
            </div>
          )}

          {Object.entries(groupedItems).map(([group, items]) => (
            <div key={group}>
              <div className="flex items-center gap-2 px-4 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-graphite dark:text-graphite">
                  {group}
                </span>
              </div>

              {items.map(item => {
                flatIdx++
                const idx = flatIdx
                const isSelected = idx === selectedIndex

                return (
                  <button
                    key={item.id}
                    data-selected={isSelected}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => item.action()}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                      isSelected
                        ? 'bg-night text-mist'
                        : 'hover:bg-mist dark:hover:bg-night-700/50'
                    )}
                  >
                    <span className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                      isSelected
                        ? 'bg-night-700 text-signal'
                        : 'bg-stone-100 text-graphite dark:bg-night-700 dark:text-graphite'
                    )}>
                      {item.icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={cn(
                        'block text-sm font-medium',
                        isSelected ? 'text-mist' : 'text-night-700 dark:text-stone-100'
                      )}>
                        {item.label}
                      </span>
                      {item.description && (
                        <span className={cn(
                          'block text-xs truncate',
                          isSelected ? 'text-[#9DB0BC]' : 'text-graphite dark:text-graphite'
                        )}>
                          {item.description}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {item.shortcut && (
                        <kbd className={cn(
                          'rounded border px-1.5 py-0.5 text-[10px] font-mono',
                          isSelected
                            ? 'border-signal/30 bg-night-700 text-signal'
                            : 'border-stone bg-stone-100 text-graphite dark:border-ink-body dark:bg-night-700 dark:text-graphite'
                        )}>
                          {item.shortcut}
                        </kbd>
                      )}
                      {isSelected && (
                        <ArrowRight className="h-3.5 w-3.5 text-signal" />
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-stone-100 px-4 py-2 dark:border-night-700">
          <div className="flex items-center gap-3 text-[11px] text-graphite dark:text-graphite">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-stone bg-stone-100 px-1 dark:border-ink-body dark:bg-night-700">↑</kbd>
              <kbd className="rounded border border-stone bg-stone-100 px-1 dark:border-ink-body dark:bg-night-700">↓</kbd>
              navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-stone bg-stone-100 px-1.5 dark:border-ink-body dark:bg-night-700">↵</kbd>
              seleccionar
            </span>
            <span className="hidden sm:flex items-center gap-1">
              <kbd className="rounded border border-stone bg-stone-100 px-1.5 dark:border-ink-body dark:bg-night-700">G</kbd><span>luego</span><kbd className="rounded border border-stone bg-stone-100 px-1.5 dark:border-ink-body dark:bg-night-700">H P T C D</kbd>
              ir a
            </span>
          </div>
          <span className="text-[11px] text-stone dark:text-graphite">Faro Command</span>
        </div>
      </div>
    </div>
  )
}
