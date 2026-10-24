import { createAdminSupabaseClient } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import { PROJECT_STATUS, PRIORITY, KANBAN_STAGES } from '@/lib/utils'
import { Calendar, Users, CheckSquare, Target, Heart, AlertCircle, Megaphone, TrendingUp, AlertTriangle, AlertOctagon, Minus } from 'lucide-react'

/**
 * Read-only public view of a project — what the client sees through a share link.
 *
 * What's exposed:
 *   - Project meta: title, code, color, status, priority, kanban stage, dates, health
 *   - Progress percentage
 *   - Goal (if linked) — just the title, not nested structure
 *   - Top-level tasks: title, status, priority, due_date, assignee NAME ONLY
 *     (no avatars/emails to avoid leaking team identity beyond first name)
 *   - Linked members: count + first names only
 *
 * What's NOT exposed:
 *   - Comments, attachments, time entries, drive folders, AI chat
 *   - Other projects in the org
 *   - Anyone's email
 *   - Custom fields (could contain client-specific PII)
 */

const KANBAN_LABEL: Record<string, string> = Object.fromEntries(KANBAN_STAGES.map(s => [s.id, s.label]))

export async function PublicProjectView({ projectId, label }: { projectId: string; label: string | null }) {
  const supabase = createAdminSupabaseClient()

  const [{ data: project }, { data: tasks }, { data: members }, { data: org }, { data: updates }] = await Promise.all([
    supabase
      .from('projects')
      .select(`
        id, code, name, description, status, kanban_stage, priority, color,
        start_date, end_date, progress_pct, health_score,
        goal:goals!projects_goal_id_fkey(id, title)
      `)
      .eq('id', projectId)
      .single(),
    supabase
      .from('tasks')
      .select('id, title, status, priority, due_date, assignee:users!tasks_assignee_id_fkey(name)')
      .eq('project_id', projectId)
      .is('parent_task_id', null)
      .order('position')
      .limit(100),
    supabase
      .from('project_members')
      .select('user:users!project_members_user_id_fkey(name)')
      .eq('project_id', projectId),
    supabase
      .from('projects')
      .select('workspace:workspaces!projects_workspace_id_fkey(org:organizations(name))')
      .eq('id', projectId)
      .single(),
    supabase
      .from('project_updates')
      .select(`
        id, content, sentiment, created_at,
        author:users!project_updates_author_id_fkey(name)
      `)
      .eq('project_id', projectId)
      .eq('visible_in_share', true)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (!project) notFound()

  const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
  const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]
  const goal = (project as unknown as { goal: { id: string; title: string } | null }).goal
  const orgName = (org as { workspace?: { org?: { name?: string } } } | null)
    ?.workspace?.org?.name ?? ''

  const taskCounts = {
    total: tasks?.length ?? 0,
    done: tasks?.filter(t => t.status === 'done').length ?? 0,
    inProgress: tasks?.filter(t => t.status === 'in_progress').length ?? 0,
    todo: tasks?.filter(t => t.status === 'todo').length ?? 0,
  }

  const healthClass = project.health_score == null ? 'text-graphite'
    : project.health_score >= 70 ? 'text-success'
    : project.health_score >= 40 ? 'text-signal-ink'
    : 'text-danger'

  return (
    <main className="min-h-screen bg-gradient-to-br from-mist to-signal-wash/30 dark:from-night dark:to-[#12293A]">
      <div className="mx-auto max-w-4xl px-4 py-8 md:py-12">
        {/* Sticky banner identifying this as a shared view */}
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-signal-wash px-3 py-2 text-xs text-night dark:bg-signal/40 dark:text-signal">
          <span className="text-base">🔗</span>
          <div className="flex-1">
            <p>
              <strong>Vista compartida</strong>
              {label && <span> · {label}</span>}
              {orgName && <span> · de {orgName}</span>}
            </p>
            <p className="text-[10px] opacity-80">Solo lectura. Datos actualizados en vivo.</p>
          </div>
        </div>

        {/* Header */}
        <header className="rounded-2xl border border-stone bg-white p-6 shadow-sm dark:border-night-700 dark:bg-night">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: project.color }} />
            <span className="text-sm font-mono text-graphite">{project.code}</span>
            <h1 className="text-2xl font-bold text-night dark:text-stone-100">{project.name}</h1>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
              project.status === 'completed' ? 'bg-success-wash text-success' :
              project.status === 'delayed' ? 'bg-signal-wash text-signal-ink' :
              project.status === 'canceled' ? 'bg-danger-wash text-danger' :
              project.status === 'in_progress' ? 'bg-signal-wash text-night' :
              project.status === 'on_hold' ? 'bg-signal-wash text-signal-ink' :
              'bg-border-soft text-graphite'
            }`}>
              {statusInfo?.label}
            </span>
            <span className="inline-flex items-center rounded-md border border-dashed border-stone px-2 py-0.5 text-xs text-graphite dark:border-ink-body dark:text-graphite">
              {KANBAN_LABEL[project.kanban_stage] ?? project.kanban_stage}
            </span>
            <span className={`text-xs font-medium ${priorityInfo?.color ?? ''}`}>
              {priorityInfo?.label}
            </span>
            {project.health_score != null && (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${healthClass}`} title="Salud del proyecto">
                <Heart className="h-3 w-3" /> {project.health_score}/100
              </span>
            )}
          </div>

          {/* Progress */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-graphite mb-1">
              <span>Progreso</span>
              <span className="font-semibold tabular-nums">{project.progress_pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-night-700">
              <div className="h-full rounded-full bg-signal transition-all duration-500" style={{ width: `${project.progress_pct}%` }} />
            </div>
          </div>

          {/* Description */}
          {project.description && (
            <div className="mt-4 border-t border-stone-100 pt-4 dark:border-night-700">
              <p className="text-sm text-graphite whitespace-pre-wrap dark:text-stone">{project.description}</p>
            </div>
          )}

          {/* Meta row */}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-stone-100 pt-4 md:grid-cols-4 dark:border-night-700">
            <Stat
              icon={<Calendar className="h-3.5 w-3.5" />}
              label="Inicio"
              value={project.start_date ? new Date(project.start_date + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
            />
            <Stat
              icon={<Calendar className="h-3.5 w-3.5" />}
              label="Vencimiento"
              value={project.end_date ? new Date(project.end_date + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
            />
            <Stat
              icon={<CheckSquare className="h-3.5 w-3.5" />}
              label="Tareas"
              value={`${taskCounts.done}/${taskCounts.total}`}
            />
            <Stat
              icon={<Users className="h-3.5 w-3.5" />}
              label="Equipo"
              value={String(members?.length ?? 0)}
            />
          </div>

          {/* Goal link if any */}
          {goal && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-mist px-3 py-2 text-xs dark:bg-night-700/40">
              <Target className="h-3.5 w-3.5 text-signal-ink" />
              <span className="text-graphite">Este proyecto contribuye a:</span>
              <span className="font-medium text-ink-body dark:text-stone">{goal.title}</span>
            </div>
          )}
        </header>

        {/* Updates — newsletter-style timeline visible to share viewers */}
        {updates && updates.length > 0 && (
          <section className="mt-6 rounded-2xl border border-stone bg-white p-6 shadow-sm dark:border-night-700 dark:bg-night">
            <h2 className="text-sm font-semibold text-ink-body dark:text-stone mb-3 flex items-center gap-2">
              <Megaphone className="h-4 w-4" /> Updates ({updates.length})
            </h2>
            <ul className="space-y-3">
              {updates.map(u => {
                const author = (u.author as { name?: string } | null)?.name?.split(' ')[0] ?? 'Equipo'
                const sentiment = u.sentiment as 'positive' | 'neutral' | 'concern' | 'blocker' | null
                const style = sentiment === 'positive' ? { color: 'text-success bg-success-wash dark:text-success/50 dark:bg-success/30', ring: 'border-l-success', icon: <TrendingUp className="h-3 w-3" />, label: 'Avance' }
                  : sentiment === 'concern' ? { color: 'text-signal-ink bg-signal-wash dark:text-signal/50 dark:bg-signal/30', ring: 'border-l-signal-ink', icon: <AlertTriangle className="h-3 w-3" />, label: 'Atención' }
                  : sentiment === 'blocker' ? { color: 'text-danger bg-danger-wash dark:text-danger/50 dark:bg-danger/30', ring: 'border-l-danger', icon: <AlertOctagon className="h-3 w-3" />, label: 'Bloqueador' }
                  : { color: 'text-graphite bg-mist dark:text-stone dark:bg-night-700/50', ring: 'border-l-graphite', icon: <Minus className="h-3 w-3" />, label: '' }
                return (
                  <li key={u.id} className={`rounded-lg border-l-4 bg-mist/40 px-4 py-3 dark:bg-night-700/30 ${style.ring}`}>
                    <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1">
                      <span className="font-semibold text-ink-body dark:text-stone">{author}</span>
                      <span className="text-graphite">·</span>
                      <span className="text-graphite">{new Date(u.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      {sentiment && style.label && (
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${style.color}`}>
                          {style.icon} {style.label}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-ink-body dark:text-stone">{u.content}</p>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* Tasks list */}
        <section className="mt-6 rounded-2xl border border-stone bg-white p-6 shadow-sm dark:border-night-700 dark:bg-night">
          <h2 className="text-sm font-semibold text-ink-body dark:text-stone mb-3 flex items-center gap-2">
            <CheckSquare className="h-4 w-4" /> Tareas ({taskCounts.total})
          </h2>

          {!tasks?.length ? (
            <p className="py-8 text-center text-sm text-graphite flex flex-col items-center gap-2">
              <AlertCircle className="h-6 w-6" />
              Sin tareas todavía
            </p>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-night-700">
              {tasks.map(t => {
                const pri = PRIORITY[t.priority as keyof typeof PRIORITY]
                const assigneeName = (t.assignee as { name?: string } | null)?.name?.split(' ')[0] ?? null
                const isDone = t.status === 'done' || t.status === 'canceled'
                return (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${pri?.dot ?? 'bg-stone'}`} />
                    <span className={`flex-1 text-sm ${isDone ? 'line-through text-graphite' : 'text-night-700 dark:text-stone'}`}>
                      {t.title}
                    </span>
                    {t.due_date && (
                      <span className="text-[11px] text-graphite">{t.due_date}</span>
                    )}
                    {assigneeName && (
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-graphite dark:bg-night-700 dark:text-graphite">
                        {assigneeName}
                      </span>
                    )}
                    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                      t.status === 'done' ? 'bg-success-wash text-success dark:bg-success/40 dark:text-success/50' :
                      t.status === 'in_progress' ? 'bg-signal-wash text-night dark:bg-signal/40 dark:text-signal' :
                      t.status === 'in_review' ? 'bg-signal-wash text-signal-ink dark:bg-signal/40 dark:text-signal/50' :
                      t.status === 'canceled' ? 'bg-danger-wash text-danger dark:bg-danger/40 dark:text-danger/50' :
                      'bg-stone-100 text-graphite dark:bg-night-700 dark:text-graphite'
                    }`}>
                      {t.status === 'done' ? 'Listo' :
                       t.status === 'in_progress' ? 'En progreso' :
                       t.status === 'in_review' ? 'En revisión' :
                       t.status === 'canceled' ? 'Cancelado' : 'Por hacer'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Footer */}
        <p className="mt-8 text-center text-[11px] text-graphite">
          Vista generada por <a href="/" className="font-medium text-signal-ink hover:underline">FARO</a> · Solo lectura
        </p>
      </div>
    </main>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-graphite">
        {icon}{label}
      </p>
      <p className="text-sm font-semibold text-ink-body dark:text-stone">{value}</p>
    </div>
  )
}
