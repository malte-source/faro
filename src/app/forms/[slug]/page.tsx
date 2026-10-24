import { createAdminSupabaseClient } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import { PublicForm } from './public-form'
import type { IntakeField } from '@/types/database'

/**
 * Public form page — accessible without auth.
 *
 * URL: /forms/{slug}
 *
 * Loads form definition server-side (RSC), then renders the client component
 * that handles the actual submission flow. If the slug doesn't exist OR the
 * form is inactive, returns a 404 — same code path so bots can't enumerate.
 */
export default async function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = createAdminSupabaseClient()

  const { data: form } = await supabase
    .from('intake_forms')
    .select('slug, title, description, branding_name, fields, success_message, is_active')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!form) notFound()

  return (
    <main className="min-h-screen bg-gradient-to-br from-mist to-signal-wash/30 dark:from-night dark:to-[#12293A]">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <PublicForm
          slug={form.slug}
          title={form.title}
          description={form.description}
          brandingName={form.branding_name}
          fields={(form.fields as IntakeField[] | null) ?? []}
          successMessage={form.success_message}
        />
        <p className="mt-8 text-center text-[11px] text-graphite">
          Procesado por <a href="/" className="font-medium text-signal-ink hover:underline">FARO</a> · Gestión de proyectos
        </p>
      </div>
    </main>
  )
}

export const metadata = {
  title: 'Formulario · FARO',
}
