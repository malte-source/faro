/**
 * Reusable skeleton compositions for the most common loading shapes.
 *
 * Instead of every list/grid hand-rolling `[...Array(n)].map(...)` with
 * different heights and corners, use one of these and get visual consistency.
 */

interface BaseProps {
  /** Number of placeholder rows/cards. Default 5. */
  rows?: number
  className?: string
}

/** Vertical list skeleton — for tables, member lists, automation lists, etc. */
export function ListSkeleton({ rows = 5, className }: BaseProps) {
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-100 dark:bg-night-700/60" />
      ))}
    </div>
  )
}

/** Grid of cards skeleton — for members grid, projects grid, etc. */
export function GridSkeleton({
  rows = 6, cols = 3, className,
}: BaseProps & { cols?: number }) {
  const colClasses: Record<number, string> = {
    1: '',
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  }
  return (
    <div className={`grid gap-3 ${colClasses[cols] ?? colClasses[3]} ${className ?? ''}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-stone-100 dark:bg-night-700/60" />
      ))}
    </div>
  )
}

/** Board skeleton — for Kanban / 4-column views. */
export function BoardSkeleton({ cols = 4 }: { cols?: number }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-xl bg-stone-100 dark:bg-night-700/60" />
      ))}
    </div>
  )
}

/** Inline skeleton — small text block (e.g. inside a header or pill). */
export function TextSkeleton({ width = 'w-24', className }: { width?: string; className?: string }) {
  return <span className={`inline-block h-3.5 animate-pulse rounded ${width} bg-stone-100 dark:bg-night-700/60 ${className ?? ''}`} />
}
