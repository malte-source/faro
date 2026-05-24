import { Header } from '@/components/layout/header'
import { ProjectKanban } from '@/components/projects/project-kanban'

export default function KanbanPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Kanban" description="Vista de portafolio por etapa de desarrollo" />
      <div className="flex-1 overflow-auto px-6 py-6">
        <ProjectKanban />
      </div>
    </div>
  )
}
