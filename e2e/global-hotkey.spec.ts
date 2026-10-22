import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, boardCard, expectCardOpen } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The global shortcut (#51): set in `bikube-settings.json`, registered by main with the OS, and a
// press shows or hides Bikube (D3), opening the card that waited longest (D4). xvfb can't send an
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
  root = mkdtempSync(join(tmpdir(), 'bikube-global-'))
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
    join(dataDir, 'bikube-settings.json'),
    JSON.stringify({ version: 1, settings: { theme: 'system', ...settings } })
  )
  ;({ app, page } = await launchApp({ dataDir }))
}

/** Presses the global shortcut through the development build's hook (AC4). */
async function pressGlobal(): Promise<void> {
  await app!.evaluate(() => {
    ;(
      globalThis as unknown as { __bikubeGlobalShortcutPress: () => void }
    ).__bikubeGlobalShortcutPress()
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
  return page.evaluate(() => window.bikube.globalShortcut.state())
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

/**
 * Opens card `title`, runs `board activity . waiting` in it a second later and goes back to the
 * board: Waiting for you clears once the card is seen, so it is set while the board shows.
 */
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
  await page.keyboard.type('sleep 1; board activity . waiting')
  await page.keyboard.press('Enter')
  await backToBoard(page)
  // The first `board` of a run starts Bikube's executable as Node from a cold disk cache.
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

test('D4: with a dialog open, the press only brings the window forward', async () => {
  await launchWith({ globalShortcut: SHORTCUT })
  await alphaAndBeta()
  await selectWorkspace('Beta')
  await setWaiting('one')
  await selectWorkspace('Alpha')

  // Opening Settings records nothing, so the shortcut stays registered.
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  expect(await isRegistered(ACCELERATOR)).toBe(true)

  await putAway()
  await pressGlobal()
  await expectInFront()
  await settle()
  await expectActive('Alpha')
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
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
    expect(await page.evaluate(() => window.bikube.settings.load())).toMatchObject({
      openWaitingOnShow: true
    })
    expect((await page.evaluate(() => window.bikube.settings.load())).globalShortcut).toBe(
      undefined
    )
    await app!.close()
    app = undefined
  }
})

// The Settings row (#51 D5, D6, D8): the Global group in Settings > Shortcuts. The ACs name Linux
// keys.

const FAILED =
  "Couldn't register this shortcut: another app may use it, or the desktop doesn't allow global shortcuts"

const settingsDialog = (): Locator => page.getByTestId('settings-dialog')
const globalField = (): Locator => settingsDialog().getByTestId('settings-shortcut-global')
const globalClear = (): Locator => settingsDialog().getByTestId('settings-shortcut-clear-global')
const globalError = (): Locator => settingsDialog().getByTestId('settings-shortcut-error-global')
const globalFailed = (): Locator => settingsDialog().getByTestId('settings-global-shortcut-failed')
const openWaiting = (): Locator => settingsDialog().getByTestId('settings-open-waiting-on-show')

async function openShortcuts(): Promise<void> {
  await page.getByTestId('settings-open').click()
  await settingsDialog().getByTestId('settings-section-shortcuts').click()
}

/** The settings file's `settings`, or null while there is none. */
function savedSettings(dataDir: string): Record<string, unknown> | null {
  const file = join(dataDir, 'bikube-settings.json')
  if (!existsSync(file)) return null
  return (JSON.parse(readFileSync(file, 'utf8')) as { settings: Record<string, unknown> }).settings
}

test.describe('the Settings row', () => {
  test.skip(darwin, 'the ACs name the Linux keys')

  test('AC1: off by default, the row reads None with Clear disabled and the switch on', async () => {
    ;({ app, page } = await launchApp())
    expect(await isRegistered(ACCELERATOR)).toBe(false)
    expect(await shortcutState()).toBe('none')
    await openShortcuts()
    await expect(globalField()).toHaveText('None')
    await expect(globalClear()).toBeDisabled()
    await expect(openWaiting()).toBeChecked()
    await expect(globalFailed()).toHaveCount(0)
  })

  test('AC2: a recorded shortcut is saved and registered, across a restart; Clear removes it', async () => {
    const dataDir = newDataDir()
    ;({ app, page } = await launchApp({ dataDir }))
    await openShortcuts()
    await globalField().click()
    await expect(globalField()).toHaveText('Press a shortcut…')
    await page.keyboard.press('Control+Alt+Shift+D')
    await expect(globalField()).toHaveText(SHORTCUT)
    await expect(globalField()).toHaveAttribute('data-recording', 'false')
    await expect(globalClear()).toBeEnabled()
    await expect.poll(() => savedSettings(dataDir)?.['globalShortcut']).toBe(SHORTCUT)
    await expect.poll(() => isRegistered(ACCELERATOR)).toBe(true)

    await app!.close()
    ;({ app, page } = await launchApp({ dataDir }))
    expect(await isRegistered(ACCELERATOR)).toBe(true)
    await openShortcuts()
    await expect(globalField()).toHaveText(SHORTCUT)
    await globalClear().click()
    await expect(globalField()).toHaveText('None')
    await expect(globalClear()).toBeDisabled()
    await expect.poll(() => 'globalShortcut' in (savedSettings(dataDir) ?? {})).toBe(false)
    await expect.poll(() => isRegistered(ACCELERATOR)).toBe(false)
  })

  test('AC3: the Global field refuses a key alone, a fixed or in-app shortcut; in-app fields refuse it', async () => {
    const dataDir = newDataDir()
    ;({ app, page } = await launchApp({ dataDir }))
    await openShortcuts()
    await globalField().click()
    const refusals: [string, string][] = [
      ['d', 'Use Ctrl or Alt with a key'],
      ['Control+Shift+P', 'Already used by Command palette'],
      ['Control+Shift+C', 'Already used by Copy']
    ]
    for (const [press, message] of refusals) {
      await page.keyboard.press(press)
      await expect(globalError()).toHaveText(message)
      await expect(globalField()).toHaveText('None')
      await expect(globalField()).toHaveAttribute('data-recording', 'true')
    }
    await page.keyboard.press('Escape')
    await expect(globalError()).toHaveCount(0)
    await expect(globalField()).toHaveText('None')
    await page.waitForTimeout(300)
    expect(savedSettings(dataDir)).toBe(null)

    await globalField().click()
    await page.keyboard.press('Control+Alt+Shift+D')
    await expect(globalField()).toHaveText(SHORTCUT)
    const splitRight = settingsDialog().getByTestId('settings-shortcut-splitRight')
    await splitRight.click()
    await page.keyboard.press('Control+Alt+Shift+D')
    await expect(settingsDialog().getByTestId('settings-shortcut-error-splitRight')).toHaveText(
      'Already used by Show or hide Bikube'
    )
    await expect(splitRight).toHaveAttribute('data-recording', 'true')
  })

  test('AC6: recording any shortcut field suspends the global shortcut until it ends', async () => {
    await launchWith({ globalShortcut: SHORTCUT })
    expect(await isRegistered(ACCELERATOR)).toBe(true)
    await openShortcuts()

    // The Global field, ended by Escape.
    await globalField().click()
    await expect.poll(() => isRegistered(ACCELERATOR)).toBe(false)
    await page.keyboard.press('Escape')
    await expect.poll(() => isRegistered(ACCELERATOR)).toBe(true)

    // An in-app field, ended by a new shortcut.
    const splitRight = settingsDialog().getByTestId('settings-shortcut-splitRight')
    await splitRight.click()
    await expect.poll(() => isRegistered(ACCELERATOR)).toBe(false)
    await page.keyboard.press('Control+Alt+Shift+R')
    await expect(splitRight).toHaveText('Ctrl+Alt+Shift+R')
    await expect.poll(() => isRegistered(ACCELERATOR)).toBe(true)

    // The Global field, ended by a new global shortcut: that one is registered.
    await globalField().click()
    await expect.poll(() => isRegistered(ACCELERATOR)).toBe(false)
    await page.keyboard.press('Control+Alt+Shift+K')
    await expect(globalField()).toHaveText('Ctrl+Alt+Shift+K')
    await expect.poll(() => isRegistered('Control+Alt+Shift+K')).toBe(true)
    expect(await isRegistered(ACCELERATOR)).toBe(false)

    // Ended by the window losing focus: the field stops recording too. Playwright emulates the
    // page's focus, so the page's own `blur` comes from the test, beside main's window blur.
    await globalField().click()
    await expect.poll(() => isRegistered('Control+Alt+Shift+K')).toBe(false)
    await blur()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(globalField()).toHaveAttribute('data-recording', 'false')
    await expect.poll(() => isRegistered('Control+Alt+Shift+K')).toBe(true)

    // Ended by closing Settings.
    await page.bringToFront()
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.focus())
    await globalField().click()
    await expect.poll(() => isRegistered('Control+Alt+Shift+K')).toBe(false)
    await settingsDialog().getByTestId('settings-done').click()
    await expect(settingsDialog()).toHaveCount(0)
    await expect.poll(() => isRegistered('Control+Alt+Shift+K')).toBe(true)
  })

  test('D6: a page reload while recording registers the global shortcut again', async () => {
    await launchWith({ globalShortcut: SHORTCUT })
    await openShortcuts()
    await globalField().click()
    await expect.poll(() => isRegistered(ACCELERATOR)).toBe(false)
    expect(await shortcutState()).toBe('registered')

    // The page never says recording ended: main sees the reload.
    await page.reload()
    await expect(page.getByTestId('settings-open')).toBeVisible()
    await expect.poll(() => isRegistered(ACCELERATOR)).toBe(true)
    expect(await shortcutState()).toBe('registered')
  })

  test('AC7: a shortcut the OS refuses stays saved and the row says why', async () => {
    const dataDir = newDataDir()
    ;({ app, page } = await launchApp({ dataDir }))
    // Taken already: Electron refuses an accelerator registered once.
    await app.evaluate(({ globalShortcut }, a) => {
      globalShortcut.register(a, () => {})
    }, ACCELERATOR)
    await openShortcuts()
    await globalField().click()
    await page.keyboard.press('Control+Alt+Shift+D')
    await expect(globalField()).toHaveText(SHORTCUT)
    await expect(globalFailed()).toHaveText(FAILED)
    expect(await shortcutState()).toBe('failed')
    await expect.poll(() => savedSettings(dataDir)?.['globalShortcut']).toBe(SHORTCUT)

    // Read when Settings opens too.
    await settingsDialog().getByTestId('settings-done').click()
    await openShortcuts()
    await expect(globalFailed()).toHaveText(FAILED)

    await globalClear().click()
    await expect(globalFailed()).toHaveCount(0)
  })

  test('the Open the next waiting card switch is saved', async () => {
    const dataDir = newDataDir()
    ;({ app, page } = await launchApp({ dataDir }))
    await openShortcuts()
    await openWaiting().click()
    await expect(openWaiting()).not.toBeChecked()
    await expect.poll(() => savedSettings(dataDir)?.['openWaitingOnShow']).toBe(false)
    await openWaiting().click()
    await expect.poll(() => 'openWaitingOnShow' in (savedSettings(dataDir) ?? {})).toBe(false)
  })
})
