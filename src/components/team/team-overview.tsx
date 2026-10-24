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
import {
  UserPlus, Users, Building2, BarChart3, Mail, Pencil, RotateCcw, Trash2, Power, Plus, Network,
} from 'lucide-react'
import { toast } from '@/components/ui/toaster'
import { confirmAction } from '@/components/ui/confirm'
import { EmptyState } from '@/components/ui/empty-state'
import { GridSkeleton, ListSkeleton } from '@/components/ui/skeletons'
import { OrgChart } from '@/components/team/org-chart'
import { InsetGroup, ListRow } from '@/components/mobile/inset-list'
import { haptic } from '@/components/mobile/haptics'

type Tab = 'members' | 'departments' | 'workload' | 'orgchart'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Manager',
  member: 'Miembro', viewer: 'Observador', guest: 'Invitado',
}
const ROLE_VARIANTS: Record<string, 'default' | 'secondary' | 'warning' | 'success' | 'danger'> = {
  owner: 'danger', admin: 'default', manager: 'warning',
  member: 'secondary', viewer: 'secondary', guest: 'secondary',
}
const DEPT_COLORS = ['#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316']

export function TeamOverview() {
  const [tab, setTab] = useState<Tab>('members')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<string | null>(null)
  const [deptDialog, setDeptDialog] = useState<{ id: string | null } | null>(null)

  const { data: me } = trpc.team.me.useQuery()
  const isAdmin = me?.isAdmin ?? false

  const utils = trpc.useUtils()
  const { data: members, isLoading: loadingMembers } = trpc.team.members.useQuery({ includeInactive })
  const { data: departments, isLoading: loadingDepts } = trpc.team.departments.useQuery()
  const { data: workload } = trpc.team.workload.useQuery()

  const tabs: { id: Tab; label: string; mobileLabel: string; icon: React.ReactNode }[] = [
    { id: 'members', label: 'Miembros', mobileLabel: 'Miembros', icon: <Users className="h-4 w-4" /> },
    { id: 'orgchart', label: 'Organigrama', mobileLabel: 'Organigrama', icon: <Network className="h-4 w-4" /> },
    { id: 'departments', label: 'Departamentos', mobileLabel: 'Áreas', icon: <Building2 className="h-4 w-4" /> },
    { id: 'workload', label: 'Carga de trabajo', mobileLabel: 'Carga', icon: <BarChart3 className="h-4 w-4" /> },
  ]

  return (
    <div className="space-y-4">
      {/* Phone: scrollable pill tabs (never cut off) */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden" role="tablist" data-no-track data-no-ptr>
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => { haptic(); setTab(t.id) }}
            className={`h-10 shrink-0 rounded-full px-4 text-[14px] font-medium transition-colors ${
              tab === t.id ? 'bg-night text-mist dark:bg-signal dark:text-night' : 'border border-border bg-surface text-graphite active:bg-border-soft'
            }`}
          >
            {t.mobileLabel}
          </button>
        ))}
      </div>

      {/* Phone: contextual actions */}
      {(tab === 'members' || (tab === 'departments' && isAdmin)) && (
        <div className="flex flex-wrap items-center gap-2 md:hidden">
          {tab === 'members' && (
            <>
              {isAdmin && (
                <button type="button" onClick={() => setInviteOpen(true)} className="flex h-10 items-center gap-1.5 rounded-full bg-signal px-4 text-[14px] font-semibold text-night active:opacity-80">
                  <UserPlus className="h-4 w-4" /> Invitar
                </button>
              )}
              <button
                type="button"
                aria-pressed={includeInactive}
                onClick={() => { haptic(); setIncludeInactive(v => !v) }}
                className={`h-10 rounded-full border px-4 text-[14px] font-medium ${includeInactive ? 'border-night bg-night text-mist dark:border-signal dark:bg-signal dark:text-night' : 'border-border bg-surface text-graphite'}`}
              >
                Mostrar inactivos
              </button>
            </>
          )}
          {tab === 'departments' && isAdmin && (
            <button type="button" onClick={() => setDeptDialog({ id: null })} className="flex h-10 items-center gap-1.5 rounded-full bg-signal px-4 text-[14px] font-semibold text-night active:opacity-80">
              <Plus className="h-4 w-4" /> Nuevo departamento
            </button>
          )}
        </div>
      )}

      {/* Desktop: tab bar + actions */}
      <div className="hidden items-center justify-between flex-wrap gap-3 md:flex">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-signal-wash text-night dark:bg-signal/15 dark:text-signal' : 'text-graphite hover:bg-border-soft hover:text-body'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {tab === 'members' && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-graphite">
                <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />
                Mostrar inactivos
              </label>
              {isAdmin && (
                <Button size="sm" onClick={() => setInviteOpen(true)}>
                  <UserPlus className="h-4 w-4" /> Invitar miembro
                </Button>
              )}
            </>
          )}
          {tab === 'departments' && isAdmin && (
            <Button size="sm" onClick={() => setDeptDialog({ id: null })}>
              <Plus className="h-4 w-4" /> Nuevo departamento
            </Button>
          )}
        </div>
      </div>

      {/* Members */}
      {tab === 'members' && (
        loadingMembers ? (
          <GridSkeleton rows={6} cols={3} />
        ) : (
          <>
          <div className="md:hidden">
            {members?.length ? (
              <InsetGroup footer={isAdmin ? 'Toca una persona para editar su cargo, rol y estructura.' : undefined}>
                {members.map(m => {
                  const canEdit = isAdmin && m.role !== 'owner' && m.id !== me?.id
                  const dept = m.department as { name: string; color: string } | null
                  return (
                    <ListRow
                      key={m.id}
                      onClick={canEdit ? () => { haptic(); setEditingMember(m.id) } : undefined}
                      chevron={canEdit}
                      leading={
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={m.avatar_url ?? undefined} />
                          <AvatarFallback className="bg-signal-wash text-sm font-semibold text-night">
                            {m.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      }
                      title={
                        <span className={`flex items-center gap-2 ${m.is_active ? '' : 'opacity-60'}`}>
                          <span className="truncate">{m.name}</span>
                          <Badge variant={ROLE_VARIANTS[m.role] ?? 'secondary'} className="shrink-0 px-1.5 text-[10px]">{ROLE_LABELS[m.role] ?? m.role}</Badge>
                          {!m.is_active && <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px]">Inactivo</Badge>}
                        </span>
                      }
                      subtitle={m.position || m.email}
                      trailing={dept ? (
                        <span className="flex items-center gap-1.5 text-xs">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dept.color }} />
                          <span className="max-w-[84px] truncate">{dept.name}</span>
                        </span>
                      ) : undefined}
                    />
                  )
                })}
              </InsetGroup>
            ) : (
              <EmptyState icon={Users} title="Sin miembros todavía" description="Invita al primer miembro de tu organización para arrancar." />
            )}
          </div>
          <div className="hidden gap-3 md:grid md:grid-cols-2 lg:grid-cols-3">
            {members?.map(m => {
              const isInactive = !m.is_active
              return (
                <div
                  key={m.id}
                  className={`group relative flex items-start gap-3 rounded-xl border p-4 transition ${isInactive ? 'border-stone bg-mist/50 opacity-70' : 'border-stone bg-white hover:border-stone'} dark:border-night-700 dark:bg-night`}
                >
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarImage src={m.avatar_url ?? undefined} />
                    <AvatarFallback className="text-sm font-semibold bg-signal-wash text-night">
                      {m.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-night dark:text-stone-100 truncate">{m.name}</p>
                      <Badge variant={ROLE_VARIANTS[m.role] ?? 'secondary'} className="text-[10px] px-1.5">
                        {ROLE_LABELS[m.role] ?? m.role}
                      </Badge>
                      {isInactive && (
                        <Badge variant="secondary" className="text-[10px] px-1.5">Inactivo</Badge>
                      )}
                    </div>
                    <p className="text-xs text-graphite flex items-center gap-1 mt-0.5 truncate">
                      <Mail className="h-3 w-3 shrink-0" />{m.email}
                    </p>
                    {m.position && <p className="text-xs text-graphite mt-0.5 truncate">{m.position}</p>}
                    {(m.department as { name: string } | null)?.name && (
                      <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-graphite">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: (m.department as { color: string }).color }} />
                        {(m.department as { name: string }).name}
                      </p>
                    )}
                  </div>
                  {isAdmin && m.role !== 'owner' && m.id !== me?.id && (
                    <button
                      onClick={() => setEditingMember(m.id)}
                      className="absolute right-2 top-2 rounded-md p-1 text-graphite md:opacity-0 transition md:group-hover:opacity-100 hover:bg-stone-100 dark:hover:bg-night-700"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
            {!members?.length && (
              <div className="col-span-full">
                <EmptyState
                  icon={Users}
                  title="Sin miembros todavía"
                  description="Invita al primer miembro de tu organización para arrancar."
                />
              </div>
            )}
          </div>
          </>
        )
      )}

      {/* Departments */}
      {tab === 'departments' && (
        loadingDepts ? (
          <ListSkeleton rows={4} />
        ) : (
          <>
          <div className="md:hidden">
            {departments?.length ? (
              <InsetGroup>
                {departments.map(dept => {
                  const count = members?.filter(m => (m.department as { id: string } | null)?.id === dept.id).length ?? 0
                  return (
                    <ListRow
                      key={dept.id}
                      onClick={isAdmin ? () => { haptic(); setDeptDialog({ id: dept.id }) } : undefined}
                      chevron={isAdmin}
                      leading={<span className="h-4 w-4 rounded-full" style={{ backgroundColor: dept.color }} />}
                      title={dept.name}
                      subtitle={(dept.head as { name: string } | null)?.name ? `Jefe: ${(dept.head as { name: string }).name}` : undefined}
                      trailing={`${count} miembro${count !== 1 ? 's' : ''}`}
                    />
                  )
                })}
              </InsetGroup>
            ) : (
              <EmptyState icon={Building2} title="Sin departamentos" description="Crea uno para agrupar miembros (Diseño, Desarrollo, Cuentas, etc.)." />
            )}
          </div>
          <div className="hidden space-y-2 md:block">
            {departments?.map(dept => {
              const memberCount = members?.filter(m => (m.department as { id: string } | null)?.id === dept.id).length ?? 0
              return (
                <div key={dept.id} className="group flex items-center gap-4 rounded-xl border border-stone bg-white px-5 py-4 transition hover:border-stone dark:border-night-700 dark:bg-night">
                  <div className="h-4 w-4 rounded-full shrink-0" style={{ backgroundColor: dept.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-night dark:text-stone-100">{dept.name}</p>
                    {(dept.head as { name: string } | null)?.name && (
                      <p className="text-xs text-graphite">Jefe: {(dept.head as { name: string }).name}</p>
                    )}
                  </div>
                  <Badge variant="secondary">{memberCount} miembro{memberCount !== 1 ? 's' : ''}</Badge>
                  {isAdmin && (
                    <div className="flex items-center gap-1 md:opacity-0 transition md:group-hover:opacity-100">
                      <button onClick={() => setDeptDialog({ id: dept.id })} className="rounded-md p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700" title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
            {!departments?.length && (
              <EmptyState
                icon={Building2}
                title="Sin departamentos"
                description="Crea uno para agrupar miembros (Diseño, Desarrollo, Cuentas, etc.)."
              />
            )}
          </div>
          </>
        )
      )}

      {/* Workload (unchanged) */}
      {tab === 'workload' && (
        <div className="space-y-3">
          {workload?.map(person => {
            const p = person as {
              id: string; name: string; avatar_url: string | null; position: string | null
              activeProjects: number; openTasks: number; overdueTasks: number
              inProgressTasks: number; minutesThisWeek: number
            }
            const load = p.activeProjects * 1.5 + p.openTasks * 0.25 + p.overdueTasks * 0.5
            const barColor = load >= 8 ? 'bg-danger' : load >= 4 ? 'bg-signal-ink' : load >= 1 ? 'bg-success' : 'bg-stone'
            const barPct = Math.min(100, (load / 12) * 100)
            const hoursThisWeek = (p.minutesThisWeek / 60).toFixed(1)
            return (
              <div key={p.id} className="rounded-[14px] border border-border bg-surface px-4 py-3 transition-colors md:rounded-xl md:px-5">
                <div className="flex items-center gap-3 md:gap-4">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={p.avatar_url ?? undefined} />
                    <AvatarFallback className="text-xs">{p.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="w-28 shrink-0 md:w-40">
                    <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                    {p.position && <p className="truncate text-[10px] text-graphite">{p.position}</p>}
                  </div>
                  <div className="flex-1">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-night-700">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barPct}%` }} />
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] md:ml-[3.25rem] md:mt-2 md:grid-cols-4">
                  <WorkloadStat label="Proyectos activos" value={String(p.activeProjects)} />
                  <WorkloadStat
                    label="Tareas abiertas"
                    value={String(p.openTasks)}
                    sub={p.inProgressTasks > 0 ? `${p.inProgressTasks} en progreso` : null}
                  />
                  <WorkloadStat label="Vencidas" value={String(p.overdueTasks)} tone={p.overdueTasks > 0 ? 'rose' : 'slate'} />
                  <WorkloadStat label="Hs esta semana" value={`${hoursThisWeek}h`} tone="cyan" />
                </div>
              </div>
            )
          })}
          {!workload?.length && <EmptyState icon={BarChart3} title="Sin datos de carga" description="Aparece cuando los miembros tengan tareas asignadas." />}
        </div>
      )}

      {/* Org chart — capas, código de rol, línea sólida/punteada */}
      {tab === 'orgchart' && <OrgChart />}

      {/* INVITE MODAL */}
      {inviteOpen && (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          onCreated={() => { utils.team.members.invalidate(); setInviteOpen(false) }}
          departments={departments ?? []}
        />
      )}

      {/* EDIT MEMBER MODAL */}
      {editingMember && (
        <MemberEditor
          member={members?.find(m => m.id === editingMember)}
          departments={departments ?? []}
          allMembers={members ?? []}
          onClose={() => setEditingMember(null)}
          onChanged={() => { utils.team.members.invalidate(); setEditingMember(null) }}
        />
      )}

      {/* DEPARTMENT MODAL */}
      {deptDialog && (
        <DepartmentEditor
          deptId={deptDialog.id}
          existing={departments?.find(d => d.id === deptDialog.id)}
          members={members ?? []}
          onClose={() => setDeptDialog(null)}
          onChanged={() => { utils.team.departments.invalidate(); setDeptDialog(null) }}
        />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

function InviteDialog({
  onClose, onCreated, departments,
}: {
  onClose: () => void
  onCreated: () => void
  departments: Array<{ id: string; name: string }>
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('member')
  const [dept, setDept] = useState('none')
  const [position, setPosition] = useState('')
  const invite = trpc.team.invite.useMutation({
    onSuccess: (data) => {
      const reactivated = (data as { _reactivated?: boolean })?._reactivated
      toast.success(reactivated ? 'Miembro reactivado' : 'Invitación enviada',
        reactivated ? 'Ya existía — se actualizaron los datos.' : 'La primera vez que se loguee con su Google, se activa.')
      onCreated()
    },
    onError: (e) => toast.error('No se pudo invitar', e.message),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Invitar miembro</DialogTitle></DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          <div className="space-y-1.5">
            <Label htmlFor="inv-name">Nombre completo</Label>
            <Input id="inv-name" placeholder="Ana García" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" placeholder="ana@empresa.com" value={email} onChange={e => setEmail(e.target.value)} />
            <p className="text-[10px] text-graphite">Debe ser un email de Google — el usuario se activa la primera vez que se loguee con esa cuenta.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Rol</Label>
              <Select value={role} onValueChange={setRole}>
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
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger><SelectValue placeholder="Ninguno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguno</SelectItem>
                  {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-position">Cargo (opcional)</Label>
            <Input id="inv-position" placeholder="Project manager" value={position} onChange={e => setPosition(e.target.value)} />
          </div>
          {invite.isError && (
            <p className="rounded-lg bg-danger-wash px-3 py-2 text-xs text-danger">{invite.error.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => invite.mutate({
              email, name,
              role: role as 'admin' | 'manager' | 'member' | 'viewer',
              departmentId: dept !== 'none' ? dept : undefined,
              position: position || undefined,
            })}
            disabled={!email || !name || invite.isPending}
          >
            {invite.isPending ? 'Invitando…' : 'Invitar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MemberEditor({
  member, departments, allMembers, onClose, onChanged,
}: {
  member?: {
    id: string; name: string; email: string; role: string
    position: string | null
    is_active: boolean
    department: { id: string } | null
    role_code?: string | null
    corporate_layer?: 'gobierno' | 'coe' | 'sso' | 'filial' | null
    reports_to_user_id?: string | null
    dotted_line_to_user_id?: string | null
    kpi_description?: string | null
  }
  departments: Array<{ id: string; name: string }>
  allMembers: Array<{ id: string; name: string }>
  onClose: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState(member?.name ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [role, setRole] = useState(member?.role ?? 'member')
  const [dept, setDept] = useState((member?.department as { id: string } | null)?.id ?? 'none')
  const [position, setPosition] = useState(member?.position ?? '')
  const [roleCode, setRoleCode] = useState(member?.role_code ?? '')
  const [corporateLayer, setCorporateLayer] = useState(member?.corporate_layer ?? 'none')
  const [reportsTo, setReportsTo] = useState(member?.reports_to_user_id ?? 'none')
  const [dottedLineTo, setDottedLineTo] = useState(member?.dotted_line_to_user_id ?? 'none')
  const [kpiDescription, setKpiDescription] = useState(member?.kpi_description ?? '')
  const [jdBrief, setJdBrief] = useState('')
  const [jdDraft, setJdDraft] = useState<string | null>(null)
  const update = trpc.team.updateMember.useMutation({
    onSuccess: () => { toast.success('Miembro actualizado'); onChanged() },
    onError: (e) => toast.error('No se pudo actualizar', e.message),
  })
  const generateJD = trpc.team.generateJobDescription.useMutation({
    onSuccess: (data) => setJdDraft(data.draft),
    onError: (e) => toast.error('No se pudo generar la JD', e.message),
  })
  const deactivate = trpc.team.deactivateMember.useMutation({
    onSuccess: () => { toast.success('Miembro desactivado'); onChanged() },
    onError: (e) => toast.error('No se pudo desactivar', e.message),
  })
  const reactivate = trpc.team.reactivateMember.useMutation({
    onSuccess: () => { toast.success('Miembro reactivado'); onChanged() },
    onError: (e) => toast.error('No se pudo reactivar', e.message),
  })
  const remove = trpc.team.deleteMember.useMutation({
    onSuccess: () => { toast.success('Miembro borrado'); onChanged() },
    onError: (e) => toast.error('No se pudo borrar', e.message),
  })

  if (!member) return null
  const emailChanged = email.trim().toLowerCase() !== member.email.toLowerCase()
  const emailChangeRisky = emailChanged && member.is_active

  const handleSave = async () => {
    // For risky changes, ask for explicit confirmation before sending the
    // confirmEmailChange flag — server rejects without it on active users.
    if (emailChangeRisky) {
      const ok = await confirmAction({
        title: 'Cambiar email de un usuario activo',
        description: `Vas a cambiar el email de ${member.name} de "${member.email}" a "${email}".\n\nEsto ROMPE su acceso actual a FARO porque está vinculado a Google OAuth. La próxima vez que se loguee con el email nuevo, se creará una cuenta nueva.`,
        confirmLabel: 'Sí, cambiar',
        cancelLabel: 'Cancelar',
        variant: 'destructive',
      })
      if (!ok) return
    }
    update.mutate({
      userId: member.id,
      name,
      email: emailChanged ? email.trim() : undefined,
      role: role as 'admin' | 'manager' | 'member' | 'viewer',
      departmentId: dept !== 'none' ? dept : null,
      position: position || null,
      confirmEmailChange: emailChangeRisky || undefined,
      roleCode: roleCode.trim() || null,
      corporateLayer: corporateLayer !== 'none' ? corporateLayer as 'gobierno' | 'coe' | 'sso' | 'filial' : null,
      reportsToUserId: reportsTo !== 'none' ? reportsTo : null,
      dottedLineToUserId: dottedLineTo !== 'none' ? dottedLineTo : null,
      kpiDescription: kpiDescription.trim() || null,
    })
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar miembro</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
            {emailChangeRisky && (
              <p className="rounded-md bg-signal-wash px-2 py-1.5 text-[11px] text-signal-ink dark:bg-signal/30 dark:text-signal/30">
                ⚠️ Este usuario ya se logueó con <code className="font-mono">{member.email}</code>. Cambiar el email rompe su acceso. Pedirá confirmación al guardar.
              </p>
            )}
            {emailChanged && !emailChangeRisky && (
              <p className="text-[11px] text-graphite">
                El usuario aún no se logueó — cambiar el email es seguro (todavía no hay pairing con Google).
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Rol</Label>
              <Select value={role} onValueChange={setRole}>
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
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguno</SelectItem>
                  {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Cargo</Label>
            <Input value={position} onChange={e => setPosition(e.target.value)} />
          </div>

          {/* Estructura org — capas, código de rol, líneas de reporte */}
          <div className="rounded-lg border border-border bg-background p-3 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-graphite">Estructura organizacional</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Código de rol</Label>
                <Input placeholder="ej. DIR-01" value={roleCode} onChange={e => setRoleCode(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Capa corporativa</Label>
                <Select value={corporateLayer} onValueChange={v => setCorporateLayer(v as typeof corporateLayer)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin asignar</SelectItem>
                    <SelectItem value="gobierno">Gobierno</SelectItem>
                    <SelectItem value="coe">Centro de Excelencia</SelectItem>
                    <SelectItem value="sso">Servicios Compartidos</SelectItem>
                    <SelectItem value="filial">Filial Operativa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Línea sólida (reporta a)</Label>
                <Select value={reportsTo} onValueChange={setReportsTo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin asignar</SelectItem>
                    {allMembers.filter(m => m.id !== member.id).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Línea punteada (funcional)</Label>
                <Select value={dottedLineTo} onValueChange={setDottedLineTo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguna</SelectItem>
                    {allMembers.filter(m => m.id !== member.id).map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>KPI principal</Label>
              <Input placeholder="ej. Ahorro capturado vs. línea base" value={kpiDescription} onChange={e => setKpiDescription(e.target.value)} />
            </div>

            {/* AI JD generator */}
            <div className="border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Contexto extra para la JD (opcional)"
                  value={jdBrief}
                  onChange={e => setJdBrief(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="signal"
                  size="sm"
                  disabled={generateJD.isPending}
                  onClick={() => generateJD.mutate({ userId: member.id, brief: jdBrief.trim() || undefined })}
                >
                  {generateJD.isPending ? 'Generando…' : 'Generar JD con IA'}
                </Button>
              </div>
              {jdDraft && (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-signal/30 bg-signal-wash p-3">
                  <pre className="whitespace-pre-wrap font-sans text-xs text-body">{jdDraft}</pre>
                </div>
              )}
            </div>
          </div>

          {(update.isError || deactivate.isError || reactivate.isError || remove.isError) && (
            <p className="rounded-lg bg-danger-wash px-3 py-2 text-xs text-danger">
              {(update.error || deactivate.error || reactivate.error || remove.error)?.message}
            </p>
          )}
        </div>
        <DialogFooter className="flex justify-between">
          <div className="flex gap-1">
            {member.is_active ? (
              <Button
                variant="ghost"
                onClick={async () => {
                  const ok = await confirmAction({
                    title: `Desactivar a ${member.name}`,
                    description: 'El usuario no podrá acceder, pero su data (tareas, comentarios) se mantiene. Se puede reactivar después.',
                    variant: 'warning',
                    confirmLabel: 'Desactivar',
                  })
                  if (ok) deactivate.mutate({ userId: member.id })
                }}
                className="text-signal-ink hover:bg-signal-wash"
              >
                <Power className="h-4 w-4" /> Desactivar
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => reactivate.mutate({ userId: member.id })} className="text-success hover:bg-success-wash">
                <RotateCcw className="h-4 w-4" /> Reactivar
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={async () => {
                const ok = await confirmAction({
                  title: `Borrar a ${member.name}`,
                  description: 'Esta acción es PERMANENTE y borra todo lo que el usuario creó (tareas, comentarios, time entries). Si solo quieres que pierda acceso, mejor desactívalo.',
                  variant: 'destructive',
                  confirmLabel: 'Borrar permanentemente',
                })
                if (ok) remove.mutate({ userId: member.id })
              }}
              className="text-danger hover:bg-danger-wash"
            >
              <Trash2 className="h-4 w-4" /> Borrar
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DepartmentEditor({
  deptId, existing, members, onClose, onChanged,
}: {
  deptId: string | null
  existing?: { id: string; name: string; color: string; head_user_id: string | null }
  members: Array<{ id: string; name: string }>
  onClose: () => void
  onChanged: () => void
}) {
  const isNew = deptId === null
  const [name, setName] = useState(existing?.name ?? '')
  const [color, setColor] = useState(existing?.color ?? DEPT_COLORS[0])
  const [headUserId, setHeadUserId] = useState(existing?.head_user_id ?? 'none')

  const create = trpc.team.createDepartment.useMutation({
    onSuccess: () => { toast.success('Departamento creado'); onChanged() },
    onError: (e) => toast.error('No se pudo crear', e.message),
  })
  const update = trpc.team.updateDepartment.useMutation({
    onSuccess: () => { toast.success('Departamento actualizado'); onChanged() },
    onError: (e) => toast.error('No se pudo actualizar', e.message),
  })
  const remove = trpc.team.deleteDepartment.useMutation({
    onSuccess: () => { toast.success('Departamento borrado'); onChanged() },
    onError: (e) => toast.error('No se pudo borrar', e.message),
  })

  const save = () => {
    if (!name.trim()) return
    const headValue = headUserId === 'none' ? null : headUserId
    if (isNew) create.mutate({ name: name.trim(), color, headUserId: headValue })
    else update.mutate({ id: deptId!, name: name.trim(), color, headUserId: headValue })
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isNew ? 'Nuevo departamento' : 'Editar departamento'}</DialogTitle></DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Diseño, Desarrollo, …" />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {DEPT_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full transition ${color === c ? 'ring-2 ring-offset-2 ring-graphite' : ''}`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Jefe (opcional)</Label>
            <Select value={headUserId ?? 'none'} onValueChange={setHeadUserId}>
              <SelectTrigger><SelectValue placeholder="Sin jefe asignado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin jefe</SelectItem>
                {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(create.isError || update.isError || remove.isError) && (
            <p className="rounded-lg bg-danger-wash px-3 py-2 text-xs text-danger">
              {(create.error || update.error || remove.error)?.message}
            </p>
          )}
        </div>
        <DialogFooter className="flex justify-between">
          {!isNew ? (
            <Button
              variant="ghost"
              onClick={async () => {
                const ok = await confirmAction({
                  title: `Borrar departamento "${existing?.name}"`,
                  description: 'No se puede deshacer. Si tiene miembros asignados, se rechaza — reasignalos primero.',
                  variant: 'destructive',
                  confirmLabel: 'Borrar',
                })
                if (ok) remove.mutate(deptId!)
              }}
              className="text-danger hover:bg-danger-wash"
            >
              <Trash2 className="h-4 w-4" /> Borrar
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={save} disabled={!name.trim() || create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WorkloadStat({
  label, value, sub, tone = 'slate',
}: {
  label: string
  value: string
  sub?: string | null
  tone?: 'slate' | 'rose' | 'cyan'
}) {
  const colors = {
    slate: 'text-ink-body dark:text-stone',
    rose:  'text-danger dark:text-danger',
    cyan:  'text-night dark:text-signal',
  }[tone]
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-graphite">{label}</p>
      <p className={`text-base font-bold tabular-nums leading-tight ${colors}`}>{value}</p>
      {sub && <p className="text-[10px] text-graphite">{sub}</p>}
    </div>
  )
}
