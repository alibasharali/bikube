import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, boardCard, expectCardOpen } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The global shortcut (#51): set in `drovr-settings.json`, registered by main with the OS, and a
// press shows or hides Drovr (D3), opening the card that waited longest (D4). xvfb can't send an
// OS-wide key, so the development build hands the tests main's press handler (AC4). xvfb has no
// window manager, so `minimize()` does nothing there: a test puts the window away with `hide()`
// (not visible, as a minimized window is to the user) or `blur()`, and sees the hiding press call
// `minimize()` (`app.hide()` on macOS) through a spy.

const darwin = process.platform === 'darwin'
const SHORTCUT = 'Ctrl+Alt+Shift+D'
const ACCELERATOR = 'Control+Alt+Shift+D'

let app: ElectronApplication | undefined
let page: Page
let root: string

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drovr-global-'))
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

/** Launches with `settings` as the settings file's fields. */
async function launchWith(settings: Record<string, unknown>): Promise<void> {
  const dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'drovr-settings.json'),
    JSON.stringify({ version: 1, settings: { theme: 'system', ...settings } })
  )
  ;({ app, page } = await launchApp({ dataDir }))
}

/** Presses the global shortcut through the development build's hook (AC4). */
async function pressGlobal(): Promise<void> {
  await app!.evaluate(() => {
    ;(
      globalThis as unknown as { __drovrGlobalShortcutPress: () => void }
    ).__drovrGlobalShortcutPress()
  })
}

interface Look {
  visible: boolean
  minimized: boolean
  focused: boolean
}

function look(): Promise<Look> {
  return app!.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    return {
      visible: window.isVisible(),
      minimized: window.isMinimized(),
      focused: window.isFocused()
    }
  })
}

/** Puts the window away: hidden, which xvfb can do where it can't minimize. */
async function putAway(): Promise<void> {
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide())
  await expect.poll(async () => (await look()).visible).toBe(false)
}

/** Leaves the window shown but not focused, as when another app is in front. */
async function blur(): Promise<void> {
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.blur())
  await expect.poll(async () => (await look()).focused).toBe(false)
}

/**
 * Counts the window's `minimize()` and `app.hide()` calls from now on, still running them: xvfb
 * can't minimize, so the count is what a test can see of the hiding press.
 */
async function spyOnHide(): Promise<void> {
  await app!.evaluate(({ app: electronApp, BrowserWindow }) => {
    const calls = { minimize: 0, hide: 0 }
    Object.assign(globalThis, { __hideCalls: calls })
    const window = BrowserWindow.getAllWindows()[0]!
    const minimize = window.minimize.bind(window)
    window.minimize = () => {
      calls.minimize++
      minimize()
    }
    // macOS only: elsewhere Electron has no `app.hide`.
    const hide = electronApp.hide?.bind(electronApp)
    electronApp.hide = () => {
      calls.hide++
      hide?.()
    }
  })
}

function hideCalls(): Promise<{ minimize: number; hide: number }> {
  return app!.evaluate(
    () => (globalThis as unknown as { __hideCalls: { minimize: number; hide: number } }).__hideCalls
  )
}

async function expectInFront(): Promise<void> {
  await expect.poll(look).toEqual({ visible: true, minimized: false, focused: true })
}

function isRegistered(accelerator: string): Promise<boolean> {
  return app!.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), accelerator)
}

/** Main's state of the global shortcut, as the renderer reads it (#51 D8). */
function shortcutState(): Promise<string> {
  return page.evaluate(() => window.drovr.globalShortcut.state())
}

async function createWorkspace(name: string): Promise<void> {
  const dir = join(root, name)
  mkdirSync(dir)
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

/** The sidebar row of `Alpha` or `Beta`, by place. */
const row = (name: 'Alpha' | 'Beta'): Locator =>
  page.locator('[data-workspace-id]').nth(name === 'Alpha' ? 0 : 1)

async function selectWorkspace(name: 'Alpha' | 'Beta'): Promise<void> {
  await row(name).getByTestId('workspace-item').click()
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

async function expectActive(name: 'Alpha' | 'Beta'): Promise<void> {
  await expect(page.locator('[data-testid=workspace-item][aria-current=true]')).toHaveText(
    new RegExp(name)
  )
}

/** Creates the running card `title` in Backlog and goes back to the board. */
async function newCard(title: string): Promise<void> {
  await page.getByTestId('new-card').first().click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await backToBoard(page)
}

/** Opens card `title`, runs `board activity . waiting` in it and goes back to the board. */
async function setWaiting(title: string): Promise<void> {
  await boardCard(page, title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.closest('[data-testid=card-view] [data-testid=pane]') != null
      )
    )
    .toBe(true)
  await page.keyboard.type('board activity . waiting')
  await page.keyboard.press('Enter')
  await backToBoard(page)
  // The first `board` of a run starts Drovr's executable as Node from a cold disk cache.
  await expect(boardCard(page, title).getByTestId('card-activity')).toHaveText('Waiting for you', {
    timeout: 15_000
  })
}

/** Alpha (active, on its board) and Beta with the running card `one`. */
async function alphaAndBeta(): Promise<void> {
  await createWorkspace('Alpha')
  await createWorkspace('Beta')
  await newCard('one')
  await selectWorkspace('Alpha')
}

/** Lets a press that should do nothing more have its chance to act. */
const settle = (): Promise<void> => page.waitForTimeout(500)

test('AC4: the global shortcut brings the window forward, and hides it when focused', async () => {
  await launchWith({ globalShortcut: SHORTCUT })
  expect(await isRegistered(ACCELERATOR)).toBe(true)
  expect(await shortcutState()).toBe('registered')

  await putAway()
  await pressGlobal()
  await expectInFront()

  // Pressed again while focused: minimized off macOS, the app hidden on macOS.
  await spyOnHide()
  await pressGlobal()
  expect(await hideCalls()).toEqual(darwin ? { minimize: 0, hide: 1 } : { minimize: 1, hide: 0 })

  // Behind another app, it comes forward again.
  await blur()
  await pressGlobal()
  await expectInFront()
  expect(await hideCalls()).toEqual(darwin ? { minimize: 0, hide: 1 } : { minimize: 1, hide: 0 })
})

test('AC5: the press opens the card that waited longest, in its workspace', async () => {
  await launchWith({ globalShortcut: SHORTCUT })
  await alphaAndBeta()

  // Nothing waits: the board stays as it was.
  await putAway()
  await pressGlobal()
  await expectInFront()
  await settle()
  await expectActive('Alpha')
  await expect(page.getByTestId('board-title')).toHaveText('Alpha')

  await selectWorkspace('Beta')
  await setWaiting('one')
  await selectWorkspace('Alpha')
  await putAway()
  await pressGlobal()
  await expectInFront()
  await expectCardOpen(page, 'one')
  await expectActive('Beta')
})

test('AC5: with Open the next waiting card off, only the window comes forward', async () => {
  await launchWith({ globalShortcut: SHORTCUT, openWaitingOnShow: false })
  await alphaAndBeta()
  await selectWorkspace('Beta')
  await setWaiting('one')
  await selectWorkspace('Alpha')

  await putAway()
  await pressGlobal()
  await expectInFront()
  await settle()
  await expectActive('Alpha')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('board-title')).toHaveText('Alpha')
})

test('AC8: a bad global shortcut in the file registers nothing', async () => {
  test.setTimeout(120_000)
  const candidates = ['D', 'Control+Shift+P', ACCELERATOR]
  for (const value of ['D', 'Ctrl+Shift+P', 42]) {
    await launchWith({ globalShortcut: value, openWaitingOnShow: 'no' })
    expect(await shortcutState()).toBe('none')
    for (const accelerator of candidates) expect(await isRegistered(accelerator)).toBe(false)
    // An invalid switch reads as on (D9).
    expect(await page.evaluate(() => window.drovr.settings.load())).toMatchObject({
      openWaitingOnShow: true
    })
    expect((await page.evaluate(() => window.drovr.settings.load())).globalShortcut).toBe(undefined)
    await app!.close()
    app = undefined
  }
})
