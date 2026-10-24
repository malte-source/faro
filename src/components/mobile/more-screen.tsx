'use client'

import { useState } from 'react'
import { signOutAndClear } from '@/lib/sign-out'
import { useTheme } from 'next-themes'
import {
  Activity, BarChart3, Building2, CalendarDays, CalendarRange, Gauge, GanttChartSquare, ClipboardList, FileText,
  Flame, Kanban, Landmark, LogOut, Map as MapIcon, MessagesSquare, Network, Repeat, Rocket, Scale, Settings, Target,
  Users, Zap, Grid3x3, Sparkles, ChevronsUpDown, Inbox, BellRing, Gauge as GaugeIcon,
} from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'
import { Segmented } from '@/components/mobile/segmented'
import { WorkspaceSheet } from '@/components/mobile/workspace-sheet'
import { OutboxChip } from '@/components/mobile/outbox-chip'
import { InstallCard } from '@/components/pwa/install-coach'

type Row = { href: string; label: string; sub?: string; icon: typeof Users; tone?: 'night' | 'signal' | 'success' | 'info' | 'neutral'; badge?: number; direction?: boolean; team?: boolean }

const PLAN: Row[] = [
  { href: '/dashboard/goals', label: 'Objetivos', sub: 'OKRs y el para qué', icon: Target, tone: 'info' },
  { href: '/dashboard/sprints', label: 'Sprints', icon: Rocket, tone: 'info' },
  { href: '/dashboard/decisions', label: 'Decisiones', icon: Scale, tone: 'info' },
  { href: '/dashboard/recurring', label: 'Tareas recurrentes', icon: Repeat, tone: 'info' },
  { href: '/dashboard/automations', label: 'Automatizaciones', icon: Zap, tone: 'info' },
  { href: '/dashboard/forms', label: 'Formularios', sub: 'Pedidos de clientes y equipo', icon: ClipboardList, tone: 'info' },
]
const VIEWS: Row[] = [
  { href: '/dashboard/calendar', label: 'Calendario', icon: CalendarDays, tone: 'neutral' },
  { href: '/dashboard/week', label: 'Semana', icon: CalendarRange, tone: 'neutral' },
  { href: '/dashboard/month', label: 'Mes', icon: Grid3x3, tone: 'neutral' },
  { href: '/dashboard/kanban', label: 'Kanban', icon: Kanban, tone: 'neutral' },
  { href: '/dashboard/gantt', label: 'Gantt', icon: GanttChartSquare, tone: 'neutral' },
  { href: '/dashboard/roadmap', label: 'Roadmap', icon: MapIcon, tone: 'neutral' },
  { href: '/dashboard/priorities', label: 'Prioridades', sub: 'Lo más urgente del equipo', icon: Flame, tone: 'neutral' },
]
const ANALYSIS: Row[] = [
  { href: '/dashboard/reports', label: 'Reportes', icon: BarChart3, tone: 'success' },
  { href: '/dashboard/activity', label: 'Actividad', icon: Activity, tone: 'success' },
  { href: '/dashboard/capacity', label: 'Capacidad', icon: Gauge, tone: 'success' },
]

/** "Más": the iOS-Settings-style home for everything that isn't on a tab. */
export function MoreScreen() {
  const [spaceOpen, setSpaceOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const { data: team } = trpc.team.me.useQuery(undefined, { staleTime: 60_000 })
  const { data: active } = trpc.orgs.active.useQuery(undefined, { staleTime: 60_000 })
  const { data: chat } = trpc.chat.unreadTotal.useQuery(undefined, { enabled: !!me?.isTeam, retry: false, staleTime: 10_000 })

  const groupMode = me?.groupMode ?? false
  const isDirection = me?.isDirection ?? false
  const name = team?.name ?? me?.user.name ?? ''
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()

  const work: Row[] = [
    { href: '/dashboard/bandeja', label: 'Bandeja', sub: 'Menciones, asignaciones y aprobaciones', icon: Inbox, tone: 'signal' as const },
    ...(groupMode
      ? [
          { href: '/dashboard/personas', label: 'Personas', sub: 'Quién trabaja dónde y con qué carga', icon: Users, tone: 'signal' as const },
          { href: '/dashboard/documentos', label: 'Documentos', sub: 'Políticas, manuales, SOPs y actas', icon: FileText, tone: 'signal' as const },
          { href: '/dashboard/capturar', label: 'Capturar', sub: 'Audio, video, foto o texto → tareas', icon: Sparkles, tone: 'signal' as const },
          { href: '/dashboard/tasks', label: 'Todas las tareas', icon: ClipboardList, tone: 'signal' as const },
          ...(isDirection
            ? [
                { href: '/dashboard/grupo', label: 'Grupo', sub: 'Vista de Dirección', icon: Building2, tone: 'night' as const },
                { href: '/dashboard/costos', label: 'Costos', sub: 'Reparto del holding a las filiales', icon: Landmark, tone: 'night' as const },
              ]
            : []),
        ]
      : [
          { href: '/dashboard/hoy', label: 'Mi día', sub: 'Solo lo tuyo de hoy', icon: CalendarDays, tone: 'signal' as const },
          ...(me?.isTeam ? [{ href: '/dashboard/chat', label: 'Chat', sub: 'Canales y mensajes directos', icon: MessagesSquare, tone: 'signal' as const, badge: chat?.total }] : []),
          { href: '/dashboard/team', label: 'Equipo', sub: 'Miembros, departamentos y organigrama', icon: Network, tone: 'signal' as const },
          { href: '/dashboard/documentos', label: 'Documentos', sub: 'Políticas, manuales, SOPs y actas', icon: FileText, tone: 'signal' as const },
        ]),
  ]
  if (groupMode) work.push({ href: '/dashboard/team', label: 'Equipo y organigrama', icon: Network, tone: 'neutral' })

  const renderRows = (rows: Row[]) =>
    rows.map(r => (
      <ListRow
        key={r.href}
        href={r.href}
        leading={<IconTile tone={r.tone ?? 'neutral'}><r.icon /></IconTile>}
        title={r.label}
        subtitle={r.sub}
        trailing={r.badge ? <span className="rounded-full bg-signal px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-night">{r.badge}</span> : undefined}
      />
    ))

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 pb-8 pt-2">
      {/* Identity card + workspace */}
      <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
        <div className="flex items-center gap-3.5 p-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-night text-lg font-bold text-mist dark:bg-signal dark:text-night">
            {team?.avatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={team.avatar} alt="" className="h-full w-full object-cover" />
              : initials}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-extrabold tracking-[-0.03em] text-foreground">{name}</p>
            <p className="truncate text-[13px] text-graphite">{team?.email}</p>
            {groupMode && <p className="mt-0.5 text-xs font-medium text-signal-ink">{isDirection ? 'Dirección del grupo' : `${me?.memberships.length ?? 0} ${me?.memberships.length === 1 ? 'sombrero' : 'sombreros'}`}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSpaceOpen(true)}
          className="flex w-full items-center gap-3 border-t border-border-soft px-4 py-3 text-left active:bg-border-soft"
        >
          <IconTile tone="night"><Building2 /></IconTile>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium uppercase tracking-[0.1em] text-graphite">Espacio de trabajo</span>
            <span className="block truncate text-[15px] font-semibold text-foreground">{active?.name ?? '…'}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-graphite" />
        </button>
      </div>

      {groupMode && !!me?.memberships.length && (
        <InsetGroup label="Mis sombreros">
          {me.memberships.map(m => (
            <ListRow
              key={m.workspaceId}
              leading={<span className="h-3 w-3 rounded-full" style={{ background: m.color }} />}
              title={m.name}
              subtitle={m.position}
            />
          ))}
        </InsetGroup>
      )}

      <InsetGroup label="Trabajo">{renderRows(work)}</InsetGroup>
      <InsetGroup label="Vistas">{renderRows(VIEWS)}</InsetGroup>
      <InsetGroup label="Planificación">{renderRows(PLAN)}</InsetGroup>
      <InsetGroup label="Análisis">
        {renderRows(ANALYSIS)}
        <ListRow
          href="/dashboard/ia"
          leading={<IconTile tone="success"><GaugeIcon /></IconTile>}
          title="Uso de IA"
          subtitle={isDirection ? 'Gasto del mes y presupuesto del grupo' : 'Tu uso del mes'}
        />
      </InsetGroup>

      <InsetGroup label="Apariencia">
        <div className="p-3">
          <Segmented
            aria-label="Tema"
            value={(theme as 'system' | 'light' | 'dark') ?? 'system'}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'Sistema' },
              { value: 'light', label: 'Claro' },
              { value: 'dark', label: 'Oscuro' },
            ]}
          />
        </div>
      </InsetGroup>

      <InstallCard />
      <OutboxChip />

      <InsetGroup>
        <ListRow href="/dashboard/ajustes-avisos" leading={<IconTile tone="signal"><BellRing /></IconTile>} title="Avisos" subtitle="Push, tipos de aviso y horas de silencio" />
        <ListRow href="/dashboard/settings" leading={<IconTile tone="neutral"><Settings /></IconTile>} title="Configuración" />
        <ListRow onClick={() => void signOutAndClear()} leading={<IconTile tone="danger"><LogOut /></IconTile>} title="Cerrar sesión" destructive />
      </InsetGroup>

      <WorkspaceSheet open={spaceOpen} onClose={() => setSpaceOpen(false)} />
    </div>
  )
}
