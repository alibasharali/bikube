import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The `board` CLI (#9 D4) is built beside main as out/main/board-cli.js.
        input: {
          index: resolve('src/main/index.ts'),
          'board-cli': resolve('src/main/board-cli.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
