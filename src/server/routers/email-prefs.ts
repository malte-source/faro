import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc/server'
import { tryConsume } from '@/lib/rate-limit'
import { todayInTZ } from '@/lib/tz'
import { isEmailConfigured, sendMail } from '@/lib/mailer'
import { buildTestEmail } from '@/lib/email-templates'
import { EMAIL_CONFIGURABLE_KINDS, emailRuleFor, resolveEmailPrefs } from '@/lib/email-prefs'
import { KIND_META, type NotificationKind } from '@/lib/notify-core'
import { emailLinksFor } from '@/server/email-links'

/**
 * Email preferences ("Resumen por email" in Avisos). Separate from the push/inbox preferences in
 * notifications.ts. Every procedure copes with the email columns not being migrated yet: reading falls
 * back to the defaults and says `available: false`; writing explains what is missing.
 */

const COLUMNS = 'email_digest, digest_hour, email_instant, email_kinds, last_digest_at'

/** Email-specific wording where the generic notification label would mislead. */
const LABEL_OVERRIDES: Partial<Record<NotificationKind, { label: string; description: string }>> = {
  task_assigned: { label: 'Tareas que te asignan', description: 'Por defecto solo si vencen en 48 horas o menos.' },
  task_review: { label: 'Revisiones de tareas', description: 'Cuando te piden revisar algo.' },
  doc_review: { label: 'Documentos por revisar', description: 'Cuando te piden revisar o aprobar un documento.' },
  cost_run: { label: 'Cargos entre empresas', description: 'Cuando hay un reparto de costos listo para aprobar (solo Dirección).' },
}

const isMissingColumn = (error: { code?: string; message?: string }) =>
  error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find .* column/i.test(error.message ?? '')

const SMTP_PROBLEMS: Record<string, string> = {
  EAUTH: 'Google rechazó el usuario o la contraseña de aplicación del correo del servidor.',
  ECONNECTION: 'El servidor no pudo conectarse a Google para enviar el correo.',
  ETIMEDOUT: 'El envío tardó demasiado y se canceló.',
}

export const emailPrefsRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('user_notification_prefs')
      .select(COLUMNS)
      .eq('user_id', ctx.me.id)
      .maybeSingle()
    const available = !error
    const prefs = resolveEmailPrefs(available ? (data as never) : null)
    const isDirection = ctx.me.role === 'owner' || ctx.me.role === 'admin'
    return {
      configured: isEmailConfigured(),
      available,
      email: ctx.session.user.email ?? null,
      prefs: { email_digest: prefs.email_digest, digest_hour: prefs.digest_hour, email_instant: prefs.email_instant },
      kinds: EMAIL_CONFIGURABLE_KINDS
        .filter(k => k !== 'cost_run' || isDirection)
        .map(kind => ({
          kind,
          ...(LABEL_OVERRIDES[kind] ?? { label: KIND_META[kind].label, description: KIND_META[kind].description }),
          rule: emailRuleFor(prefs, kind),
        })),
    }
  }),

  set: protectedProcedure
    .input(z.object({
      email_digest: z.enum(['off', 'daily', 'weekly']).optional(),
      digest_hour: z.number().int().min(0).max(23).optional(),
      email_instant: z.boolean().optional(),
      /** true = always email this kind, false = never, null = back to the default rule. */
      email_kinds: z.record(z.string(), z.boolean().nullable()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: current, error: readError } = await ctx.supabase
        .from('user_notification_prefs')
        .select('email_kinds')
        .eq('user_id', ctx.me.id)
        .maybeSingle()
      if (readError) {
        if (isMissingColumn(readError)) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Falta aplicar la migración de correo en la base de datos.' })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No se pudieron guardar las preferencias.' })
      }

      const known = new Set<string>(EMAIL_CONFIGURABLE_KINDS)
      const kinds = { ...((current?.email_kinds ?? {}) as Record<string, boolean>) }
      for (const [k, v] of Object.entries(input.email_kinds ?? {})) {
        if (!known.has(k)) continue
        if (v === null) delete kinds[k]
        else kinds[k] = v
      }

      const { error } = await ctx.supabase.from('user_notification_prefs').upsert(
        {
          user_id: ctx.me.id,
          ...(input.email_digest !== undefined && { email_digest: input.email_digest }),
          ...(input.digest_hour !== undefined && { digest_hour: input.digest_hour }),
          ...(input.email_instant !== undefined && { email_instant: input.email_instant }),
          ...(input.email_kinds !== undefined && { email_kinds: kinds }),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      if (error) {
        if (isMissingColumn(error)) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Falta aplicar la migración de correo en la base de datos.' })
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No se pudieron guardar las preferencias.' })
      }
      return { ok: true }
    }),

  /** A sample email to my own address, to check the server can send and see how it looks. 3 per hour. */
  sendTest: protectedProcedure.mutation(async ({ ctx }) => {
    if (!isEmailConfigured()) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'El servidor aún no tiene correo configurado.' })
    }
    const to = ctx.session.user.email
    if (!to) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tu cuenta no tiene un correo.' })
    if (!tryConsume(`${ctx.me.id}:emailTest`, { tokensPerMinute: 3 / 60, maxBurst: 3 })) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Ya enviaste 3 correos de prueba en la última hora. Intenta más tarde.' })
    }
    const built = buildTestEmail(ctx.session.user.name ?? '', todayInTZ(undefined, ctx.tz), emailLinksFor(ctx.me.id))
    const result = await sendMail({ to, subject: built.subject, html: built.html, text: built.text, headers: built.headers }, { kind: 'test' })
    if (result.ok) return { sentTo: to }
    if ('skipped' in result) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'El servidor aún no tiene correo configurado.' })
    }
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: SMTP_PROBLEMS[result.error] ?? 'No se pudo enviar el correo de prueba. Revisa la configuración del correo del servidor.',
    })
  }),
})
