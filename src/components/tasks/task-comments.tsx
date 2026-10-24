'use client'

import { useState, useRef } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MessageSquare, Send, Trash2 } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { createPortal } from 'react-dom'
import { TaskCommentsSummary } from './task-comments-summary'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `hace ${days}d`
  return new Date(dateStr).toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

interface Comment {
  id: string
  task_id: string
  author_id: string
  content: string
  created_at: string
  updated_at: string
  author: { id: string; name: string; avatar_url: string | null } | null
}

interface Props {
  taskId: string
  /** When given, the composer renders there (portal) instead of inline — used to pin it above the keyboard on phones. */
  composerHost?: HTMLElement | null
}

export function TaskComments({ taskId, composerHost }: Props) {
  const [content, setContent] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { data: session } = useSession()

  const { data: rawComments, isLoading } = trpc.comments.list.useQuery(taskId)
  const comments = (rawComments ?? []) as unknown as Comment[]
  const utils = trpc.useUtils()

  const add = trpc.comments.add.useMutation({
    onSuccess: () => utils.comments.list.invalidate(taskId),
  })

  const del = trpc.comments.delete.useMutation({
    onSuccess: () => utils.comments.list.invalidate(taskId),
  })

  function handleSubmit() {
    const trimmed = content.trim()
    if (!trimmed || add.isPending) return
    add.mutate({ taskId, content: trimmed })
    setContent('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="flex gap-2">
            <div className="h-7 w-7 rounded-full bg-border-soft animate-pulse shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-24 rounded bg-border-soft animate-pulse" />
              <div className="h-3 w-48 rounded bg-border-soft animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* AI summarize bar — only renders when comments.length ≥ 3 */}
      <TaskCommentsSummary taskId={taskId} commentsCount={comments.length} />

      {/* Comments list */}
      {comments.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-4 text-graphite">
          <MessageSquare className="h-5 w-5" />
          <p className="text-xs">Sin comentarios todavía</p>
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map(comment => {
            const author = comment.author
            const isOwn = author?.name === session?.user?.name
            return (
              <div key={comment.id} className="flex gap-2 group">
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarImage src={author?.avatar_url ?? undefined} />
                  <AvatarFallback className="text-[10px] bg-signal-wash text-night">
                    {author?.name?.slice(0, 2).toUpperCase() ?? '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-body">{author?.name ?? 'Usuario'}</span>
                    <span className="text-[10px] text-graphite">{timeAgo(comment.created_at)}</span>
                    {isOwn && (
                      <button
                        onClick={() => del.mutate(comment.id)}
                        className="ml-auto opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity text-stone hover:text-danger"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-graphite leading-relaxed whitespace-pre-wrap mt-0.5">
                    {comment.content}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* New comment input */}
      {composerHost
        ? createPortal(renderComposer(), composerHost)
        : renderComposer()}
    </div>
  )

  // Called as a plain function (not used as <Component/>) so the textarea keeps focus between renders.
  function renderComposer() {
    return (
      <div className={composerHost ? 'flex items-end gap-2' : 'flex gap-2 pt-1'}>
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarImage src={session?.user?.image ?? undefined} />
          <AvatarFallback className="text-[10px] bg-signal-wash text-night">
            {session?.user?.name?.slice(0, 2).toUpperCase() ?? '?'}
          </AvatarFallback>
        </Avatar>
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un comentario… (Enter para enviar)"
            rows={1}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 pr-10 text-xs text-body placeholder:text-graphite focus:border-signal/40 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-signal/20 transition-all"
            style={{ minHeight: '36px', maxHeight: '120px' }}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || add.isPending}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-signal-ink transition-all hover:bg-signal-wash disabled:opacity-30"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }
}
