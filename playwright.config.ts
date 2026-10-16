import { defineConfig } from '@playwright/test'

// Electron smoke tests: run the built app (npm run build) under xvfb-run on Linux.
export default defineConfig({
  testDir: 'e2e',
  // benchmark: slow, run with `npm run benchmark`; packaged: needs a pack, `npm run test:packaged`.
  testIgnore: ['benchmark.spec.ts', 'packaged.spec.ts'],
  timeout: 60_000,
  // Files run side by side locally, each app in its own data folder (more than 4 makes shell-timing
  // tests flaky). CI runs one: xvfb-run gives every app one display, and another app's window
  // mapping over a test's moves the real pointer there, dropping the hover a click relies on.
  workers: process.env['CI'] ? 1 : 4,
  reporter: 'list'
})
