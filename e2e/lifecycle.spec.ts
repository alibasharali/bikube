import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'
import type { DrovrApi } from '../src/shared/api'

declare global {
  interface Window {
    drovr: DrovrApi
  }
}

// Window hardening and terminal lifecycle, driven through the preload bridge since
// terminals are not on the board yet (#19).

let app: ElectronApplication
let page: Page
let stderr: string

test.beforeEach(async () => {
  stderr = ''
  ;({ app, page } = await launchApp({ onStderr: (chunk) => (stderr += chunk) }))
})

test.afterEach(async () => {
  await app?.close()
})

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Spawns a shell through the bridge and returns its pid, read back from a file it writes. */
async function spawnShell(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'drovr-pid-'))
  const file = join(dir, 'pid')
  await page.evaluate(
    async ({ dir, path }) => {
      const result = await window.drovr.terminal.spawn(80, 24, dir)
      if (!result.ok) throw new Error(result.reason)
      window.drovr.terminal.write(result.id, `echo $$ > '${path}'\r`)
    },
    { dir, path: file }
  )
  await expect.poll(() => existsSync(file) && readFileSync(file, 'utf8').trim() !== '').toBe(true)
  return Number(readFileSync(file, 'utf8').trim())
}

test('the page cannot navigate away or open windows', async () => {
  const url = page.url()
  await page.evaluate(() => {
    location.href = 'data:text/html,<h1>replaced</h1>'
  })
  const opened = await page.evaluate(() => window.open('https://example.com') === null)
  await page.waitForTimeout(500)
  expect(page.url()).toBe(url)
  await expect(page.getByTestId('app')).toBeVisible()
  expect(opened).toBe(true)
  expect(app.windows()).toHaveLength(1)
})

test('reloading the page kills its shells', async () => {
  const pid = await spawnShell()
  expect(alive(pid)).toBe(true)
  await page.reload()
  await page.waitForSelector('[data-testid=app]')
  await expect.poll(() => alive(pid)).toBe(false)
})

test('many shells in one window add no listener per session', async () => {
  await page.evaluate(async (cwd) => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => window.drovr.terminal.spawn(80, 24, cwd))
    )
    results.forEach((result) => result.ok && window.drovr.terminal.kill(result.id))
  }, tmpdir())
  await page.waitForTimeout(500)
  expect(stderr).not.toContain('MaxListenersExceededWarning')
})

test('a blocked navigation leaves the shells running', async () => {
  const pid = await spawnShell()
  // Chromium starts these navigations (did-start-navigation) before the lock cancels them.
  for (const url of ['file:///tmp/', 'https://example.com/']) {
    await page.evaluate((url) => {
      location.href = url
    }, url)
    await page.waitForTimeout(500)
  }
  expect(page.url()).toMatch(/index\.html$/)
  expect(alive(pid)).toBe(true)
  // The page is still the same load: a new spawn is accepted.
  expect(alive(await spawnShell())).toBe(true)
})

test('a crashed renderer kills its shells', async () => {
  const pid = await spawnShell()
  expect(alive(pid)).toBe(true)
  // Kill the renderer process outright: on Linux forcefullyCrashRenderer() only asks the renderer
  // to crash itself over IPC, which can leave it hung instead of gone.
  const renderer = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()
  )
  process.kill(renderer, 'SIGKILL')
  await expect.poll(() => alive(pid)).toBe(false)
})
