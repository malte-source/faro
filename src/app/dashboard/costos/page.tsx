import { Header } from '@/components/layout/header'
import { CostosView } from '@/components/costos/costos-view'

export default function CostosPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Costos intercompany"
        description="Cómo el holding reparte sus costos entre las empresas, mes a mes"
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <CostosView />
      </div>
    </div>
  )
}
