'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { User, Building2, Check, HelpCircle } from 'lucide-react'

const TOUR_STORAGE_KEY = 'faro:onboarding:v1'

type Tab = 'profile' | 'org' | 'help'

const PLAN_LABELS: Record<string, string> = {
  free: 'Free', team: 'Team', business: 'Business', enterprise: 'Enterprise',
}
const PLAN_VARIANTS: Record<string, 'secondary' | 'default' | 'success' | 'warning'> = {
  free: 'secondary', team: 'default', business: 'success', enterprise: 'warning',
}

export function SettingsOverview() {
  const [tab, setTab] = useState<Tab>('profile')
  const { data: session } = useSession()

  const { data: members } = trpc.team.members.useQuery()
  const utils = trpc.useUtils()

  const me = members?.find(m => m.email === session?.user?.email)

  const [name, setName] = useState('')
  const [position, setPosition] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (me) {
      setName(me.name)
      setPosition(me.position ?? '')
    }
  }, [me])

  const updateMember = trpc.team.updateMember.useMutation({
    onSuccess: () => {
      utils.team.members.invalidate()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  function saveProfile() {
    if (!me) return
    updateMember.mutate({ userId: me.id, name: name.trim(), position: position.trim() || null })
  }

  const [tourRestarted, setTourRestarted] = useState(false)

  function restartTour() {
    localStorage.removeItem(TOUR_STORAGE_KEY)
    setTourRestarted(true)
    // Trigger reload so tour picks up fresh state
    window.location.reload()
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: 'Mi perfil', icon: <User className="h-4 w-4" /> },
    { id: 'org', label: 'Organización', icon: <Building2 className="h-4 w-4" /> },
    { id: 'help', label: 'Ayuda', icon: <HelpCircle className="h-4 w-4" /> },
  ]

  return (
    <div className="max-w-2xl space-y-6">
      {/* Tab nav */}
      <div className="flex gap-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {tab === 'profile' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={session?.user?.image ?? undefined} />
              <AvatarFallback className="text-lg font-semibold bg-indigo-50 text-indigo-700">
                {session?.user?.name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() ?? '?'}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium text-slate-600">Foto de perfil</p>
              <p className="text-xs text-slate-400 mt-0.5">Sincronizada con tu cuenta Google</p>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Nombre completo</Label>
              <Input id="s-name" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-email">Email</Label>
              <Input id="s-email" value={session?.user?.email ?? ''} disabled className="bg-slate-50 text-slate-500" />
              <p className="text-xs text-slate-400">El email se gestiona desde Google</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-pos">Cargo / Posición</Label>
              <Input id="s-pos" placeholder="Ej: Project Manager" value={position} onChange={e => setPosition(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <Button
              onClick={saveProfile}
              disabled={!name.trim() || updateMember.isPending}
            >
              {saved ? (
                <><Check className="h-4 w-4" /> Guardado</>
              ) : updateMember.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </div>
      )}

      {/* Help tab */}
      {tab === 'help' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">Tour de bienvenida</h3>
            <p className="text-sm text-slate-500">
              Volvé a ver el tour interactivo que explica las funciones principales de Faro.
            </p>
            <button
              onClick={restartTour}
              disabled={tourRestarted}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
            >
              <HelpCircle className="h-4 w-4" />
              {tourRestarted ? 'Recargando…' : 'Reiniciar tour'}
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Atajos de teclado</h3>
            <div className="space-y-2 text-sm">
              {[
                ['⌘K', 'Abrir paleta de comandos'],
                ['N', 'Nueva tarea rápida'],
                ['G D', 'Ir al Dashboard'],
                ['G P', 'Ir a Proyectos'],
                ['G K', 'Ir al Kanban'],
                ['G T', 'Ir a Tareas'],
              ].map(([kbd, desc]) => (
                <div key={kbd} className="flex items-center justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-600">{desc}</span>
                  <kbd className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-500">{kbd}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Org tab */}
      {tab === 'org' && me && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">Datos de la organización</h3>
            <div className="grid gap-3">
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-sm text-slate-500">Plan actual</span>
                <Badge variant={PLAN_VARIANTS['free'] ?? 'secondary'}>
                  {PLAN_LABELS['free']}
                </Badge>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-sm text-slate-500">Tu rol</span>
                <Badge variant="secondary">{me.role}</Badge>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-50">
                <span className="text-sm text-slate-500">Miembro desde</span>
                <span className="text-sm text-slate-700">{new Date(me.joined_at).toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Integración Google</h3>
            <div className="flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <p className="text-sm text-green-700 font-medium">Google OAuth conectado</p>
            </div>
            <p className="text-xs text-slate-400">
              El acceso se gestiona a través de Google Workspace. Contactá al administrador para cambiar permisos.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Stack tecnológico</h3>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
              {[
                ['Frontend', 'Next.js 16 + TypeScript'],
                ['Base de datos', 'Supabase (PostgreSQL)'],
                ['API', 'tRPC v11'],
                ['Autenticación', 'NextAuth.js + Google OAuth'],
                ['Infraestructura', 'Google Cloud Run'],
                ['Región', 'southamerica-east1'],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <span className="font-medium text-slate-600">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
