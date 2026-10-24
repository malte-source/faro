import { Header } from '@/components/layout/header'
import { AutomationsBoard } from '@/components/automations/automations-board'

export default function AutomationsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Automatizaciones"
        description="Reglas si-esto-entonces-aquello. Se ejecutan automáticamente cuando algo cambia."
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <AutomationsBoard />
      </div>
    </div>
  )
}
