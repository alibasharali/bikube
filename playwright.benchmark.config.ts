import { defineConfig } from '@playwright/test'

// D8 benchmark: `npm run benchmark` (builds, then runs under xvfb-run on Linux).
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'benchmark.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list'
})
