import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Integration smoke test against the REAL database (read-only queries, service role, run as the owner).
 *
 *   pnpm exec vitest run --config vitest.smoke.config.ts
 *
 * Not part of `pnpm test`: it needs .env.local and network. Run it after applying migrations and before
 * deploying — it exercises the whole request path (permission context, every query procedure, error
 * formatter) and would have caught the 24-oct-2026 outage (ambiguous workspaces→projects embed).
 *
 * Imports only from 'vitest/config' on purpose: `vite` is not a direct dependency, and the Docker build
 * type-checks this file.
 */
function readEnvLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf8').split(/\r?\n/)
        .filter(l => l && !l.startsWith('#') && l.includes('='))
        .map(l => {
          const i = l.indexOf('=')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
        }),
    )
  } catch {
    return {}
  }
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['smoke/**/*.smoke.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: readEnvLocal(),
    // Process next-auth through Vite (not Node's loader) so the aliases below apply to its imports.
    server: { deps: { inline: [/next-auth/, /@auth\/core/] } },
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'src') },
      // next-auth imports these without the .js extension, which plain Node ESM cannot resolve outside Next.
      { find: /^next\/server$/, replacement: 'next/server.js' },
      { find: /^next\/headers$/, replacement: 'next/headers.js' },
      { find: /^next\/navigation$/, replacement: 'next/navigation.js' },
    ],
  },
})
