// Compares what the migrations in supabase/migrations/ define with what the REAL database has.
// Read-only (service role, limit 0). Reports tables and columns that are defined in a migration
// file but missing in the database — i.e. migrations that were never applied (or were applied partially).
//
//   node scripts/check-schema.mjs
//
// Exit code 1 if anything is missing.
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
  }),
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const dir = 'supabase/migrations'
const tables = new Map()   // table → first file defining it
const columns = []         // [table, column, file]

for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
  const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--.*$/gm, '')
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
    const t = m[1].toLowerCase()
    if (!tables.has(t)) tables.set(t, f)
    for (const line of m[2].split('\n')) {
      const c = line.trim().match(/^([a-z_][a-z0-9_]*)\s+(?:uuid|text|int|integer|bigint|numeric|boolean|bool|date|timestamptz|timestamp|jsonb|json|smallint|time|inet|[a-z_]+\[\]|[a-z_]+)/i)
      if (c && !/^(primary|unique|constraint|foreign|check|create|references)$/i.test(c[1])) columns.push([t, c[1].toLowerCase(), f])
    }
  }
  for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi)) {
    for (const a of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) columns.push([m[1].toLowerCase(), a[1].toLowerCase(), f])
  }
}

const missingTables = []
for (const [t, f] of tables) {
  const r = await admin.from(t).select('*', { count: 'exact', head: true })
  // head requests can hide the error body; confirm with a real select
  const r2 = await admin.from(t).select('*').limit(0)
  if (r.error || r2.error) missingTables.push([t, f, (r2.error ?? r.error).message])
}
const missingTableSet = new Set(missingTables.map(x => x[0]))

const missingCols = []
const seen = new Set()
for (const [t, c, f] of columns) {
  const key = `${t}.${c}`
  if (seen.has(key) || missingTableSet.has(t)) continue
  seen.add(key)
  const r = await admin.from(t).select(c).limit(0)
  if (r.error) missingCols.push([key, f, r.error.message])
}

console.log(`${tables.size} tables and ${seen.size} columns defined in migrations checked against the live database\n`)
for (const [t, f, why] of missingTables) console.log(`MISSING TABLE  ${t}   (defined in ${f})   ${why}`)
for (const [k, f, why] of missingCols) console.log(`MISSING COLUMN ${k}   (defined in ${f})   ${why}`)
const bad = missingTables.length + missingCols.length
console.log(bad ? `\n${bad} item(s) missing — apply the corresponding migration files.` : '\nSchema matches the migrations.')
process.exit(bad ? 1 : 0)
