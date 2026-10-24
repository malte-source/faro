'use client'

import { useState } from 'react'
import { Building2, Check, Plus, Sparkles, User } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { toast } from '@/components/ui/toaster'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'

/** Switch the active grupo/workspace. Writes the same cookie as the desktop switcher, then lands on /dashboard. */
export function switchWorkspace(orgId: string) {
  document.cookie = `faro:active_org=${encodeURIComponent(orgId)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
  window.location.href = '/dashboard'
}

const ROLE_LABEL: Record<string, string> = { owner: 'Propietario', admin: 'Administrador', member: 'Miembro' }

/** Bottom-sheet version of the workspace switcher — the phone had no way to change workspace at all. */
export function WorkspaceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: orgs } = trpc.orgs.mine.useQuery(undefined, { enabled: open })
  const { data: active } = trpc.orgs.active.useQuery(undefined, { enabled: open })
  const [creating, setCreating] = useState(false)

  const createTeam = trpc.orgs.createTeam.useMutation({
    onSuccess: org => switchWorkspace(org.id),
    onError: e => { setCreating(false); toast.error('No se pudo crear el workspace', e.message) },
  })
  const createPersonal = trpc.orgs.createPersonal.useMutation({
    onSuccess: org => switchWorkspace(org.id),
    onError: e => { setCreating(false); toast.error('No se pudo crear el workspace', e.message) },
  })

  const create = (kind: 'personal' | 'team') => {
    const name = window.prompt(kind === 'personal' ? 'Nombre del workspace personal (ej. "Casa")' : 'Nombre del workspace de equipo')
    if (!name?.trim()) return
    setCreating(true)
    if (kind === 'personal') createPersonal.mutate({ name: name.trim() })
    else createTeam.mutate({ name: name.trim() })
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Espacio de trabajo" description="Cambia de grupo o de workspace personal.">
      <div className="space-y-5 pb-2 pt-2">
        <InsetGroup>
          {(orgs ?? []).map(o => {
            const isActive = o.id === active?.id
            const personal = o.workspace_type === 'personal'
            return (
              <ListRow
                key={o.id}
                onClick={() => (isActive ? onClose() : switchWorkspace(o.id))}
                leading={<IconTile tone={personal ? 'signal' : 'night'}>{personal ? <User /> : <Building2 />}</IconTile>}
                title={o.name}
                subtitle={`${personal ? 'Personal' : 'Equipo'} · ${ROLE_LABEL[o.role] ?? o.role}`}
                trailing={isActive ? <Check className="h-5 w-5 text-signal-ink" /> : undefined}
                selected={isActive}
              />
            )
          })}
          {!orgs && <div className="h-14 animate-pulse bg-border-soft" />}
        </InsetGroup>
        <InsetGroup>
          <ListRow onClick={() => create('team')} disabled={creating} leading={<IconTile tone="neutral"><Sparkles /></IconTile>} title="Crear workspace de equipo" />
          <ListRow onClick={() => create('personal')} disabled={creating} leading={<IconTile tone="neutral"><Plus /></IconTile>} title="Crear workspace personal" />
        </InsetGroup>
      </div>
    </BottomSheet>
  )
}
