'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, ChevronRight, Lock } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { useEmpresaFilter } from '@/stores/empresa-filter'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ListSkeleton } from '@/components/ui/skeletons'
import { OVERLOAD_HOURS } from '@/lib/multiempresa'
import { cn } from '@/lib/utils'

const COLS = 'md:grid-cols-[minmax(0,1.4fr)_90px_90px_110px_minmax(0,1fr)]'

export function GrupoView() {
  const router = useRouter()
  const setWorkspaceId = useEmpresaFilter(s => s.setWorkspaceId)
  const { data, isLoading, error } = trpc.group.overview.useQuery(undefined, { retry: false })
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })

  if (isLoading) return <ListSkeleton rows={5} />

  if (error) {
    if (error.data?.code === 'FORBIDDEN') {
      return (
        <div className="rounded-[14px] border border-border bg-surface p-6">
          <p className="mb-1.5 flex items-center gap-2 font-display text-lg font-bold text-foreground">
            <Lock className="h-4 w-4 text-graphite" /> La vista de grupo es para Dirección.
          </p>
          <p className="text-sm text-graphite">Con tu permiso ves tus empresas en Proyectos y Personas.</p>
        </div>
      )
    }
    return <EmptyState icon={Building2} title="No se pudo cargar el grupo" description={error.message} />
  }

  if (!data || data.empresas.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Aún no hay empresas en el grupo"
        description="Crea las empresas del grupo para ver aquí proyectos activos, atrasos y quién las gestiona."
      />
    )
  }

  const open = (id: string) => {
    setWorkspaceId(id)
    router.push('/dashboard/projects')
  }

  return (
    <div className="space-y-4">
      {/* Hero Noche: the cross-company insight no single empresa can see */}
      <div className="flex flex-wrap items-center gap-4 rounded-[20px] bg-night px-5 py-5 text-mist md:rounded-2xl md:px-[22px]">
        <div className="min-w-[240px] flex-1">
          <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-signal">
            {me?.groupName ? `${me.groupName} · ` : ''}esta semana
          </p>
          <p className="font-display text-2xl font-extrabold leading-[1.15] tracking-[-0.03em]">
            {data.insight ?? `Nadie supera las ${OVERLOAD_HOURS} h entre empresas esta semana.`}
          </p>
        </div>
        <Link href="/dashboard/personas" className={cn(buttonVariants({ variant: 'signal' }), 'h-12 w-full shrink-0 text-[15px] md:h-9 md:w-auto md:text-sm')}>
          Ver personas
        </Link>
      </div>

      {data.overloaded.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-graphite">Sobre {OVERLOAD_HOURS} h:</span>
          {data.overloaded.map(p => (
            <span key={p.id} className="rounded-full bg-danger-wash px-2.5 py-1 font-medium text-danger dark:bg-danger/15">
              {p.name.split(' ')[0]} · <span className="font-mono">{p.hours} h</span> · {p.empresas} emp.
            </span>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
        <div className={cn('hidden gap-3 border-b border-border px-[18px] py-3 font-mono text-[11px] uppercase tracking-[0.06em] text-graphite md:grid', COLS)}>
          <span>Empresa</span><span>Activos</span><span>Atrasados</span><span>Tareas vencidas</span><span>Gerente</span>
        </div>
        {data.empresas.map(e => {
          const managers = Array.from(new Set(e.managers))
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => open(e.id)}
              className={cn(
                'relative grid w-full grid-cols-3 items-center gap-x-3 gap-y-2.5 border-b border-border-soft px-4 py-4 pr-10 text-left text-sm transition-colors last:border-b-0 active:bg-border-soft hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal md:px-[18px] md:py-3.5 md:pr-[18px]',
                COLS,
              )}
            >
              <ChevronRight className="absolute right-3 top-5 h-4 w-4 text-graphite/60 md:hidden" aria-hidden />
              <span className="col-span-3 flex min-w-0 items-center gap-2 text-[16px] font-semibold text-foreground md:col-span-1 md:text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.color }} />
                <span className="truncate">{e.name}</span>
              </span>
              <Stat label="Activos" value={e.active} />
              <Stat label="Atrasados" value={e.late} danger={e.late > 0} />
              <Stat label="Vencidas" value={e.overdueTasks} danger={e.overdueTasks > 0} />
              <span className="col-span-3 truncate text-[13px] text-body md:col-span-1 md:text-sm">
                {managers.length ? managers.join(' · ') : '—'}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-[13px] text-graphite">Toca una empresa para ver sus proyectos.</p>
    </div>
  )
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <span className="flex flex-col md:block">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-graphite md:hidden">{label}</span>
      <span className={cn('font-mono text-[17px] tabular-nums md:text-sm', danger ? 'text-danger' : 'text-foreground')}>{value}</span>
    </span>
  )
}
