import { defineConfig } from '@playwright/test'

// #14 D8 packaged check: `npm run test:packaged` packs the app (npm run pack), then runs this
// against dist/linux-unpacked under xvfb-run on Linux.
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'packaged.spec.ts',
  timeout: 60_000,
  workers: 1,
  reporter: 'list'
})
