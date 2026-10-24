import { Header } from '@/components/layout/header'
import { DocumentsList, NewDocumentButton } from '@/components/documentos/documents-list'

export default function DocumentosPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header
        title="Documentos"
        description="Políticas, manuales, SOPs, actas y acuerdos — con revisión, versiones y Faro para redactar"
        actions={<NewDocumentButton />}
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <DocumentsList />
      </div>
    </div>
  )
}
