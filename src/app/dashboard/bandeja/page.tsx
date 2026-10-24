import { Header } from '@/components/layout/header'
import { BandejaView } from '@/components/bandeja/bandeja-view'

export default function BandejaPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Bandeja" description="Lo que te asignan, te mencionan y te piden revisar" />
      <div className="flex-1 overflow-y-auto md:px-6 md:py-6">
        <BandejaView />
      </div>
    </div>
  )
}
