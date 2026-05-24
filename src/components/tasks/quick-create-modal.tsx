'use client'

import { useState, useEffect, useRef } from 'react'
import { trpc } from '@/lib/trpc/client'
import { X, Plus, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const PRIORITY_OPTIONS = [
  { value: 'very_high', label: 'Muy alta', color: '#ef4444' },
  { value: 'high',      label: 'Alta',     color: '#f97316' },
  { value: 'medium',    label: 'Media',    color: '#f59e0b' },
  { value: 'low',       label: 'Baja',     color: '#22c55e' },
  { value: 'very_low',  label: 'Muy baja', color: '#94a3b8' },
] as const

interface QuickCreateModalProps {
  open: boolean
  onClose: () => void
}

export function QuickCreateModal({ open, onClose }: QuickCreateModalProps) {
  const [title, setTitle]       = useState('')
  const [projectId, setProjectId] = useState('')
  const [priority, setPriority] = useState<typeof PRIORITY_OPTIONS[number]['value']>('medium')
  const [dueDate, setDueDate]   = useState('')
  const [status, setStatus]     = useState<'todo' | 'in_progress'>('todo')
  const titleRef = useRef<HTMLInputElement>(null)

  const { data: projects } = trpc.projects.list.useQuery()
  const utils = trpc.useUtils()

  const create = trpc.tasks.create.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      utils.tasks.stats.invalidate()
      if (projectId) utils.tasks.byProject.invalidate(projectId)
      resetAndClose()
    },
  })

  const activeProjects = (projects ?? []).filter(
    p => p.status !== 'canceled' && p.status !== 'completed'
  )

  // Auto-select first project
  useEffect(() => {
    if (activeProjects.length && !projectId) {
      setProjectId(activeProjects[0].id)
    }
  }, [activeProjects, projectId])

  // Focus title on open
  useEffect(() => {
    if (open) {
      setTimeout(() => titleRef.current?.focus(), 50)
    }
  }, [open])

  // Keyboard: Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  function resetAndClose() {
    setTitle('')
    setDueDate('')
    setStatus('todo')
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !projectId) return
    create.mutate({
      title: title.trim(),
      projectId,
      priority,
      dueDate: dueDate || undefined,
      status,
    })
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px]"
        onClick={resetAndClose}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-indigo-600" />
              <span className="text-sm font-semibold text-slate-800">Nueva tarea</span>
            </div>
            <button
              onClick={resetAndClose}
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Title */}
            <div>
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="¿Qué hay que hacer?"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>

            {/* Project */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500">Proyecto</label>
              <div className="relative">
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  required
                  className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-2.5 pr-8 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                >
                  <option value="" disabled>Seleccionar proyecto…</option>
                  {activeProjects.map(p => (
                    <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              </div>
            </div>

            {/* Priority + Status row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500">Prioridad</label>
                <div className="relative">
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value as typeof priority)}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-7 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                  >
                    {PRIORITY_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-500">Estado inicial</label>
                <div className="relative">
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as 'todo' | 'in_progress')}
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-7 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                  >
                    <option value="todo">Por hacer</option>
                    <option value="in_progress">En progreso</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                </div>
              </div>
            </div>

            {/* Due date */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500">Vencimiento (opcional)</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-1 border-t border-slate-100">
              <p className="text-[11px] text-slate-400">
                <kbd className="rounded border border-slate-200 px-1 py-0.5 text-[10px] font-mono">Esc</kbd> para cerrar
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="rounded-xl px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || !projectId || create.isPending}
                  className={cn(
                    'rounded-xl px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all',
                    'bg-indigo-600 hover:bg-indigo-700 active:scale-95',
                    'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'
                  )}
                >
                  {create.isPending ? 'Creando…' : 'Crear tarea'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
