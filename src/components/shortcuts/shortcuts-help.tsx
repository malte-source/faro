'use client'

import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { cn } from '@/lib/utils'
import { SHORTCUT_GROUPS, displayKey, type ShortcutInfo } from './catalog'
import { useShortcuts } from './shortcuts-store'

/** Keys of one shortcut: "G luego H" for a sequence, the chord text for ⌘K / ⌘Z. */
function Keys({ info }: { info: ShortcutInfo }) {
  const kbd = 'rounded-md border border-border bg-border-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground'
  if (info.keys.length === 0) {
    return <kbd className={kbd}>{info.chord}</kbd>
  }
  return (
    <span className="flex items-center gap-1">
      {info.keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-[10px] text-graphite">luego</span>}
          <kbd className={kbd}>{displayKey(k)}</kbd>
        </span>
      ))}
    </span>
  )
}

/** "Atajos de teclado": every shortcut by area, plus the switch that turns them all off. */
export function ShortcutsHelp({ catalog }: { catalog: ShortcutInfo[] }) {
  const open = useShortcuts(s => s.helpOpen)
  const close = useShortcuts(s => s.closeHelp)
  const enabled = useShortcuts(s => s.enabled)
  const setEnabled = useShortcuts(s => s.setEnabled)

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title="Atajos de teclado"
      description="Muévete por Faro sin soltar el teclado. Nada se activa mientras escribes."
      tall
    >
      <div className="space-y-5 pb-3 pt-2">
        <div className="flex items-center justify-between gap-4 rounded-[14px] border border-border bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Atajos activados</p>
            <p className="text-xs text-graphite">Apágalos si prefieres usar solo el mouse o el tacto.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Atajos de teclado activados"
            onClick={() => setEnabled(!enabled)}
            className={cn(
              'relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2',
              enabled ? 'bg-signal' : 'bg-border',
            )}
          >
            <span
              className={cn(
                'absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200',
                enabled && 'translate-x-5',
              )}
            />
          </button>
        </div>

        {SHORTCUT_GROUPS.map(group => {
          const items = catalog.filter(s => s.group === group)
          if (items.length === 0) return null
          return (
            <section key={group} className="space-y-1.5">
              <h3 className="px-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">{group}</h3>
              <ul className="divide-y divide-border-soft overflow-hidden rounded-[14px] border border-border bg-surface">
                {items.map(s => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 text-sm text-foreground">{s.label}</span>
                    <Keys info={s} />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </BottomSheet>
  )
}
