import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { PrintControls } from './print-controls'
import { PROJECT_STATUS, PRIORITY, formatDate } from '@/lib/utils'

const TASK_STATUS_LABEL: Record<string, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  in_review: 'En revisión',
  done: 'Listo',
  canceled: 'Cancelado',
}

const TASK_STATUS_COLOR: Record<string, string> = {
  todo: '#64748b',
  in_progress: '#3b82f6',
  in_review: '#f59e0b',
  done: '#22c55e',
  canceled: '#ef4444',
}

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.email) redirect('/auth/signin')

  const supabase = createAdminSupabaseClient()

  // Verify user belongs to org that owns this project
  const { data: me } = await supabase
    .from('users')
    .select('id, org_id, name')
    .eq('email', session.user.email)
    .single()
  if (!me) redirect('/dashboard')

  const { data: project } = await supabase
    .from('projects')
    .select(`
      *,
      department:departments(id, name, color),
      workspace:workspaces!inner(id, name, org_id)
    `)
    .eq('id', id)
    .eq('workspace.org_id', me.org_id)
    .single()
  if (!project) redirect('/dashboard/projects')

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, status, priority, due_date, estimated_hours, actual_hours, assignee:users!tasks_assignee_id_fkey(id, name)')
    .eq('project_id', id)
    .is('parent_task_id', null)
    .order('position')

  const { data: members } = await supabase
    .from('project_members')
    .select('id, role, user:users(id, name, email, position)')
    .eq('project_id', id)
    .is('removed_at', null)

  const statusInfo = PROJECT_STATUS[project.status as keyof typeof PROJECT_STATUS]
  const priorityInfo = PRIORITY[project.priority as keyof typeof PRIORITY]

  const tasksByStatus = {
    todo: tasks?.filter(t => t.status === 'todo').length ?? 0,
    in_progress: tasks?.filter(t => t.status === 'in_progress').length ?? 0,
    in_review: tasks?.filter(t => t.status === 'in_review').length ?? 0,
    done: tasks?.filter(t => t.status === 'done').length ?? 0,
    canceled: tasks?.filter(t => t.status === 'canceled').length ?? 0,
  }
  const totalTasks = tasks?.length ?? 0
  const doneTasks = tasksByStatus.done

  const generatedAt = new Intl.DateTimeFormat('es', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date())

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          body { margin: 0; }
          @page { margin: 20mm; size: A4; }
        }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      `}</style>

      <div className="mx-auto max-w-4xl px-8 py-8">
        <PrintControls projectName={project.name} />

        {/* Report header */}
        <div className="mb-8 border-b-2 border-slate-200 pb-6">
          <div className="flex items-start gap-4">
            <div
              className="mt-1 h-5 w-5 shrink-0 rounded-full"
              style={{ backgroundColor: project.color }}
            />
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-slate-400">{project.code}</span>
                <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {statusInfo && (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusInfo.color}`}>
                    {statusInfo.label}
                  </span>
                )}
                {priorityInfo && (
                  <span className={`text-sm font-medium ${priorityInfo.color}`}>
                    {priorityInfo.label}
                  </span>
                )}
                {project.department && (
                  <span
                    className="rounded-full px-2.5 py-1 text-xs font-semibold"
                    style={{
                      backgroundColor: `${project.department.color}20`,
                      color: project.department.color,
                    }}
                  >
                    {project.department.name}
                  </span>
                )}
                {project.health_score != null && (
                  <span className={`text-sm font-semibold ${
                    project.health_score >= 70 ? 'text-green-600' :
                    project.health_score >= 40 ? 'text-yellow-600' : 'text-red-500'
                  }`}>
                    ❤ Salud: {project.health_score}%
                  </span>
                )}
              </div>
            </div>
          </div>

          {project.description && (
            <p className="mt-4 text-sm leading-relaxed text-slate-600 whitespace-pre-wrap">
              {project.description}
            </p>
          )}
        </div>

        {/* Key metrics grid */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Progreso', value: `${project.progress_pct}%` },
            { label: 'Inicio', value: project.start_date ? formatDate(project.start_date) : '—' },
            { label: 'Vencimiento', value: project.end_date ? formatDate(project.end_date) : '—' },
            {
              label: 'Presupuesto',
              value: project.budget != null
                ? new Intl.NumberFormat('es', { style: 'currency', currency: project.currency, maximumFractionDigits: 0 }).format(project.budget)
                : '—',
            },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-0.5 text-lg font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="mb-1.5 flex justify-between text-xs text-slate-500">
            <span>Progreso del proyecto</span>
            <span>{project.progress_pct}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-500"
              style={{ width: `${project.progress_pct}%` }}
            />
          </div>
        </div>

        {/* Tasks section */}
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800">
              Tareas <span className="ml-1 text-slate-400 font-normal">({totalTasks})</span>
            </h2>
            <span className="text-sm text-slate-500">
              {doneTasks} de {totalTasks} completadas
              {totalTasks > 0 && ` (${Math.round((doneTasks / totalTasks) * 100)}%)`}
            </span>
          </div>

          {/* Status summary pills */}
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(tasksByStatus).map(([status, count]) => count > 0 && (
              <span
                key={status}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
                style={{ borderColor: `${TASK_STATUS_COLOR[status]}40`, color: TASK_STATUS_COLOR[status] }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: TASK_STATUS_COLOR[status] }}
                />
                {TASK_STATUS_LABEL[status]} ({count})
              </span>
            ))}
          </div>

          {/* Task table */}
          {totalTasks > 0 && (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="py-2 text-left text-xs font-semibold text-slate-500">Tarea</th>
                  <th className="py-2 text-left text-xs font-semibold text-slate-500">Estado</th>
                  <th className="py-2 text-left text-xs font-semibold text-slate-500">Prioridad</th>
                  <th className="py-2 text-left text-xs font-semibold text-slate-500">Asignado</th>
                  <th className="py-2 text-left text-xs font-semibold text-slate-500">Vence</th>
                </tr>
              </thead>
              <tbody>
                {tasks?.map((task, i) => {
                  const assignee = task.assignee as { id: string; name: string } | null
                  const p = PRIORITY[task.priority as keyof typeof PRIORITY]
                  return (
                    <tr key={task.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="py-2 pr-4">
                        <span className="font-medium text-slate-800">{task.title}</span>
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            backgroundColor: `${TASK_STATUS_COLOR[task.status]}18`,
                            color: TASK_STATUS_COLOR[task.status],
                          }}
                        >
                          {TASK_STATUS_LABEL[task.status] ?? task.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`text-xs font-medium ${p?.color ?? 'text-slate-500'}`}>
                          {p?.label ?? task.priority}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className="text-xs text-slate-600">{assignee?.name ?? '—'}</span>
                      </td>
                      <td className="py-2">
                        <span className="text-xs text-slate-600">
                          {task.due_date ? formatDate(task.due_date) : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Team members */}
        {(members?.length ?? 0) > 0 && (
          <div className="mb-8">
            <h2 className="mb-4 text-base font-bold text-slate-800">
              Equipo <span className="ml-1 text-slate-400 font-normal">({members!.length})</span>
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {members!.map(member => {
                const user = member.user as { id: string; name: string; email: string; position: string | null } | null
                const roleLabel = { lead: 'Líder', contributor: 'Colaborador', viewer: 'Observador' }[member.role] ?? member.role
                return (
                  <div key={member.id} className="rounded-lg border border-slate-200 px-3 py-2.5">
                    <p className="text-sm font-semibold text-slate-800">{user?.name ?? '—'}</p>
                    <p className="text-xs text-slate-500">{user?.position ?? roleLabel}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{roleLabel}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
          Generado por <span className="font-semibold text-indigo-600">Faro</span> · {generatedAt}
          {me.name && ` · Por ${me.name}`}
        </div>
      </div>
    </div>
  )
}
