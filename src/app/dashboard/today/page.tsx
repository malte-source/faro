import { Header } from '@/components/layout/header'
import { MyDayBoard } from '@/components/tasks/my-day-board'

export default function MyDayPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Mi día"
        description="Solo lo TUYO de hoy — tareas asignadas a ti o donde eres reviewer. Tu dashboard personal."
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <MyDayBoard />
      </div>
    </div>
  )
}
