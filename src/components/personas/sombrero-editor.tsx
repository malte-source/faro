'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldSelect } from '@/components/personas/field-select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'

export const SOMBRERO_ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  manager: 'Gerente',
  member: 'Miembro',
  viewer: 'Solo lectura',
  guest: 'Invitado',
}
const ROLE_OPTIONS = ['admin', 'manager', 'member', 'viewer', 'guest'] as const
type SombreroRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'guest'

export interface EditablePerson {
  id: string
  name: string
  memberships: Array<{ workspaceId: string; position: string; role: string; workspaceName: string; workspaceColor: string }>
}

export interface ManageableEmpresa {
  id: string
  name: string
  color: string
}

function RoleSelect({ value, onChange }: { value: string; onChange: (v: SombreroRole) => void }) {
  // Owners keep their label visible even though it can't be picked from the list.
  const options = value === 'owner' ? (['owner', ...ROLE_OPTIONS] as const) : ROLE_OPTIONS
  return (
    <FieldSelect
      value={value}
      onChange={v => onChange(v as SombreroRole)}
      options={options.map(r => ({ value: r, label: SOMBRERO_ROLE_LABELS[r] }))}
    />
  )
}

/** One existing sombrero: edit cargo and permiso, or take it off. */
function SombreroRow({
  person, hat, onDone,
}: {
  person: EditablePerson
  hat: EditablePerson['memberships'][number]
  onDone: () => void
}) {
  const [position, setPosition] = useState(hat.position)
  const [role, setRole] = useState<string>(hat.role)
  const [error, setError] = useState<string | null>(null)

  const save = trpc.membership.upsert.useMutation({
    onSuccess: () => { toast.success('Sombrero actualizado'); onDone() },
    onError: e => { setError(e.message); toast.error('No se pudo guardar', e.message) },
  })
  const remove = trpc.membership.deactivate.useMutation({
    onSuccess: () => { toast.success('Sombrero quitado'); onDone() },
    onError: e => { setError(e.message); toast.error('No se pudo quitar', e.message) },
  })
  const dirty = position.trim() !== hat.position || role !== hat.role

  return (
    <div className="rounded-[14px] border border-border bg-surface p-3.5 md:rounded-xl md:bg-transparent md:p-3">
      <div className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold text-foreground md:mb-2 md:text-sm">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: hat.workspaceColor }} />
        {hat.workspaceName}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Cargo</Label>
          <Input value={position} onChange={e => { setPosition(e.target.value); setError(null) }} maxLength={80} />
        </div>
        <div className="space-y-1">
          <Label>Permiso</Label>
          <RoleSelect value={role} onChange={setRole} />
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={remove.isPending}
          onClick={() => { setError(null); remove.mutate({ userId: person.id, workspaceId: hat.workspaceId }) }}
          className="h-11 text-danger hover:text-danger md:h-8"
        >
          <Trash2 className="h-3.5 w-3.5" /> Quitar de {hat.workspaceName}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-11 px-5 md:h-8 md:px-3"
          disabled={!dirty || !position.trim() || save.isPending}
          onClick={() => {
            setError(null)
            save.mutate({ userId: person.id, workspaceId: hat.workspaceId, position: position.trim(), role: role as SombreroRole })
          }}
        >
          {save.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </div>
  )
}

/**
 * Sombreros of one person: edit the ones in empresas the viewer can manage and
 * add new ones. Server enforces the real permission (Dirección or admin of the
 * empresa) and its message is shown as-is when it refuses.
 */
export function SombreroEditor({
  person, manageable, onClose,
}: {
  person: EditablePerson
  manageable: ManageableEmpresa[]
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const manageableIds = new Set(manageable.map(e => e.id))
  const editable = person.memberships.filter(m => manageableIds.has(m.workspaceId))
  const taken = new Set(person.memberships.map(m => m.workspaceId))
  const available = manageable.filter(e => !taken.has(e.id))

  const [workspaceId, setWorkspaceId] = useState('')
  const [position, setPosition] = useState('')
  const [role, setRole] = useState<SombreroRole>('member')
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    void utils.membership.list.invalidate()
    void utils.membership.directory.invalidate()
    void utils.membership.me.invalidate()
    void utils.group.overview.invalidate()
  }

  const add = trpc.membership.upsert.useMutation({
    onSuccess: () => {
      toast.success('Sombrero agregado')
      setWorkspaceId(''); setPosition(''); setRole('member'); setError(null)
      refresh()
    },
    onError: e => { setError(e.message); toast.error('No se pudo agregar', e.message) },
  })

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Sombreros de {person.name}</DialogTitle>
          <DialogDescription>
            El cargo y el permiso de la persona en cada empresa. La persona sigue teniendo un solo login y una sola bandeja.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-6 pb-6">
          {editable.length === 0 && (
            <p className="text-sm text-graphite">Esta persona aún no tiene cargo en tus empresas.</p>
          )}
          {editable.map(hat => (
            <SombreroRow key={`${hat.workspaceId}:${hat.position}:${hat.role}`} person={person} hat={hat} onDone={refresh} />
          ))}

          {available.length > 0 && (
            <div className="rounded-[14px] border border-dashed border-border p-3.5 md:rounded-xl md:p-3">
              <p className="mb-2.5 flex items-center gap-1.5 text-[15px] font-semibold text-foreground md:mb-2 md:text-sm">
                <Plus className="h-3.5 w-3.5" /> Agregar a otra empresa
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Empresa</Label>
                  <FieldSelect
                    value={workspaceId}
                    onChange={v => { setWorkspaceId(v); setError(null) }}
                    placeholder="Elige…"
                    options={available.map(e => ({ value: e.id, label: e.name }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Cargo</Label>
                  <Input value={position} onChange={e => setPosition(e.target.value)} maxLength={80} placeholder="Administración" />
                </div>
                <div className="space-y-1">
                  <Label>Permiso</Label>
                  <RoleSelect value={role} onChange={setRole} />
                </div>
              </div>
              {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="h-11 px-5 md:h-8 md:px-3"
                  disabled={!workspaceId || !position.trim() || add.isPending}
                  onClick={() => { setError(null); add.mutate({ userId: person.id, workspaceId, position: position.trim(), role }) }}
                >
                  {add.isPending ? 'Agregando…' : 'Agregar'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
