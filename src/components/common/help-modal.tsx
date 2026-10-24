'use client'

import { useEffect, useState } from 'react'
import { X, Keyboard, Search, Plus, Sparkles, CalendarDays, HelpCircle } from 'lucide-react'

/**
 * Help / keyboard shortcuts modal.
 *
 * Opens with the `?` key (Shift+/) — a near-universal app convention since GitHub.
 * Also openable via the Help icon in the sidebar (TODO: wire later).
 *
 * Keeps shortcut documentation IN the app — no need to read docs externally.
 */

const SHORTCUTS: Array<{ section: string; items: Array<{ keys: string[]; label: string; icon?: React.ReactNode }> }> = [
  {
    section: 'Acciones globales',
    items: [
      { keys: ['⌘', 'K'], label: 'Buscar / Command Palette', icon: <Search className="h-3.5 w-3.5" /> },
      { keys: ['N'], label: 'Nueva tarea (formulario)', icon: <Plus className="h-3.5 w-3.5" /> },
      { keys: ['⇧', 'N'], label: 'Nueva tarea con AI (texto / audio / imagen)', icon: <Sparkles className="h-3.5 w-3.5" /> },
      { keys: ['?'], label: 'Mostrar esta ayuda', icon: <HelpCircle className="h-3.5 w-3.5" /> },
    ],
  },
  {
    section: 'Navegación',
    items: [
      { keys: ['G', 'T'], label: 'Ir a Mi día' },
      { keys: ['G', 'P'], label: 'Ir a Prioridades' },
      { keys: ['G', 'D'], label: 'Ir a Dashboard' },
      { keys: ['G', 'R'], label: 'Ir a Proyectos' },
    ],
  },
  {
    section: 'En los diálogos',
    items: [
      { keys: ['Esc'], label: 'Cerrar modal / drawer' },
      { keys: ['Enter'], label: 'Confirmar acción primaria' },
    ],
  },
  {
    section: 'Calendar',
    items: [
      { keys: ['Sidebar →'], label: 'Schedulear reunión', icon: <CalendarDays className="h-3.5 w-3.5" /> },
    ],
  },
]

export function HelpModal() {
  const [open, setOpen] = useState(false)

  // Open with `?` (Shift+/) — skip if user is typing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // ── Cross-component: also open via window event so the sidebar can trigger it.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('faro:open-help', onOpen)
    return () => window.removeEventListener('faro:open-help', onOpen)
  }, [])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-night animate-in zoom-in-95 fade-in"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-stone-100 px-5 py-4 dark:border-night-700">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-wash dark:bg-signal/40">
              <Keyboard className="h-4 w-4 text-signal-ink" />
            </span>
            <div>
              <h2 id="help-title" className="text-base font-semibold text-night dark:text-stone-100">Atajos de teclado</h2>
              <p className="text-xs text-graphite">Vuelve a abrir esta ventana con <KeyChip k="?" /></p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1 text-graphite hover:bg-stone-100 dark:hover:bg-night-700"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
          {SHORTCUTS.map(s => (
            <section key={s.section}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-graphite">{s.section}</h3>
              <ul className="space-y-1.5">
                {s.items.map(it => (
                  <li key={it.label} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-mist dark:hover:bg-night-700/50">
                    <span className="flex items-center gap-2 text-sm text-ink-body dark:text-stone">
                      {it.icon}
                      {it.label}
                    </span>
                    <span className="flex items-center gap-1">
                      {it.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[10px] text-stone">+</span>}
                          <KeyChip k={k} />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="border-t border-stone-100 bg-mist px-5 py-3 text-[10px] text-graphite dark:border-night-700 dark:bg-night-700/50">
          Tip: los atajos no se disparan cuando estás escribiendo en un campo.
        </footer>
      </div>
    </div>
  )
}

function KeyChip({ k }: { k: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-stone bg-white px-1.5 text-[10px] font-medium text-graphite shadow-sm dark:border-ink-body dark:bg-night-700 dark:text-stone">
      {k}
    </kbd>
  )
}

/** Imperatively open the help modal from anywhere (e.g. sidebar button). */
export function openHelp() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('faro:open-help'))
}
