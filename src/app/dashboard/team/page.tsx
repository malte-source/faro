import { Header } from '@/components/layout/header'
import { TeamOverview } from '@/components/team/team-overview'

export default function TeamPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Equipo" description="Gestión de personas, departamentos y carga de trabajo" />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <TeamOverview />
      </div>
    </div>
  )
}
