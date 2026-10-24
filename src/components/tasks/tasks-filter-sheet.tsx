'use client'

import { useState } from 'react'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { InsetGroup } from '@/components/mobile/inset-list'
import { IosSwitch, SheetActions, FilterChip, Field, FIELD_CLASS } from '@/components/projects/mobile-bits'

export interface TaskFilterValues {
  status: string
  priority: string
  project: string
  assignee: string
  reviewer: string
  label: string
  dueWithin: string
  onlyBlocked: boolean
  sortBy: string
}

export const DEFAULT_TASK_FILTERS: TaskFilterValues = {
  status: 'all', priority: 'all', project: 'all', assignee: 'all', reviewer: 'all',
  label: '', dueWithin: 'all', onlyBlocked: false, sortBy: 'created_at',
}

export const TASK_STATUS_LABELS: Record<string, string> = {
  todo: 'Por hacer', in_progress: 'En progreso', in_review: 'En revisión', done: 'Listo', canceled: 'Cancelado',
}
export const TASK_PRIORITY_LABELS: Record<string, string> = {
  very_high: 'Muy alta', high: 'Alta', medium: 'Media', low: 'Baja', very_low: 'Muy baja',
}
export const DUE_LABELS: Record<string, string> = {
  '3': 'Próx. 3 días', '7': 'Próx. 7 días', '14': 'Próx. 14 días', '30': 'Próx. 30 días',
}
export const SORT_LABELS: Record<string, string> = {
  created_at: 'Más recientes', due_date: 'Fecha límite', priority: 'Prioridad', status: 'Estado',
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <h3 className="px-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">{children}</h3>
)

/**
 * All the Tareas filters in one sheet (phones used to get seven stacked
 * controls). Short lists are chips; long lists use the platform's native
 * picker (<select>), which is exactly what iOS/Android users expect.
 */
export function TasksFilterSheet({
  open, onClose, values, onApply, projects, members,
}: {
  open: boolean
  onClose: () => void
  values: TaskFilterValues
  onApply: (v: TaskFilterValues) => void
  projects: Array<{ id: string; code: string; name: string }>
  members: Array<{ id: string; name: string }>
}) {
  // Re-seed the draft each time the sheet opens (keyed remount) while keeping the exit animation.
  const [seed, setSeed] = useState(0)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setSeed(n => n + 1)
  }
  return <SheetBody key={seed} open={open} {...{ onClose, values, onApply, projects, members }} />
}

function SheetBody({
  open, onClose, values, onApply, projects, members,
}: {
  open: boolean
  onClose: () => void
  values: TaskFilterValues
  onApply: (v: TaskFilterValues) => void
  projects: Array<{ id: string; code: string; name: string }>
  members: Array<{ id: string; name: string }>
}) {
  const [d, setD] = useState<TaskFilterValues>(values)
  const set = <K extends keyof TaskFilterValues>(k: K, v: TaskFilterValues[K]) => setD(prev => ({ ...prev, [k]: v }))
  const apply = (v: TaskFilterValues) => { onApply(v); onClose() }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filtros"
      tall
      footer={<SheetActions primaryLabel="Aplicar" onPrimary={() => apply(d)} secondaryLabel="Limpiar" onSecondary={() => apply({ ...DEFAULT_TASK_FILTERS, sortBy: d.sortBy })} />}
    >
      <div className="space-y-6 pb-2 pt-2">
        <div className="space-y-2">
          <Eyebrow>Estado</Eyebrow>
          <div className="flex flex-wrap gap-2">
            <FilterChip selected={d.status === 'all'} onClick={() => set('status', 'all')}>Todos</FilterChip>
            {Object.entries(TASK_STATUS_LABELS).map(([v, l]) => (
              <FilterChip key={v} selected={d.status === v} onClick={() => set('status', v)}>{l}</FilterChip>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Eyebrow>Prioridad</Eyebrow>
          <div className="flex flex-wrap gap-2">
            <FilterChip selected={d.priority === 'all'} onClick={() => set('priority', 'all')}>Toda</FilterChip>
            {Object.entries(TASK_PRIORITY_LABELS).map(([v, l]) => (
              <FilterChip key={v} selected={d.priority === v} onClick={() => set('priority', v)}>{l}</FilterChip>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Eyebrow>Vencimiento</Eyebrow>
          <div className="flex flex-wrap gap-2">
            <FilterChip selected={d.dueWithin === 'all'} onClick={() => set('dueWithin', 'all')}>Cualquiera</FilterChip>
            {Object.entries(DUE_LABELS).map(([v, l]) => (
              <FilterChip key={v} selected={d.dueWithin === v} onClick={() => set('dueWithin', v)}>{l}</FilterChip>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Field label="Proyecto">
            <select className={FIELD_CLASS} value={d.project} onChange={e => set('project', e.target.value)}>
              <option value="all">Todos los proyectos</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </Field>
          <Field label="Asignado a">
            <select className={FIELD_CLASS} value={d.assignee} onChange={e => set('assignee', e.target.value)}>
              <option value="all">Cualquiera</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Reviewer">
            <select className={FIELD_CLASS} value={d.reviewer} onChange={e => set('reviewer', e.target.value)}>
              <option value="all">Cualquiera</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Etiqueta">
            <input className={FIELD_CLASS} value={d.label} onChange={e => set('label', e.target.value)} placeholder="Ej: urgente" autoCapitalize="none" />
          </Field>
          <Field label="Ordenar por">
            <select className={FIELD_CLASS} value={d.sortBy} onChange={e => set('sortBy', e.target.value)}>
              {Object.entries(SORT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>

        <InsetGroup footer="Solo tareas frenadas por una dependencia que aún no está completa.">
          <div className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1 text-[15px] font-medium text-foreground">Solo bloqueadas</span>
            <IosSwitch checked={d.onlyBlocked} onChange={v => set('onlyBlocked', v)} label="Solo tareas bloqueadas" />
          </div>
        </InsetGroup>
      </div>
    </BottomSheet>
  )
}
