'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { ChannelList, type SelectOptions } from '@/components/chat/channel-list'
import { MobileChannelList } from '@/components/chat/mobile-channel-list'
import { Conversation } from '@/components/chat/conversation'
import { NewChannelDialog, NewDmDialog } from '@/components/chat/dialogs'
import { useIsDesktop, usePageVisible, useVisualViewportBox } from '@/components/chat/hooks'
import { ThreadPanel } from '@/components/chat/thread-panel'

/**
 * Chat shell: channel list · conversation · thread. The selected channel,
 * thread and highlighted message live in the URL
 * (/dashboard/chat?c=<channel>&t=<thread root>&m=<message>) so links and
 * reloads land where you were.
 *
 * Phones get an iOS Messages-style stack: the conversation list is the tab
 * root; opening a conversation (and a thread inside it) PUSHES a history
 * entry and covers the tab bar full-screen, so the system back gesture and the
 * Back chevron both pop one level. Desktop keeps the three panes and uses
 * `replace` so history isn't flooded by every channel click.
 */
export function ChatApp() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const utils = trpc.useUtils()
  const isDesktop = useIsDesktop()
  const visible = usePageVisible()
  const viewportBox = useVisualViewportBox()

  const selectedId = params.get('c')
  const threadId = params.get('t')
  const highlightId = params.get('m')

  const [channelDialog, setChannelDialog] = useState(false)
  const [dmDialog, setDmDialog] = useState(false)

  // Make sure General / empresa / capa channels exist and I'm in mine.
  const bootstrap = trpc.chat.bootstrap.useMutation({
    onSuccess: () => void utils.chat.channels.invalidate(),
  })
  const bootstrapped = useRef(false)
  const { mutate: runBootstrap } = bootstrap
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    runBootstrap()
  }, [runBootstrap])

  const channelsQuery = trpc.chat.channels.useQuery(undefined, {
    enabled: bootstrap.isSuccess || bootstrap.isError,
    refetchInterval: visible ? 20_000 : false,
    refetchIntervalInBackground: false,
  })

  // History entries this screen pushed on a phone (so closing = router.back()).
  const pushed = useRef(0)
  useEffect(() => {
    if (!selectedId && !threadId) pushed.current = 0
  }, [selectedId, threadId])

  const setParams = useCallback(
    (next: Record<string, string | null>, mode: 'replace' | 'push' = 'replace') => {
      const sp = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(next)) {
        if (v) sp.set(k, v)
        else sp.delete(k)
      }
      const qs = sp.toString()
      const url = qs ? `${pathname}?${qs}` : pathname
      if (mode === 'push') {
        pushed.current++
        router.push(url, { scroll: false })
      } else {
        router.replace(url, { scroll: false })
      }
    },
    [params, pathname, router],
  )

  const select = useCallback(
    (channelId: string, opts?: SelectOptions) =>
      setParams({ c: channelId, m: opts?.messageId ?? null, t: opts?.threadId ?? null }, isDesktop ? 'replace' : 'push'),
    [setParams, isDesktop],
  )

  // Desktop opens General by default; phones start on the list.
  const channels = channelsQuery.data?.channels
  useEffect(() => {
    if (selectedId || !isDesktop || !channels?.length) return
    const general = channels.find(c => c.slug === 'general') ?? channels[0]
    setParams({ c: general.id })
  }, [selectedId, isDesktop, channels, setParams])

  const selected = channels?.find(c => c.id === selectedId)
  const loading = bootstrap.isIdle || bootstrap.isPending || channelsQuery.isLoading
  const error = bootstrap.error?.message ?? channelsQuery.error?.message ?? null

  /** Pop one level on a phone when we pushed it; otherwise rewrite the URL. */
  const pop = useCallback(
    (next: Record<string, string | null>) => {
      if (!isDesktop && pushed.current > 0) {
        pushed.current--
        router.back()
      } else {
        setParams(next)
      }
    },
    [isDesktop, router, setParams],
  )
  const closeConversation = useCallback(() => {
    // A thread open on top of the conversation was pushed too: pop both.
    if (!isDesktop && threadId && pushed.current > 1) {
      const steps = pushed.current
      pushed.current = 0
      window.history.go(-steps)
      return
    }
    pop({ c: null, t: null, m: null })
  }, [isDesktop, threadId, pop])
  const closeThread = useCallback(() => pop({ t: null }), [pop])
  const clearHighlight = useCallback(() => setParams({ m: null }), [setParams])
  const openThread = useCallback((messageId: string) => setParams({ t: messageId }, isDesktop ? 'replace' : 'push'), [setParams, isDesktop])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background md:bg-surface">
      {/* Phone: conversation list (stays mounted under the pushed conversation, like iOS). */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <MobileChannelList
          data={channelsQuery.data}
          isLoading={loading}
          error={error}
          onSelect={select}
          onNewChannel={() => setChannelDialog(true)}
          onNewDm={() => setDmDialog(true)}
          onRetry={() => {
            bootstrapped.current = true
            runBootstrap()
          }}
        />
      </div>

      {/* Desktop: sidebar list. */}
      <div
        className={cn(
          'hidden w-72 shrink-0 flex-col border-r border-stone bg-mist/60 dark:border-night-700 dark:bg-night lg:w-80',
          // With a thread open the list yields its space below lg.
          selectedId && threadId ? 'lg:flex' : 'md:flex',
        )}
      >
        <ChannelList
          data={channelsQuery.data}
          isLoading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={select}
          onNewChannel={() => setChannelDialog(true)}
          onNewDm={() => setDmDialog(true)}
          onRetry={() => {
            bootstrapped.current = true
            runBootstrap()
          }}
        />
      </div>

      <main
        style={!isDesktop && selectedId ? { top: viewportBox.top, height: viewportBox.height } : undefined}
        className={cn(
          'min-w-0 flex-col md:flex md:flex-1',
          // Phone: full-screen push above the tab bar; desktop: the middle pane.
          selectedId
            ? 'fixed inset-x-0 bottom-0 top-0 z-[45] flex h-dvh bg-background md:static md:z-auto md:h-auto md:bg-transparent'
            : 'hidden',
        )}
      >
        {selectedId ? (
          <Conversation
            key={selectedId}
            channelId={selectedId}
            channel={selected}
            highlightMessageId={highlightId}
            onHighlightDone={clearHighlight}
            onOpenThread={openThread}
            onBack={closeConversation}
            onLeft={() => setParams({ c: null, t: null, m: null })}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessageCircle}
              title={loading ? 'Cargando el chat…' : 'Elige una conversación'}
              description={loading ? undefined : 'Escoge un canal o un mensaje directo de la lista, o crea uno nuevo.'}
            />
          </div>
        )}
      </main>

      {selectedId && threadId && (
        <ThreadPanel
          channelId={selectedId}
          parentId={threadId}
          channelWorkspaceId={selected?.workspaceId ?? null}
          onClose={closeThread}
        />
      )}

      <NewChannelDialog open={channelDialog} onOpenChange={setChannelDialog} onCreated={id => select(id)} />
      <NewDmDialog open={dmDialog} onOpenChange={setDmDialog} onOpened={id => select(id)} />
    </div>
  )
}
