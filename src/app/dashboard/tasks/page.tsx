import { Header } from '@/components/layout/header'
import { TasksOverview } from '@/components/tasks/tasks-overview'
import { ExportTasksButton } from '@/components/tasks/export-tasks-button'

export default function TasksPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Tareas"
        description={'Busca, filtra y exporta CUALQUIER tarea. Para auditar, reportar y resolver "¿dónde está esa tarea?".'}
        actions={<ExportTasksButton />}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3 md:px-6 md:py-6">
        <TasksOverview />
      </div>
    </div>
  )
}
