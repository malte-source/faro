import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Lightweight message rendering — no dependencies and no HTML injection:
 * everything is built as React nodes (React escapes text), never with
 * dangerouslySetInnerHTML.
 *
 * Supports **bold**, *italic*, `code`, ```code blocks```, auto-linked URLs and
 * highlighted @mentions (@todos / @canal / @faro and the names of the people
 * mentioned in the message).
 */

const SPECIAL_MENTION = '@(?:todos|todas|canal|all|channel|faro)\\b'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildInlineRegex(mentionNames: string[]): RegExp {
  const names = Array.from(new Set(mentionNames.flatMap(n => [n, n.split(' ')[0]]).filter(n => n.length > 1)))
    .sort((a, b) => b.length - a.length)
    .map(n => `@${escapeRegExp(n)}`)
  const mention = [SPECIAL_MENTION, ...names].join('|')
  return new RegExp(
    [
      '(`[^`\\n]+`)',                    // 1 inline code
      '(\\*\\*[^*\\n]+\\*\\*)',          // 2 bold
      '(\\*[^*\\n]+\\*)',                // 3 italic
      '(https?:\\/\\/[^\\s<]+)',         // 4 url
      `(${mention})`,                    // 5 mention
    ].join('|'),
    'giu',
  )
}

const MENTION_CLASS = 'rounded bg-signal/25 px-1 font-medium text-foreground dark:bg-signal/20 dark:text-signal'
const MENTION_ON_ACCENT = 'rounded bg-night/15 px-1 font-semibold text-night'

function renderInline(text: string, regex: RegExp, keyPrefix: string, onAccent = false): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  regex.lastIndex = 0
  for (let m = regex.exec(text); m; m = regex.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyPrefix}-${i++}`
    if (m[1]) {
      out.push(<code key={key} className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-night-700">{m[1].slice(1, -1)}</code>)
    } else if (m[2]) {
      out.push(<strong key={key} className="font-semibold">{m[2].slice(2, -2)}</strong>)
    } else if (m[3]) {
      out.push(<em key={key}>{m[3].slice(1, -1)}</em>)
    } else if (m[4]) {
      // Trailing punctuation belongs to the sentence, not the link.
      const url = m[4].replace(/[.,;:!?)\]]+$/, '')
      const trailing = m[4].slice(url.length)
      out.push(
        <a key={key} href={url} target="_blank" rel="noopener noreferrer" className={cn('break-all underline underline-offset-2', onAccent ? 'font-medium text-night' : 'text-signal-ink hover:text-foreground dark:text-signal dark:hover:text-mist')}>
          {url}
        </a>,
      )
      if (trailing) out.push(trailing)
    } else if (m[5]) {
      out.push(<span key={key} className={onAccent ? MENTION_ON_ACCENT : MENTION_CLASS}>{m[5]}</span>)
    }
    last = m.index + m[0].length
    if (m[0].length === 0) regex.lastIndex++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function RichText({
  body,
  mentionNames = [],
  className,
  inherit = false,
  onAccent = false,
}: {
  body: string
  mentionNames?: string[]
  className?: string
  /** Take the colour from the parent (chat bubbles) instead of the default body ink. */
  inherit?: boolean
  /** Rendered on the amber bubble: links and mentions switch to Noche. */
  onAccent?: boolean
}) {
  const regex = buildInlineRegex(mentionNames)
  const parts = body.split(/```/)
  return (
    <div className={cn('whitespace-pre-wrap break-words text-sm leading-relaxed', inherit ? 'text-[15px] leading-snug' : 'text-body', className)}>
      {parts.map((part, idx) => {
        // Odd segments sit between a pair of ``` fences; an unclosed trailing fence stays plain text.
        if (idx % 2 === 1 && idx < parts.length - 1) {
          return (
            <pre key={idx} className="my-1 overflow-x-auto rounded-lg bg-night p-3 font-mono text-xs leading-snug text-mist">
              <code>{part.replace(/^\n/, '').replace(/\n$/, '')}</code>
            </pre>
          )
        }
        return <Fragment key={idx}>{renderInline(part, regex, String(idx), onAccent)}</Fragment>
      })}
    </div>
  )
}
