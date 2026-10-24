'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SelectItem } from '@/components/ui/select'
import { ResponsiveSelect } from '@/components/projects/mobile-bits'
import { ArrowLeft, Globe, Lock, User } from 'lucide-react'
import { toast } from '@/components/ui/toaster'

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#64748b',
]

function slugify(str: string) {
  return str.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'PRJ'
}

export function NewProjectForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [codeManual, setCodeManual] = useState(false)
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('not_started')
  const [kanbanStage, setKanbanStage] = useState('backlog')
  const [priority, setPriority] = useState('medium')
  const [color, setColor] = useState(COLORS[0])
  const [visibility, setVisibility] = useState<'workspace' | 'private' | 'personal'>('workspace')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [budget, setBudget] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [departmentId, setDepartmentId] = useState('none')

  const { data: departments } = trpc.team.departments.useQuery()
  const utils = trpc.useUtils()

  const create = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      toast.success('Proyecto creado', `[${project.code}] ${project.name}`)
      utils.projects.invalidate()
      router.push(`/dashboard/projects/${project.id}`)
    },
    onError: (e) => toast.error('No se pudo crear el proyecto', e.message),
  })

  function handleNameChange(v: string) {
    setName(v)
    if (!codeManual) setCode(slugify(v))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !code.trim()) return
    create.mutate({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description.trim() || undefined,
      status: status as 'not_started' | 'in_progress' | 'on_hold' | 'delayed' | 'completed' | 'canceled' | 'pending',
      kanbanStage: kanbanStage as 'ideas' | 'backlog' | 'pending' | 'in_progress' | 'on_hold' | 'completed' | 'canceled',
      priority: priority as 'very_high' | 'high' | 'medium' | 'low' | 'very_low',
      color,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      estimatedHours: estimatedHours ? Number(estimatedHours) : undefined,
      budget: budget ? Number(budget) : undefined,
      currency,
      departmentId: departmentId !== 'none' ? departmentId : undefined,
      visibility,
    })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={() => router.back()}
        className="mb-6 hidden items-center gap-2 text-sm text-graphite transition-colors hover:text-foreground md:flex"
      >
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Identidad */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-graphite">Identidad</h2>

          <div className="space-y-1.5">
            <Label htmlFor="name">Nombre del proyecto *</Label>
            <Input className="h-12 md:h-9"
              id="name"
              placeholder="Ej: Rediseño web corporativa"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="code">Código *</Label>
              <Input
                id="code"
                placeholder="Ej: REDWEB"
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setCodeManual(true) }}
                maxLength={8}
                className="h-12 font-mono uppercase md:h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Departamento</Label>
              <ResponsiveSelect value={departmentId} onValueChange={setDepartmentId}>
                  <SelectItem value="none">Sin departamento</SelectItem>
                  {departments?.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </ResponsiveSelect>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Textarea className="min-h-[88px] md:min-h-0"
              id="description"
              placeholder="¿De qué trata este proyecto?"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-2 ring-signal scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Visibility */}
          <div className="space-y-1.5">
            <Label>Visibilidad</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <VisibilityOption
                kind="workspace"
                active={visibility === 'workspace'}
                onClick={() => setVisibility('workspace')}
              />
              <VisibilityOption
                kind="private"
                active={visibility === 'private'}
                onClick={() => setVisibility('private')}
              />
              <VisibilityOption
                kind="personal"
                active={visibility === 'personal'}
                onClick={() => setVisibility('personal')}
              />
            </div>
          </div>
        </section>

        {/* Estado */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-graphite">Estado inicial</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <ResponsiveSelect value={status} onValueChange={setStatus}>
                  <SelectItem value="not_started">No iniciado</SelectItem>
                  <SelectItem value="in_progress">En progreso</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="on_hold">En pausa</SelectItem>
                  <SelectItem value="delayed">Retrasado</SelectItem>
                  <SelectItem value="completed">Completado</SelectItem>
                  <SelectItem value="canceled">Cancelado</SelectItem>
                </ResponsiveSelect>
            </div>

            <div className="space-y-1.5">
              <Label>Etapa kanban</Label>
              <ResponsiveSelect value={kanbanStage} onValueChange={setKanbanStage}>
                  <SelectItem value="ideas">💡 Ideas</SelectItem>
                  <SelectItem value="backlog">📋 Backlog</SelectItem>
                  <SelectItem value="pending">⏳ Pendiente</SelectItem>
                  <SelectItem value="in_progress">🚀 En progreso</SelectItem>
                  <SelectItem value="on_hold">⏸️ En pausa</SelectItem>
                  <SelectItem value="completed">✅ Completado</SelectItem>
                  <SelectItem value="canceled">❌ Cancelado</SelectItem>
                </ResponsiveSelect>
            </div>

            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <ResponsiveSelect value={priority} onValueChange={setPriority}>
                  <SelectItem value="very_high">🔴 Muy alta</SelectItem>
                  <SelectItem value="high">🟠 Alta</SelectItem>
                  <SelectItem value="medium">🟡 Media</SelectItem>
                  <SelectItem value="low">🟢 Baja</SelectItem>
                  <SelectItem value="very_low">⚪ Muy baja</SelectItem>
                </ResponsiveSelect>
            </div>
          </div>
        </section>

        {/* Fechas */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-graphite">Fechas y estimación</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start">Fecha inicio</Label>
              <Input className="h-12 md:h-9" id="start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">Fecha fin</Label>
              <Input className="h-12 md:h-9" id="end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hours">Horas estimadas</Label>
              <Input className="h-12 md:h-9" id="hours" type="number" inputMode="numeric" min={0} placeholder="0" value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Presupuesto</Label>
              <div className="flex gap-2">
                <Input className="h-12 md:h-9" type="number" inputMode="numeric" min={0} placeholder="0" value={budget} onChange={e => setBudget(e.target.value)} />
                <ResponsiveSelect value={currency} onValueChange={setCurrency}>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ARS">ARS</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </ResponsiveSelect>
              </div>
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t border-border-soft bg-background/90 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:static md:mx-0 md:justify-end md:border-border-soft md:bg-transparent md:px-0 md:pb-0 md:pt-6 md:backdrop-blur-none">
          <Button type="button" variant="ghost" className="h-12 flex-1 md:h-9 md:flex-none" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button type="submit" className="h-12 flex-[1.6] md:h-9 md:flex-none" disabled={!name.trim() || !code.trim() || create.isPending}>
            {create.isPending ? 'Creando…' : 'Crear proyecto'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function VisibilityOption({
  kind,
  active,
  onClick,
}: {
  kind: 'workspace' | 'private' | 'personal'
  active: boolean
  onClick: () => void
}) {
  const meta = {
    workspace: {
      icon: Globe,
      title: 'Workspace',
      desc: 'Visible para todos los miembros del workspace',
      iconBg: 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal',
    },
    private: {
      icon: Lock,
      title: 'Privado',
      desc: 'Solo los miembros explícitos del proyecto',
      iconBg: 'bg-signal-wash text-signal-ink dark:bg-signal/40 dark:text-signal/50',
    },
    personal: {
      icon: User,
      title: 'Personal',
      desc: 'Solo tú lo ves (tareas de casa, side projects)',
      iconBg: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
    },
  }[kind]
  const Icon = meta.icon
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-all active:scale-[0.98] ${active ? 'border-signal bg-signal-wash/40 ring-1 ring-signal dark:bg-signal/20' : 'border-stone bg-white hover:border-stone dark:border-ink-body dark:bg-night dark:hover:border-graphite'}`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.iconBg}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-night dark:text-stone-100">{meta.title}</span>
        <span className="block text-[11px] leading-tight text-graphite dark:text-graphite">{meta.desc}</span>
      </span>
    </button>
  )
}
