import { Header } from '@/components/layout/header'
import { SprintsBoard } from '@/components/sprints/sprints-board'

export default function SprintsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Sprints" description="Planifica iteraciones y sigue la velocidad del equipo" />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <SprintsBoard />
      </div>
    </div>
  )
}
