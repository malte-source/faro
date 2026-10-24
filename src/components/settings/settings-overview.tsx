'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { User, Building2, Check, HelpCircle, Plug, RotateCcw } from 'lucide-react'
import { GoogleChatCard } from './google-chat-card'
import { TemplatesPanel } from './templates-panel'
import { CustomFieldsPanel } from './custom-fields-panel'
import { SheetImportCard } from './sheet-import-card'
import { TimezoneCard } from './timezone-card'
import { PlanCard } from './plan-card'
import { InsetGroup, ListRow, IconTile } from '@/components/mobile/inset-list'
import { haptic } from '@/components/mobile/haptics'

const TOUR_STORAGE_KEY = 'faro:onboarding:v1'

type Tab = 'profile' | 'org' | 'integrations' | 'help'

const PLAN_LABELS: Record<string, string> = {
  free: 'Free', team: 'Team', business: 'Business', enterprise: 'Enterprise',
}
const PLAN_VARIANTS: Record<string, 'secondary' | 'default' | 'success' | 'warning'> = {
  free: 'secondary', team: 'default', business: 'success', enterprise: 'warning',
}

/** One labelled field inside an inset group (iOS Settings style: label left, value right, 16px input). */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-h-[54px] items-center gap-3 px-4">
      <span className="w-[72px] shrink-0 text-[13px] text-graphite">{label}</span>
      {children}
    </label>
  )
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

  // Seed the form once per person (adjusting state during render, not in an effect).
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (me && seededFor !== me.id) {
    setSeededFor(me.id)
    setName(me.name)
    setPosition(me.position ?? '')
  }

  const updateMember = trpc.team.updateMember.useMutation({
    onSuccess: () => {
      utils.team.members.invalidate()
      setSaved(true)
      haptic('success')
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
    { id: 'integrations', label: 'Integraciones', icon: <Plug className="h-4 w-4" /> },
    { id: 'help', label: 'Ayuda', icon: <HelpCircle className="h-4 w-4" /> },
  ]

  const initials = session?.user?.name?.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() ?? '?'
  const joined = me ? new Date(me.joined_at).toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' }) : ''

  return (
    <div className="max-w-2xl space-y-5 md:space-y-6">
      {/* Workspace plan card — always visible at the top */}
      <PlanCard />

      {/* Tab nav — scrollable pills on phones, the original row from md */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:gap-1 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden" role="tablist" data-no-track data-no-ptr>
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => { haptic(); setTab(t.id) }}
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors md:h-auto md:rounded-lg md:px-3 md:py-1.5 md:text-sm ${
              tab === t.id
                ? 'bg-night text-mist md:bg-signal-wash md:text-night dark:bg-signal dark:text-night md:dark:bg-signal/15 md:dark:text-signal'
                : 'border border-border bg-surface text-graphite active:bg-border-soft md:border-0 md:bg-transparent md:hover:bg-border-soft md:hover:text-body'
            }`}
          >
            <span className="hidden md:inline">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Integrations tab */}
      {tab === 'integrations' && (
        <div className="space-y-4">
          <TimezoneCard />
          <GoogleChatCard />
          <SheetImportCard />
          <TemplatesPanel />
          <CustomFieldsPanel />
        </div>
      )}

      {/* Profile tab */}
      {tab === 'profile' && (
        <>
          {/* Phone */}
          <div className="space-y-5 md:hidden">
            <div className="flex items-center gap-4 rounded-[14px] border border-border bg-surface p-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={session?.user?.image ?? undefined} />
                <AvatarFallback className="bg-signal-wash text-lg font-semibold text-night">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-extrabold tracking-[-0.03em] text-foreground">{session?.user?.name}</p>
                <p className="truncate text-[13px] text-graphite">{session?.user?.email}</p>
                <p className="mt-0.5 text-xs text-graphite">Foto sincronizada con tu cuenta Google</p>
              </div>
            </div>
            <InsetGroup label="Datos personales" footer="El email se gestiona desde Google.">
              <FieldRow label="Nombre">
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="name"
                  className="min-w-0 flex-1 bg-transparent py-3 text-[16px] text-foreground outline-none placeholder:text-graphite/60"
                />
              </FieldRow>
              <FieldRow label="Cargo">
                <input
                  value={position}
                  onChange={e => setPosition(e.target.value)}
                  placeholder="Ej: Project Manager"
                  className="min-w-0 flex-1 bg-transparent py-3 text-[16px] text-foreground outline-none placeholder:text-graphite/60"
                />
              </FieldRow>
            </InsetGroup>
            <Button
              onClick={saveProfile}
              disabled={!name.trim() || updateMember.isPending}
              className="h-12 w-full rounded-[14px] text-[15px]"
            >
              {saved ? (
                <><Check className="h-4 w-4" /> Guardado</>
              ) : updateMember.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>

          {/* Desktop */}
          <div className="hidden space-y-6 rounded-xl border border-border bg-surface p-6 md:block">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={session?.user?.image ?? undefined} />
                <AvatarFallback className="text-lg font-semibold bg-signal-wash text-night">{initials}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium text-graphite">Foto de perfil</p>
                <p className="text-xs text-graphite mt-0.5">Sincronizada con tu cuenta Google</p>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="s-name">Nombre completo</Label>
                <Input id="s-name" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-email">Email</Label>
                <Input id="s-email" value={session?.user?.email ?? ''} disabled className="bg-background text-graphite" />
                <p className="text-xs text-graphite">El email se gestiona desde Google</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-pos">Cargo / Posición</Label>
                <Input id="s-pos" placeholder="Ej: Project Manager" value={position} onChange={e => setPosition(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border-soft">
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
        </>
      )}

      {/* Help tab */}
      {tab === 'help' && (
        <>
          <div className="md:hidden">
            <InsetGroup label="Ayuda" footer="Vuelve a ver el tour interactivo que explica las funciones principales de Faro.">
              <ListRow
                onClick={restartTour}
                disabled={tourRestarted}
                leading={<IconTile tone="signal"><RotateCcw /></IconTile>}
                title={tourRestarted ? 'Recargando…' : 'Reiniciar tour de bienvenida'}
              />
            </InsetGroup>
          </div>

          <div className="hidden space-y-4 md:block">
            <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
              <h3 className="text-sm font-semibold text-body">Tour de bienvenida</h3>
              <p className="text-sm text-graphite">
                Vuelve a ver el tour interactivo que explica las funciones principales de Faro.
              </p>
              <button
                onClick={restartTour}
                disabled={tourRestarted}
                className="flex items-center gap-2 rounded-lg bg-night px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-night-700 disabled:opacity-60 dark:bg-signal dark:text-night dark:hover:bg-signal/90"
              >
                <HelpCircle className="h-4 w-4" />
                {tourRestarted ? 'Recargando…' : 'Reiniciar tour'}
              </button>
            </div>

            <div className="rounded-xl border border-border bg-surface p-6 space-y-3">
              <h3 className="text-sm font-semibold text-body">Atajos de teclado</h3>
              <div className="space-y-2 text-sm">
                {[
                  ['⌘K', 'Abrir paleta de comandos'],
                  ['N', 'Nueva tarea rápida'],
                  ['G D', 'Ir al Dashboard'],
                  ['G P', 'Ir a Proyectos'],
                  ['G K', 'Ir al Kanban'],
                  ['G T', 'Ir a Tareas'],
                ].map(([kbd, desc]) => (
                  <div key={kbd} className="flex items-center justify-between py-1.5 border-b border-border-soft">
                    <span className="text-graphite">{desc}</span>
                    <kbd className="rounded border border-border bg-border-soft px-2 py-0.5 text-xs font-mono text-graphite">{kbd}</kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Org tab */}
      {tab === 'org' && me && (
        <>
          <div className="space-y-5 md:hidden">
            <InsetGroup label="Organización">
              <ListRow title="Plan actual" trailing={<Badge variant={PLAN_VARIANTS['free'] ?? 'secondary'}>{PLAN_LABELS['free']}</Badge>} />
              <ListRow title="Tu rol" trailing={<Badge variant="secondary">{me.role}</Badge>} />
              <ListRow title="Miembro desde" trailing={joined} />
            </InsetGroup>
            <InsetGroup label="Integración Google" footer="El acceso se gestiona a través de Google Workspace. Contacta al administrador para cambiar permisos.">
              <ListRow
                leading={<span className="h-2.5 w-2.5 rounded-full bg-success" />}
                title="Google OAuth conectado"
              />
            </InsetGroup>
          </div>

          <div className="hidden space-y-4 md:block">
            <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
              <h3 className="text-sm font-semibold text-body">Datos de la organización</h3>
              <div className="grid gap-3">
                <div className="flex justify-between items-center py-2 border-b border-border-soft">
                  <span className="text-sm text-graphite">Plan actual</span>
                  <Badge variant={PLAN_VARIANTS['free'] ?? 'secondary'}>
                    {PLAN_LABELS['free']}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border-soft">
                  <span className="text-sm text-graphite">Tu rol</span>
                  <Badge variant="secondary">{me.role}</Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border-soft">
                  <span className="text-sm text-graphite">Miembro desde</span>
                  <span className="text-sm text-body">{joined}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-6 space-y-3">
              <h3 className="text-sm font-semibold text-body">Integración Google</h3>
              <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success-wash px-4 py-3 dark:bg-success/15">
                <div className="h-2 w-2 rounded-full bg-success" />
                <p className="text-sm font-medium text-success">Google OAuth conectado</p>
              </div>
              <p className="text-xs text-graphite">
                El acceso se gestiona a través de Google Workspace. Contacta al administrador para cambiar permisos.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-surface p-6 space-y-3">
              <h3 className="text-sm font-semibold text-body">Stack tecnológico</h3>
              <div className="grid grid-cols-2 gap-2 text-xs text-graphite">
                {[
                  ['Frontend', 'Next.js 16 + TypeScript'],
                  ['Base de datos', 'Supabase (PostgreSQL)'],
                  ['API', 'tRPC v11'],
                  ['Autenticación', 'NextAuth.js + Google OAuth'],
                  ['Infraestructura', 'Google Cloud Run'],
                  ['Región', 'southamerica-east1'],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-0.5">
                    <span className="font-medium text-graphite">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
