import { Header } from '@/components/layout/header'
import { ActivityFeed } from '@/components/activity/activity-feed'

export default function ActivityPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Actividad"
        description="Todo lo que pasa en tu workspace, en tiempo real"
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <ActivityFeed />
      </div>
    </div>
  )
}
