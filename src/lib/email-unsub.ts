import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed unsubscribe links.
 *
 *   token = base64url( HMAC-SHA256( AUTH_SECRET, `${userId}:email-unsubscribe` ) )
 *
 * The token proves the link was minted by Faro for that exact person; it carries no expiry on purpose
 * (an old email must still be able to unsubscribe). It only authorises ONE thing — turning email off —
 * and the route requires a POST (a deliberate click) so mail scanners that GET every link cannot do it.
 */

const PURPOSE = 'email-unsubscribe'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function signUnsubscribeToken(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${userId}:${PURPOSE}`).digest('base64url')
}

/** Constant-time check. A missing secret or a malformed id never verifies. */
export function verifyUnsubscribeToken(userId: string, token: string, secret: string | undefined): boolean {
  if (!secret || !token || !UUID.test(userId)) return false
  const expected = Buffer.from(signUnsubscribeToken(userId, secret))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Absolute unsubscribe URL, or null when there is no secret to sign with (the footer then only links to preferences). */
export function unsubscribeUrl(baseUrl: string, userId: string, secret: string | undefined): string | null {
  if (!secret) return null
  const t = signUnsubscribeToken(userId, secret)
  return `${baseUrl}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(t)}`
}

/** The two things an unsubscribe can switch off. */
export type UnsubscribeScope = 'digest' | 'all'

export function parseScope(value: unknown): UnsubscribeScope {
  return value === 'all' ? 'all' : 'digest'
}
