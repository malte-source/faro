'use client'

import { Children, isValidElement, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { haptic } from '@/components/mobile/haptics'

/**
 * Small phone-only building blocks shared by the Proyectos / Tareas screens
 * (kept here so the foundation in src/components/mobile stays untouched).
 */

/** Filter / quick-view chip. Selected = inverted (foreground on background), so it flips with the theme. */
export function FilterChip({
  selected, onClick, children, count, onRemove, className,
}: { selected?: boolean; onClick?: () => void; children: ReactNode; count?: number; onRemove?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => { haptic(); (onRemove ?? onClick)?.() }}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-200 active:scale-[0.97]',
        selected
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-surface text-foreground active:bg-border-soft',
        className,
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className={cn('rounded-full px-1.5 text-[11px] font-bold tabular-nums', selected ? 'bg-background/20' : 'bg-signal text-night')}>{count}</span>
      )}
      {onRemove && <span aria-hidden className="-mr-1 text-base leading-none opacity-70">×</span>}
    </button>
  )
}

/** iOS-style switch (the green/amber pill with a sliding knob). */
export function IosSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => { haptic(); onChange(!checked) }}
      className={cn(
        'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-signal' : 'bg-stone dark:bg-border',
      )}
    >
      <span
        className={cn(
          'absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_5px_rgba(10,26,38,0.3)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          checked && 'translate-x-[20px]',
        )}
      />
    </button>
  )
}

/** Primary / secondary action pair pinned in a sheet footer. */
export function SheetActions({
  primaryLabel, onPrimary, secondaryLabel, onSecondary, busy, disabled,
}: { primaryLabel: string; onPrimary: () => void; secondaryLabel?: string; onSecondary?: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <div className="flex gap-3">
      {secondaryLabel && (
        <button
          type="button"
          onClick={onSecondary}
          className="h-12 flex-1 rounded-[14px] border border-border bg-surface text-[15px] font-semibold text-foreground active:bg-border-soft"
        >
          {secondaryLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onPrimary}
        disabled={disabled || busy}
        className="h-12 flex-[1.6] rounded-[14px] bg-signal text-[15px] font-bold text-night transition-opacity active:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Un momento…' : primaryLabel}
      </button>
    </div>
  )
}

/** Labelled form field: label above, 48px control (16px text so iOS never zooms). */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="block px-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">{label}</span>
      {children}
      {hint && <span className="block px-1 text-xs text-graphite">{hint}</span>}
    </label>
  )
}

/** Shared class for 48px inputs/selects/textareas inside sheets. */
export const FIELD_CLASS =
  'block min-h-12 w-full rounded-[14px] border border-border bg-surface px-3.5 text-base text-foreground outline-none transition-colors placeholder:text-graphite focus:border-signal focus:ring-2 focus:ring-signal/30'

/** Settings-style row with a NATIVE picker on the right (the OS wheel/sheet — what phone users expect). */
export function SelectRow({
  label, value, onChange, options, icon,
}: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; icon?: ReactNode }) {
  const current = options.find(o => o.value === value)?.label ?? ''
  return (
    <label className="relative flex min-h-[52px] items-center gap-3 px-4 py-2 active:bg-border-soft">
      {icon}
      <span className="flex-1 text-[15px] font-medium text-foreground">{label}</span>
      <span className="text-[15px] text-graphite">{current}</span>
      <span aria-hidden className="text-graphite/60">›</span>
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

/** Same idea for dates: the row shows the formatted date, a transparent native date input sits on top. */
export function DateRow({
  label, value, onChange, icon,
}: { label: string; value: string; onChange: (v: string) => void; icon?: ReactNode }) {
  const shown = value ? new Date(value + 'T12:00:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Sin fecha'
  return (
    <label className="relative flex min-h-[52px] items-center gap-3 px-4 py-2 active:bg-border-soft">
      {icon}
      <span className="flex-1 text-[15px] font-medium text-foreground">{label}</span>
      <span className={cn('text-[15px]', value ? 'text-foreground' : 'text-graphite')}>{shown}</span>
      {value && (
        <button
          type="button"
          aria-label="Quitar fecha"
          onClick={e => { e.preventDefault(); e.stopPropagation(); onChange('') }}
          className="relative z-10 -mr-2 flex h-8 w-8 items-center justify-center rounded-full text-graphite active:bg-border"
        >
          ×
        </button>
      )}
      <input
        type="date"
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full"
      />
    </label>
  )
}

/** Titled card for a self-contained section inside a sheet (comments, files…). */
export function SectionCard({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-1.5', className)}>
      <h3 className="px-4 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">{label}</h3>
      <div className="rounded-[14px] border border-border bg-surface p-4">{children}</div>
    </section>
  )
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

function collectOptions(children: ReactNode, out: Array<{ value: string; label: string }> = []) {
  Children.forEach(children, child => {
    if (!isValidElement(child)) return
    const props = child.props as { value?: string; children?: ReactNode }
    if (typeof props.value === 'string') out.push({ value: props.value, label: textOf(props.children) })
    else if (props.children) collectOptions(props.children, out) // fragments / wrappers
  })
  return out
}

/**
 * Drop-in for the Radix <Select> inside forms: same JSX (`<SelectItem>` children),
 * but phones get the platform's NATIVE picker (iOS wheel / Android sheet) and
 * md+ keeps the Radix popover. Use it in place of Select + SelectTrigger + SelectContent.
 */
export function ResponsiveSelect({
  value, onValueChange, children, className, id,
}: { value: string; onValueChange: (v: string) => void; children: ReactNode; className?: string; id?: string }) {
  const options = collectOptions(children)
  return (
    <>
      <select
        id={id}
        value={value}
        onChange={e => onValueChange(e.target.value)}
        className={cn(FIELD_CLASS, 'md:hidden', className)}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="hidden md:block">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger id={id}><SelectValue /></SelectTrigger>
          <SelectContent>{children}</SelectContent>
        </Select>
      </div>
    </>
  )
}

/**
 * A callback whose identity never changes but always calls the latest function.
 * Pass sheet `onClose` handlers through this: BottomSheet's effect depends on
 * `onClose`, and a new identity per render would re-run its focus/scroll-lock
 * cleanup on every keystroke inside the sheet.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  return useCallback((...args: A) => ref.current(...args), [])
}
