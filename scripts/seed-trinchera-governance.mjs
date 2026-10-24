// Seed the "Ritmo de gobierno" of La Trinchera (plan estructural §4) as recurring tasks
// in a project "Gobierno · Ritmo" inside the Holding. Idempotent (matches by title).
// Dates are proposals — edit them in FARO (Recurrentes) once the calendar is agreed.
//
//   node scripts/seed-trinchera-governance.mjs
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
  }),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const RULES = [
  { title: 'Comité Ejecutivo — preparar y realizar', cadence: 'monthly:5', who: 'Gobierno completo', why: 'Números del grupo, decisiones macro.' },
  { title: 'Revisión de BU — preparar y realizar', cadence: 'monthly:10', who: 'CEO, COO, CFO + 1 BU Manager', why: 'P&L, desvíos, apoyo necesario.' },
  { title: 'Comité Comercial — 1ª quincena', cadence: 'monthly:1', who: 'CRO, Belén, Nati, BU Managers', why: 'Pipeline, cuentas cruzadas, forecast.' },
  { title: 'Comité Comercial — 2ª quincena', cadence: 'monthly:15', who: 'CRO, Belén, Nati, BU Managers', why: 'Pipeline, cuentas cruzadas, forecast.' },
  { title: 'Comité de Tecnología — preparar y realizar', cadence: 'monthly:12', who: 'CTO, CEO, Alesandro, PMO', why: 'Roadmap, riesgos, estándares.' },
  { title: 'Revisión de Portafolio — preparar y realizar', cadence: 'monthly:8', who: 'PMO + Gobierno', why: 'Estado de proyectos, semáforo.' },
  { title: 'Cierre Financiero — consolidado e intercompany', cadence: 'monthly:3', who: 'CFO, Andrea', why: 'Consolidado, intercompany.' },
]

const { data: orgs } = await sb.from('organizations').select('id').eq('name', 'La Trinchera')
if (orgs.length !== 1) throw new Error(`Expected 1 La Trinchera org, found ${orgs.length}`)
const { data: holding } = await sb.from('workspaces').select('id').eq('org_id', orgs[0].id).eq('name', 'La Trinchera · Holding').single()
if (!holding) throw new Error('Run seed-trinchera-empresas.mjs first')
const { data: owner } = await sb.from('users').select('id').eq('email', 'malte@thecrewagencia.com').single()

let { data: project } = await sb.from('projects').select('id').eq('workspace_id', holding.id).eq('code', 'GOB').maybeSingle()
if (!project) {
  const { data, error } = await sb.from('projects').insert({
    workspace_id: holding.id, code: 'GOB', name: 'Gobierno · Ritmo',
    description: 'Calendario mínimo de gobierno del grupo: la estructura sin cadencia es un organigrama muerto.',
    status: 'in_progress', kanban_stage: 'in_progress', color: '#0F4C5C', created_by: owner.id, visibility: 'workspace',
  }).select('id').single()
  if (error) throw error
  project = data
  console.log('created project GOB')
}
await sb.from('project_members').upsert({ project_id: project.id, user_id: owner.id, role: 'lead', added_by: owner.id }, { onConflict: 'project_id,user_id', ignoreDuplicates: true })

function nextRun(cadence) {
  // first firing date strictly in the future
  const today = new Date(); today.setUTCHours(12, 0, 0, 0)
  const day = Number(cadence.split(':')[1])
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day, 12))
  if (d <= today) d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}

for (const r of RULES) {
  const { data: have } = await sb.from('task_recurring_rules').select('id').eq('project_id', project.id).eq('title_template', r.title).maybeSingle()
  if (have) { console.log(`exists   ${r.title}`); continue }
  const { error } = await sb.from('task_recurring_rules').insert({
    project_id: project.id,
    title_template: r.title,
    description_template: `Participan: ${r.who}.\nPara qué: ${r.why}\n\nAgenda y acta: crear el documento en Documentos (tipo Acta) y vincularlo a esta tarea.`,
    assignee_id: owner.id,
    priority: 'high',
    cadence: r.cadence,
    next_run_at: nextRun(r.cadence),
    created_by: owner.id,
  })
  if (error) throw error
  console.log(`created  ${r.cadence.padEnd(11)} ${r.title}`)
}
