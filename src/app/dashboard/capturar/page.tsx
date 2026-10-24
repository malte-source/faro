import { Suspense } from 'react'
import { Header } from '@/components/layout/header'
import { CaptureWorkspace } from '@/components/captura/capture-workspace-lazy'

export default function CapturarPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Capturar" description="Envía lo que tengas. Faro arma las tareas." />
      <Suspense fallback={null}>
        <CaptureWorkspace />
      </Suspense>
    </div>
  )
}
