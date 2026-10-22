import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, boardCard, expectCardOpen, SHORTCUTS, splitRight } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'
import { showShells } from './shells-tab'

// Find in a card's terminal (#35): the find bar on the focused pane, its result text, stepping,
// toggles, highlights, the clipboard, the remembered query, the live count, closing with the
// view, where Find acts and rebinding it; then split panes, where the bar follows Find to the
// focused pane and closes with its pane, and the Default shell. The words a test finds are
// printed with octal escapes (`\141lpha`), so the typed command line never holds them.

const darwin = process.platform === 'darwin'
/** Find's default (#35 D2) as a Playwright press. */
const FIND = darwin ? 'Meta+F' : 'Control+Shift+F'
const TERMINAL = '[data-testid=card-view] [data-testid=terminal]'

let app: ElectronApplication
let page: Page
let dataDir: string
let root: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-find-'))
  ;({ app, page, dataDir } = await launchApp())
  await createWorkspace()
  await newCard('one')
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

async function createWorkspace(): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(root)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Creates card `title` in Backlog; its view opens, its shell at a prompt. */
async function newCard(title: string): Promise<void> {
  await page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    .getByTestId('new-card')
    .click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await expect.poll(terminalFocused).toBe(true)
  await expect.poll(bufferLines, { timeout: 15_000 }).toContainEqual(expect.stringMatching(/\S/))
}

const terminalFocused = (): Promise<boolean> =>
  page.evaluate((sel) => document.activeElement?.closest(sel) != null, TERMINAL)

type Xterm = {
  buffer: {
    active: {
      length: number
      baseY: number
      cursorY: number
      getLine(i: number): { translateToString(trim: boolean): string } | undefined
    }
  }
  getSelection(): string
  hasSelection(): boolean
  getSelectionPosition(): { start: { x: number; y: number } } | undefined
}

/** The open card's buffer, one trimmed line each. */
function bufferLines(): Promise<string[]> {
  return page.evaluate((sel) => {
    const term = (document.querySelector(sel) as (HTMLElement & { __xterm?: Xterm }) | null)
      ?.__xterm
    if (!term) return []
    const lines: string[] = []
    for (let i = 0; i < term.buffer.active.length; i++) {
      lines.push(term.buffer.active.getLine(i)?.translateToString(true).trim() ?? '')
    }
    return lines
  }, TERMINAL)
}

/** The open card's selection: its text and the buffer row it starts on (-1 for none). */
function selection(): Promise<{ text: string; row: number }> {
  return page.evaluate((sel) => {
    const term = (document.querySelector(sel) as HTMLElement & { __xterm: Xterm }).__xterm
    if (!term.hasSelection()) return { text: '', row: -1 }
    return { text: term.getSelection(), row: term.getSelectionPosition()?.start.y ?? -1 }
  }, TERMINAL)
}

/** The line the open card's cursor is on: the shell's prompt and what was typed at it. */
function cursorLine(): Promise<string> {
  return page.evaluate((sel) => {
    const buf = (document.querySelector(sel) as HTMLElement & { __xterm: Xterm }).__xterm.buffer
      .active
    return buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) ?? ''
  }, TERMINAL)
}

/** Runs `command` at the focused terminal's prompt and waits for the line `until` in its output. */
async function run(command: string, until: string): Promise<void> {
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
  await expect.poll(bufferLines).toContain(until)
}

/** Prints `alpha` on 3 lines with `beta` between (AC1). */
const printAlphas = (): Promise<void> =>
  run(String.raw`printf '\141lpha\nbeta\n\141lpha\n\141lpha\n'`, 'beta')

const bar = (): Locator => page.getByTestId('find-bar')
const input = (): Locator => page.getByTestId('find-input')
const result = (): Locator => page.getByTestId('find-result')
/** Every match decoration in the open card's terminal, the active one included. */
const decorations = (): Locator => page.locator(`${TERMINAL} .xterm-find-result-decoration`)

/** Opens Find and types `query` into its emptied field. */
async function find(query: string): Promise<void> {
  await page.keyboard.press(FIND)
  await expect(input()).toBeFocused()
  await input().fill(query)
}

test('#35 AC1: Find opens the bar in the pane and finds as you type, newest match active', async () => {
  await printAlphas()
  const before = await cursorLine()
  await page.keyboard.press(FIND)
  await expect(bar()).toBeVisible()
  await expect(input()).toBeFocused()
  await expect(input()).toHaveAttribute('placeholder', 'Find')
  await page.keyboard.type('alpha')
  await expect(result()).toHaveText('1 of 3')

  // The bar is in the pane's top-right corner.
  const pane = (await page.getByTestId('pane').boundingBox())!
  const box = (await bar().boundingBox())!
  expect(box.y - pane.y).toBeLessThan(12)
  expect(pane.x + pane.width - (box.x + box.width)).toBeLessThan(12)

  // The active match is the alpha on the last of those lines.
  const lines = await bufferLines()
  expect(await selection()).toEqual({ text: 'alpha', row: lines.lastIndexOf('alpha') })
  // The shell got none of the keys.
  expect(await cursorLine()).toBe(before)
  expect(lines.filter((line) => line.includes('alpha'))).toHaveLength(3)
})

test('#35 AC2: Enter steps up, Shift+Enter down, both wrapping; the buttons do the same', async () => {
  await printAlphas()
  await find('alpha')
  await expect(result()).toHaveText('1 of 3')
  await page.keyboard.press('Enter')
  await expect(result()).toHaveText('2 of 3')
  await page.keyboard.press('Enter')
  await expect(result()).toHaveText('3 of 3')
  await page.keyboard.press('Enter')
  await expect(result()).toHaveText('1 of 3')
  await page.keyboard.press('Shift+Enter')
  await expect(result()).toHaveText('3 of 3')

  const next = page.getByRole('button', { name: 'Next match' })
  const previous = page.getByRole('button', { name: 'Previous match' })
  await expect(next).toHaveAttribute('title', 'Next match')
  await expect(previous).toHaveAttribute('title', 'Previous match')
  await next.click()
  await expect(result()).toHaveText('1 of 3')
  await next.click()
  await expect(result()).toHaveText('2 of 3')
  await previous.click()
  await expect(result()).toHaveText('1 of 3')
  await previous.click()
  await expect(result()).toHaveText('3 of 3')
})

test('#35 D6: stepping goes on from the active match after a click clears the selection', async () => {
  await printAlphas()
  await find('alpha')
  await expect(result()).toHaveText('1 of 3')
  await page.keyboard.press('Enter')
  await expect(result()).toHaveText('2 of 3')
  await page.locator(TERMINAL).click()
  await expect.poll(selection).toEqual({ text: '', row: -1 })
  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(result()).toHaveText('3 of 3')
  await input().press('Shift+Enter')
  await expect(result()).toHaveText('2 of 3')
  await page.locator(TERMINAL).click()
  await expect.poll(selection).toEqual({ text: '', row: -1 })
  await page.getByRole('button', { name: 'Previous match' }).click()
  await expect(result()).toHaveText('1 of 3')
})

test('#35 D5: only typing that extends the query keeps the active match', async () => {
  await run(String.raw`printf '\141lpha\nbeta\n\141lpha\n\101lpha\n'`, 'beta')
  await find('alph')
  await expect(result()).toHaveText('1 of 3')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(result()).toHaveText('3 of 3')
  // Extending keeps it.
  await page.keyboard.type('a')
  await expect(result()).toHaveText('3 of 3')
  // Deleting a character starts again from the newest.
  await page.keyboard.press('Backspace')
  await expect(result()).toHaveText('1 of 3')
  // So does a toggle change.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(result()).toHaveText('3 of 3')
  await page.getByRole('button', { name: 'Case sensitive' }).click()
  await expect(result()).toHaveText('1 of 2')
  await input().focus()
  await page.keyboard.press('Enter')
  await expect(result()).toHaveText('2 of 2')
  await page.getByRole('button', { name: 'Case sensitive' }).click()
  await expect(result()).toHaveText('1 of 3')
})

test('#35 AC3: No results disables the buttons; an empty query shows no text and no highlights', async () => {
  await printAlphas()
  await find('alpha')
  await expect(result()).toHaveText('1 of 3')
  await input().fill('zzz-none')
  await expect(result()).toHaveText('No results')
  await expect(page.getByRole('button', { name: 'Next match' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Previous match' })).toBeDisabled()
  await input().fill('alpha')
  await expect(decorations()).not.toHaveCount(0)
  await input().fill('')
  await expect(result()).toHaveText('')
  await expect(decorations()).toHaveCount(0)
})

test('#35 AC4: Case sensitive narrows the matches and shows its state', async () => {
  await run(String.raw`printf '\105rror\n\145rror\n'`, 'Error')
  const toggle = page.getByRole('button', { name: 'Case sensitive' })
  await find('error')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Regex' })).toHaveAttribute('aria-pressed', 'false')
  await expect(result()).toHaveText('1 of 2')
  await toggle.click()
  await expect(result()).toHaveText('1 of 1')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(result()).toHaveText('1 of 2')
})

test('#35 AC5: Regex matches a regular expression; an invalid one reads Invalid regex', async () => {
  await run(String.raw`printf '\146ile1.ts\n\146ile22.ts\n'`, 'file22.ts')
  const regex = page.getByRole('button', { name: 'Regex' })
  await find(String.raw`file\d+\.ts`)
  await expect(result()).toHaveText('No results')
  await regex.click()
  await expect(regex).toHaveAttribute('aria-pressed', 'true')
  await expect(result()).toHaveText('1 of 2')
  await input().fill('file(')
  await expect(result()).toHaveText('Invalid regex')
  await expect(page.getByRole('button', { name: 'Next match' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Previous match' })).toBeDisabled()
  await expect(decorations()).toHaveCount(0)
})

test('#35 AC6: every match is highlighted, the active one filled; closing leaves none', async () => {
  await printAlphas()
  await find('alpha')
  await expect(result()).toHaveText('1 of 3')
  // 3 matches outlined in amber, and the active one's own decoration on top of the newest.
  await expect(decorations()).toHaveCount(4)
  const shown = await decorations().evaluateAll((elements) =>
    elements.map((element) => ({
      outline: getComputedStyle(element).outlineColor,
      top: Math.round(element.getBoundingClientRect().top)
    }))
  )
  expect(shown.every(({ outline }) => outline === 'rgb(209, 154, 0)')).toBe(true)
  const tops = shown.map(({ top }) => top).sort((a, b) => a - b)
  expect(new Set(tops).size).toBe(3)
  // The doubled one is the newest match, the active one.
  expect(tops.at(-1)).toBe(tops.at(-2))
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(bar()).toHaveCount(0)
  await expect(decorations()).toHaveCount(0)
  expect(await selection()).toEqual({ text: '', row: -1 })
})

test('#35 AC7: Escape closes the bar and gives the keyboard back to the terminal', async () => {
  await printAlphas()
  await find('alpha')
  await expect(result()).toHaveText('1 of 3')
  await page.keyboard.press('Escape')
  await expect(bar()).toHaveCount(0)
  await expect.poll(terminalFocused).toBe(true)
  await run('echo ok', 'ok')
})

test('#35 AC8: what Find selects never reaches the clipboard, even with Copy on select', async () => {
  await page.getByTestId('settings-open').click()
  const dialog = page.getByTestId('settings-dialog')
  await dialog.getByTestId('settings-section-terminal').click()
  await dialog.getByTestId('settings-copy-on-select').check()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.locator(TERMINAL).click()
  await printAlphas()
  await app.evaluate(({ clipboard }) => clipboard.writeText('before'))

  await find('alpha')
  await expect(result()).toHaveText('1 of 3')
  await page.keyboard.press('Enter')
  await expect(result()).toHaveText('2 of 3')
  await page.keyboard.press('Enter')
  await expect(result()).toHaveText('3 of 3')
  // Nor does the active match selected again after a click cleared the selection (D6).
  await page.locator(TERMINAL).click()
  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(result()).toHaveText('1 of 3')
  await page.waitForTimeout(500)
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('before')

  // A selection the user makes with the mouse while the bar is open still is copied (D9).
  const rows = page.locator(`${TERMINAL} .xterm-screen`)
  const box = (await rows.boundingBox())!
  await page.mouse.move(box.x + 2, box.y + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 5 })
  await page.mouse.up()
  await expect(bar()).toBeVisible()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).not.toBe('before')
})

test('#35 AC9: the query and toggles are remembered app-wide for the run, not after a restart', async () => {
  await printAlphas()
  await find('alpha')
  await page.getByRole('button', { name: 'Case sensitive' }).click()
  await expect(result()).toHaveText('1 of 3')
  await page.keyboard.press('Escape')
  await expect(bar()).toHaveCount(0)

  // Again in the same card.
  await page.keyboard.press(FIND)
  await expect(input()).toHaveValue('alpha')
  await expect(result()).toHaveText('1 of 3')
  await page.keyboard.press('Escape')

  // In another card: filled in, selected, Case sensitive on, searched at once.
  await backToBoard(page)
  await newCard('two')
  await run(String.raw`printf '\141lpha\n\101lpha\n'`, 'Alpha')
  await page.keyboard.press(FIND)
  await expect(input()).toBeFocused()
  await expect(input()).toHaveValue('alpha')
  expect(
    await input().evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])
  ).toEqual([0, 5])
  await expect(page.getByRole('button', { name: 'Case sensitive' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(result()).toHaveText('1 of 1')

  // After a restart: an empty field, both toggles off.
  await app.close()
  ;({ app, page } = await launchApp({ dataDir }))
  await expect(page.getByTestId('board')).toBeVisible()
  await newCard('three')
  await page.keyboard.press(FIND)
  await expect(input()).toHaveValue('')
  await expect(result()).toHaveText('')
  await expect(page.getByRole('button', { name: 'Case sensitive' })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await expect(page.getByRole('button', { name: 'Regex' })).toHaveAttribute('aria-pressed', 'false')
})

test('#35 AC10: the count follows new output while the bar is open', async () => {
  await printAlphas()
  // One more alpha in a few seconds, printed by the shell while the bar is open.
  await run(String.raw`sleep 3; printf '\141lpha\n'; echo done`, 'beta')
  await find('alpha')
  await expect(result()).toHaveText('1 of 3')
  await expect(result()).toHaveText(/ of 4$/, { timeout: 10_000 })
  await expect.poll(bufferLines).toContain('done')
})

test('#35 AC12: the bar closes with the view: Back, and the shell exiting', async () => {
  await printAlphas()
  await find('alpha')
  await expect(result()).toHaveText('1 of 3')
  // Back works with the focus in the bar; the card opens again with no bar.
  await backToBoard(page)
  await boardCard(page, 'one').getByTestId('card-open').click()
  await expectCardOpen(page, 'one')
  await expect(bar()).toHaveCount(0)

  await find('alpha')
  await expect(bar()).toBeVisible()
  await page.locator(TERMINAL).click()
  await expect(bar()).toBeVisible()
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('board')).toBeVisible()
  await boardCard(page, 'one').getByTestId('card-open').click()
  await expectCardOpen(page, 'one')
  await expect.poll(terminalFocused).toBe(true)
  await expect(bar()).toHaveCount(0)
})

test('#35 AC14: Find does nothing on the board or behind a dialog', async () => {
  await backToBoard(page)
  await page.keyboard.press(FIND)
  await expect(bar()).toHaveCount(0)
  await expect(page.getByTestId('board')).toBeVisible()

  await boardCard(page, 'one').getByTestId('card-open').click()
  await expectCardOpen(page, 'one')
  await page.keyboard.press(darwin ? 'Meta+,' : 'Control+,')
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await page.keyboard.press(FIND)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect(bar()).toHaveCount(0)
})

test('#35 AC15: Find is listed in Settings, can be recorded, kept across a restart and reset', async () => {
  test.skip(darwin, 'the AC names the Linux default')
  const dialog = (): Locator => page.getByTestId('settings-dialog')
  const field = (): Locator => dialog().getByTestId('settings-shortcut-find')
  await page.keyboard.press('Control+,')
  await dialog().getByTestId('settings-section-shortcuts').click()
  await expect(dialog().getByRole('group', { name: 'Shortcuts' })).toContainText('Find')
  await expect(field()).toHaveText('Ctrl+Shift+F')
  await field().click()
  await page.keyboard.press('Control+Alt+F')
  await expect(field()).toHaveText('Ctrl+Alt+F')
  await page.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)

  await page.locator(TERMINAL).click()
  await page.keyboard.press('Control+Shift+F')
  await page.waitForTimeout(300)
  await expect(bar()).toHaveCount(0)
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.press('Control+Alt+F')
  await expect(input()).toBeFocused()
  await page.keyboard.press('Escape')

  await app.close()
  ;({ app, page } = await launchApp({ dataDir }))
  await page.keyboard.press('Control+,')
  await dialog().getByTestId('settings-section-shortcuts').click()
  await expect(field()).toHaveText('Ctrl+Alt+F')
  await field().click()
  await page.keyboard.press('Control+Shift+C')
  await expect(dialog().getByTestId('settings-shortcut-error-find')).toHaveText(
    'Already used by Copy'
  )
  await expect(field()).toHaveText('Ctrl+Alt+F')
  await page.keyboard.press('Escape')
  await dialog().getByTestId('settings-shortcut-reset-find').click()
  await expect(field()).toHaveText('Ctrl+Shift+F')
})

// Panes and shells (#35 S2).

const panes = (): Locator => page.getByTestId('card-view').getByTestId('pane')

/** Pane `index`'s buffer, one trimmed line each. */
function paneLines(index: number): Promise<string[]> {
  return panes()
    .nth(index)
    .getByTestId('terminal')
    .evaluate((host) => {
      const term = (host as HTMLElement & { __xterm: Xterm }).__xterm
      const lines: string[] = []
      for (let i = 0; i < term.buffer.active.length; i++) {
        lines.push(term.buffer.active.getLine(i)?.translateToString(true).trim() ?? '')
      }
      return lines
    })
}

/** Whether pane `index`'s terminal has a selection. */
const paneSelected = (index: number): Promise<boolean> =>
  panes()
    .nth(index)
    .getByTestId('terminal')
    .evaluate((host) => (host as HTMLElement & { __xterm: Xterm }).__xterm.hasSelection())

const paneDecorations = (index: number): Locator =>
  panes().nth(index).locator('.xterm-find-result-decoration')

/** Splits the open card right; the new pane is focused, its shell at a prompt. */
async function splitWithGamma(): Promise<void> {
  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')
  await expect
    .poll(() => paneLines(1), { timeout: 15_000 })
    .toContainEqual(expect.stringMatching(/\S/))
  await page.keyboard.type(String.raw`printf '\147amma\n'`)
  await page.keyboard.press('Enter')
  await expect.poll(() => paneLines(1)).toContain('gamma')
}

/** Whether two boxes overlap. */
const overlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

test('#35 AC11: the bar follows Find to the focused pane, never covering the close button', async () => {
  await splitWithGamma()
  await find('gamma')
  const extraBar = panes().nth(1).getByTestId('find-bar')
  await expect(extraBar).toBeVisible()
  await expect(result()).toHaveText('1 of 1')
  await expect(paneDecorations(1)).not.toHaveCount(0)
  const close = panes().nth(1).getByTestId('pane-close')
  await panes().nth(1).hover()
  const closeBox = (await close.boundingBox())!
  expect(overlap((await extraBar.boundingBox())!, closeBox)).toBe(false)
  // Nothing of the bar is drawn over it: its centre is the button's own.
  expect(
    await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid=pane-close]') != null,
      [closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2] as const
    )
  ).toBe(true)

  // Clicking another pane leaves the bar where it is.
  await panes().nth(0).click()
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'true')
  await expect(extraBar).toBeVisible()
  await expect(bar()).toHaveCount(1)

  // Find moves it to the focused pane, with its query, searching there.
  await page.keyboard.press(FIND)
  await expect(panes().nth(0).getByTestId('find-bar')).toBeVisible()
  await expect(bar()).toHaveCount(1)
  await expect(input()).toBeFocused()
  await expect(input()).toHaveValue('gamma')
  await expect(result()).toHaveText('No results')
  await expect(paneDecorations(1)).toHaveCount(0)
  expect(await paneSelected(1)).toBe(false)

  // Find on the pane it is on focuses its field and selects the query.
  await panes().nth(0).getByTestId('terminal').click()
  await expect(input()).not.toBeFocused()
  await page.keyboard.press(FIND)
  await expect(input()).toBeFocused()
  expect(
    await input().evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])
  ).toEqual([0, 5])
  await expect(panes().nth(0).getByTestId('find-bar')).toBeVisible()
})

test('#35 D3, D10: using the bar makes its pane the focused one; closing it keeps that', async () => {
  await splitWithGamma()
  await find('gamma')
  const extraBar = panes().nth(1).getByTestId('find-bar')
  await panes().nth(0).click()
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'true')
  await expect(extraBar).toBeVisible()
  await input().click()
  await expect(input()).toBeFocused()
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')
  await page.keyboard.press('Escape')
  await expect(bar()).toHaveCount(0)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')
  await expect
    .poll(() =>
      panes()
        .nth(1)
        .evaluate((pane) => pane.contains(document.activeElement))
    )
    .toBe(true)
  // Close pane closes B, with no Close card dialog.
  await page.keyboard.press(SHORTCUTS.closePane)
  await expect(panes()).toHaveCount(1)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('#35 AC12: the bar closes with the extra pane it searches', async () => {
  await splitWithGamma()
  await find('gamma')
  await expect(panes().nth(1).getByTestId('find-bar')).toBeVisible()
  // Its close button.
  await panes().nth(1).getByTestId('pane-close').click()
  await expect(panes()).toHaveCount(1)
  await expect(bar()).toHaveCount(0)

  // The Close pane shortcut, with the focus in the bar.
  await splitWithGamma()
  await find('gamma')
  await expect(panes().nth(1).getByTestId('find-bar')).toBeVisible()
  await page.keyboard.press(SHORTCUTS.closePane)
  await expect(panes()).toHaveCount(1)
  await expect(bar()).toHaveCount(0)

  // Find opens it afresh on the pane left.
  await page.keyboard.press(FIND)
  await expect(panes().nth(0).getByTestId('find-bar')).toBeVisible()
  await expect(input()).toHaveValue('gamma')
})

test('#35 AC13: Find works in the Default shell', async () => {
  await backToBoard(page)
  await showShells(page)
  await page
    .locator('[data-testid="shell"][data-shell-name="Default"]')
    .getByTestId('shell-open')
    .click()
  await expectCardOpen(page, 'Default')
  await expect.poll(terminalFocused).toBe(true)
  await expect.poll(bufferLines, { timeout: 15_000 }).toContainEqual(expect.stringMatching(/\S/))
  await printAlphas()
  await find('alpha')
  await expect(bar()).toBeVisible()
  await expect(result()).toHaveText('1 of 3')
  const lines = await bufferLines()
  expect(await selection()).toEqual({ text: 'alpha', row: lines.lastIndexOf('alpha') })
})
