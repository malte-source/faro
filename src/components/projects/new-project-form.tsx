'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft } from 'lucide-react'

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
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('')
  const [budget, setBudget] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [departmentId, setDepartmentId] = useState('none')

  const { data: departments } = trpc.team.departments.useQuery()

  const create = trpc.projects.create.useMutation({
    onSuccess: (project) => router.push(`/dashboard/projects/${project.id}`),
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
    })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={() => router.back()}
        className="mb-6 flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Identidad */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Identidad</h2>

          <div className="space-y-1.5">
            <Label htmlFor="name">Nombre del proyecto *</Label>
            <Input
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
                className="font-mono uppercase"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Departamento</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger><SelectValue placeholder="Ninguno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin departamento</SelectItem>
                  {departments?.map(d => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Descripción</Label>
            <Textarea
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
                  className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-2 ring-indigo-500 scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Estado */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Estado inicial</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">No iniciado</SelectItem>
                  <SelectItem value="in_progress">En progreso</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="on_hold">En pausa</SelectItem>
                  <SelectItem value="delayed">Retrasado</SelectItem>
                  <SelectItem value="completed">Completado</SelectItem>
                  <SelectItem value="canceled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Etapa kanban</Label>
              <Select value={kanbanStage} onValueChange={setKanbanStage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ideas">💡 Ideas</SelectItem>
                  <SelectItem value="backlog">📋 Backlog</SelectItem>
                  <SelectItem value="pending">⏳ Pendiente</SelectItem>
                  <SelectItem value="in_progress">🚀 En progreso</SelectItem>
                  <SelectItem value="on_hold">⏸️ En pausa</SelectItem>
                  <SelectItem value="completed">✅ Completado</SelectItem>
                  <SelectItem value="canceled">❌ Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="very_high">🔴 Muy alta</SelectItem>
                  <SelectItem value="high">🟠 Alta</SelectItem>
                  <SelectItem value="medium">🟡 Media</SelectItem>
                  <SelectItem value="low">🟢 Baja</SelectItem>
                  <SelectItem value="very_low">⚪ Muy baja</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Fechas */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Fechas y estimación</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start">Fecha inicio</Label>
              <Input id="start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end">Fecha fin</Label>
              <Input id="end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hours">Horas estimadas</Label>
              <Input id="hours" type="number" min={0} placeholder="0" value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Presupuesto</Label>
              <div className="flex gap-2">
                <Input type="number" min={0} placeholder="0" value={budget} onChange={e => setBudget(e.target.value)} />
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="w-24 shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ARS">ARS</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-6">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!name.trim() || !code.trim() || create.isPending}>
            {create.isPending ? 'Creando…' : 'Crear proyecto'}
          </Button>
        </div>
      </form>
    </div>
  )
}
