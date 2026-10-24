'use client'

import { forwardRef } from 'react'
import { CheckSquare, FileText, MessagesSquare, Newspaper, Scale } from 'lucide-react'
import type { SearchEntityType, SnippetPart } from '@/lib/search-utils'
import { cn } from '@/lib/utils'
import { formatWhen } from '@/components/search/format'

export const TYPE_ICON: Record<SearchEntityType, typeof CheckSquare> = {
  task: CheckSquare,
  document: FileText,
  chat: MessagesSquare,
  decision: Scale,
  update: Newspaper,
}

/** The matched words, marked — rendered as React text nodes, so user content can never inject markup. */
function Snippet({ parts }: { parts: SnippetPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.hit
          ? <mark key={i} className="rounded-[3px] bg-signal/30 px-px font-medium text-foreground">{p.t}</mark>
          : <span key={i}>{p.t}</span>,
      )}
    </>
  )
}

export interface ResultRowHit {
  type: SearchEntityType
  id: string
  title: string
  snippet: SnippetPart[]
  empresa: { name: string; color: string } | null
  projectName: string | null
  channelName: string | null
  when: string
}

interface Props {
  hit: ResultRowHit
  id: string
  active: boolean
  onSelect: () => void
  onHover: () => void
}

/** One result: type icon, title, two-line snippet with highlights, and a calm meta line. 56px+ tall on touch. */
export const SearchResultRow = forwardRef<HTMLDivElement, Props>(function SearchResultRow({ hit, id, active, onSelect, onHover }, ref) {
  const Icon = TYPE_ICON[hit.type]
  const where = hit.projectName ?? (hit.type === 'chat' ? null : hit.channelName)
  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onClick={onSelect}
      onMouseMove={onHover}
      className={cn(
        'flex min-h-[56px] cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors',
        active ? 'bg-signal-wash dark:bg-signal/10' : 'active:bg-border-soft',
      )}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-border-soft text-foreground">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-snug text-foreground">{hit.title}</span>
        {hit.snippet.length > 0 && (
          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-graphite">
            <Snippet parts={hit.snippet} />
          </span>
        )}
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-graphite">
          {hit.empresa && (
            <span className="flex min-w-0 items-center gap-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hit.empresa.color }} />
              <span className="truncate">{hit.empresa.name}</span>
            </span>
          )}
          {where && <span className="truncate">{hit.empresa ? '· ' : ''}{where}</span>}
          <span className="ml-auto shrink-0">{formatWhen(hit.when)}</span>
        </span>
      </span>
    </div>
  )
})
