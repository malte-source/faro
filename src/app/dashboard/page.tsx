import { Header } from '@/components/layout/header'
import { DashboardStats } from '@/components/projects/dashboard-stats'
import { RecentProjects } from '@/components/projects/recent-projects'
import { MyTasksWidget } from '@/components/tasks/my-tasks-widget'

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Dashboard" description="Vista general del portafolio de proyectos" />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 md:px-6 md:py-6 md:space-y-6">
        <DashboardStats />
        <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentProjects compact />
          </div>
          <div>
            <MyTasksWidget />
          </div>
        </div>
      </div>
    </div>
  )
}
