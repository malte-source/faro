'use client'

import { useMemo, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldSelect } from '@/components/personas/field-select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toaster'
import { SOMBRERO_ROLE_LABELS } from '@/components/personas/sombrero-editor'

const ROLES = ['member', 'manager', 'admin', 'viewer', 'guest'] as const

interface ParsedLine { email: string; name?: string; position: string }

/** One person per line: `email, Nombre, Cargo` (comma or tab — pastes straight from a spreadsheet). */
function parseLines(text: string, defaultPosition: string): { rows: ParsedLine[]; invalid: string[] } {
  const rows: ParsedLine[] = []
  const invalid: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const [email, name, position] = line.split(/\t|,/).map(c => c.trim())
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) { invalid.push(line); continue }
    const pos = position || defaultPosition
    if (!pos) { invalid.push(line); continue }
    rows.push({ email, name: name || undefined, position: pos })
  }
  return { rows, invalid }
}

/** Invite people to the grupo and give them a sombrero in an empresa, in one step. */
export function InvitePeopleButton() {
  const { data: me } = trpc.membership.me.useQuery(undefined, { staleTime: 60_000 })
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)

  const manageable = useMemo(() => {
    if (!me) return []
    if (me.isDirection) return me.empresas
    const adminIn = new Set(me.memberships.filter(m => m.role === 'owner' || m.role === 'admin').map(m => m.workspaceId))
    return me.empresas.filter(e => adminIn.has(e.id))
  }, [me])

  const [workspaceId, setWorkspaceId] = useState('')
  const [role, setRole] = useState<(typeof ROLES)[number]>('member')
  const [defaultPosition, setDefaultPosition] = useState('')
  const [text, setText] = useState('')
  const [failures, setFailures] = useState<Array<{ email: string; error?: string }>>([])

  const invite = trpc.membership.inviteMany.useMutation({
    onSuccess: ({ results }) => {
      const ok = results.filter(r => r.ok).length
      const bad = results.filter(r => !r.ok)
      void utils.membership.invalidate()
      void utils.team.invalidate()
      if (bad.length === 0) {
        toast.success(ok === 1 ? 'Persona invitada' : `${ok} personas invitadas`)
        setText(''); setFailures([]); setOpen(false)
      } else {
        toast.warning(`${ok} invitadas, ${bad.length} con error`)
        setFailures(bad)
        // Keep only the failed lines so the user can fix and retry.
        const failed = new Set(bad.map(b => b.email.toLowerCase()))
        setText(t => t.split(/\r?\n/).filter(l => failed.has(l.split(/\t|,/)[0]?.trim().toLowerCase())).join('\n'))
      }
    },
    onError: err => toast.error('No se pudo invitar', err.message),
  })

  if (!manageable.length) return null

  const targetId = workspaceId || manageable[0].id
  const { rows, invalid } = parseLines(text, defaultPosition.trim())

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="h-9 rounded-full px-4 md:h-8 md:rounded-[10px] md:px-3">
        <UserPlus className="h-4 w-4" /> Invitar personas
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Invitar personas</DialogTitle>
            <DialogDescription>
              Entran al grupo con su correo de Google y reciben un cargo en la empresa elegida. Después puedes darles cargo en otras empresas desde su fila.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Empresa</Label>
                <FieldSelect value={targetId} onChange={setWorkspaceId} options={manageable.map(e => ({ value: e.id, label: e.name }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Permiso</Label>
                <FieldSelect value={role} onChange={v => setRole(v as (typeof ROLES)[number])} options={ROLES.map(r => ({ value: r, label: SOMBRERO_ROLE_LABELS[r] }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-default-position">Cargo por defecto <span className="font-normal text-graphite">(si la línea no trae uno)</span></Label>
              <Input id="invite-default-position" value={defaultPosition} onChange={e => setDefaultPosition(e.target.value)} placeholder="Ej: Administración" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-lines">Personas <span className="font-normal text-graphite">(una por línea: correo, nombre, cargo)</span></Label>
              <Textarea
                id="invite-lines"
                rows={7}
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={'ana@empresa.com, Ana Pérez, Legal\nluis@empresa.com, Luis Gómez'}
                className="font-mono text-xs"
              />
              <p className="text-xs text-graphite">
                {rows.length} {rows.length === 1 ? 'persona lista' : 'personas listas'}
                {invalid.length > 0 && <span className="text-danger"> · {invalid.length} línea{invalid.length === 1 ? '' : 's'} sin correo válido o sin cargo</span>}
              </p>
            </div>

            {failures.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-danger-wash p-3 text-xs text-danger dark:bg-danger/15">
                {failures.map(f => <li key={f.email}><strong>{f.email}</strong>: {f.error}</li>)}
              </ul>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" className="h-12 sm:h-9" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button
                className="h-12 sm:h-9"
                disabled={rows.length === 0 || invite.isPending}
                onClick={() => invite.mutate({ workspaceId: targetId, role, people: rows })}
              >
                {invite.isPending ? 'Invitando…' : `Invitar${rows.length ? ` (${rows.length})` : ''}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
