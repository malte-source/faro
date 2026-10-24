import { Header } from '@/components/layout/header'
import { PersonasView } from '@/components/personas/personas-view'
import { InvitePeopleButton } from '@/components/personas/invite-people'

export default function PersonasPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Personas"
        description="Quién trabaja en qué empresa, con qué cargo, y cuántas horas lleva esta semana"
        actions={<InvitePeopleButton />}
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <PersonasView />
      </div>
    </div>
  )
}
