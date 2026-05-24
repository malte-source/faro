import { Header } from '@/components/layout/header'
import { ProjectsList } from '@/components/projects/projects-list'

export default function ProjectsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Proyectos"
        description="Portafolio completo de proyectos"
      />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <ProjectsList />
      </div>
    </div>
  )
}
