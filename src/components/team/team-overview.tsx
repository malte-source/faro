'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserPlus, Users, Building2, BarChart3, Mail } from 'lucide-react'

type Tab = 'members' | 'departments' | 'workload'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Manager',
  member: 'Miembro', viewer: 'Observador', guest: 'Invitado',
}
const ROLE_VARIANTS: Record<string, 'default' | 'secondary' | 'warning' | 'success' | 'danger'> = {
  owner: 'danger', admin: 'default', manager: 'warning',
  member: 'secondary', viewer: 'secondary', guest: 'secondary',
}

export function TeamOverview() {
  const [tab, setTab] = useState<Tab>('members')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteDept, setInviteDept] = useState('none')

  const { data: members, isLoading: loadingMembers } = trpc.team.members.useQuery()
  const { data: departments, isLoading: loadingDepts } = trpc.team.departments.useQuery()
  const { data: workload } = trpc.team.workload.useQuery()
  const utils = trpc.useUtils()

  const invite = trpc.team.invite.useMutation({
    onSuccess: () => {
      utils.team.members.invalidate()
      setInviteOpen(false)
      setInviteEmail('')
      setInviteName('')
    },
  })

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'members', label: 'Miembros', icon: <Users className="h-4 w-4" /> },
    { id: 'departments', label: 'Departamentos', icon: <Building2 className="h-4 w-4" /> },
    { id: 'workload', label: 'Carga de trabajo', icon: <BarChart3 className="h-4 w-4" /> },
  ]

  return (
    <div className="space-y-4">
      {/* Tab bar + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        {tab === 'members' && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" /> Invitar miembro
          </Button>
        )}
      </div>

      {/* Members */}
      {tab === 'members' && (
        loadingMembers ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members?.map(m => (
              <div key={m.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarImage src={m.avatar_url ?? undefined} />
                  <AvatarFallback className="text-sm font-semibold bg-indigo-50 text-indigo-700">
                    {m.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-900 truncate">{m.name}</p>
                    <Badge variant={ROLE_VARIANTS[m.role] ?? 'secondary'} className="text-[10px] px-1.5">
                      {ROLE_LABELS[m.role] ?? m.role}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5 truncate">
                    <Mail className="h-3 w-3 shrink-0" />{m.email}
                  </p>
                  {m.position && <p className="text-xs text-slate-500 mt-0.5 truncate">{m.position}</p>}
                  {(m.department as { name: string } | null)?.name && (
                    <p className="mt-1.5 text-[11px] font-medium text-slate-400">
                      {(m.department as { name: string }).name}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Departments */}
      {tab === 'departments' && (
        loadingDepts ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}</div>
        ) : (
          <div className="space-y-2">
            {departments?.map(dept => {
              const memberCount = members?.filter(m => (m.department as { id: string } | null)?.id === dept.id).length ?? 0
              return (
                <div key={dept.id} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 hover:border-slate-300 transition-colors">
                  <div className="h-4 w-4 rounded-full shrink-0" style={{ backgroundColor: dept.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{dept.name}</p>
                    {(dept.head as { name: string } | null)?.name && (
                      <p className="text-xs text-slate-400">Jefe: {(dept.head as { name: string }).name}</p>
                    )}
                  </div>
                  <Badge variant="secondary">{memberCount} miembro{memberCount !== 1 ? 's' : ''}</Badge>
                </div>
              )
            })}
            {!departments?.length && (
              <p className="text-center py-12 text-sm text-slate-400">Sin departamentos</p>
            )}
          </div>
        )
      )}

      {/* Workload */}
      {tab === 'workload' && (
        <div className="space-y-3">
          {workload?.map(person => {
            const active = (person as { activeProjects: number }).activeProjects
            const total = (person as { project_members: unknown[] }).project_members?.length ?? 0
            const pct = total > 0 ? Math.round((active / Math.max(total, 1)) * 100) : 0
            const barColor = active >= 4 ? 'bg-red-500' : active >= 2 ? 'bg-orange-400' : 'bg-green-500'
            return (
              <div key={person.id} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3 hover:border-slate-300 transition-colors">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={person.avatar_url ?? undefined} />
                  <AvatarFallback className="text-xs">{person.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="w-36 shrink-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{person.name}</p>
                </div>
                <div className="flex-1">
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0 w-28">
                  <span className="text-sm font-semibold text-slate-700">{active}</span>
                  <span className="text-xs text-slate-400"> activo{active !== 1 ? 's' : ''}</span>
                  <span className="text-xs text-slate-300"> / {total} total</span>
                </div>
              </div>
            )
          })}
          {!workload?.length && <p className="text-center py-12 text-sm text-slate-400">Sin datos</p>}
        </div>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitar miembro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">Nombre completo</Label>
              <Input id="inv-name" placeholder="Ana García" value={inviteName} onChange={e => setInviteName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" type="email" placeholder="ana@empresa.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Rol</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="member">Miembro</SelectItem>
                    <SelectItem value="viewer">Observador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Departamento</Label>
                <Select value={inviteDept} onValueChange={setInviteDept}>
                  <SelectTrigger><SelectValue placeholder="Ninguno" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguno</SelectItem>
                    {departments?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => invite.mutate({ email: inviteEmail, name: inviteName, role: inviteRole as 'admin' | 'manager' | 'member' | 'viewer', departmentId: inviteDept !== 'none' ? inviteDept : undefined })}
              disabled={!inviteEmail || !inviteName || invite.isPending}
            >
              {invite.isPending ? 'Invitando…' : 'Invitar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
