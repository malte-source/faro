import { Header } from '@/components/layout/header'
import { NewProjectForm } from '@/components/projects/new-project-form'

export default function NewProjectPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Nuevo proyecto" description="Completá los datos para crear el proyecto" />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <NewProjectForm />
      </div>
    </div>
  )
}
