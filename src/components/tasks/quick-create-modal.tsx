'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { X, Plus, ChevronDown, Repeat } from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/components/mobile/use-media'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { Segmented } from '@/components/mobile/segmented'
import { InsetGroup } from '@/components/mobile/inset-list'
import { Field, FIELD_CLASS, FilterChip, IosSwitch, SheetActions, useStableCallback } from '@/components/projects/mobile-bits'

const CADENCE_PRESETS = [
  { value: 'daily',              label: 'Todos los días' },
  { value: 'weekly:mon',         label: 'Cada Lunes' },
  { value: 'weekly:fri',         label: 'Cada Viernes' },
  { value: 'weekly:mon,wed,fri', label: 'Lun, Mié, Vie' },
  { value: 'weekly:tue,thu',     label: 'Mar y Jue' },
  { value: 'monthly:1',          label: 'Día 1 del mes' },
  { value: 'monthly:15',         label: 'Día 15 del mes' },
  { value: 'monthly:last',       label: 'Último día del mes' },
] as const

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
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState('')
  const [assigneeId, setAssigneeId] = useState<string>('none')
  const [priority, setPriority] = useState<typeof PRIORITY_OPTIONS[number]['value']>('medium')
  const [dueDate, setDueDate]   = useState('')
  const [status, setStatus]     = useState<'todo' | 'in_progress'>('todo')
  // When true, the form creates a recurring rule instead of a single task.
  // Toggleable inline so users don't have to leave the quick-create flow.
  const [isRecurring, setIsRecurring] = useState(false)
  const [cadence, setCadence] = useState<string>('weekly:mon')
  const titleRef = useRef<HTMLInputElement>(null)
  const pathname = usePathname()
  const isMobile = useIsMobile()
  const stableClose = useStableCallback(() => resetAndClose())

  const { data: projects } = trpc.projects.list.useQuery()
  const { data: members } = trpc.team.members.useQuery()
  const utils = trpc.useUtils()

  const create = trpc.tasks.create.useMutation({
    onSuccess: () => {
      toast.success('Tarea creada')
      utils.tasks.invalidate()
      utils.projects.invalidate()
      resetAndClose()
    },
    onError: (e) => toast.error('No se pudo crear la tarea', e.message),
  })

  const createRecurring = trpc.recurring.create.useMutation({
    onSuccess: () => {
      toast.success('Regla recurrente creada', 'Las tareas se materializan automáticamente en el cron diario.')
      utils.recurring.invalidate()
      utils.tasks.invalidate()
      resetAndClose()
    },
    onError: (e) => toast.error('No se pudo crear la regla', e.message),
  })

  const activeProjects = (projects ?? []).filter(
    p => p.status !== 'canceled' && p.status !== 'completed'
  )

  // URL-aware project pre-selection. When the user is inside a project page
  // (/dashboard/projects/{id}), pre-fill that project so the FAB feels like
  // "add a task HERE" instead of "add to whatever". Falls back to the first
  // active project if not inside a project context.
  useEffect(() => {
    if (!open || projectId) return
    const m = pathname?.match(/\/dashboard\/projects\/([0-9a-f-]{20,})/i)
    const urlProjectId = m?.[1]
    if (urlProjectId && activeProjects.some(p => p.id === urlProjectId)) {
      setProjectId(urlProjectId)
    } else if (activeProjects.length) {
      setProjectId(activeProjects[0].id)
    }
  }, [open, pathname, activeProjects, projectId])

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
    setDescription('')
    setAssigneeId('none')
    setDueDate('')
    setStatus('todo')
    setIsRecurring(false)
    setCadence('weekly:mon')
    onClose()
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    // Make validation failures LOUD instead of silently returning.
    if (!title.trim()) {
      toast.warning('Falta el título')
      return
    }
    if (!projectId) {
      toast.warning('Falta seleccionar un proyecto')
      return
    }
    if (isRecurring) {
      createRecurring.mutate({
        projectId,
        titleTemplate: title.trim(),
        cadence,
        priority,
      })
    } else {
      create.mutate({
        title: title.trim(),
        description: description.trim() || undefined,
        projectId,
        assigneeId: assigneeId !== 'none' ? assigneeId : undefined,
        priority,
        dueDate: dueDate || undefined,
        status,
      })
    }
  }

  const submitting = create.isPending || createRecurring.isPending

  if (!open) return null

  // Phones: a tall bottom sheet — labels above 48px fields, primary action pinned above the safe area.
  if (isMobile) {
    return (
      <BottomSheet
        open
        tall
        onClose={stableClose}
        title={isRecurring ? 'Nueva tarea recurrente' : 'Nueva tarea'}
        footer={
          <SheetActions
            primaryLabel={isRecurring ? 'Crear regla' : 'Crear tarea'}
            onPrimary={() => handleSubmit()}
            busy={submitting}
            disabled={!title.trim() || !projectId}
            secondaryLabel="Cancelar"
            onSecondary={resetAndClose}
          />
        }
      >
        <form onSubmit={handleSubmit} className="space-y-5 pb-2 pt-1">
          <input
            autoFocus
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="¿Qué hay que hacer?"
            enterKeyHint="done"
            className="block min-h-14 w-full rounded-[14px] border border-border bg-surface px-4 font-display text-lg font-bold tracking-[-0.02em] text-foreground outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-graphite focus:border-signal focus:ring-2 focus:ring-signal/30"
          />

          {!isRecurring && (
            <Field label="Descripción">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Detalles, contexto, links…"
                rows={3}
                className={cn(FIELD_CLASS, 'resize-none py-3')}
              />
            </Field>
          )}

          <div className="space-y-4">
            <Field label="Proyecto">
              <select value={projectId} onChange={e => setProjectId(e.target.value)} required className={FIELD_CLASS}>
                <option value="" disabled>Seleccionar…</option>
                {activeProjects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </Field>
            {!isRecurring && (
              <Field label="Asignar a">
                <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={FIELD_CLASS}>
                  <option value="none">Sin asignar</option>
                  {(members ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
            )}
          </div>

          <div className="space-y-2">
            <span className="block px-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">Prioridad</span>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-no-track>
              {PRIORITY_OPTIONS.map(o => (
                <FilterChip key={o.value} selected={priority === o.value} onClick={() => setPriority(o.value)}>
                  <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
                  {o.label}
                </FilterChip>
              ))}
            </div>
          </div>

          {!isRecurring && (
            <div className="space-y-2">
              <span className="block px-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">Estado inicial</span>
              <Segmented
                aria-label="Estado inicial"
                value={status}
                onChange={setStatus}
                options={[{ value: 'todo', label: 'Por hacer' }, { value: 'in_progress', label: 'En progreso' }]}
              />
            </div>
          )}

          {isRecurring ? (
            <Field label="Cadencia">
              <select value={cadence} onChange={e => setCadence(e.target.value)} className={FIELD_CLASS}>
                {CADENCE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Vencimiento">
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={FIELD_CLASS} />
            </Field>
          )}

          <InsetGroup footer="Se materializa sola con el cron diario, en el proyecto elegido.">
            <div className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
              <Repeat className="h-5 w-5 shrink-0 text-graphite" />
              <span className="min-w-0 flex-1 text-[15px] font-medium text-foreground">Repetir esta tarea</span>
              <IosSwitch checked={isRecurring} onChange={setIsRecurring} label="Crear como tarea recurrente" />
            </div>
          </InsetGroup>
          <button type="submit" className="sr-only">Crear</button>
        </form>
      </BottomSheet>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
        onClick={resetAndClose}
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4">
        <div className="rounded-2xl border border-stone bg-white shadow-2xl dark:border-ink-body dark:bg-night">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4 dark:border-night-700">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-signal-ink dark:text-signal" />
              <span className="text-sm font-semibold text-night-700 dark:text-stone-100">Nueva tarea</span>
            </div>
            <button
              onClick={resetAndClose}
              className="rounded-lg p-1 text-graphite transition-colors hover:bg-stone-100 hover:text-graphite dark:text-graphite dark:hover:bg-night-700 dark:hover:text-stone"
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
                className="w-full rounded-xl border border-stone bg-mist px-4 py-3 text-sm font-medium placeholder:text-graphite focus:border-signal/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-signal/20 transition-all dark:border-ink-body dark:bg-night-700 dark:text-stone-100 dark:placeholder:text-graphite dark:focus:border-signal dark:focus:bg-night-700"
              />
            </div>

            {/* Description — opcional, brief details */}
            {!isRecurring && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-graphite dark:text-graphite">Descripción (opcional)</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Detalles, contexto, links…"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-stone bg-white px-3 py-2 text-sm text-ink-body placeholder:text-graphite focus:border-signal/50 focus:outline-none focus:ring-2 focus:ring-signal/20 transition-all dark:border-ink-body dark:bg-night-700 dark:text-stone dark:placeholder:text-graphite"
                />
              </div>
            )}

            {/* Project + Assignee row */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-graphite dark:text-graphite">Proyecto</label>
                <div className="relative">
                  <select
                    value={projectId}
                    onChange={e => setProjectId(e.target.value)}
                    required
                    className="w-full appearance-none rounded-xl border border-stone bg-white px-3 py-2.5 pr-7 text-sm text-ink-body focus:border-signal/50 focus:outline-none focus:ring-2 focus:ring-signal/20 transition-all dark:border-ink-body dark:bg-night-700 dark:text-stone"
                  >
                    <option value="" disabled>Seleccionar…</option>
                    {activeProjects.map(p => (
                      <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-graphite" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-graphite dark:text-graphite">Asignar a</label>
                <div className="relative">
                  <select
                    value={assigneeId}
                    onChange={e => setAssigneeId(e.target.value)}
                    className="w-full appearance-none rounded-xl border border-stone bg-white px-3 py-2.5 pr-7 text-sm text-ink-body focus:border-signal/50 focus:outline-none focus:ring-2 focus:ring-signal/20 transition-all dark:border-ink-body dark:bg-night-700 dark:text-stone"
                  >
                    <option value="none">Sin asignar</option>
                    {(members ?? []).map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-graphite" />
                </div>
              </div>
            </div>

            {/* Priority + Status row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-graphite dark:text-graphite">Prioridad</label>
                <div className="relative">
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value as typeof priority)}
                    className="w-full appearance-none rounded-xl border border-stone bg-white px-3 py-2.5 pr-7 text-xs text-ink-body focus:border-signal/50 focus:outline-none focus:ring-2 focus:ring-signal/20 transition-all dark:border-ink-body dark:bg-night-700 dark:text-stone"
                  >
                    {PRIORITY_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-graphite" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-graphite dark:text-graphite">Estado inicial</label>
                <div className="relative">
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as 'todo' | 'in_progress')}
                    className="w-full appearance-none rounded-xl border border-stone bg-white px-3 py-2.5 pr-7 text-xs text-ink-body focus:border-signal/50 focus:outline-none focus:ring-2 focus:ring-signal/20 transition-all dark:border-ink-body dark:bg-night-700 dark:text-stone"
                  >
                    <option value="todo">Por hacer</option>
                    <option value="in_progress">En progreso</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-graphite" />
                </div>
              </div>
            </div>

            {/* Vencimiento o cadencia — depende del toggle de recurrente */}
            {isRecurring ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-graphite dark:text-graphite">Cadencia</label>
                <div className="relative">
                  <select
                    value={cadence}
                    onChange={e => setCadence(e.target.value)}
                    className="w-full appearance-none rounded-xl border border-stone bg-signal-wash/40 px-4 py-2.5 pr-8 text-sm text-night focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/20 transition-all dark:border-signal/40 dark:bg-signal/30 dark:text-signal"
                  >
                    {CADENCE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-signal-ink" />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-graphite dark:text-graphite">Vencimiento (opcional)</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full rounded-xl border border-stone bg-white px-4 py-2.5 text-sm text-ink-body focus:border-signal/50 focus:outline-none focus:ring-2 focus:ring-signal/20 transition-all dark:border-ink-body dark:bg-night-700 dark:text-stone"
                />
              </div>
            )}

            {/* Recurring toggle */}
            <label className={cn(
              'flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 transition',
              isRecurring
                ? 'border-signal/40 bg-signal-wash/60 dark:border-signal/40 dark:bg-signal/30'
                : 'border-stone bg-mist/40 hover:border-stone dark:border-ink-body dark:bg-night-700/40',
            )}>
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={e => setIsRecurring(e.target.checked)}
                className="h-3.5 w-3.5 accent-signal"
              />
              <Repeat className={cn('h-3.5 w-3.5', isRecurring ? 'text-signal-ink' : 'text-graphite')} />
              <span className={cn(
                'text-xs font-medium',
                isRecurring ? 'text-night dark:text-signal' : 'text-graphite dark:text-stone',
              )}>
                Crear como tarea recurrente
              </span>
              {isRecurring && (
                <span className="ml-auto text-[10px] text-night/80 dark:text-signal/80">
                  Se materializa automáticamente
                </span>
              )}
            </label>

            {/* Actions */}
            <div className="flex items-center justify-between pt-1 border-t border-stone-100 dark:border-night-700">
              <p className="text-[11px] text-graphite dark:text-graphite">
                <kbd className="rounded border border-stone px-1 py-0.5 text-[10px] font-mono dark:border-ink-body">Esc</kbd> para cerrar
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetAndClose}
                  className="rounded-xl px-4 py-2 text-xs font-medium text-graphite hover:bg-stone-100 transition-colors dark:text-graphite dark:hover:bg-night-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || !projectId || submitting}
                  className={cn(
                    'rounded-xl px-5 py-2 text-xs font-semibold text-background shadow-sm transition-all',
                    'bg-foreground hover:bg-foreground/90 active:scale-95',
                    'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'
                  )}
                >
                  {submitting ? 'Creando…' : isRecurring ? 'Crear regla' : 'Crear tarea'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
