'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SelectItem } from '@/components/ui/select'
import { ResponsiveSelect } from '@/components/projects/mobile-bits'
import type { TaskStatus } from '@/types/database'
import { toast } from '@/components/ui/toaster'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  projectId: string
  defaultStatus?: TaskStatus
  onCreated?: () => void
}

export function AddTaskDialog({ open, onOpenChange, projectId, defaultStatus = 'todo', onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<string>('medium')
  const [dueDate, setDueDate] = useState('')
  const [assigneeId, setAssigneeId] = useState<string>('none')

  const { data: members } = trpc.team.members.useQuery()
  const utils = trpc.useUtils()

  const create = trpc.tasks.create.useMutation({
    onSuccess: () => {
      toast.success('Tarea creada')
      utils.tasks.invalidate()
      utils.projects.invalidate()
      setTitle('')
      setDescription('')
      setPriority('medium')
      setDueDate('')
      setAssigneeId('none')
      onOpenChange(false)
      onCreated?.()
    },
    onError: (e) => toast.error('No se pudo crear la tarea', e.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    create.mutate({
      projectId,
      title: title.trim(),
      description: description.trim() || undefined,
      priority: priority as 'very_high' | 'high' | 'medium' | 'low' | 'very_low',
      dueDate: dueDate || undefined,
      assigneeId: assigneeId !== 'none' ? assigneeId : undefined,
      labels: [],
      status: defaultStatus,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-6 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-title">Título *</Label>
              <Input className="h-12 md:h-9"
                id="task-title"
                placeholder="¿Qué hay que hacer?"
                value={title}
                onChange={e => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-desc">Descripción</Label>
              <Textarea className="min-h-[88px] md:min-h-0"
                id="task-desc"
                placeholder="Detalles opcionales..."
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Prioridad</Label>
                <ResponsiveSelect value={priority} onValueChange={setPriority}>
                    <SelectItem value="very_high">Muy alta</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="medium">Media</SelectItem>
                    <SelectItem value="low">Baja</SelectItem>
                    <SelectItem value="very_low">Muy baja</SelectItem>
                  </ResponsiveSelect>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-due">Fecha límite</Label>
                <Input className="h-12 md:h-9"
                  id="task-due"
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Responsable</Label>
              <ResponsiveSelect value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {members?.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </ResponsiveSelect>
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 z-10 bg-surface md:static">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {create.isPending ? 'Creando…' : 'Crear tarea'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
