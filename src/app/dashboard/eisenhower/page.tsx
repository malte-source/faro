import { Header } from '@/components/layout/header'
import { EisenhowerMatrix } from '@/components/tasks/eisenhower-matrix'

export default function EisenhowerPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Eisenhower"
        description="Tus tareas por urgencia e importancia"
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <EisenhowerMatrix />
      </div>
    </div>
  )
}
