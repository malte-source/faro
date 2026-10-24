'use client'

import { useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import { PeoplePicker } from '@/components/chat/people-picker'
import { useChatDirectory, useMe } from '@/components/chat/hooks'
import type { ChatMessage } from '@/components/chat/types'

export const SELECT_CLASS =
  'h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-foreground focus:border-night focus:outline-none focus:ring-2 focus:ring-signal/40 dark:bg-[#12293A] md:h-9'

// ── New channel ────────────────────────────────────────────────────────────

export function NewChannelDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (channelId: string) => void
}) {
  const me = useMe()
  const { directory } = useChatDirectory()
  const utils = trpc.useUtils()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [workspaceId, setWorkspaceId] = useState('')
  const [members, setMembers] = useState<Set<string>>(new Set())

  const people = useMemo(() => (directory?.people ?? []).filter(p => p.id !== me?.user.id), [directory, me])

  const create = trpc.chat.createChannel.useMutation({
    onSuccess: ({ id }) => {
      void utils.chat.channels.invalidate()
      toast.success('Canal creado')
      setName(''); setDescription(''); setVisibility('public'); setWorkspaceId(''); setMembers(new Set())
      onOpenChange(false)
      onCreated(id)
    },
    onError: err => toast.error('No se pudo crear el canal', err.message),
  })

  const toggle = (id: string) =>
    setMembers(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <form
          onSubmit={e => {
            e.preventDefault()
            if (name.trim().length < 2 || create.isPending) return
            create.mutate({
              name,
              description: description.trim() || undefined,
              visibility,
              memberIds: Array.from(members),
              workspaceId: workspaceId || undefined,
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Nuevo canal</DialogTitle>
            <DialogDescription>Un lugar para conversar de un tema, una empresa o un equipo.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 pb-4">
            <div className="space-y-1.5">
              <Label htmlFor="chat-new-name">Nombre</Label>
              <Input id="chat-new-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: compras-grupo" maxLength={60} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chat-new-desc">Descripción <span className="font-normal text-graphite">(opcional)</span></Label>
              <Textarea id="chat-new-desc" rows={2} value={description} onChange={e => setDescription(e.target.value)} maxLength={240} className="min-h-[60px]" />
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-night dark:text-mist">Quién puede verlo</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ['public', 'Público', 'Cualquiera del grupo puede verlo y unirse.'],
                  ['private', 'Privado', 'Solo las personas que agregues.'],
                ] as const).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer flex-col rounded-[10px] border p-3 text-sm transition-colors',
                      visibility === value ? 'border-night bg-mist dark:border-signal dark:bg-night-700' : 'border-stone hover:border-graphite dark:border-[#1E3A4C]',
                    )}
                  >
                    <input type="radio" name="chat-visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} className="sr-only" />
                    <span className="font-semibold text-night dark:text-mist">{label}</span>
                    <span className="text-xs text-graphite">{hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {!!directory?.workspaces.length && (
              <div className="space-y-1.5">
                <Label htmlFor="chat-new-ws">Empresa <span className="font-normal text-graphite">(opcional)</span></Label>
                <select id="chat-new-ws" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} className={SELECT_CLASS}>
                  <option value="">Sin empresa</option>
                  {directory.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Personas {members.size > 0 && <span className="font-normal text-graphite">· {members.size} seleccionadas</span>}</Label>
              <PeoplePicker people={people} selected={members} onToggle={toggle} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={name.trim().length < 2 || create.isPending}>
              {create.isPending ? 'Creando…' : 'Crear canal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── New DM ─────────────────────────────────────────────────────────────────

export function NewDmDialog({
  open,
  onOpenChange,
  onOpened,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpened: (channelId: string) => void
}) {
  const me = useMe()
  const { directory, isLoading } = useChatDirectory()
  const utils = trpc.useUtils()
  const people = useMemo(() => (directory?.people ?? []).filter(p => p.id !== me?.user.id), [directory, me])

  const openDm = trpc.chat.openDm.useMutation({
    onSuccess: ({ id }) => {
      void utils.chat.channels.invalidate()
      onOpenChange(false)
      onOpened(id)
    },
    onError: err => toast.error('No se pudo abrir el mensaje', err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mensaje directo</DialogTitle>
          <DialogDescription>Elige a quién quieres escribirle.</DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-graphite">Cargando personas…</p>
          ) : (
            <PeoplePicker people={people} onPick={id => { if (!openDm.isPending) openDm.mutate({ userId: id }) }} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Message → task ─────────────────────────────────────────────────────────

export function TaskDialog({
  message,
  channelWorkspaceId,
  onClose,
}: {
  message: ChatMessage
  channelWorkspaceId: string | null
  onClose: () => void
}) {
  const me = useMe()
  const { directory } = useChatDirectory()
  const utils = trpc.useUtils()
  const firstLine = message.body.split('\n').map(l => l.trim()).find(Boolean) ?? ''

  const [title, setTitle] = useState(firstLine.length > 100 ? `${firstLine.slice(0, 97)}…` : firstLine)
  const [assigneeId, setAssigneeId] = useState(message.mentions[0] ?? me?.user.id ?? '')
  const [workspaceId, setWorkspaceId] = useState(
    channelWorkspaceId && directory?.workspaces.some(w => w.id === channelWorkspaceId) ? channelWorkspaceId : '',
  )
  const [dueDate, setDueDate] = useState('')

  const toTask = trpc.chat.toTask.useMutation({
    onSuccess: ({ title: created }) => {
      toast.success('Tarea creada', created)
      void utils.chat.invalidate()
      void utils.tasks.invalidate()
      void utils.inbox.invalidate()
      onClose()
    },
    onError: err => toast.error('No se pudo crear la tarea', err.message),
  })

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <form
          onSubmit={e => {
            e.preventDefault()
            if (!title.trim() || toTask.isPending) return
            toTask.mutate({
              messageId: message.id,
              title: title.trim(),
              assigneeId: assigneeId || null,
              workspaceId: workspaceId || undefined,
              dueDate: dueDate || null,
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Convertir en tarea</DialogTitle>
            <DialogDescription>El mensaje queda enlazado a la tarea y el hilo avisa que se creó.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-4">
            <div className="space-y-1.5">
              <Label htmlFor="chat-task-title">Título</Label>
              <Input id="chat-task-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} autoFocus />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="chat-task-assignee">Responsable</Label>
                <select id="chat-task-assignee" value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={SELECT_CLASS}>
                  <option value="">Sin responsable</option>
                  {(directory?.people ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chat-task-ws">Empresa</Label>
                <select id="chat-task-ws" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} className={SELECT_CLASS}>
                  <option value="">Automática</option>
                  {(directory?.workspaces ?? []).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="chat-task-date">Fecha límite <span className="font-normal text-graphite">(opcional)</span></Label>
              <Input id="chat-task-date" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={!title.trim() || toTask.isPending}>
              {toTask.isPending ? 'Creando…' : 'Crear tarea'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
