import { defineConfig } from '@playwright/test'

// Electron smoke tests: run the built app (npm run build) under xvfb-run on Linux.
export default defineConfig({
  testDir: 'e2e',
  // benchmark: slow, run with `npm run benchmark`; packaged: needs a pack, `npm run test:packaged`.
  testIgnore: ['benchmark.spec.ts', 'packaged.spec.ts'],
  timeout: 60_000,
  // Every test launches its own app with its own data folder, so files run side by side: 4 locally
  // (more makes shell-timing tests flaky under load), 2 in CI (a private repository's runner has 2
  // cores). Tests in a file stay in order.
  workers: process.env['CI'] ? 2 : 4,
  reporter: 'list'
})
