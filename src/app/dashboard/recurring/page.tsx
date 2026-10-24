import { Header } from '@/components/layout/header'
import { RecurringBoard } from '@/components/recurring/recurring-board'

export default function RecurringPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Tareas recurrentes"
        description="Reglas que generan tareas automáticamente — cron diario las materializa según la cadencia configurada"
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <RecurringBoard />
      </div>
    </div>
  )
}
