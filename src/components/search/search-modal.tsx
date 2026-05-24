'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { Search, Loader2, FolderKanban, CheckSquare, X } from 'lucide-react'
import { PROJECT_STATUS, PRIORITY } from '@/lib/utils'
import type { TaskStatus } from '@/types/database'

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  done: 'Listo',
  canceled: 'Cancelado',
}

interface SearchModalProps {
  /** Renders only the icon button (no text/kbd hint) — for mobile header */
  compact?: boolean
}

export function SearchModal({ compact }: SearchModalProps = {}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 280)
    return () => clearTimeout(t)
  }, [query])

  // Keyboard shortcut Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const isSearching = debouncedQuery.trim().length >= 2
  const { data, isFetching } = trpc.search.global.useQuery(
    debouncedQuery.trim() || '_',
    { enabled: isSearching, staleTime: 10_000 }
  )

  function close() {
    setOpen(false)
    setQuery('')
    setDebouncedQuery('')
  }

  function navigate(href: string) {
    close()
    router.push(href)
  }

  const hasProjects = (data?.projects.length ?? 0) > 0
  const hasTasks = (data?.tasks.length ?? 0) > 0
  const hasResults = hasProjects || hasTasks

  return (
    <>
      {/* Trigger button */}
      {compact ? (
        // Icon-only button for mobile header
        <button
          onClick={() => setOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Buscar (⌘K)"
        >
          <Search className="h-4 w-4" />
        </button>
      ) : (
        // Full trigger for sidebar
        <button
          onClick={() => setOpen(true)}
          className="mx-2 mb-1 flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-400 transition-all hover:border-slate-300 hover:bg-white hover:text-slate-500"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Buscar...</span>
          <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 shadow-sm">
            ⌘K
          </kbd>
        </button>
      )}

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[18vh]">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={close}
          />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
            {/* Input row */}
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && close()}
                placeholder="Buscar proyectos, tareas..."
                className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              {isFetching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />}
              <button
                onClick={close}
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-[380px] overflow-y-auto">
              {!isSearching && (
                <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-slate-400">
                  <Search className="h-7 w-7 text-slate-200" />
                  <p className="text-sm">Escribí al menos 2 caracteres para buscar</p>
                </div>
              )}

              {isSearching && !isFetching && !hasResults && (
                <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-slate-400">
                  <p className="text-sm">Sin resultados para <strong className="text-slate-600">"{debouncedQuery}"</strong></p>
                </div>
              )}

              {hasProjects && (
                <div>
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <FolderKanban className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Proyectos</span>
                  </div>
                  {data!.projects.map(project => {
                    const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
                    return (
                      <button
                        key={project.id}
                        onClick={() => navigate(`/dashboard/projects/${project.id}`)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-indigo-50"
                      >
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: project.color }}
                        />
                        <span className="text-xs font-medium text-slate-400">{project.code}</span>
                        <span className="flex-1 truncate text-sm text-slate-800">{project.name}</span>
                        {statusInfo && (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusInfo.color}`}>
                            {statusInfo.label}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {hasTasks && (
                <div className={hasProjects ? 'border-t border-slate-100' : ''}>
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <CheckSquare className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Tareas</span>
                  </div>
                  {data!.tasks.map(task => {
                    const priorityInfo = PRIORITY[task.priority as keyof typeof PRIORITY]
                    const projectData = task.project
                    return (
                      <button
                        key={task.id}
                        onClick={() => projectData ? navigate(`/dashboard/projects/${projectData.id}`) : undefined}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-indigo-50"
                      >
                        <div
                          className={`h-2 w-2 shrink-0 rounded-full ${priorityInfo?.dot ?? 'bg-slate-300'}`}
                        />
                        <span className="flex-1 truncate text-sm text-slate-800">{task.title}</span>
                        {projectData && (
                          <span className="flex items-center gap-1 text-[11px] text-slate-400">
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: projectData.color }}
                            />
                            {projectData.code}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400">
                          {TASK_STATUS_LABEL[task.status as TaskStatus] ?? task.status}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Footer hint */}
              {hasResults && (
                <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
                  Presioná <kbd className="rounded border border-slate-200 px-1 py-0.5">↵ Enter</kbd> para navegar
                  · <kbd className="rounded border border-slate-200 px-1 py-0.5">Esc</kbd> para cerrar
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
