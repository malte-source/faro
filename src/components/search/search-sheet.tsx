'use client'

import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { SearchPanel } from '@/components/search/search-panel'

const SEARCH_EVENT = 'faro:search'

/** Open the search sheet from anywhere (nav bar button, command palette, shortcut). Needs `<SearchSheetHost />` mounted once. */
export function openSearch(query = '') {
  window.dispatchEvent(new CustomEvent<string>(SEARCH_EVENT, { detail: query }))
}

interface SearchSheetProps {
  open: boolean
  onClose: () => void
  initialQuery?: string
}

/**
 * Search as a sheet: full-height on phones, a centred modal on desktop. The panel is
 * remounted on every open (fresh query, focus in the input), and closes itself after a result is opened.
 */
export function SearchSheet({ open, onClose, initialQuery = '' }: SearchSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Buscar" tall className="md:h-[70dvh] md:max-w-2xl">
      {open && <SearchPanel autoFocus fill initialQuery={initialQuery} onNavigate={onClose} />}
    </BottomSheet>
  )
}

/** Mount once (layout). Listens for `openSearch()` and renders the sheet. */
export function SearchSheetHost() {
  const [state, setState] = useState<{ open: boolean; q: string }>({ open: false, q: '' })

  useEffect(() => {
    const onOpen = (e: Event) => setState({ open: true, q: (e as CustomEvent<string>).detail ?? '' })
    window.addEventListener(SEARCH_EVENT, onOpen)
    return () => window.removeEventListener(SEARCH_EVENT, onOpen)
  }, [])

  return <SearchSheet open={state.open} initialQuery={state.q} onClose={() => setState(s => ({ ...s, open: false }))} />
}
