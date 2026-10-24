import { Header } from '@/components/layout/header'
import { NewProjectForm } from '@/components/projects/new-project-form'
import { FromTemplateCard } from '@/components/projects/from-template-card'

export default function NewProjectPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Nuevo proyecto" description="Completa los datos para crear el proyecto" />
      <div className="flex-1 overflow-y-auto px-4 pb-0 pt-3 md:px-6 md:py-6">
        <FromTemplateCard />
        <NewProjectForm />
      </div>
    </div>
  )
}
