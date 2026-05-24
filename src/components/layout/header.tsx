interface HeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export function Header({ title, description, actions }: HeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-6 md:py-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold text-slate-900 md:text-xl dark:text-slate-100">{title}</h1>
        {description && (
          <p className="mt-0.5 hidden text-sm text-slate-500 md:block dark:text-slate-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
