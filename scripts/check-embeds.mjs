// Safety net for PostgREST relationships.
//
// Extracts every `.from('t').select('…')` that embeds a relation and runs it against the REAL database
// (service role, limit 1, read-only). Type-checking cannot see these failures, and a new table can break
// an old query: adding a junction table (e.g. project_workspaces) made `workspaces → projects` ambiguous
// and took the whole app down ("more than one relationship was found"), because every request builds its
// permission context with that query.
//
// Run it AFTER applying a migration and BEFORE deploying:
//
//   node scripts/check-embeds.mjs
//
// Exit code 1 if any embedded select fails. Fix ambiguity with an explicit hint, e.g.
//   projects!projects_workspace_id_fkey(...)   or   users!project_members_user_id_fkey(...)
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

const found = new Map() // table|select → first location
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (!/\.(ts|tsx)$/.test(e.name) || /\.test\./.test(e.name)) continue
    const s = fs.readFileSync(p, 'utf8')
    for (const m of s.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)\s*\.select\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
      const sel = m[2].slice(1, -1)
      if (sel.includes('${')) continue                // dynamic: skipped
      if (!/[a-z_:!]+\s*\(/.test(sel)) continue       // no embedded relation
      const line = s.slice(0, m.index).split('\n').length
      const key = m[1] + '|' + sel.replace(/\s+/g, ' ').trim()
      if (!found.has(key)) found.set(key, `${p.replace(/\\/g, '/')}:${line}`)
    }
  }
}
walk('src')

let bad = 0
for (const [key, loc] of found) {
  const [table, sel] = key.split('|')
  const r = await admin.from(table).select(sel).limit(1)
  if (r.error) {
    bad++
    console.log(`FAIL ${loc}\n     from ${table}: ${r.error.code} ${r.error.message}\n     select: ${sel.slice(0, 160)}`)
  }
}
console.log(`\n${found.size} embedded selects checked, ${bad} failing`)
process.exit(bad ? 1 : 0)
