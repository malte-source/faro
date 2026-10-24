import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { createAdminSupabaseClient } from '@/lib/supabase'

/**
 * Google API scopes requested at sign-in.
 *
 * OAuth consent for the FARO project is configured as "Internal" in
 * Google Cloud Console, so these sensitive scopes work without external
 * Google verification — they only apply to users of the @thecrewagencia.com
 * Workspace.
 */
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  // Calendar Events — create/update events for project deadlines.
  'https://www.googleapis.com/auth/calendar.events',
  // Drive (file-level scope) — only files the user creates or opens with
  // the app, NOT the full drive. This is the non-sensitive variant.
  'https://www.googleapis.com/auth/drive.file',
  // Sheets read-only — to import the legacy "Matriz de Proyectos TPY" sheet.
  'https://www.googleapis.com/auth/spreadsheets.readonly',
].join(' ')

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Required for Cloud Run: requests arrive via reverse proxy with
  // internal hostname. trustHost lets NextAuth use x-forwarded-* headers.
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          access_type: 'offline',
          prompt: 'consent', // forces refresh_token issuance on every sign-in
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        // ── Initial sign-in: capture all tokens + expiry ────────────────
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        // expires_at is in SECONDS since epoch; convert to ms
        token.accessTokenExpires = account.expires_at
          ? (account.expires_at as number) * 1000
          : Date.now() + 3600_000
        token.googleId = profile?.sub

        // Cache Supabase user data in the JWT so createTRPCContext can skip
        // the users-table DB round-trip on every tRPC request.
        if (token.email && !token.supabaseId) {
          try {
            const ctrl = new AbortController()
            const tid = setTimeout(() => ctrl.abort(), 4000)
            const supabase = createAdminSupabaseClient()
            const { data: user } = await supabase
              .from('users')
              .select('id, org_id')
              .eq('email', token.email as string)
              .abortSignal(ctrl.signal)
              .single()
            clearTimeout(tid)
            if (user) {
              token.supabaseId = user.id
              token.orgId = user.org_id
            }
          } catch {
            // Non-fatal — will be retried on next sign-in
          }
        }
        return token
      }

      // ── Subsequent calls: refresh access_token if it's expired ────────
      // Google access tokens are valid for 1 h. We refresh 1 min before
      // expiry to avoid race conditions with concurrent API calls.
      const expiresAt = (token.accessTokenExpires as number | undefined) ?? 0
      if (Date.now() < expiresAt - 60_000) {
        return token // still fresh
      }

      const refreshToken = token.refreshToken as string | undefined
      if (!refreshToken) return token // can't refresh — first sign-in didn't grant offline

      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.AUTH_GOOGLE_ID!,
            client_secret: process.env.AUTH_GOOGLE_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        })
        const refreshed: {
          access_token: string
          expires_in: number
          refresh_token?: string
        } = await res.json()
        if (!res.ok) throw refreshed

        token.accessToken = refreshed.access_token
        token.accessTokenExpires = Date.now() + refreshed.expires_in * 1000
        // refresh_token isn't always returned — keep the existing one if not
        if (refreshed.refresh_token) token.refreshToken = refreshed.refresh_token
        return token
      } catch (err) {
        console.error('[auth jwt] token refresh failed:', err)
        // Don't clear the token — let the user keep their session, just
        // mark that Google API calls will fail until next sign-in.
        token.error = 'RefreshAccessTokenError'
        return token
      }
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string
      session.user.googleId = token.googleId as string
      if (token.supabaseId) session.user.supabaseId = token.supabaseId as string
      if (token.orgId) session.user.orgId = token.orgId as string
      return session
    },
    async signIn({ user, account }) {
      if (!user.email) return false
      try {
        const supabase = createAdminSupabaseClient()
        const { data: existingUser, error: lookupErr } = await supabase
          .from('users')
          .select('id, org_id')
          .eq('email', user.email)
          .single()

        if (lookupErr && lookupErr.code !== 'PGRST116') {
          console.error('[auth signIn] user lookup failed:', lookupErr.code, lookupErr.message)
          return true
        }

        if (!existingUser) {
          // ── New user signup: provision a Personal workspace ──────────────
          // Every signup gets their own org with workspace_type='personal' and
          // plan='free'. They can later create / be invited to Team workspaces.
          // The order matters: org → user → org_membership → workspace, all
          // best-effort (we never block sign-in on Supabase hiccups).
          const slug = `${user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`
          const displayName = user.name ?? user.email.split('@')[0]
          const { data: org, error: orgErr } = await supabase
            .from('organizations')
            .insert({
              name: `${displayName} (Personal)`,
              slug,
              workspace_type: 'personal',
              plan: 'free',
            })
            .select('id')
            .single()

          if (orgErr) {
            console.error('[auth signIn] org creation failed:', orgErr.message)
            return true
          }

          if (org) {
            const { data: newUser, error: userErr } = await supabase
              .from('users')
              .insert({
                email: user.email,
                name: displayName,
                avatar_url: user.image ?? null,
                google_id: account?.providerAccountId ?? null,
                org_id: org.id,
                role: 'owner',
                last_active_org_id: org.id,
              })
              .select('id')
              .single()

            if (userErr) {
              console.error('[auth signIn] user creation failed:', userErr.message)
            } else if (newUser) {
              // Set the owner FK now that we have the user id.
              await supabase
                .from('organizations')
                .update({ owner_user_id: newUser.id })
                .eq('id', org.id)

              // Create membership row (canonical source of truth for "who's
              // in this org"). users.org_id is now just the default pointer.
              await supabase
                .from('org_memberships')
                .insert({ user_id: newUser.id, org_id: org.id, role: 'owner' })

              // Default workspace inside the org — projects need a workspace_id.
              // For personal accounts this stays as the single workspace; team
              // accounts can add more later.
              await supabase
                .from('workspaces')
                .insert({ org_id: org.id, name: 'Main' })
            }
          }
        }
        return true
      } catch (err) {
        console.error('[auth signIn] unexpected error:', err)
        return true
      }
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
})
