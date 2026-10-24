'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Send, Sparkles, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getDraft, normalize, setDraft } from '@/components/chat/chat-utils'
import { useChatDirectory, useMe, type SendApi } from '@/components/chat/hooks'
import { UserAvatar } from '@/components/chat/user-avatar'

interface Candidate {
  key: string
  label: string
  hint: string
  personId?: string
  avatarUrl?: string | null
  kind: 'person' | 'all' | 'faro'
}

const MENTION_TOKEN = /(^|\s)@([^\s@]*)$/

/**
 * Message composer. Enter sends, Shift+Enter inserts a newline. Typing "@"
 * opens an autocomplete of people plus @todos and @faro; the ids of the
 * people picked are sent as `mentionIds`. The draft is kept per channel/thread.
 *
 * `key` the component by `draftKey` so switching channel resets its state.
 */
export function Composer({
  send,
  draftKey,
  placeholder,
  autoFocus = false,
  onEscape,
}: {
  send: Pick<SendApi, 'send'>
  draftKey: string
  placeholder: string
  autoFocus?: boolean
  onEscape?: () => void
}) {
  const me = useMe()
  const { directory } = useChatDirectory()
  const [text, setText] = useState(() => getDraft(draftKey))
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const picked = useRef(new Map<string, string>())
  const nextCaret = useRef<number | null>(null)

  useEffect(() => {
    // On phones focusing on open would raise the keyboard over the conversation.
    if (autoFocus && window.matchMedia('(min-width: 768px)').matches) ref.current?.focus()
  }, [autoFocus])

  // Autosize up to ~6 lines.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  useLayoutEffect(() => {
    if (nextCaret.current !== null && ref.current) {
      ref.current.setSelectionRange(nextCaret.current, nextCaret.current)
      nextCaret.current = null
    }
  })

  const token = MENTION_TOKEN.exec(text.slice(0, caret))
  const query = token ? token[2] : null

  const candidates = useMemo<Candidate[]>(() => {
    if (query === null) return []
    const q = normalize(query)
    const specials = ([
      { key: 'todos', label: 'todos', hint: 'Avisar a todo el canal', kind: 'all' },
      { key: 'faro', label: 'faro', hint: 'Preguntarle a Faro', kind: 'faro' },
    ] as Candidate[]).filter(s => !q || s.label.startsWith(q))
    const people: Candidate[] = (directory?.people ?? [])
      .filter(p => p.id !== me?.user.id && (!q || normalize(p.name).includes(q)))
      .slice(0, 6)
      .map(p => ({ key: p.id, label: p.name, hint: p.memberships[0]?.position ?? '', personId: p.id, avatarUrl: p.avatarUrl, kind: 'person' as const }))
    return [...people, ...specials].slice(0, 7)
  }, [query, directory, me])

  const popupOpen = !dismissed && candidates.length > 0

  const change = (value: string, caretPos: number) => {
    setText(value)
    setCaret(caretPos)
    setDismissed(false)
    setActive(0)
    setDraft(draftKey, value)
  }

  const insert = (c: Candidate) => {
    if (!token) return
    const start = caret - token[2].length - 1
    const insertion = `@${c.label} `
    const next = text.slice(0, start) + insertion + text.slice(caret)
    if (c.personId) picked.current.set(c.label, c.personId)
    nextCaret.current = start + insertion.length
    change(next, start + insertion.length)
    ref.current?.focus()
  }

  const submit = () => {
    const body = text.trim()
    if (!body) return
    const mentionIds = Array.from(new Set(
      Array.from(picked.current.entries()).filter(([name]) => body.includes(`@${name}`)).map(([, id]) => id),
    ))
    send.send(body, mentionIds)
    picked.current.clear()
    setText('')
    setCaret(0)
    setDraft(draftKey, '')
  }

  return (
    <div className="relative shrink-0 border-t border-border bg-surface/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:px-4 md:pb-3">
      {popupOpen && (
        <ul
          role="listbox"
          aria-label="Menciones"
          className="absolute bottom-full left-3 right-3 z-20 mb-1 max-h-64 overflow-y-auto rounded-[18px] border border-border bg-surface p-1 shadow-[0_8px_24px_rgba(10,26,38,0.14)] dark:bg-[#12293A] md:left-4 md:right-auto md:w-80 md:rounded-xl"
        >
          {candidates.map((c, i) => (
            <li key={c.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); insert(c) }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex min-h-[48px] w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left md:min-h-[40px] md:rounded-lg',
                  i === active ? 'bg-signal-wash dark:bg-signal/15' : 'hover:bg-stone-100 dark:hover:bg-night-700',
                )}
              >
                {c.kind === 'person' ? (
                  <UserAvatar name={c.label} src={c.avatarUrl} className="h-6 w-6" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-night text-signal">
                    {c.kind === 'faro' ? <Sparkles className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-night dark:text-mist">{c.kind === 'person' ? c.label : `@${c.label}`}</span>
                  {c.hint && <span className="block truncate text-xs text-graphite">{c.hint}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          aria-label={placeholder}
          aria-autocomplete="list"
          placeholder={placeholder}
          onChange={e => change(e.target.value, e.target.selectionStart)}
          onSelect={e => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={e => {
            if (popupOpen) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % candidates.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + candidates.length) % candidates.length); return }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(candidates[active]); return }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(true); return }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
              return
            }
            if (e.key === 'Escape') onEscape?.()
          }}
          enterKeyHint="send"
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-[22px] border border-border bg-background px-4 py-[11px] text-[16px] leading-snug text-foreground placeholder:text-graphite focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/40 md:min-h-[40px] md:rounded-[10px] md:bg-surface md:px-3 md:py-2 md:text-sm md:focus:border-night dark:md:bg-[#12293A]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Enviar mensaje"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-signal text-night transition-all hover:bg-[#F0A30F] focus-visible:ring-2 focus-visible:ring-night active:scale-95 disabled:cursor-not-allowed disabled:bg-border-soft disabled:text-graphite md:h-10 md:w-10 md:rounded-[10px] md:disabled:bg-signal md:disabled:text-night md:disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 hidden text-[11px] text-graphite md:block">Enter envía · Shift+Enter nueva línea · @ menciona · @faro le pregunta a Faro</p>
    </div>
  )
}
