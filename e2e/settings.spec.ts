import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  backToBoard,
  expectCardOpen,
  expectStatusOnBoard,
  SHORTCUTS,
  splitRight,
  zoomPane
} from './card-view'
import { bodyBackground, pickAppTheme } from './app-theme'
import { clipboardWrites, recordClipboardWrites } from './clipboard-writes'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Themes and settings (#10). Each test launches with its own data directory.

let app: ElectronApplication | undefined

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

const SHORTCUT = process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma'

const dialog = (page: Page): Locator => page.getByTestId('settings-dialog')

/** Settings → Terminal, where the terminal font rows are (#66 D5). */
async function showTerminal(page: Page): Promise<void> {
  await dialog(page).getByTestId('settings-section-terminal').click()
}

/** Settings → Font family set to Custom…: its text field, where any family is typed. */
async function customFamily(page: Page): Promise<Locator> {
  await dialog(page).getByLabel('Font family').selectOption({ label: 'Custom…' })
  return dialog(page).getByLabel('Custom font family')
}

/** Creates workspace `alpha` in a fresh directory and its card `api`, left open at full size. */
async function alphaWithApi(page: Page): Promise<void> {
  const dir = join(mkdtempSync(join(tmpdir(), 'bikube-settings-')), 'alpha')
  mkdirSync(dir)
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('api')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'api')
}

/** The open card's terminal buffer, one trimmed string per line. */
function bufferLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: {
            buffer: {
              active: {
                length: number
                getLine(i: number): { translateToString(trim: boolean): string } | undefined
              }
            }
          }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true).trim() ?? '')
    }
    return lines
  })
}

/** The buffer once it holds `line` and two reads 300 ms apart are equal (the shell is idle). */
async function settledBufferLines(page: Page, line: string): Promise<string[]> {
  let previous: string[] | undefined
  let current: string[] = []
  await expect
    .poll(
      async () => {
        current = await bufferLines(page)
        const settled =
          current.includes(line) && JSON.stringify(current) === JSON.stringify(previous)
        previous = current
        return settled
      },
      { intervals: [300] }
    )
    .toBe(true)
  return current
}

const terminalFocused = (page: Page): Promise<boolean> =>
  page.evaluate(
    () => document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
  )

const color = (
  page: Page,
  selector: string,
  property: 'backgroundColor' | 'color'
): Promise<string> =>
  page.evaluate(([sel, prop]) => getComputedStyle(document.querySelector(sel)!)[prop], [
    selector,
    property
  ] as const)

interface TerminalLook {
  fontSize: number
  fontFamily: string
  background: string
  foreground: string
  cols: number
}

/** The open card's terminal look. */
async function openLook(page: Page): Promise<TerminalLook> {
  const look = await page.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: {
            cols: number
            options: {
              fontSize: number
              fontFamily: string
              theme: { background: string; foreground: string }
            }
          }
        })
      | null
    const term = host?.__xterm
    if (!term) return null
    // Every family ends with the bundled symbols font; the tests compare what comes before it.
    const symbols = ', "Symbols Nerd Font Mono"'
    const family = term.options.fontFamily
    return {
      fontSize: term.options.fontSize,
      fontFamily: family.endsWith(symbols)
        ? family.slice(0, -symbols.length)
        : `no symbols font: ${family}`,
      background: term.options.theme.background,
      foreground: term.options.theme.foreground,
      cols: term.cols
    }
  })
  if (!look) throw new Error('no open terminal')
  return look
}

const terminalBackground = (page: Page): Promise<string> =>
  color(
    page,
    '[data-testid=card-view] [data-testid=terminal] .xterm-scrollable-element',
    'backgroundColor'
  )

/**
 * Playwright emulates `prefers-color-scheme: light` by default, which hides the native theme main
 * sets from the Theme setting; turn emulation off so the page follows `nativeTheme` as in the app.
 */
const followNativeTheme = (page: Page): Promise<void> => page.emulateMedia({ colorScheme: null })

const readSettingsFile = (dataDir: string): string =>
  readFileSync(join(dataDir, 'bikube-settings.json'), 'utf8')

/** Polls the settings file until it holds `expected` (it is written within 200 ms). */
async function expectSettingsFile(dataDir: string, expected: string): Promise<void> {
  await expect
    .poll(() =>
      existsSync(join(dataDir, 'bikube-settings.json')) ? readSettingsFile(dataDir) : ''
    )
    .toBe(expected)
}

test('AC1: with no settings file and a dark OS appearance the board looks as before and nothing is written', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(20, 21, 26)')
  await alphaWithApi(page)
  await expect
    .poll(() => openLook(page))
    .toMatchObject({
      fontSize: 13,
      fontFamily: 'Menlo, Consolas, monospace',
      background: '#14151a'
    })
  await expect.poll(() => terminalBackground(page)).toBe('rgb(20, 21, 26)')
  // Give a stray write the save interval (200 ms) and more to land before checking.
  await page.waitForTimeout(500)
  expect(existsSync(join(dataDir, 'bikube-settings.json'))).toBe(false)
})

test('AC1: opening Settings, leaving the family field and closing writes no settings file', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await page.getByTestId('settings-open').click()
  await showTerminal(page)
  await dialog(page).getByLabel('Font family').focus()
  await dialog(page).getByLabel('Font size').focus()
  await dialog(page).getByRole('button', { name: 'Done' }).click()
  await expect(dialog(page)).toHaveCount(0)
  // Give a stray write the save interval (200 ms) and more to land before checking.
  await page.waitForTimeout(500)
  expect(existsSync(join(dataDir, 'bikube-settings.json'))).toBe(false)
})

test('the light palette applies under a light OS appearance with theme System', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await page.emulateMedia({ colorScheme: 'light' })
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(246, 247, 249)')
})

test('the window background matches the resolved theme from the start', async () => {
  const launched = await launchApp()
  app = launched.app
  const [dark, background] = await app.evaluate(({ BrowserWindow, nativeTheme }) => [
    nativeTheme.shouldUseDarkColors,
    BrowserWindow.getAllWindows()[0]!.getBackgroundColor()
  ])
  expect(background.toLowerCase()).toBe(dark ? '#14151a' : '#f6f7f9')
})

test('a saved Light theme gives a light window and board from the start', async () => {
  const dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    '{"version":1,"settings":{"theme":"light","fontSize":13,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
  const launched = await launchApp({ dataDir })
  app = launched.app
  // xvfb's OS appearance is light too, so check main took the theme from the file.
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light')
  const background = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getBackgroundColor()
  )
  expect(background.toLowerCase()).toBe('#f6f7f9')
  await followNativeTheme(launched.page)
  await expect
    .poll(() => launched.page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(246, 247, 249)')
})

test('a saved Dark theme gives a dark window and board from the start, whatever the OS appearance', async () => {
  const dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
  const launched = await launchApp({ dataDir })
  app = launched.app
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  const background = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getBackgroundColor()
  )
  expect(background.toLowerCase()).toBe('#14151a')
  await followNativeTheme(launched.page)
  await expect
    .poll(() => launched.page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(20, 21, 26)')
})

test('AC2: Settings opens from the sidebar, expanded or collapsed, and closes each way', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched

  // Expanded: a gear with its label; Done closes.
  const button = page.getByTestId('settings-open')
  await expect(button).toHaveText(/Settings/)
  await button.click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(dialog(page).getByRole('radio', { name: 'System' })).toBeChecked()
  await expect(dialog(page).getByRole('radio', { name: 'Dark' })).not.toBeChecked()
  await expect(dialog(page).getByRole('radio', { name: 'Light' })).not.toBeChecked()
  await showTerminal(page)
  await expect(dialog(page).getByLabel('Font size')).toHaveValue('13')
  // The default family: the list's first entry, no custom field.
  await expect(dialog(page).getByLabel('Font family')).toHaveValue('')
  await expect(dialog(page).getByLabel('Custom font family')).toHaveCount(0)
  await dialog(page).getByRole('button', { name: 'Done' }).click()
  await expect(dialog(page)).toHaveCount(0)

  // Escape closes.
  await button.click()
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  // Collapsed: the icon alone, labelled; a click outside closes.
  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
  const collapsed = page.getByRole('button', { name: 'Settings', exact: true })
  await expect(collapsed).not.toHaveText(/Settings/)
  await collapsed.click()
  await expect(dialog(page)).toBeVisible()
  await page.mouse.click(5, 5)
  await expect(dialog(page)).toHaveCount(0)
})

test('AC2: the shortcut opens Settings from the board and the full-size view, never typing into the terminal', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched

  // On the board (here the empty state).
  await page.keyboard.press(SHORTCUT)
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  // With the workspace dialog open, the shortcut does nothing.
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
  await page.keyboard.press(SHORTCUT)
  await page.waitForTimeout(200)
  await expect(dialog(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  // In api's full-size view with the terminal focused: the shell sees nothing of the key.
  await alphaWithApi(page)
  await expect.poll(() => terminalFocused(page)).toBe(true)
  await page.keyboard.type('cat -v')
  await page.keyboard.press('Enter')
  await page.keyboard.press(SHORTCUT)
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect.poll(() => terminalFocused(page)).toBe(true)
  await page.keyboard.type('xyz')
  await page.keyboard.press('Enter')
  // The tty echoes the typed line and cat prints it again: `xyz` twice, nothing before it.
  await expect.poll(async () => (await bufferLines(page)).filter((l) => l === 'xyz').length).toBe(2)
  expect((await bufferLines(page)).some((l) => l.includes(','))).toBe(false)
})

const DARK = { bg: 'rgb(20, 21, 26)', sidebar: 'rgb(27, 29, 36)', text: 'rgb(230, 231, 235)' }
const LIGHT = { bg: 'rgb(246, 247, 249)', sidebar: 'rgb(255, 255, 255)', text: 'rgb(27, 29, 36)' }

const boardColours = async (page: Page): Promise<typeof DARK> => ({
  bg: await color(page, 'body', 'backgroundColor'),
  sidebar: await color(page, '[data-testid=sidebar]', 'backgroundColor'),
  text: await color(page, 'body', 'color')
})

const DARK_TERMINAL = { background: '#14151a', foreground: '#e6e7eb', shown: 'rgb(20, 21, 26)' }
const LIGHT_TERMINAL = { background: '#ffffff', foreground: '#1b1d24', shown: 'rgb(255, 255, 255)' }

/** The open terminal's theme colours, and the background it actually shows. */
const terminalColours = async (page: Page): Promise<typeof DARK_TERMINAL> => {
  const { background, foreground } = await openLook(page)
  return { background, foreground, shown: await terminalBackground(page) }
}

test('AC3: picking Light recolours the board at once, Dark restores it, and api keeps running', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await followNativeTheme(page)
  await alphaWithApi(page)
  await expect.poll(() => terminalFocused(page)).toBe(true)
  await page.keyboard.type('echo marker-$((40+2))')
  await page.keyboard.press('Enter')
  const scrollback = await settledBufferLines(page, 'marker-42')

  await page.keyboard.press(SHORTCUT)
  await expect(dialog(page)).toBeVisible()
  // xvfb's OS appearance is light, so start from Dark, the look of AC1.
  await dialog(page).getByRole('radio', { name: 'Dark' }).check()
  await expect.poll(() => boardColours(page)).toEqual(DARK)
  await expect.poll(() => terminalColours(page)).toEqual(DARK_TERMINAL)

  await dialog(page).getByRole('radio', { name: 'Light' }).check()
  await expect(dialog(page)).toBeVisible()
  await expect.poll(() => boardColours(page)).toEqual(LIGHT)
  await expect.poll(() => terminalColours(page)).toEqual(LIGHT_TERMINAL)
  await expect(page.getByTestId('card-view')).toBeVisible()
  expect(await bufferLines(page)).toEqual(scrollback)

  await dialog(page).getByRole('radio', { name: 'Dark' }).check()
  await expect.poll(() => boardColours(page)).toEqual(DARK)
  await expect.poll(() => terminalColours(page)).toEqual(DARK_TERMINAL)

  await page.keyboard.press('Escape')
  await expectStatusOnBoard(page, 'api', 'Running')
  expect(await bufferLines(page)).toEqual(scrollback)
})

test('AC4: with theme System the board follows the OS appearance live', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await page.getByTestId('settings-open').click()
  await expect(dialog(page).getByRole('radio', { name: 'System' })).toBeChecked()

  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => boardColours(page)).toEqual(LIGHT)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => boardColours(page)).toEqual(DARK)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => boardColours(page)).toEqual(LIGHT)
})

test('with theme System the terminals follow the OS appearance live, open or not', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await followNativeTheme(page)
  await alphaWithApi(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => terminalColours(page)).toEqual(DARK_TERMINAL)
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => terminalColours(page)).toEqual(LIGHT_TERMINAL)

  // A card on the board, not shown, recolours too: switch while it is closed, then open it.
  await backToBoard(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByTestId('card').filter({ hasText: 'api' }).getByTestId('card-open').click()
  await expectCardOpen(page, 'api')
  await expect.poll(() => terminalColours(page)).toEqual(DARK_TERMINAL)
  await expectStatusOnBoard(page, 'api', 'Running')
})

test('AC5: font size 18 applies at once, refits the open terminal and resizes its shell', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await alphaWithApi(page)
  await expect.poll(async () => (await openLook(page)).fontSize).toBe(13)
  const before = (await openLook(page)).cols

  await page.keyboard.press(SHORTCUT)
  await showTerminal(page)
  const size = dialog(page).getByLabel('Font size')
  await size.fill('18')
  await expect.poll(async () => (await openLook(page)).fontSize).toBe(18)
  await expect.poll(async () => (await openLook(page)).cols).toBeLessThan(before)
  const after = (await openLook(page)).cols

  for (const text of ['40', '7', '12.5', 'abc']) {
    await size.fill(text)
    await expect(dialog(page).getByTestId('settings-error-font-size')).toHaveText(
      'Font size must be a whole number from 8 to 32'
    )
    expect((await openLook(page)).fontSize).toBe(18)
  }
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  expect(await openLook(page)).toMatchObject({ fontSize: 18, cols: after })

  // The shell sees the new width.
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await expect.poll(() => terminalFocused(page)).toBe(true)
  await page.keyboard.type('echo cols-$(tput cols)')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await bufferLines(page)).includes(`cols-${after}`)).toBe(true)

  await page.keyboard.press(SHORTCUT)
  await showTerminal(page)
  await expect(dialog(page).getByLabel('Font size')).toHaveValue('18')
})

/** Goes back to the board and opens `title` at full size. */
async function openCard(page: Page, title: string): Promise<void> {
  await backToBoard(page)
  await page.getByTestId('card').filter({ hasText: title }).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

test('AC6: the trimmed family applies to every terminal; clearing it restores the default', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await alphaWithApi(page)
  // A second card, web, left on the board while api is open.
  await backToBoard(page)
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('web')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'web')
  await openCard(page, 'api')

  await page.keyboard.press(SHORTCUT)
  await showTerminal(page)
  const family = await customFamily(page)
  await family.fill('  Courier New, monospace  ')
  await family.press('Enter')
  await expect.poll(async () => (await openLook(page)).fontFamily).toBe('Courier New, monospace')
  await page.keyboard.press('Escape')
  await openCard(page, 'web')
  expect((await openLook(page)).fontFamily).toBe('Courier New, monospace')

  await page.keyboard.press(SHORTCUT)
  await showTerminal(page)
  await family.fill('')
  await family.press('Enter')
  await expect(family).toHaveValue('')
  await expect(family).toHaveAttribute('placeholder', 'Menlo, Consolas, monospace')
  await expect
    .poll(async () => (await openLook(page)).fontFamily)
    .toBe('Menlo, Consolas, monospace')
  await page.keyboard.press('Escape')
  await openCard(page, 'api')
  expect((await openLook(page)).fontFamily).toBe('Menlo, Consolas, monospace')
})

test('AC6: a typed family applies when the dialog closes by Escape or a click outside; at most 200 characters', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await alphaWithApi(page)

  await page.keyboard.press(SHORTCUT)
  await showTerminal(page)
  const family = await customFamily(page)
  await expect(family).toHaveAttribute('maxlength', '200')
  await family.fill('Courier New')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect.poll(async () => (await openLook(page)).fontFamily).toBe('Courier New')
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"system","fontSize":13,"fontFamily":"Courier New","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )

  await page.keyboard.press(SHORTCUT)
  await showTerminal(page)
  await family.fill('Courier New, monospace')
  await page.mouse.click(5, 5)
  await expect(dialog(page)).toHaveCount(0)
  await expect.poll(async () => (await openLook(page)).fontFamily).toBe('Courier New, monospace')
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"system","fontSize":13,"fontFamily":"Courier New, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
})

test('font fields: an invalid size shows the error and is not applied; the family is trimmed; both save', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await page.getByTestId('settings-open').click()
  await showTerminal(page)
  const size = dialog(page).getByLabel('Font size')
  const family = dialog(page).getByLabel('Custom font family')

  await size.fill('18')
  await expect(dialog(page).getByTestId('settings-error-font-size')).toHaveCount(0)
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"system","fontSize":18,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
  for (const text of ['40', '7', '12.5', 'abc']) {
    await size.fill(text)
    await expect(dialog(page).getByTestId('settings-error-font-size')).toHaveText(
      'Font size must be a whole number from 8 to 32'
    )
    await expect(size).toHaveAttribute('aria-invalid', 'true')
  }

  await customFamily(page)
  await family.fill('  Courier New, monospace  ')
  await family.press('Enter')
  await expect(family).toHaveValue('Courier New, monospace')
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"system","fontSize":18,"fontFamily":"Courier New, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )

  // Closing drops the invalid size; reopening shows the last valid one.
  await dialog(page).getByRole('button', { name: 'Done' }).click()
  await page.getByTestId('settings-open').click()
  await showTerminal(page)
  await expect(size).toHaveValue('18')
  await expect(dialog(page).getByTestId('settings-error-font-size')).toHaveCount(0)

  // Clearing the family (applied on blur) restores the default and shows the placeholder.
  await family.fill('')
  await size.focus()
  await expect(family).toHaveValue('')
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"system","fontSize":18,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
})

test('AC7: Light, size 16 and Courier New are kept across a restart, and the board file is untouched', async () => {
  const dataDir = newDataDir()
  let launched = await launchApp({ dataDir })
  app = launched.app
  let page = launched.page
  await followNativeTheme(page)
  await alphaWithApi(page)

  await page.keyboard.press(SHORTCUT)
  await dialog(page).getByRole('radio', { name: 'Light' }).check()
  await showTerminal(page)
  await dialog(page).getByLabel('Font size').fill('16')
  const family = await customFamily(page)
  await family.fill('Courier New, monospace')
  await family.press('Enter')
  await dialog(page).getByRole('button', { name: 'Done' }).click()
  await expect(dialog(page)).toHaveCount(0)

  await app.close()
  const expected =
    '{"version":1,"settings":{"theme":"light","fontSize":16,"fontFamily":"Courier New, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  expect(readSettingsFile(dataDir)).toBe(expected)
  const statePath = join(dataDir, 'bikube-state.json')
  const stateBefore = JSON.parse(readFileSync(statePath, 'utf8')) as { version: number }
  expect(stateBefore.version).toBe(1)

  launched = await launchApp({ dataDir })
  app = launched.app
  page = launched.page
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light')
  const background = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getBackgroundColor()
  )
  expect(background.toLowerCase()).toBe('#f6f7f9')
  await followNativeTheme(page)
  await expect.poll(() => boardColours(page)).toEqual(LIGHT)

  await page.getByTestId('settings-open').click()
  await expect(dialog(page).getByRole('radio', { name: 'Light' })).toBeChecked()
  await showTerminal(page)
  await expect(dialog(page).getByLabel('Font size')).toHaveValue('16')
  await expect(dialog(page).getByLabel('Custom font family')).toHaveValue('Courier New, monospace')
  expect(readSettingsFile(dataDir)).toBe(expected)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  // api's terminal, started again on opening it, uses the kept look.
  await page.getByTestId('card').filter({ hasText: 'api' }).getByTestId('card-open').click()
  await expectCardOpen(page, 'api')
  await expect
    .poll(() => openLook(page))
    .toMatchObject({
      fontSize: 16,
      fontFamily: 'Courier New, monospace',
      background: '#ffffff',
      foreground: '#1b1d24'
    })
  await expect.poll(() => terminalBackground(page)).toBe('rgb(255, 255, 255)')
  expect(readSettingsFile(dataDir)).toBe(expected)
  expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual(stateBefore)
})

test('AC8: invalid fields take their defaults, the rest is kept, and the next change rewrites the file', async () => {
  const dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    '{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched

  await page.getByTestId('settings-open').click()
  await expect(dialog(page).getByRole('radio', { name: 'System' })).toBeChecked()
  await showTerminal(page)
  await expect(dialog(page).getByLabel('Font size')).toHaveValue('13')
  await expect(dialog(page).getByLabel('Custom font family')).toHaveValue('Courier New')

  await dialog(page).getByTestId('settings-section-appearance').click()
  await dialog(page).getByRole('radio', { name: 'Dark' }).check()
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Courier New","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
  // The app works: a workspace and a running card.
  await page.keyboard.press('Escape')
  await alphaWithApi(page)
  await expectStatusOnBoard(page, 'api', 'Running')
})

test('AC8: a settings file that is not JSON gives all defaults', async () => {
  const dataDir = newDataDir()
  writeFileSync(join(dataDir, 'bikube-settings.json'), 'not json')
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched

  await page.getByTestId('settings-open').click()
  await expect(dialog(page).getByRole('radio', { name: 'System' })).toBeChecked()
  await showTerminal(page)
  await expect(dialog(page).getByLabel('Font size')).toHaveValue('13')
  await expect(dialog(page).getByLabel('Font family')).toHaveValue('')
})

// Configurable shortcuts (#31 D8, D9). The ACs name the Linux defaults.

const shortcutField = (page: Page, action: string): Locator =>
  dialog(page).getByTestId(`settings-shortcut-${action}`)
const shortcutReset = (page: Page, action: string): Locator =>
  dialog(page).getByTestId(`settings-shortcut-reset-${action}`)
const shortcutError = (page: Page, action: string): Locator =>
  dialog(page).getByTestId(`settings-shortcut-error-${action}`)

test('#31 AC8: a bad shortcut falls back to its default; the rest of the file is kept', async () => {
  test.skip(process.platform === 'darwin', 'the AC names the Linux defaults')
  const dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    JSON.stringify({
      version: 1,
      settings: {
        theme: 'dark',
        fontSize: 13,
        fontFamily: 'Menlo',
        shortcuts: {
          back: 'B',
          splitRight: 'Ctrl+Alt+R',
          closePane: 'Ctrl+Alt+R',
          // A fixed shortcut, refused by the recorder, is refused in the file too (round 4 Q4).
          settings: 'Ctrl+Shift+C',
          bogus: 'Ctrl+K'
        }
      }
    })
  )
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched

  await page.getByTestId('settings-open').click()
  await expect(dialog(page).getByRole('radio', { name: 'Dark' })).toBeChecked()
  await dialog(page).getByTestId('settings-section-shortcuts').click()
  await expect(shortcutField(page, 'back')).toHaveText('Ctrl+Shift+B')
  await expect(shortcutField(page, 'splitRight')).toHaveText('Ctrl+Shift+D')
  await expect(shortcutField(page, 'closePane')).toHaveText('Ctrl+Shift+W')
  await expect(shortcutField(page, 'settings')).toHaveText('Ctrl+,')
  for (const action of ['back', 'splitRight', 'splitDown', 'closePane', 'closeCard', 'settings']) {
    await expect(shortcutReset(page, action)).toBeDisabled()
  }
  await expect(dialog(page).getByRole('group', { name: 'Shortcuts' })).toContainText(
    'Open Settings'
  )
})

test('#66 AC5: Settings lists the New shell shortcut under its new label, with its keys', async () => {
  const launched = await launchApp({ dataDir: newDataDir() })
  app = launched.app
  const { page } = launched
  await page.getByTestId('settings-open').click()
  await dialog(page).getByTestId('settings-section-shortcuts').click()
  const row = dialog(page)
    .locator('.shortcut-row')
    .filter({ has: page.getByTestId('settings-shortcut-openShell') })
  await expect(row.locator('.shortcut-label')).toHaveText('New shell')
  await expect(shortcutField(page, 'openShell')).toHaveText(
    process.platform === 'darwin' ? 'Cmd+T' : 'Ctrl+Shift+T'
  )
  await expect(dialog(page).getByRole('group', { name: 'Shortcuts' })).not.toContainText(
    'Open Default shell'
  )
})

test('#31 D8: Reset is refused while another action holds the default; the value stays', async () => {
  const dataDir = newDataDir()
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched
  // Close card's default as a Playwright press, per OS (e2e/card-view.ts).
  const closeCardDefault = process.platform === 'darwin' ? 'Meta+Shift+W' : 'Control+Shift+Q'

  await page.getByTestId('settings-open').click()
  await dialog(page).getByTestId('settings-section-shortcuts').click()
  const defaultText = (await shortcutField(page, 'closeCard').textContent()) ?? ''
  // Close card moves away, then Split right takes Close card's default, free by then.
  await shortcutField(page, 'closeCard').click()
  await page.keyboard.press('Control+Alt+X')
  const movedText = (await shortcutField(page, 'closeCard').textContent()) ?? ''
  expect(movedText).not.toBe(defaultText)
  await shortcutField(page, 'splitRight').click()
  await page.keyboard.press(closeCardDefault)
  await expect(shortcutField(page, 'splitRight')).toHaveText(defaultText)

  await shortcutReset(page, 'closeCard').click()
  await expect(shortcutError(page, 'closeCard')).toHaveText('Already used by Split right')
  await expect(shortcutField(page, 'closeCard')).toHaveText(movedText)
  await expect(shortcutField(page, 'splitRight')).toHaveText(defaultText)

  // Once Split right is reset, Close card's Reset applies and the refusal is gone.
  await shortcutReset(page, 'splitRight').click()
  await shortcutReset(page, 'closeCard').click()
  await expect(shortcutError(page, 'closeCard')).toHaveCount(0)
  await expect(shortcutField(page, 'closeCard')).toHaveText(defaultText)
  await expect(shortcutReset(page, 'closeCard')).toBeDisabled()
})

test('#31 AC7: refused presses keep the old shortcut and recording; Escape stops it without a change', async () => {
  test.skip(process.platform === 'darwin', 'the AC names the Linux defaults')
  const dataDir = newDataDir()
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched

  await page.getByTestId('settings-open').click()
  await dialog(page).getByTestId('settings-section-shortcuts').click()
  const field = shortcutField(page, 'splitRight')
  await field.click()
  await expect(field).toHaveText('Press a shortcut…')
  await expect(field).toHaveAttribute('data-recording', 'true')

  const refusals: [string, string][] = [
    ['r', 'Use Ctrl or Alt with a key'],
    ['Control+Shift+B', 'Already used by Back to board'],
    ['Control+Shift+C', 'Already used by Copy'],
    ['Alt+ArrowUp', 'Already used by Move card'],
    ['Control+1', 'Already used by Switch workspace'],
    // The app menu's accelerators (round 4 Q3); the recorder swallows the press, so no reload.
    ['Control+R', 'Already used by Reload']
  ]
  for (const [press, message] of refusals) {
    await page.keyboard.press(press)
    await expect(shortcutError(page, 'splitRight')).toHaveText(message)
    await expect(field).toHaveText('Ctrl+Shift+D')
    await expect(field).toHaveAttribute('data-recording', 'true')
  }
  // A modifier alone keeps recording, as it was.
  await page.keyboard.press('Control')
  await expect(field).toHaveAttribute('data-recording', 'true')

  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeVisible()
  await expect(field).toHaveAttribute('data-recording', 'false')
  await expect(field).toHaveText('Ctrl+Shift+D')
  await expect(shortcutError(page, 'splitRight')).toHaveCount(0)
  await expect(shortcutReset(page, 'splitRight')).toBeDisabled()
  await page.waitForTimeout(500)
  expect(existsSync(join(dataDir, 'bikube-settings.json'))).toBe(false)
})

test('the Font family list offers installed fonts; a pick applies at once and is saved', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await alphaWithApi(page)
  await page.keyboard.press(SHORTCUT)
  await showTerminal(page)
  const list = dialog(page).getByLabel('Font family')
  const names = await list.locator('option').allTextContents()
  expect(names[0]).toMatch(/^Default/)
  expect(names.at(-1)).toBe('Custom…')
  const installed = names.slice(1, -1)
  test.skip(installed.length === 0, 'no listed font installed here')

  const font = installed[0]!
  await list.selectOption(font)
  await expect(dialog(page).getByLabel('Custom font family')).toHaveCount(0)
  await expect.poll(async () => (await openLook(page)).fontFamily).toBe(`"${font}", monospace`)
  await expect
    .poll(() =>
      existsSync(join(dataDir, 'bikube-settings.json')) ? readSettingsFile(dataDir) : ''
    )
    .toContain(`"fontFamily":"\\"${font}\\", monospace"`)

  // Closing keeps the pick; reopening shows it selected.
  await page.keyboard.press('Escape')
  await page.keyboard.press(SHORTCUT)
  await showTerminal(page)
  await expect(list).toHaveValue(font)
})

/** The labels of the open section's rows, in order, with the Preview's among them. */
function sectionLabels(page: Page): Promise<string[]> {
  return dialog(page).evaluate((root) =>
    [
      ...root.querySelectorAll(
        '[role=tabpanel] :is(.settings-row, .settings-preview) > .settings-label'
      )
    ].map((label) => label.textContent ?? '')
  )
}

/** The Terminal section's preview: its computed font. */
function previewFont(
  page: Page
): Promise<{ size: string; weight: string; lineHeight: string; spacing: string; family: string }> {
  return dialog(page)
    .getByTestId('theme-preview')
    .evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        size: style.fontSize,
        weight: style.fontWeight,
        lineHeight: style.lineHeight,
        spacing: style.letterSpacing,
        family: style.fontFamily
      }
    })
}

test('#66 AC6: Appearance has no terminal font rows; Terminal has them above the Preview, saving as before', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await page.getByTestId('settings-open').click()
  await expect(dialog(page).getByTestId('settings-panel-appearance')).toBeVisible()
  const fontIds = [
    'settings-font-size',
    'settings-font-choice',
    'settings-font-weight',
    'settings-line-height',
    'settings-letter-spacing'
  ]
  for (const testId of fontIds) await expect(dialog(page).getByTestId(testId)).toHaveCount(0)
  expect(await sectionLabels(page)).toEqual(['Theme', 'App theme', 'App font'])

  await dialog(page).getByTestId('settings-section-terminal').click()
  for (const testId of fontIds) await expect(dialog(page).getByTestId(testId)).toBeVisible()
  const labels = await sectionLabels(page)
  const preview = labels.indexOf('Preview')
  for (const label of [
    'Font size',
    'Font family',
    'Font weight',
    'Line height',
    'Letter spacing'
  ]) {
    expect(labels.indexOf(label), label).toBeGreaterThanOrEqual(0)
    expect(labels.indexOf(label), label).toBeLessThan(preview)
  }

  await dialog(page).getByTestId('settings-font-weight').selectOption({ label: 'Medium' })
  await expect
    .poll(() =>
      existsSync(join(dataDir, 'bikube-settings.json')) ? readSettingsFile(dataDir) : ''
    )
    .toContain('"fontWeight":500')
})

test('#66 AC7: the Terminal preview follows font size, weight, line height, letter spacing and family', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await page.getByTestId('settings-open').click()
  await dialog(page).getByTestId('settings-section-terminal').click()
  const before = await previewFont(page)

  await dialog(page).getByTestId('settings-font-size').fill('18')
  await dialog(page).getByTestId('settings-font-weight').selectOption({ label: 'Semibold' })
  await dialog(page).getByTestId('settings-line-height').selectOption('1.5')
  await dialog(page).getByTestId('settings-letter-spacing').selectOption('2')
  await expect
    .poll(() => previewFont(page))
    .toMatchObject({ size: '18px', weight: '600', lineHeight: '27px', spacing: '2px' })
  // Bold runs stay heavier than the rest.
  const bold = await dialog(page)
    .getByTestId('theme-preview')
    .locator('span')
    .first()
    .evaluate((el) => getComputedStyle(el).fontWeight)
  expect(Number(bold)).toBeGreaterThan(600)

  const list = dialog(page).getByTestId('settings-font-choice')
  const names = await list.locator('option').allTextContents()
  const installed = names.slice(1, -1).filter((name) => !name.endsWith('(not installed)'))
  test.skip(installed.length === 0, 'no listed font installed here')
  await list.selectOption(installed[0]!)
  await expect.poll(async () => (await previewFont(page)).family).not.toBe(before.family)
  expect((await previewFont(page)).family).toContain(installed[0]!)
})

/** The computed font-family of each of `selectors` in `on` ('' for one not there). */
function uiFonts(on: Page, selectors: string[]): Promise<string[]> {
  return on.evaluate(
    (list) =>
      list.map((selector) => {
        const el = document.querySelector(selector)
        return el ? getComputedStyle(el).fontFamily : ''
      }),
    selectors
  )
}

/** The open card's terminal font family, as xterm draws it, in `on`. */
const terminalFont = (on: Page): Promise<string> =>
  on.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      (HTMLElement & { __xterm?: { options: { fontFamily?: string } } }) | null
    return host?.__xterm?.options.fontFamily ?? ''
  })

const MAIN_CHROME = [
  '[data-testid=sidebar]',
  '[data-testid=column]',
  '[data-testid=settings-dialog]'
]

test('#66 AC8: a custom App font sets the chrome in the main page and a card window, not terminals, and is kept', async () => {
  const dataDir = newDataDir()
  let launched = await launchApp({ dataDir })
  app = launched.app
  let page = launched.page
  await alphaWithApi(page)
  const terminalBefore = await terminalFont(page)
  await backToBoard(page)
  const systemFont = (await uiFonts(page, ['[data-testid=sidebar]']))[0]!
  expect(systemFont).toContain('system-ui')

  const opened = app.waitForEvent('window')
  await page.getByTestId('card').filter({ hasText: 'api' }).getByTestId('card-menu').click()
  await page.getByTestId('card-menu-open-window').click()
  const cardWindow = await opened
  await expect(cardWindow.getByTestId('card-view')).toHaveAttribute('aria-label', 'api')

  await page.keyboard.press(SHORTCUT)
  const choice = dialog(page).getByLabel('App font', { exact: true })
  await expect(choice.locator('option').first()).toHaveText('System (default)')
  await expect(choice.locator('option').last()).toHaveText('Custom…')
  await choice.selectOption({ label: 'Custom…' })
  const custom = dialog(page).getByLabel('Custom app font')
  await custom.fill('  Courier New ')
  await custom.press('Enter')

  for (const font of await uiFonts(page, MAIN_CHROME)) expect(font).toMatch(/^"Courier New"/)
  await expect
    .poll(async () => (await uiFonts(cardWindow, ['body', '.card-window-bar']))[1])
    .toMatch(/^"Courier New"/)
  expect((await uiFonts(cardWindow, ['body']))[0]).toMatch(/^"Courier New"/)
  // The monospace stack and the terminals keep their own fonts.
  expect(await terminalFont(cardWindow)).toBe(terminalBefore)
  await expect
    .poll(() =>
      existsSync(join(dataDir, 'bikube-settings.json')) ? readSettingsFile(dataDir) : ''
    )
    .toContain('"appFontFamily":"Courier New"')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  await app.close()
  launched = await launchApp({ dataDir })
  app = launched.app
  page = launched.page
  await expect
    .poll(async () => (await uiFonts(page, ['[data-testid=sidebar]']))[0])
    .toMatch(/^"Courier New"/)
  await page.keyboard.press(SHORTCUT)
  await expect(dialog(page).getByLabel('Custom app font')).toHaveValue('Courier New')
  for (const font of await uiFonts(page, MAIN_CHROME)) expect(font).toMatch(/^"Courier New"/)

  await dialog(page)
    .getByLabel('App font', { exact: true })
    .selectOption({ label: 'System (default)' })
  await expect(dialog(page).getByLabel('Custom app font')).toHaveCount(0)
  for (const font of await uiFonts(page, MAIN_CHROME)) expect(font).toBe(systemFont)
  await expect.poll(() => readSettingsFile(dataDir)).not.toContain('appFontFamily')
})

test('#66 D7: the App font list offers installed UI fonts; a pick applies at once and is saved', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await page.keyboard.press(SHORTCUT)
  const list = dialog(page).getByLabel('App font', { exact: true })
  const names = await list.locator('option').allTextContents()
  const installed = names.slice(1, -1)
  test.skip(installed.length === 0, 'no listed UI font installed here')

  const font = installed[0]!
  await list.selectOption(font)
  await expect(dialog(page).getByLabel('Custom app font')).toHaveCount(0)
  await expect
    .poll(async () => (await uiFonts(page, ['[data-testid=sidebar]']))[0])
    // Chromium quotes a family only when it isn't a plain identifier (`Inter`, `"Open Sans"`).
    .toMatch(new RegExp(`^"?${font}"?, system-ui`))
  await expect
    .poll(() =>
      existsSync(join(dataDir, 'bikube-settings.json')) ? readSettingsFile(dataDir) : ''
    )
    .toContain(`"appFontFamily":"\\"${font}\\", system-ui`)
})

test('#48 AC6: Zoom pane shows its default, can be recorded to a key that then zooms, and Reset', async () => {
  const dataDir = newDataDir()
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched
  const file = join(dataDir, 'bikube-settings.json')
  const saved = (): string => (existsSync(file) ? readFileSync(file, 'utf8') : '')
  const chip = page.getByTestId('pane-zoom')
  const defaultText = process.platform === 'darwin' ? 'Shift+Cmd+Enter' : 'Ctrl+Shift+Enter'
  await alphaWithApi(page)
  await splitRight(page)
  await expect(page.getByTestId('pane')).toHaveCount(2)

  await page.keyboard.press(SHORTCUT)
  await dialog(page).getByTestId('settings-section-shortcuts').click()
  await expect(dialog(page).getByRole('group', { name: 'Shortcuts' })).toContainText('Zoom pane')
  const field = shortcutField(page, 'zoomPane')
  await expect(field).toHaveText(defaultText)
  await expect(shortcutReset(page, 'zoomPane')).toBeDisabled()
  await field.click()
  await page.keyboard.press('Control+Alt+Z')
  await expect(field).toHaveText('Ctrl+Alt+Z')
  await expect.poll(saved).toContain('"zoomPane":"Ctrl+Alt+Z"')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  await page.keyboard.press('Control+Alt+Z')
  await expect(chip).toHaveText('Zoomed · 2 panes')
  await page.keyboard.press('Control+Alt+Z')
  await expect(chip).toHaveCount(0)
  await zoomPane(page)
  await page.waitForTimeout(300)
  await expect(chip).toHaveCount(0)

  await page.keyboard.press(SHORTCUT)
  await dialog(page).getByTestId('settings-section-shortcuts').click()
  await shortcutReset(page, 'zoomPane').click()
  await expect(field).toHaveText(defaultText)
  await expect.poll(saved).not.toContain('zoomPane')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await page.keyboard.press(SHORTCUTS.zoomPane)
  await expect(chip).toHaveText('Zoomed · 2 panes')
})

test('#60 AC6: Copy command output shows its default, can be recorded to a key that then copies, and Reset', async () => {
  const dataDir = newDataDir()
  const file = join(dataDir, 'bikube-settings.json')
  // sh sends no marks of its own: the command's marks are printed.
  writeFileSync(file, JSON.stringify({ version: 1, settings: { shell: '/bin/sh' } }))
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched
  const saved = (): string => (existsSync(file) ? readFileSync(file, 'utf8') : '')
  const darwin = process.platform === 'darwin'
  const defaultText = darwin ? 'Shift+Cmd+A' : 'Ctrl+Shift+A'
  await recordClipboardWrites(app)
  await alphaWithApi(page)
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type(
    String.raw`printf '\033]133;A\007$ \033]133;B\007\033]133;C\007copied\n\033]133;D;0\007'`
  )
  await page.keyboard.press('Enter')
  await expect.poll(() => bufferLines(page)).toContain('$ copied')

  await page.keyboard.press(SHORTCUT)
  await dialog(page).getByTestId('settings-section-shortcuts').click()
  await expect(dialog(page).getByRole('group', { name: 'Shortcuts' })).toContainText(
    'Copy command output'
  )
  const field = shortcutField(page, 'copyCommandOutput')
  await expect(field).toHaveText(defaultText)
  await expect(shortcutReset(page, 'copyCommandOutput')).toBeDisabled()
  await field.click()
  // Another action's shortcut is refused.
  await page.keyboard.press(darwin ? 'Meta+F' : 'Control+Shift+F')
  await expect(shortcutError(page, 'copyCommandOutput')).toHaveText('Already used by Find')
  await page.keyboard.press('Control+Alt+O')
  await expect(field).toHaveText('Ctrl+Alt+O')
  await expect.poll(saved).toContain('"copyCommandOutput":"Ctrl+Alt+O"')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  await page.keyboard.press('Control+Alt+O')
  await expect.poll(() => clipboardWrites(app!)).toEqual(['copied'])

  await page.keyboard.press(SHORTCUT)
  await dialog(page).getByTestId('settings-section-shortcuts').click()
  await shortcutReset(page, 'copyCommandOutput').click()
  await expect(field).toHaveText(defaultText)
  await expect.poll(saved).not.toContain('copyCommandOutput')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await page.keyboard.press(darwin ? 'Meta+Shift+A' : 'Control+Shift+A')
  await expect.poll(() => clipboardWrites(app!)).toEqual(['copied', 'copied'])
})

const accent = (page: Page): Promise<string> =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  )

test('#64 AC3: with no app theme the board keeps Default, dark and light', async () => {
  const dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched
  await followNativeTheme(page)
  await expect.poll(() => bodyBackground(page)).toBe('rgb(20, 21, 26)')
  expect(await accent(page)).toBe('#6d8dfa')

  await page.keyboard.press(SHORTCUT)
  await dialog(page).getByRole('radio', { name: 'Light' }).check()
  await expect.poll(() => bodyBackground(page)).toBe('rgb(246, 247, 249)')
  expect(await accent(page)).toBe('#3d63dd')
})

test('#64 AC5: a saved Bikube theme is the window background and the first paint', async () => {
  const dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    '{"version":1,"settings":{"theme":"dark","appTheme":"bikube","fontSize":13,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched
  const background = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getBackgroundColor()
  )
  expect(background.toLowerCase()).toBe('#17140f')
  // The theme was in place before the page's first paint, so no paint showed Default.
  const timing = await page.evaluate(() => ({
    applied: performance.getEntriesByName('bikube:app-theme')[0]?.startTime ?? null,
    painted: performance.getEntriesByName('first-paint')[0]?.startTime ?? null
  }))
  expect(timing.applied).not.toBeNull()
  expect(timing.painted).not.toBeNull()
  expect(timing.applied!).toBeLessThanOrEqual(timing.painted!)
  // The renderer took over the preload's style element rather than adding a second one.
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('style[data-app-theme]')].map((s) =>
        s.getAttribute('data-app-theme')
      )
    )
  ).toEqual(['bikube'])
  await followNativeTheme(page)
  expect(await bodyBackground(page)).toBe('rgb(23, 20, 15)')
})

test('#64 AC7: changing the app theme leaves the running terminal theme and pane background', async () => {
  const dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    '{"version":1,"settings":{"theme":"light","fontSize":13,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Dracula","useGhosttyTheme":false}}'
  )
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched
  await followNativeTheme(page)
  await alphaWithApi(page)
  const terminalTheme = (): Promise<string> =>
    page.evaluate(() => {
      const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
        (HTMLElement & { __xterm?: { options: { theme: unknown } } }) | null
      return JSON.stringify(host?.__xterm?.options.theme ?? null)
    })
  await expect.poll(() => openLook(page)).toMatchObject({ background: '#282a36' })
  const before = { theme: await terminalTheme(), pane: await terminalBackground(page) }
  expect(before.pane).toBe('rgb(40, 42, 54)')

  await pickAppTheme(page, 'Gruvbox')
  // Gruvbox light's bg0.
  await expect.poll(() => bodyBackground(page)).toBe('rgb(251, 241, 199)')
  expect({ theme: await terminalTheme(), pane: await terminalBackground(page) }).toEqual(before)
  await expectStatusOnBoard(page, 'api', 'Running')
})

/** The background of app theme `id`'s preview in the App theme picker. */
const previewBackground = (page: Page, id: string): Promise<string> =>
  dialog(page)
    .getByTestId(`app-theme-${id}`)
    .locator('.app-theme-preview')
    .evaluate((el) => getComputedStyle(el).backgroundColor)

test('#64 AC4: clicking the Catppuccin tile applies Mocha at once and saves it; Light shows Latte', async () => {
  const dataDir = newDataDir()
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched
  await followNativeTheme(page)
  await page.keyboard.press(SHORTCUT)
  await dialog(page).getByRole('radio', { name: 'Dark' }).check()
  await expect.poll(() => bodyBackground(page)).toBe('rgb(20, 21, 26)')
  // The previews show the dark versions: Mocha's base.
  await expect.poll(() => previewBackground(page, 'catppuccin')).toBe('rgb(30, 30, 46)')

  await dialog(page).getByTestId('app-theme-catppuccin').click()
  await expect.poll(() => bodyBackground(page)).toBe('rgb(30, 30, 46)')
  await expect(dialog(page).getByRole('radio', { name: 'Catppuccin' })).toBeChecked()
  await expect
    .poll(() =>
      existsSync(join(dataDir, 'bikube-settings.json')) ? readSettingsFile(dataDir) : ''
    )
    .toContain('"appTheme":"catppuccin"')

  await dialog(page).getByRole('radio', { name: 'Light' }).check()
  await expect.poll(() => bodyBackground(page)).toBe('rgb(239, 241, 245)')
  // Latte's base and Gruvbox light's bg0.
  await expect.poll(() => previewBackground(page, 'catppuccin')).toBe('rgb(239, 241, 245)')
  expect(await previewBackground(page, 'gruvbox')).toBe('rgb(251, 241, 199)')
  await expect(dialog(page).getByRole('radio', { name: 'Catppuccin' })).toBeChecked()
})

test('#64 AC8: the App theme tiles are one radio group; Tab enters it and Right picks the next', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await page.keyboard.press(SHORTCUT)
  const group = dialog(page).getByRole('radiogroup', { name: 'App theme' })
  await expect(group).toBeVisible()
  await expect(group.getByRole('radio')).toHaveCount(6)
  const names = await group
    .getByRole('radio')
    .evaluateAll((radios) => radios.map((r) => (r as HTMLInputElement).labels?.[0]?.textContent))
  expect(names).toEqual(['Default', 'Bikube', 'Catppuccin', 'Rosé Pine', 'Nord', 'Gruvbox'])
  for (const name of names) {
    await expect(group.getByRole('radio', { name: name!, exact: true })).toHaveCount(1)
  }
  await expect(group.getByRole('radio', { name: 'Default', exact: true })).toBeChecked()

  // Settings opens on the Theme row's checked radio; Tab moves into the App theme group.
  await expect(dialog(page).getByRole('radio', { name: 'System' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(group.getByRole('radio', { name: 'Default', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  const bikube = group.getByRole('radio', { name: 'Bikube', exact: true })
  await expect(bikube).toBeChecked()
  await expect(bikube).toBeFocused()
  // Bikube light's background (Playwright pins a light colour scheme).
  await expect.poll(() => bodyBackground(page)).toBe('rgb(250, 245, 234)')
  // Tab leaves the group for the next control.
  await page.keyboard.press('Tab')
  await expect(bikube).not.toBeFocused()
  expect(await page.evaluate(() => document.activeElement?.getAttribute('type'))).not.toBe('radio')
})

/**
 * Each Settings row in the shown section, as where its label sits from its control: `above`,
 * `beside` or `overlapping`, with the row's label text.
 */
function rowLayouts(page: Page): Promise<{ label: string; layout: string }[]> {
  return dialog(page).evaluate((root) =>
    [...root.querySelectorAll('[role=tabpanel] .settings-row')].flatMap((row) => {
      const label = row.querySelector(':scope > .settings-label')
      const control = [...row.children].find((child) => child !== label)
      if (!label || !control) return []
      const l = label.getBoundingClientRect()
      const c = control.getBoundingClientRect()
      const layout =
        l.bottom <= c.top + 1
          ? 'above'
          : l.right <= c.left + 1 && l.top < c.bottom
            ? 'beside'
            : 'overlapping'
      return [{ label: label.textContent ?? '', layout }]
    })
  )
}

/** Whether the dialog or its section panel scrolls sideways. */
const scrollsSideways = (page: Page): Promise<boolean> =>
  dialog(page).evaluate((root) =>
    [root, root.querySelector('[role=tabpanel]')!].some((el) => el.scrollWidth > el.clientWidth)
  )

test('#64 AC8b: in a 400 px window each Settings row stacks its label above a full-width control', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(400, 700))
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(400)
  await page.keyboard.press(SHORTCUT)
  await expect(dialog(page)).toBeVisible()

  const layouts = await rowLayouts(page)
  // Theme and App theme: the terminal font rows are in Terminal since #66, checked below.
  expect(layouts.length).toBeGreaterThanOrEqual(2)
  for (const { label, layout } of layouts) expect(layout, label).toBe('above')
  const grid = await dialog(page).getByRole('radiogroup', { name: 'App theme' }).boundingBox()
  expect(grid!.width).toBeGreaterThanOrEqual(200)
  const theme = await dialog(page)
    .getByRole('group', { name: 'Theme', exact: true })
    .locator('.segmented')
    .boundingBox()
  expect(theme!.width).toBeGreaterThanOrEqual(200)
  expect(await scrollsSideways(page)).toBe(false)

  // The sections are an icon rail, each tab's name its tooltip.
  const tabs = dialog(page).getByRole('tab')
  for (let i = 0; i < (await tabs.count()); i++) {
    expect(await tabs.nth(i).getAttribute('title')).toBe(await tabs.nth(i).textContent())
    const label = await tabs.nth(i).locator('.settings-tab-label').boundingBox()
    expect(label!.width).toBeLessThanOrEqual(1)
  }

  // Every other section stacks too, with nothing scrolling sideways.
  for (let i = 1; i < (await tabs.count()); i++) {
    await tabs.nth(i).click()
    const name = await tabs.nth(i).getAttribute('data-section')
    for (const { label, layout } of await rowLayouts(page)) {
      expect(layout, `${name}: ${label}`).toBe('above')
    }
    expect(await scrollsSideways(page), name!).toBe(false)
  }

  // At 320 px nothing scrolls sideways either, every Theme choice whole.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(320, 700))
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(320)
  await dialog(page).getByTestId('settings-section-appearance').click()
  expect(await scrollsSideways(page)).toBe(false)
  const segments = await dialog(page)
    .getByRole('group', { name: 'Theme', exact: true })
    .locator('.radio')
    .evaluateAll((labels) => labels.map((l) => l.scrollWidth <= l.clientWidth))
  expect(segments).toEqual([true, true, true])

  // At 1000 px the label sits beside its control, as before.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 700))
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1000)
  await dialog(page).getByTestId('settings-section-appearance').click()
  for (const { label, layout } of await rowLayouts(page)) expect(layout, label).toBe('beside')
  const wideLabel = await tabs.first().locator('.settings-tab-label').boundingBox()
  expect(wideLabel!.width).toBeGreaterThan(20)
})
