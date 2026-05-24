// Dashboard page
import { Header } from '@/components/layout/header'
import { DashboardStats } from '@/components/projects/dashboard-stats'
import { RecentProjects } from '@/components/projects/recent-projects'

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Dashboard"
        description="Vista general del portafolio de proyectos"
      />
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        <DashboardStats />
        <RecentProjects />
      </div>
    </div>
  )
}
