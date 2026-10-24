'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate } from '@/lib/utils'
import { Edit2, Check, X } from 'lucide-react'
import type { ProjectStatus, KanbanStage } from '@/types/database'
import { toast } from '@/components/ui/toaster'
import { Target } from 'lucide-react'
import Link from 'next/link'

interface Project {
  id: string
  description: string | null
  start_date: string | null
  end_date: string | null
  estimated_hours: number | null
  budget: number | null
  currency: string
  progress_pct: number
  kanban_stage: KanbanStage
  status: ProjectStatus
  goal_id?: string | null
}

interface Props { project: Project }

export function ProjectInfo({ project }: Props) {
  const [editing, setEditing] = useState(false)
  const [desc, setDesc] = useState(project.description ?? '')
  const [startDate, setStartDate] = useState(project.start_date ?? '')
  const [endDate, setEndDate] = useState(project.end_date ?? '')
  const [progress, setProgress] = useState(String(project.progress_pct))

  const utils = trpc.useUtils()
  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      toast.success('Proyecto actualizado')
      utils.projects.invalidate()
      setEditing(false)
    },
    onError: (e) => toast.error('No se pudo actualizar', e.message),
  })

  function save() {
    update.mutate({
      id: project.id,
      description: desc,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      progressPct: Math.min(100, Math.max(0, Number(progress) || 0)),
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-body">Información del proyecto</h3>
        {!editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Edit2 className="h-3.5 w-3.5" /> Editar
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDesc(project.description ?? ''); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={save} disabled={update.isPending}>
              <Check className="h-3.5 w-3.5" /> Guardar
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Descripción</Label>
        {editing ? (
          <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4} placeholder="Agrega una descripción..." />
        ) : (
          <p className="text-sm text-graphite whitespace-pre-wrap min-h-[40px]">
            {project.description || <span className="text-graphite italic">Sin descripción</span>}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Fecha inicio</Label>
          {editing ? (
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          ) : (
            <p className="text-sm text-graphite">{project.start_date ? formatDate(project.start_date) : '—'}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Fecha fin</Label>
          {editing ? (
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          ) : (
            <p className="text-sm text-graphite">{project.end_date ? formatDate(project.end_date) : '—'}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Presupuesto</Label>
          <p className="text-sm text-graphite">
            {project.budget != null
              ? new Intl.NumberFormat('es', { style: 'currency', currency: project.currency }).format(project.budget)
              : '—'}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Horas estimadas</Label>
          <p className="text-sm text-graphite">
            {project.estimated_hours != null ? `${project.estimated_hours}h` : '—'}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Progreso manual ({progress}%)</Label>
        {editing ? (
          <Input type="number" inputMode="numeric" min={0} max={100} value={progress} onChange={e => setProgress(e.target.value)} className="w-24" />
        ) : (
          <div className="h-2 w-full rounded-full bg-border-soft overflow-hidden">
            <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${project.progress_pct}%` }} />
          </div>
        )}
      </div>

      <GoalLinkRow project={project} />
    </div>
  )
}

/**
 * Goal linker — small inline editor at the bottom of project info.
 * Shows the current linked goal (if any) or a "Vincular a objetivo" dropdown.
 */
function GoalLinkRow({ project }: { project: Project }) {
  const utils = trpc.useUtils()
  const { data: goals } = trpc.goals.list.useQuery()
  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      toast.success('Objetivo vinculado')
      utils.projects.invalidate()
      utils.goals.invalidate()
    },
    onError: (e) => toast.error('No se pudo vincular', e.message),
  })
  const currentGoal = goals?.find(g => g.id === project.goal_id)

  return (
    <div className="space-y-1.5 border-t border-stone-100 pt-4 dark:border-night-700">
      <Label className="flex items-center gap-1.5">
        <Target className="h-3.5 w-3.5 text-signal-ink" />
        Objetivo vinculado
      </Label>
      <div className="flex items-center gap-2">
        <select
          value={project.goal_id ?? ''}
          onChange={e => update.mutate({ id: project.id, goalId: e.target.value || null })}
          className="flex-1 rounded-lg border border-stone px-3 py-1.5 text-sm dark:border-ink-body dark:bg-night-700"
        >
          <option value="">Sin objetivo</option>
          {(goals ?? []).map(g => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
        {currentGoal && (
          <Link
            href="/dashboard/goals"
            className="rounded-md p-1.5 text-graphite hover:bg-stone-100 hover:text-signal-ink dark:hover:bg-night-700"
            title="Ver objetivos"
          >
            <Target className="h-4 w-4" />
          </Link>
        )}
      </div>
      {currentGoal && (
        <p className="text-[10px] text-graphite">
          Este proyecto contribuye a <span className="font-medium">{currentGoal.title}</span>
          {currentGoal._effectiveProgress != null && ` · ${currentGoal._effectiveProgress}% del objetivo`}
        </p>
      )}
    </div>
  )
}
