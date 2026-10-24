import { Header } from '@/components/layout/header'
import { ProjectGantt } from '@/components/projects/project-gantt-lazy'

export default function GanttPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Gantt"
        description="Timeline visual del portafolio de proyectos"
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <ProjectGantt />
      </div>
    </div>
  )
}
