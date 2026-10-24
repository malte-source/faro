import { Header } from '@/components/layout/header'
import { PriorityFeed } from '@/components/tasks/priority-feed'

export default function PrioritiesPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Prioridades del equipo"
        description="Ranking cross-project de lo que más arde — sin filtrar por asignado. Para ver el pulso del trabajo, no solo lo tuyo."
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <PriorityFeed />
      </div>
    </div>
  )
}
