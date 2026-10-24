'use client'

import { Bell, BellOff, CheckSquare, Copy, LogOut, MessageSquareReply, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { BottomSheet } from '@/components/mobile/bottom-sheet'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'
import { haptic } from '@/components/mobile/haptics'
import { ExtractTasksButton } from '@/components/chat/extract-tasks-button'
import { QUICK_EMOJIS } from '@/components/chat/chat-utils'
import { UserAvatar } from '@/components/chat/user-avatar'
import { cn } from '@/lib/utils'

interface Member { id: string; name: string; avatarUrl: string | null; role: string }

/** Channel / DM info as a bottom sheet: members, mute, AI helpers, leave. Replaces the desktop popovers on phones. */
export function ChannelInfoSheet({
  open, onClose, channelId, title, description, isDm, members, membersLoading, meId, isMember, muted, onToggleMute,
  onSummarize, summarizing, canLeave, onLeave,
}: {
  open: boolean
  onClose: () => void
  channelId: string
  title: string
  description?: string | null
  isDm: boolean
  members: Member[]
  membersLoading: boolean
  meId?: string
  isMember: boolean
  muted: boolean
  onToggleMute: () => void
  onSummarize: (mode: 'unread' | 'recent') => void
  summarizing: boolean
  canLeave: boolean
  onLeave: () => void
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title} description={description || (isDm ? 'Mensaje directo' : undefined)}>
      <div className="space-y-5 pb-2 pt-2">
        {isMember && (
          <InsetGroup label="Faro">
            <ListRow
              onClick={() => { onClose(); onSummarize('unread') }}
              disabled={summarizing}
              leading={<IconTile tone="signal"><Sparkles /></IconTile>}
              title="¿Qué me perdí?"
              subtitle="Resumen de lo que no has leído"
            />
            <ListRow
              onClick={() => { onClose(); onSummarize('recent') }}
              disabled={summarizing}
              leading={<IconTile tone="neutral"><Sparkles /></IconTile>}
              title="Resumir los últimos mensajes"
            />
            <ExtractTasksButton channelId={channelId} variant="row" />
          </InsetGroup>
        )}

        {isMember && (
          <InsetGroup>
            <ListRow
              onClick={onToggleMute}
              leading={<IconTile tone="neutral">{muted ? <Bell /> : <BellOff />}</IconTile>}
              title={muted ? 'Activar avisos' : 'Silenciar'}
              subtitle={muted ? 'Vuelves a ver el contador de no leídos' : 'Sin contador de no leídos'}
            />
          </InsetGroup>
        )}

        <InsetGroup label={`Miembros${members.length ? ` · ${members.length}` : ''}`}>
          {membersLoading ? (
            <div className="h-14 animate-pulse bg-border-soft" />
          ) : members.length === 0 ? (
            <ListRow title="Sin miembros" />
          ) : (
            members.map(m => (
              <ListRow
                key={m.id}
                leading={<UserAvatar name={m.name} src={m.avatarUrl} className="h-10 w-10 text-xs" />}
                title={`${m.name}${m.id === meId ? ' (tú)' : ''}`}
                trailing={m.role === 'admin' ? <span className="font-mono text-[10px] uppercase tracking-wider">admin</span> : undefined}
              />
            ))
          )}
        </InsetGroup>

        {canLeave && (
          <InsetGroup>
            <ListRow onClick={() => { onClose(); onLeave() }} leading={<IconTile tone="danger"><LogOut /></IconTile>} title="Salir del canal" destructive />
          </InsetGroup>
        )}
      </div>
    </BottomSheet>
  )
}

/**
 * Long-press menu of a message (iOS context menu / One UI "message options"):
 * a row of quick reactions on top, then the actions that apply.
 */
export function MessageActionSheet({
  open, onClose, onReact, onReply, onTask, onCopy, onEdit, onDelete, mineReactions,
}: {
  open: boolean
  onClose: () => void
  onReact: (emoji: string) => void
  onReply?: () => void
  onTask?: () => void
  onCopy: () => void
  onEdit?: () => void
  onDelete?: () => void
  /** Emojis I already reacted with (shown pressed). */
  mineReactions: Set<string>
}) {
  const act = (fn: () => void) => () => { onClose(); fn() }
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="space-y-4 pb-2 pt-3">
        <div className="flex justify-between gap-1 rounded-[16px] border border-border bg-surface p-1.5" role="group" aria-label="Reaccionar">
          {QUICK_EMOJIS.map(e => (
            <button
              key={e}
              type="button"
              aria-label={`Reaccionar con ${e}`}
              aria-pressed={mineReactions.has(e)}
              onClick={() => { haptic(); onClose(); onReact(e) }}
              className={cn(
                'flex h-11 min-w-0 flex-1 items-center justify-center rounded-xl text-[22px] transition-transform active:scale-90',
                mineReactions.has(e) && 'bg-signal/25',
              )}
            >
              {e}
            </button>
          ))}
        </div>

        <InsetGroup>
          {onReply && <ListRow onClick={act(onReply)} leading={<IconTile tone="neutral"><MessageSquareReply /></IconTile>} title="Responder en hilo" />}
          {onTask && <ListRow onClick={act(onTask)} leading={<IconTile tone="success"><CheckSquare /></IconTile>} title="Convertir en tarea" />}
          <ListRow onClick={act(onCopy)} leading={<IconTile tone="neutral"><Copy /></IconTile>} title="Copiar texto" />
          {onEdit && <ListRow onClick={act(onEdit)} leading={<IconTile tone="neutral"><Pencil /></IconTile>} title="Editar" />}
        </InsetGroup>

        {onDelete && (
          <InsetGroup>
            <ListRow onClick={act(onDelete)} leading={<IconTile tone="danger"><Trash2 /></IconTile>} title="Borrar mensaje" destructive />
          </InsetGroup>
        )}
      </div>
    </BottomSheet>
  )
}
