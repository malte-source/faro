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
} from 'lucide-react'
import { PROJECT_STATUS, PRIORITY } from '@/lib/utils'
import type { TaskStatus } from '@/types/database'
import { logout } from '@/app/actions/auth'
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

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(t)
  }, [query])

  // Open via global event
  useEffect(() => {
    const handler = () => { setOpen(true) }
    window.addEventListener(PALETTE_EVENT, handler)
    return () => window.removeEventListener(PALETTE_EVENT, handler)
  }, [])

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Focus input on open
  useEffect(() => {
    if (open) {
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 40)
    } else {
      setQuery('')
      setDebouncedQuery('')
    }
  }, [open])

  function close() { setOpen(false) }

  function navigate(href: string) {
    close()
    router.push(href)
  }

  /* static commands */
  const staticCommands = useMemo<CommandItem[]>(() => [
    // Navigation
    { id: 'nav-dashboard', label: 'Dashboard', description: 'Vista general', icon: <LayoutDashboard className="h-4 w-4" />, action: () => navigate('/dashboard'), group: 'Navegar', shortcut: 'G D' },
    { id: 'nav-projects', label: 'Proyectos', description: 'Lista de proyectos', icon: <FolderKanban className="h-4 w-4" />, action: () => navigate('/dashboard/projects'), group: 'Navegar', shortcut: 'G P' },
    { id: 'nav-kanban', label: 'Kanban', description: 'Portafolio por etapa', icon: <Kanban className="h-4 w-4" />, action: () => navigate('/dashboard/kanban'), group: 'Navegar', shortcut: 'G K' },
    { id: 'nav-tasks', label: 'Tareas', description: 'Todas las tareas', icon: <CheckSquare className="h-4 w-4" />, action: () => navigate('/dashboard/tasks'), group: 'Navegar', shortcut: 'G T' },
    { id: 'nav-calendar', label: 'Calendario', description: 'Vista de calendario', icon: <CalendarDays className="h-4 w-4" />, action: () => navigate('/dashboard/calendar'), group: 'Navegar' },
    { id: 'nav-reports', label: 'Reportes', description: 'Métricas y analytics', icon: <BarChart3 className="h-4 w-4" />, action: () => navigate('/dashboard/reports'), group: 'Navegar' },
    { id: 'nav-team', label: 'Equipo', description: 'Gestión del equipo', icon: <Users className="h-4 w-4" />, action: () => navigate('/dashboard/team'), group: 'Navegar' },
    { id: 'nav-settings', label: 'Configuración', description: 'Ajustes de la cuenta', icon: <Settings className="h-4 w-4" />, action: () => navigate('/dashboard/settings'), group: 'Navegar' },
    // Actions
    { id: 'act-new-task', label: 'Nueva tarea', description: 'Crear una tarea rápida', icon: <Plus className="h-4 w-4" />, action: () => { close(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true })) }, group: 'Acciones', shortcut: 'N' },
    { id: 'act-new-project', label: 'Nuevo proyecto', description: 'Crear un proyecto', icon: <FolderOpen className="h-4 w-4" />, action: () => navigate('/dashboard/projects?new=1'), group: 'Acciones' },
    { id: 'act-logout', label: 'Cerrar sesión', description: 'Salir de Faro', icon: <LogOut className="h-4 w-4" />, action: async () => { close(); await logout() }, group: 'Acciones' },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  const isSearching = debouncedQuery.trim().length >= 2
  const { data: searchData, isFetching } = trpc.search.global.useQuery(
    debouncedQuery.trim() || '_',
    { enabled: isSearching, staleTime: 10_000 }
  )

  /* filtered static items */
  const filteredStatic = useMemo(() => {
    if (!query.trim()) return staticCommands
    const q = query.toLowerCase()
    return staticCommands.filter(
      c => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)
    )
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

    return items
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredStatic, isSearching, searchData])

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allItems, selectedIndex])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Global 'G + key' shortcuts (only when palette is closed and not in input)
  useEffect(() => {
    let gPressed = false
    let gTimer: ReturnType<typeof setTimeout>

    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if (isInput || open) return

      if (e.key === 'g' || e.key === 'G') {
        gPressed = true
        gTimer = setTimeout(() => { gPressed = false }, 800)
        return
      }

      if (gPressed) {
        clearTimeout(gTimer)
        gPressed = false
        const map: Record<string, string> = {
          d: '/dashboard', p: '/dashboard/projects',
          k: '/dashboard/kanban', t: '/dashboard/tasks',
        }
        const dest = map[e.key.toLowerCase()]
        if (dest) { e.preventDefault(); router.push(dest) }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  /* render flat index so we can track selectedIndex */
  let flatIdx = -1

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={close}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
          <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar o escribir un comando…"
            className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-600"
          />
          {isFetching && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500 dark:border-slate-700 dark:border-t-indigo-400" />
          )}
          <kbd className="hidden rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 sm:inline dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1">
          {allItems.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-slate-400 dark:text-slate-500">
              <p className="text-sm">Sin resultados para <strong>"{query}"</strong></p>
            </div>
          )}

          {Object.entries(groupedItems).map(([group, items]) => (
            <div key={group}>
              <div className="flex items-center gap-2 px-4 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
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
                        ? 'bg-indigo-50 dark:bg-indigo-950/50'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    )}
                  >
                    <span className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                      isSelected
                        ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-400'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    )}>
                      {item.icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                        {item.label}
                      </span>
                      {item.description && (
                        <span className="block text-xs text-slate-400 truncate dark:text-slate-500">
                          {item.description}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {item.shortcut && (
                        <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500">
                          {item.shortcut}
                        </kbd>
                      )}
                      {isSelected && (
                        <ArrowRight className="h-3.5 w-3.5 text-indigo-400 dark:text-indigo-500" />
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 dark:border-slate-800">
          <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-slate-100 px-1 dark:border-slate-700 dark:bg-slate-800">↑</kbd>
              <kbd className="rounded border border-slate-200 bg-slate-100 px-1 dark:border-slate-700 dark:bg-slate-800">↓</kbd>
              navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 dark:border-slate-700 dark:bg-slate-800">↵</kbd>
              seleccionar
            </span>
            <span className="hidden sm:flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 dark:border-slate-700 dark:bg-slate-800">G</kbd>+<kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 dark:border-slate-700 dark:bg-slate-800">D/P/K/T</kbd>
              ir a
            </span>
          </div>
          <span className="text-[11px] text-slate-300 dark:text-slate-600">Faro Command</span>
        </div>
      </div>
    </div>
  )
}
