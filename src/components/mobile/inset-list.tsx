'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Grouped, inset lists — the backbone of iOS Settings / One UI screens.
 * A group is a rounded card (14px, hairline border) whose rows are separated
 * by an inset hairline; the label above is Faro's mono eyebrow.
 */
export function InsetGroup({
  label, footer, children, className,
}: { label?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-1.5', className)}>
      {label && (
        <h3 className="px-4 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-graphite">{label}</h3>
      )}
      <div className="overflow-hidden rounded-[14px] border border-border bg-surface [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-border-soft">
        {children}
      </div>
      {footer && <p className="px-4 text-xs leading-relaxed text-graphite">{footer}</p>}
    </section>
  )
}

interface ListRowProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Icon tile, avatar, checkbox… (40px slot). */
  leading?: ReactNode
  /** Value text, badge, switch… */
  trailing?: ReactNode
  /** Show the disclosure chevron (defaults to true for links). */
  chevron?: boolean
  href?: string
  onClick?: () => void
  destructive?: boolean
  selected?: boolean
  disabled?: boolean
  className?: string
}

/** One row: ≥ 56px tall (comfortable thumb target), press feedback, optional chevron. */
export function ListRow({
  title, subtitle, leading, trailing, chevron, href, onClick, destructive, selected, disabled, className,
}: ListRowProps) {
  const interactive = !!(href || onClick) && !disabled
  const showChevron = chevron ?? !!href
  const body = (
    <>
      {leading && <span className="flex h-10 w-10 shrink-0 items-center justify-center">{leading}</span>}
      <span className="min-w-0 flex-1 text-left">
        <span className={cn('block truncate text-[15px] font-medium leading-snug', destructive ? 'text-danger' : 'text-foreground')}>{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[13px] leading-snug text-graphite">{subtitle}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1.5 text-sm text-graphite">{trailing}</span>}
      {showChevron && <ChevronRight className="h-4 w-4 shrink-0 text-graphite/60" aria-hidden />}
    </>
  )
  const cls = cn(
    'flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 transition-colors',
    interactive && 'active:bg-border-soft',
    selected && 'bg-signal-wash dark:bg-signal/10',
    disabled && 'opacity-50',
    className,
  )
  if (href && !disabled) return <Link href={href} className={cls}>{body}</Link>
  if (onClick && !disabled) return <button type="button" onClick={onClick} className={cls}>{body}</button>
  return <div className={cls}>{body}</div>
}

/** 40px rounded tile with an icon — leading slot for settings-style rows. */
export function IconTile({ children, tone = 'night', className }: { children: ReactNode; tone?: 'night' | 'signal' | 'success' | 'danger' | 'info' | 'neutral'; className?: string }) {
  const tones = {
    night: 'bg-night text-mist dark:bg-border dark:text-foreground',
    signal: 'bg-signal text-night',
    success: 'bg-success text-white',
    danger: 'bg-danger text-white',
    info: 'bg-info text-white',
    neutral: 'bg-border-soft text-foreground',
  }
  return <span className={cn('flex h-9 w-9 items-center justify-center rounded-[10px] [&>svg]:h-[18px] [&>svg]:w-[18px]', tones[tone], className)}>{children}</span>
}
