import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // A known $SHELL: a developer's (e.g. fish 4, which waits for answers to its terminal queries
    // that a bare PTY never gives) can keep the default-shell test from reaching a prompt.
    env: { SHELL: '/bin/sh' }
  }
})
