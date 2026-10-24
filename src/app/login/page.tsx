import { auth, signIn } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { FaroMark } from '@/components/brand/logo'

export default async function LoginPage() {
  const session = await auth()
  if (session) redirect('/dashboard')

  return (
    // Flat Noche — no gradient. Gradients are explicitly out of brand
    // (Manual de Marca Faro §Login).
    <div className="min-h-screen flex items-center justify-center bg-[#0A1A26] relative overflow-hidden">
      {/* Bottom Google-color ribbon — the one place non-brand color is
          required (Google's own brand colors on the sign-in affordance). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-90"
        style={{
          background:
            'linear-gradient(90deg, #4285F4 0%, #34A853 33%, #FBBC05 66%, #EA4335 100%)',
          clipPath: 'polygon(0 60%, 100% 30%, 100% 100%, 0 100%)',
        }}
      />

      <div className="relative w-full max-w-md px-8 py-10 bg-white/[0.06] border border-[#FFB020]/20 rounded-[18px]">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-5">
            <FaroMark plain size={48} />
          </div>
          <h1 className="font-display text-[30px] font-extrabold tracking-[-0.035em] text-[#F7F4EF]">
            Faro
          </h1>
          <p className="text-[#9DB0BC] mt-2 text-[14px]">
            Tus proyectos, con luz propia.
          </p>
        </div>

        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/dashboard' })
          }}
        >
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-[#F7F4EF] text-[#0A1A26] rounded-xl font-semibold hover:bg-surface transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continuar con Google
          </button>
        </form>

        <p className="text-center text-[11px] text-[#6E8290] mt-6">
          Al continuar aceptas los Términos y la Política de Privacidad de Faro.
        </p>
      </div>
    </div>
  )
}
