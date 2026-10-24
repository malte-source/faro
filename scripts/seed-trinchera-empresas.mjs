// Seed the empresas of La Trinchera from la-trinchera-plan-estructural.md (§3):
// the holding (Gobierno + CoE + Servicios Compartidos) and the 10 filiales BU-01..BU-10.
// Idempotent: matches by name, never duplicates, never deletes. Run AFTER applying
// supabase/migrations/20261022_multiempresa.sql.
//
//   node scripts/seed-trinchera-empresas.mjs
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
  }),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const HOLDING = { name: 'La Trinchera · Holding', color: '#0F4C5C' }
const FILIALES = [
  { name: 'The Crew · Marketing', color: '#FFB020' },
  { name: 'Agencia de Tecnología', color: '#2F80ED' },
  { name: 'Logística', color: '#27AE60' },
  { name: 'Merchandising & Personalización', color: '#9B51E0' },
  { name: 'Servicios Gastronómicos', color: '#EB5757' },
  { name: 'Máquinas Inteligentes', color: '#F2994A' },
  { name: 'Franquicias', color: '#56CCF2' },
  { name: 'Inmobiliaria', color: '#6FCF97' },
  { name: 'Eventos', color: '#BB6BD9' },
  { name: 'Agencia de Viajes', color: '#F2C94C' },
]

const { data: orgs, error: orgErr } = await sb.from('organizations').select('id, name').eq('name', 'La Trinchera')
if (orgErr) throw orgErr
if (orgs.length !== 1) throw new Error(`Expected exactly 1 "La Trinchera" org, found ${orgs.length}`)
const org = orgs[0]

const { data: owner } = await sb.from('users').select('id').eq('email', 'malte@thecrewagencia.com').single()
if (!owner) throw new Error('Owner user not found')

let { data: workspaces, error: wsErr } = await sb.from('workspaces').select('id, name, color').eq('org_id', org.id).order('name')
if (wsErr) throw wsErr

// The org was created with a single default workspace holding the 82-task backlog:
// it becomes the Holding (renamed in place, so the projects stay where they are).
const holdingExisting = workspaces.find(w => w.name === HOLDING.name)
if (!holdingExisting) {
  const defaultWs = workspaces.length === 1 ? workspaces[0] : workspaces.find(w => w.name === 'Main' || w.name === 'La Trinchera')
  if (defaultWs) {
    const { error } = await sb.from('workspaces').update({ name: HOLDING.name, color: HOLDING.color }).eq('id', defaultWs.id)
    if (error) throw error
    console.log(`renamed "${defaultWs.name}" → "${HOLDING.name}"`)
  } else {
    const { error } = await sb.from('workspaces').insert({ org_id: org.id, name: HOLDING.name, color: HOLDING.color })
    if (error) throw error
    console.log(`created "${HOLDING.name}"`)
  }
}

for (const f of FILIALES) {
  const { data: have } = await sb.from('workspaces').select('id').eq('org_id', org.id).eq('name', f.name).maybeSingle()
  if (have) { console.log(`exists   ${f.name}`); continue }
  const { error } = await sb.from('workspaces').insert({ org_id: org.id, name: f.name, color: f.color })
  if (error) throw error
  console.log(`created  ${f.name}`)
}

// Malte wears the Group CEO hat in the Holding.
const { data: holding } = await sb.from('workspaces').select('id').eq('org_id', org.id).eq('name', HOLDING.name).single()
const { error: wmErr } = await sb.from('workspace_members').upsert(
  { user_id: owner.id, workspace_id: holding.id, position: 'Group CEO', role: 'owner', is_active: true },
  { onConflict: 'user_id,workspace_id' },
)
if (wmErr) throw wmErr

// Backlog tasks created before migration 20261022 have no workspace_id: point them at their project's empresa.
const { data: projects } = await sb.from('projects').select('id, workspace_id').eq('workspace_id', holding.id)
for (const p of projects ?? []) {
  await sb.from('tasks').update({ workspace_id: holding.id }).eq('project_id', p.id).is('workspace_id', null)
}

const { data: final } = await sb.from('workspaces').select('name, color').eq('org_id', org.id).order('name')
console.log(`\nLa Trinchera now has ${final.length} empresas:`)
for (const w of final) console.log(`  ${w.color}  ${w.name}`)
