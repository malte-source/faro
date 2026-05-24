import { Header } from '@/components/layout/header'
import { TasksOverview } from '@/components/tasks/tasks-overview'

export default function TasksPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Tareas" description="Vista global de todas las tareas" />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <TasksOverview />
      </div>
    </div>
  )
}
