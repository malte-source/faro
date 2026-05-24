import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { createServerSupabaseClient } from '@/lib/supabase'

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
          // Only request basic scopes for sign-in.
          // Sensitive scopes (calendar, drive, gmail) require Google verification
          // and will be requested incrementally when those features are enabled.
          scope: 'openid email profile',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.googleId = profile?.sub
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string
      session.user.googleId = token.googleId as string
      return session
    },
    async signIn({ user, account }) {
      if (!user.email) return false
      try {
        const supabase = await createServerSupabaseClient()
        const { data: existingUser } = await supabase
          .from('users')
          .select('id, org_id')
          .eq('email', user.email)
          .single()

        if (!existingUser) {
          // New user — create org + user (onboarding flow handles the rest)
          const { data: org } = await supabase
            .from('organizations')
            .insert({ name: `${user.name}'s Workspace`, slug: user.email?.split('@')[0] })
            .select('id')
            .single()

          if (org) {
            await supabase.from('users').insert({
              email: user.email,
              name: user.name ?? user.email.split('@')[0],
              avatar_url: user.image ?? null,
              google_id: account?.providerAccountId ?? null,
              org_id: org.id,
              role: 'owner',
            })
          }
        }
        return true
      } catch {
        return true
      }
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
})
