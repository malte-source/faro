'use client'

import { Printer, X } from 'lucide-react'

export function PrintControls({ projectName }: { projectName: string }) {
  return (
    <div className="mb-8 flex items-center justify-between rounded-xl border border-border bg-background px-5 py-3 print:hidden">
      <div>
        <p className="text-xs text-graphite">Vista previa del reporte</p>
        <p className="text-sm font-semibold text-foreground">{projectName}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-[10px] bg-night px-4 py-2 text-sm font-medium text-mist transition-colors hover:bg-night-700"
        >
          <Printer className="h-4 w-4" />
          Imprimir / Guardar PDF
        </button>
        <button
          onClick={() => window.close()}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-graphite transition-colors hover:bg-border-soft"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
