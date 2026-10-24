import { Header } from '@/components/layout/header'
import { GoalsBoard } from '@/components/goals/goals-board'

export default function GoalsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Objetivos"
        description="El 'para qué' arriba del día a día. Define qué quieres lograr este trimestre y conecta los proyectos que lo hacen realidad."
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <GoalsBoard />
      </div>
    </div>
  )
}
