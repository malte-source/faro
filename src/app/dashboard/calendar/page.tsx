import { Header } from '@/components/layout/header'
import { CalendarView } from '@/components/calendar/calendar-view'

export default function CalendarPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Calendario" description="Tareas y vencimientos de proyectos" />
      <CalendarView />
    </div>
  )
}
