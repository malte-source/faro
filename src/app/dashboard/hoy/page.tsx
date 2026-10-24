import { Header } from '@/components/layout/header'
import { HoyView } from '@/components/hoy/hoy-view'

export default function HoyPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Hoy" description="Todas tus tareas, de todas tus empresas." />
      <div className="flex-1 overflow-y-auto md:px-6 md:py-6">
        <HoyView />
      </div>
    </div>
  )
}
