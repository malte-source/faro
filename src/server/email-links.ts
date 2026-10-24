import { appBaseUrl } from '@/lib/mailer'
import { unsubscribeUrl, type UnsubscribeScope } from '@/lib/email-unsub'
import type { EmailLinks } from '@/lib/email-templates'

/**
 * Links for one person's email: the public base URL (read at runtime) and their signed unsubscribe URL.
 * `scope` is what the one-click header of THAT email switches off: the digest only, or all email
 * (instant emails use 'all': someone tapping "unsubscribe" on an alert wants the alerts to stop).
 */
export function emailLinksFor(userId: string, scope: UnsubscribeScope = 'digest'): EmailLinks {
  const baseUrl = appBaseUrl()
  const url = unsubscribeUrl(baseUrl, userId, process.env.AUTH_SECRET)
  return { baseUrl, unsubscribeUrl: url && scope === 'all' ? `${url}&scope=all` : url }
}
