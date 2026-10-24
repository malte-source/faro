import { Header } from '@/components/layout/header'
import { RoadmapBoard } from '@/components/projects/roadmap-board'

export default function RoadmapPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Roadmap"
        description="Portafolio cross-project agrupado por trimestre. Vista ejecutiva: qué arranca, qué termina y qué viene."
      />
      <div className="flex-1 overflow-auto px-4 py-4 md:px-6 md:py-6">
        <RoadmapBoard />
      </div>
    </div>
  )
}
