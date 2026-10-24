import { Header } from '@/components/layout/header'
import { DecisionEditor } from '@/components/decisions/decision-editor'

export default async function DecisionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Matriz de Decisión" />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <DecisionEditor decisionId={id} />
      </div>
    </div>
  )
}
