import { Header } from '@/components/layout/header'
import { DecisionsList } from '@/components/decisions/decisions-list'

export default function DecisionsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Matrices de Decisión"
        description="Evalúa opciones contra criterios ponderados"
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <DecisionsList />
      </div>
    </div>
  )
}
