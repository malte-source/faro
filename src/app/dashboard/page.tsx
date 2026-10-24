import { Header } from '@/components/layout/header'
import { DashboardStats } from '@/components/projects/dashboard-stats'
import { DashboardCharts } from '@/components/projects/dashboard-charts'
import { RecentProjects } from '@/components/projects/recent-projects'
import { MyTasksWidget } from '@/components/tasks/my-tasks-widget'
import { NextActionWidget } from '@/components/tasks/next-action-widget'

/**
 * Dashboard page — simple server component with fast TTFB.
 *
 * Data is fetched client-side via a single batched tRPC request
 * (all 4 queries in one HTTP round-trip, no maxURLLength cap).
 * The server-side ctx cache (5-min TTL) means zero extra DB queries
 * on the tRPC handler after the first request.
 *
 * Result: skeleton appears instantly, data fills in ≈500 ms.
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Dashboard" description="Vista general del portafolio de proyectos" />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-8 pt-3 md:space-y-6 md:px-6 md:py-6">
        <DashboardStats />
        <NextActionWidget />
        <DashboardCharts />
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
