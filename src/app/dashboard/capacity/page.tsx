import { Header } from '@/components/layout/header'
import { CapacityBoard } from '@/components/calendar/capacity-board'

export default function CapacityPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Capacidad del equipo"
        description="Vista semanal de carga real basada en Google Calendar — para asignar trabajo sabiendo cuánto tiene cada uno"
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <CapacityBoard />
      </div>
    </div>
  )
}
