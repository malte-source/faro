'use client'

import { useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { GridSkeleton } from '@/components/ui/skeletons'
import { EmptyState } from '@/components/ui/empty-state'
import { Users2, ChevronRight, ChevronDown, GitBranch } from 'lucide-react'

/**
 * Org chart — renders the "capas" framework: every person belongs to one
 * corporate layer (gobierno/coe/sso/filial), has one SOLID line (hierarchy,
 * reports_to_user_id) and optionally one DOTTED line (functional, a CoE
 * that audits their standard, dotted_line_to_user_id).
 *
 * Rendered as an indented tree by solid line (who evaluates whom), grouped
 * by layer with a color chip, and dotted-line relationships shown as a
 * secondary badge on each node rather than a second tree — two full trees
 * side by side would be harder to read than one tree with an annotation.
 */

type Member = {
  id: string
  name: string
  email: string
  avatar_url: string | null
  position: string | null
  role_code: string | null
  corporate_layer: 'gobierno' | 'coe' | 'sso' | 'filial' | null
  reports_to_user_id: string | null
  dotted_line_to_user_id: string | null
  kpi_description: string | null
}

const LAYER_META: Record<string, { label: string; badge: 'night' | 'success' | 'warning' | 'default'; hint: string }> = {
  gobierno: { label: 'Gobierno', badge: 'night', hint: 'Manda sobre las filiales' },
  coe: { label: 'Centro de Excelencia', badge: 'warning', hint: 'Fija el estándar, veto sobre la forma' },
  sso: { label: 'Servicios Compartidos', badge: 'default', hint: 'Ejecuta por pedido, SLA' },
  filial: { label: 'Filial Operativa', badge: 'success', hint: 'P&L y margen propio' },
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

function MemberNode({
  member,
  byId,
  childrenOf,
  depth,
}: {
  member: Member
  byId: Map<string, Member>
  childrenOf: Map<string, Member[]>
  depth: number
}) {
  const [expanded, setExpanded] = useState(true)
  const kids = childrenOf.get(member.id) ?? []
  const dottedTo = member.dotted_line_to_user_id ? byId.get(member.dotted_line_to_user_id) : null
  const layer = member.corporate_layer ? LAYER_META[member.corporate_layer] : null

  return (
    <div className={depth > 0 ? 'ml-3 border-l border-border pl-2.5 md:ml-6 md:pl-4' : ''}>
      <div className="mb-2 flex items-start gap-2.5 rounded-[14px] border border-border bg-surface p-3 md:rounded-lg md:p-2.5">
        {kids.length > 0 ? (
          <button
            onClick={() => setExpanded(v => !v)}
            className="-my-1.5 -ml-1.5 flex h-11 w-8 shrink-0 items-start justify-center pt-3 text-graphite active:text-foreground md:m-0 md:mt-1 md:h-auto md:w-auto md:p-0 md:hover:text-foreground"
            aria-label={expanded ? 'Contraer' : 'Expandir'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={member.avatar_url ?? undefined} />
          <AvatarFallback>{initials(member.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">{member.name}</span>
            {member.role_code && (
              <span className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[10px] text-graphite">{member.role_code}</span>
            )}
            {layer && <Badge variant={layer.badge}>{layer.label}</Badge>}
          </div>
          {member.position && <p className="text-xs text-graphite">{member.position}</p>}
          {member.kpi_description && (
            <p className="mt-1 text-[11px] text-signal-ink">KPI: {member.kpi_description}</p>
          )}
          {dottedTo && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-graphite">
              <GitBranch className="h-3 w-3" />
              línea punteada → {dottedTo.name}
            </p>
          )}
        </div>
      </div>
      {expanded && kids.map(k => (
        <MemberNode key={k.id} member={k} byId={byId} childrenOf={childrenOf} depth={depth + 1} />
      ))}
    </div>
  )
}

export function OrgChart() {
  const { data: members, isLoading } = trpc.team.orgChart.useQuery()
  const [layerFilter, setLayerFilter] = useState<string | null>(null)

  const { byId, childrenOf, roots } = useMemo(() => {
    const byId = new Map<string, Member>()
    const childrenOf = new Map<string, Member[]>()
    const roots: Member[] = []
    for (const m of (members ?? []) as Member[]) byId.set(m.id, m)
    for (const m of (members ?? []) as Member[]) {
      if (m.reports_to_user_id && byId.has(m.reports_to_user_id)) {
        const list = childrenOf.get(m.reports_to_user_id) ?? []
        list.push(m)
        childrenOf.set(m.reports_to_user_id, list)
      } else {
        roots.push(m)
      }
    }
    return { byId, childrenOf, roots }
  }, [members])

  if (isLoading) return <GridSkeleton rows={4} cols={1} />

  if (!members?.length) {
    return (
      <EmptyState
        icon={Users2}
        title="Sin estructura cargada todavía"
        description="Asigna código de rol, capa corporativa y línea de reporte a cada miembro desde su editor para que aparezca aquí."
      />
    )
  }

  const visibleRoots = layerFilter ? roots.filter(r => r.corporate_layer === layerFilter) : roots

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden" data-no-track data-no-ptr>
        <button
          onClick={() => setLayerFilter(null)}
          className={`h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors md:h-auto md:py-1 md:text-xs ${!layerFilter ? 'bg-night text-mist dark:bg-signal dark:text-night' : 'bg-border-soft text-graphite hover:bg-border'}`}
        >
          Todas las capas
        </button>
        {Object.entries(LAYER_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setLayerFilter(v => v === key ? null : key)}
            title={meta.hint}
            className={`h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors md:h-auto md:py-1 md:text-xs ${layerFilter === key ? 'bg-night text-mist dark:bg-signal dark:text-night' : 'bg-border-soft text-graphite hover:bg-border'}`}
          >
            {meta.label}
          </button>
        ))}
      </div>

      <div>
        {visibleRoots.length === 0 ? (
          <p className="text-sm text-graphite">Nadie en esta capa reporta directamente — prueba «Todas las capas».</p>
        ) : (
          visibleRoots.map(r => (
            <MemberNode key={r.id} member={r} byId={byId} childrenOf={childrenOf} depth={0} />
          ))
        )}
      </div>

      <p className="text-[11px] text-graphite">
        Línea sólida = jerarquía (anidado arriba). Línea punteada = reporte funcional a un Centro de Excelencia (anotado en cada tarjeta).
      </p>
    </div>
  )
}
