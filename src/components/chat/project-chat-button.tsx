'use client'

import { useRouter } from 'next/navigation'
import { Loader2, MessageCircle } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'

/**
 * Opens (creating it on demand) the chat of a project and goes to it.
 * Mount it in the project header; anyone who can see the project can use it.
 */
export function ProjectChatButton({ projectId, className }: { projectId: string; className?: string }) {
  const router = useRouter()
  const open = trpc.chat.openProjectChannel.useMutation({
    onSuccess: ({ id }) => router.push(`/dashboard/chat?c=${id}`),
    onError: err => toast.error('No se pudo abrir el chat del proyecto', err.message),
  })

  return (
    <button
      type="button"
      onClick={() => open.mutate({ projectId })}
      disabled={open.isPending}
      aria-busy={open.isPending}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-[10px] border border-night bg-surface px-3 text-sm font-medium text-night transition-colors hover:bg-mist disabled:opacity-60 dark:border-[#1E3A4C] dark:text-mist dark:hover:bg-night-700',
        className,
      )}
    >
      {open.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
      Chat del proyecto
    </button>
  )
}
