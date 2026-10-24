import { Header } from '@/components/layout/header'
import { FormsBoard } from '@/components/forms/forms-board'

export default function FormsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Formularios de pedidos"
        description="Formularios públicos (sin login) que crean tareas automáticamente cuando alguien los envía. Útil para clientes externos, intake de tickets, pedidos del equipo."
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <FormsBoard />
      </div>
    </div>
  )
}
