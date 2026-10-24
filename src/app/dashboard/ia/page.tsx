import { Header } from '@/components/layout/header'
import { AiUsageView } from '@/components/ai-usage/ai-usage-view'

export default function IaPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="IA" description="Cuánto cuesta la IA este mes, en qué se va y cuál es el tope" />
      <div className="flex-1 overflow-y-auto">
        <AiUsageView />
      </div>
    </div>
  )
}
