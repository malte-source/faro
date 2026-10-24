import { NextResponse } from 'next/server'

// The VAPID public key is public by design, but it is read at request time (not NEXT_PUBLIC_*,
// which is frozen into the bundle at build) so rotating it never needs a rebuild.
export const dynamic = 'force-dynamic'

export function GET() {
  const key = process.env.VAPID_PUBLIC_KEY?.trim()
  if (!key) return NextResponse.json({ configured: false }, { status: 200 })
  return NextResponse.json({ configured: true, key }, { headers: { 'Cache-Control': 'no-store' } })
}
