'use client'

import { useState, type ReactNode } from 'react'
import { Check, FileDown, HeartPulse, MoreHorizontal, Share2, Trash2, ChevronDown } from 'lucide-react'
import { MobileNavBar } from '@/components/mobile/nav-bar'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'
import { ProjectChatButton } from '@/components/chat/project-chat-button'
import { DueDateChip } from '@/components/ui/due-date-chip'
import { HealthChip } from '@/components/ui/health-chip'
import { haptic } from '@/components/mobile/haptics'
import { PROJECT_STATUS, PRIORITY, KANBAN_STAGES, cn } from '@/lib/utils'
import type { KanbanStage, ProjectStatus } from '@/types/database'

export interface MobileProjectData {
  id: string
  name: string
  code: string
  color: string
  status: string
  priority: string
  progress_pct: number
  health_score: number | null
  end_date: string | null
  kanban_stage?: string
  department: { name: string; color: string } | null
}

export interface MobileTabDef { id: string; label: string; icon: ReactNode }

function statusTone(status: string): string {
  switch (status) {
    case 'in_progress': return 'bg-info/10 text-info'
    case 'delayed': case 'on_hold': return 'bg-signal-wash text-signal-ink dark:bg-signal/15'
    case 'completed': return 'bg-success-wash text-success dark:bg-success/15'
    case 'canceled': return 'bg-danger-wash text-danger dark:bg-danger/15'
    default: return 'bg-border-soft text-graphite'
  }
}

/**
 * Phone header for a project: iOS large-title nav bar (Back + name), then a
 * summary card — status and stage are tappable chips that open a sheet,
 * progress, due date and health. Secondary actions live in an "Acciones" sheet.
 */
export function ProjectMobileTop({
  project, onStatus, onStage, onShare, onDelete, onRecalcHealth, recalcBusy,
}: {
  project: MobileProjectData
  onStatus: (s: ProjectStatus) => void
  onStage: (s: KanbanStage) => void
  onShare: () => void
  onDelete: () => void
  onRecalcHealth: () => void
  recalcBusy: boolean
}) {
  const [stateOpen, setStateOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const status = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
  const priority = PRIORITY[project.priority as keyof typeof PRIORITY]
  const stage = project.kanban_stage ?? 'backlog'
  const stageLabel = KANBAN_STAGES.find(s => s.id === stage)?.label ?? 'Backlog'
  const isDone = project.status === 'completed' || project.status === 'canceled'

  return (
    <div className="md:hidden">
      <MobileNavBar
        title={project.name}
        actions={
          <>
            <ProjectChatButton projectId={project.id} className="h-9 rounded-full border-border px-3.5 text-[13px]" />
            <button
              type="button"
              onClick={() => setActionsOpen(true)}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-medium text-foreground active:bg-border-soft"
            >
              <MoreHorizontal className="h-4 w-4" /> Acciones
            </button>
          </>
        }
      />

      <div className="px-4 pt-1">
        <div className="rounded-[14px] border border-border bg-surface p-3.5">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">{project.code}</span>
            {project.department && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${project.department.color}22`, color: project.department.color }}>
                {project.department.name}
              </span>
            )}
            <span className={cn('ml-auto text-xs font-medium', priority?.color)}>{priority?.label}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { haptic(); setStateOpen(true) }}
              className={cn('inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-semibold active:opacity-80', statusTone(project.status))}
              aria-label={`Estado: ${status?.label}. Toca para cambiar`}
            >
              {status?.label}
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>
            <button
              type="button"
              onClick={() => { haptic(); setStateOpen(true) }}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-border px-3 text-[13px] text-graphite active:bg-border-soft"
              aria-label={`Etapa: ${stageLabel}. Toca para cambiar`}
            >
              {stageLabel}
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>
          </div>

          <div className="mt-3.5 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-border-soft">
              <div className="h-full rounded-full bg-signal transition-all duration-500" style={{ width: `${project.progress_pct}%` }} />
            </div>
            <span className="text-sm font-bold tabular-nums text-foreground">{project.progress_pct}%</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" onClick={onRecalcHealth} disabled={recalcBusy} aria-label="Recalcular salud del proyecto" className="active:opacity-70 disabled:opacity-40">
              <HealthChip score={project.health_score} variant="full" />
            </button>
            {project.end_date && <DueDateChip date={project.end_date} isDone={isDone} />}
          </div>
        </div>
      </div>

      <BottomSheet open={stateOpen} onClose={() => setStateOpen(false)} title="Estado y etapa" description="Estado = lo que reportas. Etapa = dónde está en el flujo.">
        <div className="space-y-5 pb-3 pt-2">
          <InsetGroup label="Estado">
            {Object.entries(PROJECT_STATUS).map(([value, { label }]) => (
              <ListRow
                key={value}
                title={label}
                selected={project.status === value}
                trailing={project.status === value ? <Check className="h-5 w-5 text-signal-ink" /> : undefined}
                onClick={() => { haptic(); onStatus(value as ProjectStatus) }}
              />
            ))}
          </InsetGroup>
          <InsetGroup label="Etapa del workflow">
            {KANBAN_STAGES.map(s => (
              <ListRow
                key={s.id}
                title={s.label}
                selected={stage === s.id}
                trailing={stage === s.id ? <Check className="h-5 w-5 text-signal-ink" /> : undefined}
                onClick={() => { haptic(); onStage(s.id as KanbanStage) }}
              />
            ))}
          </InsetGroup>
        </div>
      </BottomSheet>

      <BottomSheet open={actionsOpen} onClose={() => setActionsOpen(false)} title="Acciones del proyecto">
        <div className="space-y-5 pb-3 pt-2">
          <InsetGroup>
            <ListRow
              title="Compartir con cliente"
              subtitle="Link público de solo lectura"
              leading={<IconTile tone="signal"><Share2 /></IconTile>}
              onClick={() => { setActionsOpen(false); onShare() }}
            />
            <ListRow
              title="Exportar reporte PDF"
              href={`/dashboard/projects/${project.id}/print`}
              leading={<IconTile tone="neutral"><FileDown /></IconTile>}
            />
            <ListRow
              title="Recalcular salud"
              leading={<IconTile tone="success"><HeartPulse /></IconTile>}
              onClick={() => { setActionsOpen(false); onRecalcHealth() }}
            />
          </InsetGroup>
          <InsetGroup>
            <ListRow
              title="Eliminar proyecto"
              destructive
              leading={<IconTile tone="danger"><Trash2 /></IconTile>}
              onClick={() => { setActionsOpen(false); onDelete() }}
            />
          </InsetGroup>
        </div>
      </BottomSheet>
    </div>
  )
}

/** Sticky, horizontally scrollable tab strip (pills). Sits at the top of the content scroller. */
export function ProjectMobileTabs<T extends string>({
  tabs, value, onChange,
}: { tabs: Array<{ id: T; label: string; icon: ReactNode }>; value: T; onChange: (t: T) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Secciones del proyecto"
      data-no-track
      data-no-ptr
      className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-background/90 px-4 py-2.5 backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden"
    >
      {tabs.map(t => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => { if (!active) { haptic(); onChange(t.id) } }}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-200 active:scale-[0.97]',
              active ? 'bg-foreground text-background' : 'bg-border-soft text-graphite active:text-foreground',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
