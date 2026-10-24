import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server/routers'

type Outputs = inferRouterOutputs<AppRouter>

export type ChannelsData = Outputs['chat']['channels']
export type ChannelItem = ChannelsData['channels'][number]
export type BrowsableChannel = ChannelsData['browsable'][number]
export type MessagesData = Outputs['chat']['messages']
export type ChatMessage = MessagesData['messages'][number]
export type Directory = Outputs['membership']['directory']
export type DirectoryPerson = Directory['people'][number]
export type SearchHit = Outputs['chat']['search'][number]

/** A message the user just wrote, shown immediately while the server confirms it. */
export interface PendingMessage {
  tempId: string
  body: string
  mentionIds: string[]
  createdAt: string
  status: 'sending' | 'failed'
  error?: string
}
