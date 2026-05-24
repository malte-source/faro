import { Header } from '@/components/layout/header'
import { ReportsOverview } from '@/components/reports/reports-overview'

export default function ReportsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Reportes" description="Métricas de proyectos, tareas y equipo" />
      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        <ReportsOverview />
      </div>
    </div>
  )
}
