'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserPlus, X } from 'lucide-react'
import type { ProjectMemberRole } from '@/types/database'

const ROLE_LABELS: Record<ProjectMemberRole, string> = {
  lead: 'Líder',
  contributor: 'Colaborador',
  viewer: 'Observador',
}

interface Member {
  id: string
  role: ProjectMemberRole
  user: { id: string; name: string; email: string; avatar_url: string | null; position: string | null } | null
}

interface Props {
  projectId: string
  members: Member[]
}

export function ProjectMembers({ projectId, members }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState('none')
  const [selectedRole, setSelectedRole] = useState<string>('contributor')

  const { data: teamMembers } = trpc.team.members.useQuery()
  const utils = trpc.useUtils()

  const existingUserIds = new Set(members.map(m => m.user?.id).filter(Boolean))
  const availableMembers = teamMembers?.filter(m => !existingUserIds.has(m.id)) ?? []

  const addMember = trpc.projects.addMember.useMutation({
    onSuccess: () => {
      utils.projects.byId.invalidate(projectId)
      setAddOpen(false)
      setSelectedUser('none')
    },
  })

  const removeMember = trpc.projects.removeMember.useMutation({
    onSuccess: () => utils.projects.byId.invalidate(projectId),
  })

  function handleAdd() {
    if (selectedUser === 'none') return
    addMember.mutate({
      projectId,
      userId: selectedUser,
      role: selectedRole as ProjectMemberRole,
    })
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{members.length} miembro{members.length !== 1 ? 's' : ''}</h3>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" /> Agregar miembro
        </Button>
      </div>

      <div className="grid gap-2">
        {members.map(m => (
          <div key={m.id} className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-slate-300 transition-colors">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={m.user?.avatar_url ?? undefined} />
              <AvatarFallback className="text-xs">
                {(m.user?.name ?? '?').slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{m.user?.name ?? '—'}</p>
              <p className="text-xs text-slate-400 truncate">{m.user?.position ?? m.user?.email}</p>
            </div>

            <Badge variant="secondary" className="text-xs">{ROLE_LABELS[m.role]}</Badge>

            <button
              onClick={() => removeMember.mutate({ memberId: m.id })}
              className="hidden group-hover:flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-red-500 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {members.length === 0 && (
          <p className="text-center text-sm text-slate-400 py-8">Sin miembros asignados</p>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar miembro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Persona</label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Seleccionar...</SelectItem>
                  {availableMembers.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Rol</label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Líder</SelectItem>
                  <SelectItem value="contributor">Colaborador</SelectItem>
                  <SelectItem value="viewer">Observador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={selectedUser === 'none' || addMember.isPending}>
              {addMember.isPending ? 'Agregando…' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
