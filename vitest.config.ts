import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    // We test PURE helpers only (no DB, no network) so node env is fine
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Don't recurse into node_modules / Next build output
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
