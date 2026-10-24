'use client'

import { Sparkles, X } from 'lucide-react'
import { DocPreview } from '@/components/documentos/doc-render'

/** Faro's plain-language reading of a reparto, always closed by the tax/legal warning. */
export function ExplainPanel({ text, disclaimer, onClose }: { text: string; disclaimer: string; onClose: () => void }) {
  return (
    <section aria-label="Explicación de Faro" className="rounded-[14px] border border-signal/40 bg-signal-wash p-4 dark:border-signal/30 dark:bg-night-700">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-signal-ink dark:text-signal">
          <Sparkles className="h-4 w-4" /> Explicación de Faro
        </h3>
        <button type="button" onClick={onClose} aria-label="Cerrar explicación" className="flex h-8 w-8 items-center justify-center rounded-full text-graphite hover:bg-white/60 dark:hover:bg-night">
          <X className="h-4 w-4" />
        </button>
      </div>
      <DocPreview md={text} />
      <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs text-ink-body dark:bg-night dark:text-stone">
        {disclaimer}
      </p>
    </section>
  )
}
