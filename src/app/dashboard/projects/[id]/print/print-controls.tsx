'use client'

import { Printer, X } from 'lucide-react'

export function PrintControls({ projectName }: { projectName: string }) {
  return (
    <div className="mb-8 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-3 print:hidden">
      <div>
        <p className="text-xs text-slate-500">Vista previa del reporte</p>
        <p className="text-sm font-semibold text-slate-800">{projectName}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          <Printer className="h-4 w-4" />
          Imprimir / Guardar PDF
        </button>
        <button
          onClick={() => window.close()}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
