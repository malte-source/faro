'use client'

import { useEffect, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Sparkles, Send, RotateCcw } from 'lucide-react'
import { confirmAction } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'

interface Props { projectId: string }

/**
 * Multi-turn AI chat tab inside a project.
 *
 * Sends messages to the `aiChat.send` mutation which:
 *   - persists user + assistant messages in `ai_messages`
 *   - feeds project context + last 20 messages to Gemini Flash
 *
 * Optimistic: user's message appears immediately, then the assistant's
 * reply lands when the mutation resolves.
 */
export function ProjectChat({ projectId }: Props) {
  const [input, setInput] = useState('')
  const [optimistic, setOptimistic] = useState<{ role: 'user'; content: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = trpc.aiChat.conversation.useQuery({ projectId })
  const utils = trpc.useUtils()

  const send = trpc.aiChat.send.useMutation({
    onSuccess: () => {
      utils.aiChat.conversation.invalidate({ projectId })
      setOptimistic(null)
    },
    onError: () => setOptimistic(null),
  })

  const reset = trpc.aiChat.reset.useMutation({
    onSuccess: () => utils.aiChat.conversation.invalidate({ projectId }),
  })

  const messages = data?.messages ?? []

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, optimistic, send.isPending])

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || send.isPending) return
    setOptimistic({ role: 'user', content: text })
    setInput('')
    send.mutate({ projectId, message: text })
  }

  return (
    <div className="flex h-[calc(100dvh-27rem)] min-h-[360px] flex-col md:h-[calc(100vh-220px)] md:min-h-[480px] rounded-xl border border-stone bg-white dark:border-night-700 dark:bg-night">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 dark:border-night-700">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-night dark:text-stone-100">Chat con Gemini</h2>
          <p className="text-[10px] uppercase tracking-wider text-graphite">
            Conoce tu proyecto · {messages.length} {messages.length === 1 ? 'mensaje' : 'mensajes'}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={async () => {
              const ok = await confirmAction({ title: 'Borrar historial de chat', description: 'Las conversaciones anteriores con la AI de este proyecto se borran.', variant: 'destructive' })
              if (ok) reset.mutate({ projectId })
            }}
            className="rounded-md p-1.5 text-graphite hover:bg-stone-100 hover:text-body dark:hover:bg-night-700"
            title="Reiniciar conversación"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-stone-100 dark:bg-night-700" />
            ))}
          </div>
        ) : messages.length === 0 && !optimistic ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Sparkles className="h-8 w-8 text-signal-ink" />
            <p className="mt-3 text-sm font-medium text-ink-body dark:text-stone">
              Pregúntale lo que quieras sobre este proyecto
            </p>
            <p className="mt-1 max-w-sm text-xs text-graphite">
              Gemini tiene acceso al estado, las tareas y los plazos. Prueba: <em>"¿qué riesgos ves esta semana?"</em>,
              <em> "arma un resumen para mandar al cliente"</em>, <em>"¿en qué tarea estoy más atrasado?"</em>
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map(m => <Bubble key={m.id} role={m.role} content={m.content} />)}
            {optimistic && <Bubble role="user" content={optimistic.content} />}
            {send.isPending && optimistic && (
              <li className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-stone-100 px-3 py-2 dark:bg-night-700">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-signal [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-signal [animation-delay:200ms]" />
                  <span className="h-2 w-2 animate-pulse rounded-full bg-signal [animation-delay:400ms]" />
                </div>
              </li>
            )}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="flex items-end gap-2 border-t border-stone-100 px-3 py-3 dark:border-night-700">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="Pregunta algo sobre el proyecto…"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-stone bg-white px-3 py-2 text-sm text-night outline-none transition focus:border-signal focus:ring-1 focus:ring-signal dark:border-ink-body dark:bg-night-700 dark:text-stone-100"
        />
        <button
          type="submit"
          disabled={!input.trim() || send.isPending}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background transition hover:bg-foreground/90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}

function Bubble({ role, content }: { role: 'user' | 'assistant' | 'system'; content: string }) {
  const isUser = role === 'user'
  return (
    <li className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed',
        isUser
          ? 'rounded-br-sm bg-foreground text-background'
          : 'rounded-bl-sm bg-stone-100 text-night-700 dark:bg-night-700 dark:text-stone-100',
      )}>
        {content}
      </div>
    </li>
  )
}
