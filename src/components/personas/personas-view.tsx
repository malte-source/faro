'use client'

import { useMemo, useState } from 'react'
import { Pencil, Users2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { useEmpresaFilter } from '@/stores/empresa-filter'
import { EmpresaChips } from '@/components/layout/empresa-chips'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'
import { HoursBar, type HoursSegment } from '@/components/personas/hours-bar'
import { SombreroEditor, type EditablePerson } from '@/components/personas/sombrero-editor'

function initials(name: string) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

export function PersonasView() {
  const workspaceId = useEmpresaFilter(s => s.workspaceId)
  const { data, isLoading, error } = trpc.membership.list.useQuery(workspaceId ? { workspaceId } : undefined)
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const [editing, setEditing] = useState<string | null>(null)

  // Empresas where the viewer can change cargos: all for Dirección, otherwise
  // the ones where they are owner/admin. The server re-checks on every write.
  const manageable = useMemo(() => {
    if (!me) return []
    if (me.isDirection) return me.empresas
    const adminIn = new Set(me.memberships.filter(m => m.role === 'owner' || m.role === 'admin').map(m => m.workspaceId))
    return me.empresas.filter(e => adminIn.has(e.id))
  }, [me])

  const empresaById = useMemo(() => new Map((data?.empresas ?? []).map(e => [e.id, e])), [data])
  const editingPerson = data?.people.find(p => p.id === editing) ?? null

  return (
    <div className="space-y-4">
      <EmpresaChips />

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : error ? (
        <EmptyState icon={Users2} title="No se pudo cargar la lista" description={error.message} />
      ) : !data?.people.length ? (
        <EmptyState
          icon={Users2}
          title="Nadie por aquí todavía"
          description={workspaceId ? 'Nadie tiene cargo en esta empresa. Prueba con "Todo".' : 'Invita a tu equipo desde Equipo y luego asígnales un cargo en cada empresa.'}
        />
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
          {data.people.map(p => {
            const segments: HoursSegment[] = Object.entries(p.hoursByWorkspace)
              .map(([id, hours]) => {
                const e = empresaById.get(id)
                return { workspaceId: id, name: e?.name ?? 'Empresa', color: e?.color ?? '#55636B', hours }
              })
              .sort((a, b) => b.hours - a.hours)
            const n = p.memberships.length
            const canEdit = manageable.length > 0
            return (
              <div
                key={p.id}
                className="grid gap-3 border-b border-border-soft px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(150px,200px)_minmax(0,1.3fr)_minmax(160px,1fr)_auto] md:items-center md:gap-4 md:px-5"
              >
                <div className="flex min-w-0 items-center gap-3 md:gap-2.5">
                  <Avatar className="h-11 w-11 md:h-[34px] md:w-[34px]">
                    <AvatarImage src={p.avatarUrl ?? undefined} alt="" />
                    <AvatarFallback>{initials(p.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-semibold text-foreground md:text-sm">{p.name}</p>
                    <p className="text-[13px] text-graphite md:text-xs">{n === 1 ? '1 empresa' : `${n} empresas`}</p>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditing(p.id)}
                      aria-label={`Editar sombreros de ${p.name}`}
                      className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-graphite active:bg-border-soft md:hidden"
                    >
                      <Pencil className="h-[18px] w-[18px]" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {p.memberships.length === 0 ? (
                    <span className="text-xs text-graphite">Sin cargo asignado</span>
                  ) : (
                    p.memberships.map(m => (
                      <span
                        key={m.workspaceId}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-foreground"
                      >
                        <span className="h-[7px] w-[7px] rounded-full" style={{ background: m.workspaceColor }} />
                        {m.workspaceName} · <span className="text-graphite">{m.position}</span>
                      </span>
                    ))
                  )}
                </div>

                <HoursBar segments={segments} total={p.totalHours} />

                <div className="hidden md:block md:w-9">
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(p.id)}
                      aria-label={`Editar sombreros de ${p.name}`}
                      title="Editar sombreros"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[13px] text-graphite">
        La barra suma las horas de todas las empresas, con el color de cada una. 40 h = 100%.
      </p>

      {editingPerson && (
        <SombreroEditor
          person={editingPerson as EditablePerson}
          manageable={manageable}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
