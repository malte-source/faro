import { DocumentEditor } from '@/components/documentos/document-editor'

interface Props {
  params: Promise<{ id: string }>
}

export default async function DocumentPage({ params }: Props) {
  const { id } = await params
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DocumentEditor id={id} />
    </div>
  )
}
