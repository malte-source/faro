'use client'

import { useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { SearchPanel } from '@/components/search/search-panel'

/** Full-page search (/dashboard/buscar?q=…). The query stays in the URL (replaceState, no navigation) so it can be shared. */
export function SearchPage() {
  const params = useSearchParams()
  const [initial] = useState(() => params.get('q') ?? '')

  const onQueryChange = useCallback((q: string) => {
    const url = new URL(window.location.href)
    if (q.trim()) url.searchParams.set('q', q)
    else url.searchParams.delete('q')
    window.history.replaceState(window.history.state, '', url)
  }, [])

  return (
    <div className="mx-auto w-full max-w-2xl">
      <SearchPanel autoFocus initialQuery={initial} onQueryChange={onQueryChange} />
    </div>
  )
}
