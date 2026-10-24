import { Header } from '@/components/layout/header'
import { MoreScreen } from '@/components/mobile/more-screen'

export default function MasPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Más" description="Todo lo que no está en la barra inferior." />
      <div className="flex-1 overflow-y-auto">
        <MoreScreen />
      </div>
    </div>
  )
}
