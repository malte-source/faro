import { Header } from '@/components/layout/header'
import { GrupoView } from '@/components/grupo/grupo-view'

export default function GrupoPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Grupo"
        description="Todas las empresas de un vistazo — solo para Dirección"
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <GrupoView />
      </div>
    </div>
  )
}
