import Link from 'next/link'
import { FaroMark } from '@/components/brand/logo'
import { MobileNavBar } from '@/components/mobile/nav-bar'

interface HeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

/**
 * Page header. Desktop: logo + title + description + actions in one bar.
 * Mobile: an iOS-style large-title navigation bar (see MobileNavBar) — the
 * description is dropped on phones, `actions` become a row of pills under the title.
 */
export function Header({ title, description, actions }: HeaderProps) {
  return (
    <>
      <MobileNavBar title={title} actions={actions} />
      <div className="hidden items-center justify-between border-b border-border bg-surface px-6 py-4 md:flex dark:border-night-700 dark:bg-night">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/dashboard" className="inline-flex shrink-0" aria-label="Faro — ir al dashboard">
            <FaroMark size={32} />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground dark:text-stone-100">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-graphite">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </>
  )
}
