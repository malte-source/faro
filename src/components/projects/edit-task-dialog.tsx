'use client'

import { useState, useEffect } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TaskStatus } from '@/types/database'

interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: string
  due_date: string | null
  assignee_id: string | null
}

interface Props {
  task: Task | null
  projectId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function EditTaskDialog({ task, projectId, open, onOpenChange }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [assigneeId, setAssigneeId] = useState('none')

  const { data: members } = trpc.team.members.useQuery()
  const utils = trpc.useUtils()

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description ?? '')
      setStatus(task.status)
      setPriority(task.priority)
      setDueDate(task.due_date ?? '')
      setAssigneeId(task.assignee_id ?? 'none')
    }
  }, [task])

  const update = trpc.tasks.update.useMutation({
    onSuccess: () => {
      utils.tasks.byProject.invalidate(projectId)
      utils.tasks.list.invalidate()
      onOpenChange(false)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!task || !title.trim()) return
    update.mutate({
      id: task.id,
      title: title.trim(),
      status,
      priority: priority as 'very_high' | 'high' | 'medium' | 'low' | 'very_low',
      dueDate: dueDate || null,
      assigneeId: assigneeId !== 'none' ? assigneeId : null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar tarea</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 px-6 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="et-title">Título *</Label>
              <Input id="et-title" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="et-desc">Descripción</Label>
              <Textarea id="et-desc" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Select value={status} onValueChange={v => setStatus(v as TaskStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">Por hacer</SelectItem>
                    <SelectItem value="in_progress">En progreso</SelectItem>
                    <SelectItem value="in_review">En revisión</SelectItem>
                    <SelectItem value="done">Listo</SelectItem>
                    <SelectItem value="canceled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Prioridad</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="very_high">Muy alta</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="medium">Media</SelectItem>
                    <SelectItem value="low">Baja</SelectItem>
                    <SelectItem value="very_low">Muy baja</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="et-due">Fecha límite</Label>
                <Input id="et-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Responsable</Label>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin asignar</SelectItem>
                    {members?.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!title.trim() || update.isPending}>
              {update.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
