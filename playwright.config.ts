import { defineConfig } from '@playwright/test'

// Electron smoke tests: run the built app (npm run build) under xvfb-run on Linux.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list'
})
