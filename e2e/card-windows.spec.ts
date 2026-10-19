import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, boardCard, expectCardOpen, SHORTCUTS } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// A card in its own window (#53): opened from its ⋯ menu, drawn by the main window's page into
// an `about:blank` window main allows (D2, D3), coming back to its board when that window closes.

let app: ElectronApplication
let page: Page
let dir: string
let dataDir: string

const darwin = process.platform === 'darwin'

const WORKSPACE = 'cw'

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'drovr-card-windows-'))
  ;({ app, page, dataDir } = await launchApp())
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(WORKSPACE)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  rmSync(dir, { recursive: true, force: true })
})

const card = (title: string): Locator => boardCard(page, title)

/** Creates card `title` in the first column; its view opens, then the board shows again. */
async function newCard(title: string): Promise<void> {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

/** Picks Open in new window in card `title`'s menu and returns the window's page. */
async function openInWindow(title: string): Promise<Page> {
  const opened = app.waitForEvent('window')
  await card(title).getByTestId('card-menu').click()
  await page.getByTestId('card-menu-open-window').click()
  const window = await opened
  await expect(window.getByTestId('card-view')).toHaveAttribute('aria-label', title)
  return window
}

/** A page's card view terminal buffer, one trimmed string per line (wrapped lines joined). */
function bufferLines(on: Page, pane = 0): Promise<string[]> {
  return on.evaluate((index) => {
    type Line = { isWrapped: boolean; translateToString(trim: boolean): string }
    const hosts = document.querySelectorAll('[data-testid=card-view] [data-testid=terminal]')
    const host = hosts[index] as
      | (HTMLElement & {
          __xterm?: { buffer: { active: { length: number; getLine(i: number): Line | undefined } } }
        })
      | undefined
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const rows: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      const next = buffer.getLine(i + 1)
      const text = line?.translateToString(!next?.isWrapped) ?? ''
      if (line?.isWrapped && rows.length > 0) rows[rows.length - 1] += text
      else rows.push(text)
    }
    return rows.map((r) => r.trim())
  }, pane)
}

const terminalFocused = (on: Page): Promise<boolean> =>
  on.evaluate(
    () => document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
  )

/** Types a command into the page's focused terminal and presses Enter. */
async function run(on: Page, command: string): Promise<void> {
  await expect.poll(() => terminalFocused(on)).toBe(true)
  await on.keyboard.type(command)
  await on.keyboard.press('Enter')
}

test('AC1: Open in new window shows the card there, running, with an In window chip', async () => {
  await newCard('Agent A')
  await run(page, 'echo before-53')
  await expect.poll(() => bufferLines(page)).toContain('before-53')
  await backToBoard(page)

  const window = await openInWindow('Agent A')
  await expect.poll(() => window.title()).toBe(`Agent A · ${WORKSPACE}`)
  // Only the card's view: no board, sidebar or title bar there.
  await expect(window.getByTestId('board')).toHaveCount(0)
  await expect(window.getByTestId('sidebar')).toHaveCount(0)
  // Its earlier output came with it, and it takes commands.
  await expect.poll(() => bufferLines(window)).toContain('before-53')
  await run(window, 'echo hello-$((50+3))')
  await expect.poll(() => bufferLines(window)).toContain('hello-53')

  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('Agent A').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('Agent A').getByTestId('card-in-window')).toHaveText('In window')
})

test("D4: the window has the app's stylesheets, the symbols font and a fitted terminal", async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  const background = (on: Page): Promise<string> =>
    on.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(await background(window)).toBe(await background(page))
  await expect
    .poll(() =>
      window.evaluate(() =>
        [...document.fonts].some((f) => f.family.includes('Symbols') && f.status === 'loaded')
      )
    )
    .toBe(true)
  // Fitted to its pane in the window: the rows fill the host's width, less a cell and the ruler.
  await expect
    .poll(() =>
      window.evaluate(() => {
        const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]')
        const screen = host?.querySelector('.xterm-screen')
        if (!host || !screen) return -1
        return host.clientWidth - screen.getBoundingClientRect().width
      })
    )
    .toBeGreaterThanOrEqual(0)
  const slack = await window.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]')!
    return host.clientWidth - host.querySelector('.xterm-screen')!.getBoundingClientRect().width
  })
  expect(slack).toBeLessThan(40)
})

test('AC14: only a card window opens, and it has no bridge', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  expect(await window.evaluate(() => 'drovr' in globalThis)).toBe(false)
  const before = app.windows().length
  await page.evaluate(() => {
    globalThis.open('https://example.com')
    globalThis.open('about:blank', 'x')
    globalThis.open('about:blank', 'drovr-card:')
  })
  // A card window can't open one either, even named after a card.
  await window.evaluate(() => globalThis.open('about:blank', 'drovr-card:other'))
  await page.waitForTimeout(500)
  expect(app.windows()).toHaveLength(before)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
})

/** Card `title`'s shell exits; it reads Stopped on the board. */
async function stopCard(title: string): Promise<void> {
  await run(page, 'exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
}

test('AC2: a Stopped card starts, running its startup command, in its new window', async () => {
  await newCard('Agent A')
  await stopCard('Agent A')
  await card('Agent A').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-startup').click()
  const dialog = page.getByTestId('startup-dialog')
  await dialog.getByTestId('startup-dialog-startup').selectOption({ label: 'Custom…' })
  await dialog.getByTestId('startup-dialog-command').fill('echo started-$((50+3))')
  await dialog.getByTestId('startup-dialog-save').click()
  await expect(dialog).toHaveCount(0)

  const window = await openInWindow('Agent A')
  await expect.poll(() => bufferLines(window)).toContain('started-53')
  await expect(card('Agent A').getByTestId('card-status-label')).toHaveText('Running')
})

/** Wraps main's `focus()` of the card window titled `title`, counting its calls. */
async function spyOnFocus(title: string): Promise<() => Promise<number>> {
  await app.evaluate(({ BrowserWindow }, title) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.getTitle() === title)!
    const spied = window as typeof window & { focusCalls?: number }
    spied.focusCalls = 0
    const focus = window.focus.bind(window)
    window.focus = () => {
      spied.focusCalls! += 1
      focus()
    }
  }, title)
  return () =>
    app.evaluate(({ BrowserWindow }, title) => {
      const window = BrowserWindow.getAllWindows().find((w) => w.getTitle() === title)
      return (window as (typeof window & { focusCalls?: number }) | undefined)?.focusCalls ?? -1
    }, title)
}

test('AC4: opening it again from the board or its menu focuses its window', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  await expect.poll(() => window.title()).toBe(`Agent A · ${WORKSPACE}`)
  const focusCalls = await spyOnFocus(`Agent A · ${WORKSPACE}`)

  await card('Agent A').getByTestId('card-open').click()
  await expect.poll(focusCalls).toBe(1)
  await card('Agent A').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-open-window').click()
  await expect.poll(focusCalls).toBe(2)
  // No second window, and the main window still shows the board.
  await page.waitForTimeout(300)
  expect(app.windows()).toHaveLength(2)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

test('AC5: closing the window brings the card back, still running', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  await run(window, 'sleep 1000')
  await window.close()
  await expect(card('Agent A').getByTestId('card-in-window')).toHaveCount(0)
  await expect(card('Agent A').getByTestId('card-status-label')).toHaveText('Running')
  // The main window's view didn't change.
  await expect(page.getByTestId('board')).toBeVisible()

  await card('Agent A').getByTestId('card-open').click()
  await expectCardOpen(page, 'Agent A')
  // `sleep 1000` still runs: nothing after its line yet.
  await expect
    .poll(async () => {
      const lines = (await bufferLines(page)).filter(Boolean)
      return lines[lines.length - 1]
    })
    .toMatch(/sleep 1000$/)
  // The same screen, in the main window again: it takes keys there.
  await page.keyboard.press('Control+C')
  await run(page, 'echo back-$((50+3))')
  await expect.poll(() => bufferLines(page)).toContain('back-53')
})

/** Resolves once `window` has closed. */
const closed = (window: Page): Promise<unknown> =>
  window.isClosed() ? Promise.resolve() : window.waitForEvent('close')

test('AC6: Back, the shell exiting and deleting the card close its window', async () => {
  await newCard('Agent A')
  await backToBoard(page)

  let window = await openInWindow('Agent A')
  await expect.poll(() => terminalFocused(window)).toBe(true)
  let gone = closed(window)
  // The window closes on the keydown, before the press's keyup.
  await window.keyboard.press(SHORTCUTS.back).catch(() => undefined)
  await gone
  await expect(card('Agent A').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('Agent A').getByTestId('card-in-window')).toHaveCount(0)

  window = await openInWindow('Agent A')
  gone = closed(window)
  await run(window, 'exit')
  await gone
  await expect(card('Agent A').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(page.getByTestId('board')).toBeVisible()

  window = await openInWindow('Agent A')
  gone = closed(window)
  await card('Agent A').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  await page.getByTestId('confirm-delete').click()
  await gone
  await expect(card('Agent A')).toHaveCount(0)
})

test("AC6: deleting the card's workspace closes its window", async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  const gone = closed(window)
  const row = page.locator('.workspace-row').first()
  await row.hover()
  await row.getByTestId('workspace-delete').click()
  await page.getByTestId('confirm-delete').click()
  await gone
})

test('AC7: split, zoom, Find and Close card act in the card window', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  await run(window, 'echo hello-$((50+3))')
  await expect.poll(() => bufferLines(window)).toContain('hello-53')

  await window.keyboard.press(SHORTCUTS.splitRight)
  await expect(window.getByTestId('pane')).toHaveCount(2)
  await window.keyboard.press(SHORTCUTS.zoomPane)
  await expect(window.getByTestId('pane-zoom')).toHaveText('Zoomed · 2 panes')
  await window.keyboard.press(SHORTCUTS.zoomPane)
  await expect(window.getByTestId('pane-zoom')).toHaveCount(0)

  // Find on the main pane.
  await window.getByTestId('pane').first().click()
  await window.keyboard.press(darwin ? 'Meta+F' : 'Control+Shift+F')
  await expect(window.getByTestId('find-input')).toBeFocused()
  await window.keyboard.type('hello-53')
  await expect(window.getByTestId('find-result')).toHaveText('1 of 1')
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('find-bar')).toHaveCount(0)
  await expect.poll(() => terminalFocused(window)).toBe(true)

  await window.keyboard.press(SHORTCUTS.closeCard)
  await expect(window.getByTestId('confirm-dialog')).toBeVisible()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  // The card window's dialog owns only its window's keyboard: Settings opens in the main one.
  await page.keyboard.press(darwin ? 'Meta+,' : 'Control+,')
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)

  // Escape cancels it there, giving the terminal its keyboard back; Close stops the card.
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect.poll(() => terminalFocused(window)).toBe(true)
  await window.keyboard.press(SHORTCUTS.closeCard)
  const gone = closed(window)
  await window.getByTestId('confirm-dialog').getByRole('button', { name: 'Close' }).click()
  await gone
  await expect(card('Agent A').getByTestId('card-status-label')).toHaveText('Stopped')
})

test("AC8: the app's shortcuts do nothing in a card window and never reach its shell", async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  await expect.poll(() => terminalFocused(window)).toBe(true)
  const keys = darwin
    ? ['Meta+,', 'Meta+K', 'Meta+J', 'Meta+T', 'Meta+1']
    : ['Control+,', 'Control+Shift+P', 'Control+Shift+J', 'Control+Shift+T', 'Control+1']
  for (const key of keys) await window.keyboard.press(key)
  await run(window, 'echo after-$((50+3))')
  await expect.poll(() => bufferLines(window)).toContain('after-53')
  // Nothing reached the shell before the command: its line is just the typed one.
  const lines = await bufferLines(window)
  expect(lines.find((l) => l.includes('echo after-'))).toMatch(
    /^\S+[$#] echo after-\$\(\(50\+3\)\)$/
  )
  for (const on of [page, window]) {
    await expect(on.getByTestId('settings-dialog')).toHaveCount(0)
    await expect(on.getByTestId('command-palette')).toHaveCount(0)
  }
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

test('AC10: the window title follows a rename', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  await expect.poll(() => window.title()).toBe(`Agent A · ${WORKSPACE}`)
  await card('Agent A').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-rename').click()
  await page.getByTestId('card-rename-input').fill('Agent B')
  await page.getByTestId('card-rename-input').press('Enter')
  await expect.poll(() => window.title()).toBe(`Agent B · ${WORKSPACE}`)
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()))
    )
    .toContain(`Agent B · ${WORKSPACE}`)
})

test('AC11: a reload of the main window closes every card window; none is kept', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  await newCard('Agent B')
  await backToBoard(page)
  const first = await openInWindow('Agent A')
  const second = await openInWindow('Agent B')
  const gone = Promise.all([closed(first), closed(second)])
  await page.reload()
  await gone
  await page.waitForSelector('[data-testid=app]')
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  const state = readFileSync(join(dataDir, 'drovr-state.json'), 'utf8')
  // No key about windows (D9); the test folder's path has the word in it.
  expect(state).not.toMatch(/"[^"/]*window[^"/]*":/i)
})

test('AC11: closing the main window closes the card windows', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  const gone = closed(window)
  const quit = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.getTitle().includes(' · '))!
    main.close()
  })
  await gone
  // With no window left the app quits (off macOS); a restart opens only the main window.
  if (darwin) await app.close()
  else await quit
  ;({ app, page } = await launchApp({ dataDir }))
  await expect(card('Agent A').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(card('Agent A').getByTestId('card-in-window')).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})

test('D5: Toggle panel works in a card window, for every window at once', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  await expect(window.getByTestId('side-panel')).toBeVisible()
  await expect(page.getByTestId('side-panel')).toBeVisible()
  await expect.poll(() => terminalFocused(window)).toBe(true)
  await window.keyboard.press(darwin ? 'Alt+Meta+B' : 'Control+Alt+B')
  await expect(window.getByTestId('side-panel')).toHaveCount(0)
  await expect(page.getByTestId('side-panel')).toHaveCount(0)
  await page.keyboard.press(darwin ? 'Alt+Meta+B' : 'Control+Alt+B')
  await expect(window.getByTestId('side-panel')).toBeVisible()
  // Its width keeps to half of its own window when dragged wider.
  const handle = window.getByTestId('side-panel-resize')
  const box = (await handle.boundingBox())!
  await window.mouse.move(box.x + box.width / 2, box.y + 20)
  await window.mouse.down()
  await window.mouse.move(10, box.y + 20, { steps: 5 })
  await window.mouse.up()
  const half = await window.evaluate(() => globalThis.innerWidth / 2)
  const width = (await window.getByTestId('side-panel').boundingBox())!.width
  expect(width).toBeLessThanOrEqual(half + 1)
  expect(width).toBeGreaterThan(half - 20)
})

/**
 * Drags across `on`'s card view terminal, whose program asked for button-event tracking in SGR
 * encoding, and expects both a move with the left button held (`CSI < 32;x;y M`) and its release
 * (`CSI < 0;x;y m`) to reach it.
 */
async function expectDragReported(on: Page): Promise<void> {
  const terminal = '[data-testid=card-view] [data-testid=terminal]'
  await expect
    .poll(() =>
      on.evaluate((selector) => {
        const host = document.querySelector(selector) as HTMLElement & {
          __xterm?: { modes: { mouseTrackingMode: string } }
        }
        return host.__xterm?.modes.mouseTrackingMode
      }, terminal)
    )
    .toBe('drag')
  await on.evaluate((selector) => {
    const host = document.querySelector(selector) as HTMLElement & {
      __xterm?: { onData(listener: (data: string) => void): void }
    }
    const sent: string[] = []
    Object.assign(globalThis, { sentByTerminal: sent })
    host.__xterm?.onData((data) => sent.push(data))
  }, terminal)
  const box = (await on.locator(terminal).boundingBox())!
  await on.mouse.move(box.x + 40, box.y + 40)
  await on.mouse.down()
  await on.mouse.move(box.x + 120, box.y + 80, { steps: 4 })
  await on.mouse.up()
  const sent = (): Promise<string[]> =>
    on.evaluate(() => (globalThis as unknown as { sentByTerminal: string[] }).sentByTerminal)
  await expect
    .poll(async () => (await sent()).some((d) => d.startsWith('\x1b[<32;') && d.endsWith('M')))
    .toBe(true)
  await expect
    .poll(async () => (await sent()).some((d) => d.startsWith('\x1b[<0;') && d.endsWith('m')))
    .toBe(true)
}

/** Button-event tracking (1002) in SGR encoding (1006): a drag's moves and release are reported. */
const TRACK_DRAGS = "printf '\\033[?1002;1006h'; sleep 1000"

test('D2: a mouse-reporting drag in a card window reports its moves and release', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  await run(window, TRACK_DRAGS)
  await expectDragReported(window)
})

test('D2: back in the main window, a mouse-reporting drag reports there again', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  await window.close()
  await expect(card('Agent A').getByTestId('card-in-window')).toHaveCount(0)
  await card('Agent A').getByTestId('card-open').click()
  await expectCardOpen(page, 'Agent A')
  await run(page, TRACK_DRAGS)
  await expectDragReported(page)
})

test("D5: Mod+digit is left alone while the card window's dialog owns its keyboard", async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  await expect.poll(() => terminalFocused(window)).toBe(true)
  // Whether each Mod+1 keydown reached the window's bubble phase un-swallowed.
  await window.evaluate(() => {
    const seen: boolean[] = []
    Object.assign(globalThis, { digitSeen: seen })
    globalThis.addEventListener('keydown', (event) => {
      if (event.code === 'Digit1') seen.push(!event.defaultPrevented)
    })
  })
  const seen = (): Promise<boolean[]> =>
    window.evaluate(() => (globalThis as unknown as { digitSeen: boolean[] }).digitSeen)
  const modDigit = darwin ? 'Meta+1' : 'Control+1'
  await window.keyboard.press(SHORTCUTS.closeCard)
  await expect(window.getByTestId('confirm-dialog')).toBeVisible()
  await window.keyboard.press(modDigit)
  await expect.poll(seen).toEqual([true])
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('confirm-dialog')).toHaveCount(0)
  // Without a dialog it is swallowed, so it never reaches the window's bubble phase.
  await window.keyboard.press(modDigit)
  await window.waitForTimeout(200)
  expect(await seen()).toEqual([true])
})

// S2: the shortcut, the palette and shells (#53 D6, D7).

/** The Open in new window shortcut's default (D6) as a Playwright press. */
const OPEN_WINDOW = darwin ? 'Meta+Shift+O' : 'Control+Shift+O'
const PALETTE = darwin ? 'Meta+K' : 'Control+Shift+P'
const palette = (): Locator => page.getByRole('dialog', { name: 'Command palette' })

/** Opens the palette, types `query` and runs its first row, titled `title`, with Enter. */
async function pickInPalette(query: string, title: string): Promise<void> {
  await page.keyboard.press(PALETTE)
  await expect(palette().getByTestId('palette-input')).toBeFocused()
  await page.keyboard.type(query)
  await expect(palette().getByTestId('palette-row-title').first()).toHaveText(title)
  await page.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0)
}

/** Expects `on`'s typed `echo after-…` line to be only what was typed: no stray keys before it. */
async function expectCleanLine(on: Page): Promise<void> {
  await run(on, 'echo after-$((50+3))')
  await expect.poll(() => bufferLines(on)).toContain('after-53')
  const lines = await bufferLines(on)
  expect(lines.find((l) => l.includes('echo after-'))).toMatch(
    /^\S+[$#] echo after-\$\(\(50\+3\)\)$/
  )
}

test('AC3: the shortcut opens the open card in its own window and the main window shows its board', async () => {
  await newCard('Agent A')
  await expect.poll(() => terminalFocused(page)).toBe(true)
  const opened = app.waitForEvent('window')
  await page.keyboard.press(OPEN_WINDOW)
  const window = await opened
  await expect(window.getByTestId('card-view')).toHaveAttribute('aria-label', 'Agent A')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card('Agent A').getByTestId('card-in-window')).toHaveText('In window')
  // The new window has the keyboard, and the shell got none of the shortcut's keys.
  await expectCleanLine(window)

  // In the card window the shortcut does nothing, and never reaches the shell (D5).
  await window.keyboard.press(OPEN_WINDOW)
  await window.waitForTimeout(300)
  expect(app.windows()).toHaveLength(2)
  await run(window, 'clear')
  await expectCleanLine(window)

  // The workspace forgot its view (#31 D19): with the window closed the main window stays on
  // its board (D8).
  await window.close()
  await expect(card('Agent A').getByTestId('card-in-window')).toHaveCount(0)
  await page.waitForTimeout(300)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

test("AC3: the palette's Open in new window row opens the open card in its own window", async () => {
  await newCard('Agent A')
  const opened = app.waitForEvent('window')
  await pickInPalette('Open in new window', 'Open in new window')
  const window = await opened
  await expect(window.getByTestId('card-view')).toHaveAttribute('aria-label', 'Agent A')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card('Agent A').getByTestId('card-in-window')).toHaveText('In window')
  await expect.poll(() => terminalFocused(window)).toBe(true)
})

test('AC4: a palette pick and Next waiting card focus its window, changing nothing here', async () => {
  await newCard('Agent A')
  await backToBoard(page)
  const window = await openInWindow('Agent A')
  await expect.poll(() => window.title()).toBe(`Agent A · ${WORKSPACE}`)
  const focusCalls = await spyOnFocus(`Agent A · ${WORKSPACE}`)

  await pickInPalette('Agent A', 'Agent A')
  await expect.poll(focusCalls).toBe(1)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)

  await run(window, 'board activity . waiting')
  // The first `board` of a run starts Drovr's executable as Node from a cold disk cache.
  await expect(card('Agent A').getByTestId('card-activity')).toHaveText('Waiting for you', {
    timeout: 15_000
  })
  await page.keyboard.press(darwin ? 'Meta+J' : 'Control+Shift+J')
  await expect.poll(focusCalls).toBe(2)
  await page.waitForTimeout(300)
  expect(app.windows()).toHaveLength(2)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

test("AC9: a shell's menu opens it in its own window; its strip button and shortcut focus it", async () => {
  const shell = page.locator('[data-testid=shell][data-shell-name="Default"]')
  const opened = app.waitForEvent('window')
  await shell.getByTestId('shell-menu').click()
  await page.getByTestId('shell-menu-open-window').click()
  const window = await opened
  await expect.poll(() => window.title()).toBe(`Default shell · ${WORKSPACE}`)
  await expect(window.getByTestId('card-view')).toBeVisible()
  await expect(shell.getByTestId('shell-in-window')).toHaveText('In window')
  await expectCleanLine(window)
  const focusCalls = await spyOnFocus(`Default shell · ${WORKSPACE}`)

  await page.keyboard.press(darwin ? 'Meta+T' : 'Control+Shift+T')
  await expect.poll(focusCalls).toBe(1)
  await shell.getByTestId('shell-open').click()
  await expect.poll(focusCalls).toBe(2)
  await shell.getByTestId('shell-menu').click()
  await page.getByTestId('shell-menu-open-window').click()
  await expect.poll(focusCalls).toBe(3)
  await page.waitForTimeout(300)
  expect(app.windows()).toHaveLength(2)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)

  await window.close()
  await expect(shell.getByTestId('shell-in-window')).toHaveCount(0)
})

test('AC13: Settings lists Open in new window, recorded, refused, saved and reset; font size reaches the window', async () => {
  const settings = page.getByTestId('settings-dialog')
  const field = settings.getByTestId('settings-shortcut-openInWindow')
  const error = settings.getByTestId('settings-shortcut-error-openInWindow')
  const reset = settings.getByTestId('settings-shortcut-reset-openInWindow')
  const file = join(dataDir, 'drovr-settings.json')
  const saved = (): string => (existsSync(file) ? readFileSync(file, 'utf8') : '')
  const defaultText = darwin ? 'Shift+Cmd+O' : 'Ctrl+Shift+O'
  const openSettings = async (): Promise<void> => {
    await page.getByTestId('settings-open').click()
    await settings.getByTestId('settings-section-shortcuts').click()
  }

  await openSettings()
  await expect(settings.getByRole('group', { name: 'Shortcuts' })).toContainText(
    'Open in new window'
  )
  await expect(field).toHaveText(defaultText)
  await expect(reset).toBeDisabled()
  await field.click()
  await page.keyboard.press(PALETTE)
  await expect(error).toHaveText('Already used by Command palette')
  await page.keyboard.press('Control+Alt+O')
  await expect(field).toHaveText('Ctrl+Alt+O')
  await expect.poll(saved).toContain('"openInWindow":"Ctrl+Alt+O"')
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)

  await newCard('Agent A')
  const opened = app.waitForEvent('window')
  await page.keyboard.press('Control+Alt+O')
  const window = await opened
  await expect(window.getByTestId('card-view')).toHaveAttribute('aria-label', 'Agent A')

  // The card window's terminal follows a font size set in the main window's Settings.
  const fontSize = (): Promise<number | undefined> =>
    window.evaluate(() => {
      const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
        (HTMLElement & { __xterm?: { options: { fontSize?: number } } }) | null
      return host?.__xterm?.options.fontSize
    })
  await expect.poll(fontSize).toBe(13)
  await openSettings()
  await reset.click()
  await expect(field).toHaveText(defaultText)
  await expect.poll(saved).not.toContain('openInWindow')
  await settings.getByTestId('settings-section-appearance').click()
  await settings.getByLabel('Font size').fill('18')
  await expect.poll(fontSize).toBe(18)
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
})
