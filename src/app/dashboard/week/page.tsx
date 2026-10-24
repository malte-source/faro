import { Header } from '@/components/layout/header'
import { WeekView } from '@/components/views/week-view'

export default function WeekPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Semana" description="Tus tareas distribuidas por día de la semana" />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <WeekView />
      </div>
    </div>
  )
}
