/**
 * Google Chat — outbound notifications via Incoming Webhooks.
 *
 * Why webhooks (not the full Chat API)? Webhooks need ZERO Google
 * verification or OAuth — a space admin pastes the webhook URL into FARO,
 * and we POST messages to it. Perfect for the internal TPY phase. For the
 * SaaS phase we can layer the proper Chat App on top (slash commands,
 * inbound messages) without rewriting outbound.
 *
 * Webhook URL format:
 *   https://chat.googleapis.com/v1/spaces/{SPACE_ID}/messages?key=...&token=...
 *
 * Payload formats:
 *   Simple text:  { text: "..." }
 *   Rich card:    { cardsV2: [{ cardId, card: { header, sections, ... } }] }
 */

export interface ChatTextMessage {
  text: string
}

export interface ChatCardMessage {
  cardsV2: Array<{
    cardId: string
    card: ChatCard
  }>
}

export interface ChatCard {
  header?: {
    title?: string
    subtitle?: string
    imageUrl?: string
    imageType?: 'CIRCLE' | 'SQUARE'
  }
  sections?: Array<{
    header?: string
    collapsible?: boolean
    widgets: Array<ChatWidget>
  }>
}

export type ChatWidget =
  | { textParagraph: { text: string } }
  | { decoratedText: { topLabel?: string; text: string; bottomLabel?: string; startIcon?: { knownIcon?: string; iconUrl?: string } } }
  | { divider: Record<string, never> }
  | { buttonList: { buttons: Array<{ text: string; onClick: { openLink: { url: string } } }> } }

export type ChatMessage = ChatTextMessage | ChatCardMessage | (ChatTextMessage & ChatCardMessage)

/**
 * Validate that a string looks like a Google Chat webhook URL. Cheap
 * client/server check — doesn't actually contact Google.
 */
export function isValidWebhookUrl(url: string): boolean {
  return /^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^/]+\/messages\?/.test(url)
}

/**
 * POST a message payload to a Google Chat incoming webhook.
 * Throws on non-2xx responses with the body text included.
 */
export async function postToChatWebhook(
  webhookUrl: string,
  payload: ChatMessage,
): Promise<void> {
  if (!isValidWebhookUrl(webhookUrl)) {
    throw new Error('Webhook URL inválida — debe empezar con https://chat.googleapis.com/v1/spaces/')
  }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Chat ${res.status}: ${text.slice(0, 200)}`)
  }
}

/**
 * Convenience: build a card payload for a "new project created" event.
 */
export function newProjectCard(p: {
  code: string
  name: string
  status: string
  priority: string
  createdBy: string
  endDate: string | null
  url: string
}): ChatCardMessage {
  const widgets: ChatWidget[] = [
    { decoratedText: { topLabel: 'Creado por', text: p.createdBy } },
    { decoratedText: { topLabel: 'Estado', text: p.status } },
    { decoratedText: { topLabel: 'Prioridad', text: p.priority } },
  ]
  if (p.endDate) widgets.push({ decoratedText: { topLabel: 'Vence', text: p.endDate } })
  widgets.push({
    buttonList: { buttons: [{ text: 'Abrir en FARO', onClick: { openLink: { url: p.url } } }] },
  })

  return {
    cardsV2: [{
      cardId: `faro-newproject-${p.code}`,
      card: {
        header: {
          title: `Nuevo proyecto: ${p.name}`,
          subtitle: p.code,
        },
        sections: [{ widgets }],
      },
    }],
  }
}

/**
 * Convenience: build a card payload for the weekly digest.
 */
export function weeklyDigestCard(d: {
  headline: string
  highlights: string[]
  risks: string[]
  asks: string[]
  nextWeekFocus: string
  url: string
}): ChatCardMessage {
  const bulletList = (items: string[]) => items.map(i => `• ${i}`).join('\n')

  const widgets: ChatWidget[] = [
    { textParagraph: { text: `<b>${d.headline}</b>` } },
  ]
  if (d.highlights.length) widgets.push({ divider: {} },
    { decoratedText: { topLabel: 'Destacados', text: bulletList(d.highlights) } })
  if (d.risks.length) widgets.push({ divider: {} },
    { decoratedText: { topLabel: 'Riesgos', text: bulletList(d.risks) } })
  if (d.asks.length) widgets.push({ divider: {} },
    { decoratedText: { topLabel: 'Decisiones pendientes', text: bulletList(d.asks) } })
  if (d.nextWeekFocus) widgets.push({ divider: {} },
    { decoratedText: { topLabel: 'Foco próxima semana', text: d.nextWeekFocus } })
  widgets.push({
    buttonList: { buttons: [{ text: 'Ver en FARO', onClick: { openLink: { url: d.url } } }] },
  })

  return {
    cardsV2: [{
      cardId: `faro-digest-${Date.now()}`,
      card: {
        header: { title: 'Digest semanal · FARO' },
        sections: [{ widgets }],
      },
    }],
  }
}
