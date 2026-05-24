import { Header } from '@/components/layout/header'
import { SettingsOverview } from '@/components/settings/settings-overview'

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Configuración" description="Perfil y ajustes de la organización" />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <SettingsOverview />
      </div>
    </div>
  )
}
