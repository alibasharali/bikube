import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, removeDataDirs } from './launch'
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
/** Set by a test that quits the app itself. */
let closed: boolean

test.beforeEach(async () => {
  stderr = ''
  closed = false
  ;({ app, page } = await launchApp({ onStderr: (chunk) => (stderr += chunk) }))
})

test.afterEach(async () => {
  if (!closed) await app?.close()
  removeDataDirs()
})

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Spawns a shell through the bridge and returns its session id and pid, read back from a file it
 * writes. With `ignoreHangup` the shell runs `trap '' HUP` first and then becomes `sleep`, which
 * keeps its pid and the ignored hangup but never reads the terminal, so no EOF ends it (#18 D1).
 */
async function spawnShell({ ignoreHangup = false } = {}): Promise<{ id: string; pid: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'drovr-pid-'))
  const file = join(dir, 'pid')
  const id = await page.evaluate(
    async ({ dir, line }) => {
      const result = await window.drovr.terminal.spawn(80, 24, dir, 'lifecycle-card')
      if (!result.ok) throw new Error(result.reason)
      window.drovr.terminal.write(result.id, `${line}\r`)
      return result.id
    },
    {
      dir,
      line: ignoreHangup
        ? `trap '' HUP; echo $$ > '${file}'; exec sleep 600`
        : `echo $$ > '${file}'`
    }
  )
  await expect.poll(() => existsSync(file) && readFileSync(file, 'utf8').trim() !== '').toBe(true)
  return { id, pid: Number(readFileSync(file, 'utf8').trim()) }
}

// Each reaches a navigation lock: `about:blank` the preload's (no `will-navigate` fires for it,
// #20), the others main's. A `data:` URL wouldn't: Chromium blocks it before any navigation event.
const blockedUrls = ['about:blank', 'file:///tmp/', 'https://example.com/']

test('the page cannot navigate away or open windows', async () => {
  const url = page.url()
  for (const target of blockedUrls) {
    await page.evaluate((target) => {
      location.href = target
    }, target)
    await page.waitForTimeout(500)
    expect(page.url()).toBe(url)
  }
  // Other ways into `about:blank` go through the same navigate event.
  await page.evaluate(() => location.replace('about:blank'))
  await page.waitForTimeout(500)
  expect(page.url()).toBe(url)
  await page.evaluate(() => window.open('about:blank', '_self'))
  await page.waitForTimeout(500)
  expect(page.url()).toBe(url)
  // Not a locator: it would wait for the cancelled navigations to finish.
  expect(await page.evaluate(() => document.querySelector('[data-testid=app]') !== null)).toBe(true)
  const opened = await page.evaluate(() => window.open('https://example.com') === null)
  await page.waitForTimeout(500)
  expect(opened).toBe(true)
  expect(app.windows()).toHaveLength(1)
})

test('reloading the page kills its shells', async () => {
  const { pid } = await spawnShell()
  expect(alive(pid)).toBe(true)
  await page.reload()
  await page.waitForSelector('[data-testid=app]')
  await expect.poll(() => alive(pid)).toBe(false)
})

test('many shells in one window add no listener per session', async () => {
  await page.evaluate(async (cwd) => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => window.drovr.terminal.spawn(80, 24, cwd, 'lifecycle-card'))
    )
    results.forEach((result) => result.ok && window.drovr.terminal.kill(result.id))
  }, tmpdir())
  await page.waitForTimeout(500)
  expect(stderr).not.toContain('MaxListenersExceededWarning')
})

test('a blocked navigation leaves the shells running', async () => {
  const { pid } = await spawnShell()
  // Chromium starts some of these (did-start-navigation) before a lock cancels them.
  for (const url of blockedUrls) {
    await page.evaluate((url) => {
      location.href = url
    }, url)
    await page.waitForTimeout(500)
  }
  expect(page.url()).toMatch(/index\.html$/)
  expect(alive(pid)).toBe(true)
  // The page is still the same load: a new spawn is accepted.
  expect(alive((await spawnShell()).pid)).toBe(true)
})

test('a crashed renderer kills its shells', async () => {
  const { pid } = await spawnShell()
  expect(alive(pid)).toBe(true)
  // Kill the renderer process outright: on Linux forcefullyCrashRenderer() only asks the renderer
  // to crash itself over IPC, which can leave it hung instead of gone.
  const renderer = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()
  )
  process.kill(renderer, 'SIGKILL')
  await expect.poll(() => alive(pid)).toBe(false)
})

test('no shell survives quitting the app, even one ignoring the hangup (#18 D2)', async () => {
  const shells = [await spawnShell(), await spawnShell({ ignoreHangup: true })]
  shells.forEach(({ pid }) => expect(alive(pid)).toBe(true))
  closed = true
  await app.close()
  // A SIGKILLed shell can linger as a zombie for a moment until it is reaped.
  await expect.poll(() => shells.some(({ pid }) => alive(pid)), { timeout: 2_000 }).toBe(false)
})

test('a second quit while the first waits SIGKILLs the shells and goes through (#18 D2)', async () => {
  const { pid } = await spawnShell({ ignoreHangup: true })
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
  closed = true
  const start = Date.now()
  // The app may be gone before the call returns.
  await app
    .evaluate(({ app }) => {
      app.quit()
      app.quit()
    })
    .catch(() => undefined)
  await exited
  // Well under the kill's 2 s grace: the second quit didn't wait for the escalation.
  await expect
    .poll(() => alive(pid), { timeout: Math.max(100, 1_500 - (Date.now() - start)) })
    .toBe(false)
  expect(Date.now() - start).toBeLessThan(1_500)
})

test('closing a card escalates to SIGKILL when its shell ignores the hangup (#18 D1)', async () => {
  await page.evaluate(() => {
    const exits: string[] = []
    ;(window as unknown as { exits: string[] }).exits = exits
    window.drovr.terminal.onExit(({ id }) => exits.push(id))
  })
  const { id, pid } = await spawnShell({ ignoreHangup: true })
  await page.evaluate((id) => window.drovr.terminal.kill(id), id)
  await expect.poll(() => alive(pid), { timeout: 4_000 }).toBe(false)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { exits: string[] }).exits))
    .toContain(id)
})
