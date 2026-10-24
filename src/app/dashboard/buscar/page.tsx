import { Suspense } from 'react'
import { Header } from '@/components/layout/header'
import { SearchPage } from '@/components/search/search-page'

export default function BuscarPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Buscar" description="Tareas, documentos, chat, decisiones y avances — por palabras y por significado" />
      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <Suspense fallback={null}>
          <SearchPage />
        </Suspense>
      </div>
    </div>
  )
}
