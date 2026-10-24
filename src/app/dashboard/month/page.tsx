import { Header } from '@/components/layout/header'
import { MonthView } from '@/components/views/month-view'

export default function MonthPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Mes" description="Grilla mensual con todas tus tareas con fecha" />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <MonthView />
      </div>
    </div>
  )
}
