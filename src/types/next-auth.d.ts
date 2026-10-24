import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    accessToken?: string
    user: {
      googleId?: string
      /** Supabase user UUID — cached in JWT to avoid a DB round-trip on every tRPC request */
      supabaseId?: string
      /** Supabase org UUID — cached in JWT alongside supabaseId */
      orgId?: string
      /** Role from users.role — used to gate admin-only UI like the "see whole org" toggle */
      role?: string
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string
    refreshToken?: string
    /** Milliseconds-since-epoch when accessToken expires (refresh threshold) */
    accessTokenExpires?: number
    /** Set when token refresh fails — caller can decide to force re-auth */
    error?: string
    googleId?: string
    /** Supabase user UUID — populated once at sign-in, persisted across refreshes */
    supabaseId?: string
    /** Supabase org UUID — populated once at sign-in */
    orgId?: string
    /** Role from users.role — refreshed on each session callback */
    role?: string
  }
}
