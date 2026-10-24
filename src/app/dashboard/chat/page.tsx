import { Suspense } from 'react'
import { ChatApp } from '@/components/chat/chat-app'

export default function ChatPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Suspense fallback={<div className="flex-1 animate-pulse bg-mist/60 dark:bg-night" aria-busy="true" aria-label="Cargando el chat" />}>
        <ChatApp />
      </Suspense>
    </div>
  )
}
