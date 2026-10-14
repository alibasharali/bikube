import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, newDataDir, removeDataDirs } from './launch'

// Themes and settings (#10). Each test launches with its own data directory.

let app: ElectronApplication | undefined

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

const SHORTCUT = process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma'

const dialog = (page: Page): Locator => page.getByTestId('settings-dialog')

/** Creates workspace `alpha` in a fresh directory and its card `api`, left open at full size. */
async function alphaWithApi(page: Page): Promise<void> {
  const dir = join(mkdtempSync(join(tmpdir(), 'drovr-settings-')), 'alpha')
  mkdirSync(dir)
  await page.getByTestId('workspace-add').click()
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('api')
  await page.getByTestId('new-card-input').press('Enter')
  await expect(page.getByTestId('card-view-title')).toHaveText('api')
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
    return {
      fontSize: term.options.fontSize,
      fontFamily: term.options.fontFamily,
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
  readFileSync(join(dataDir, 'drovr-settings.json'), 'utf8')

/** Polls the settings file until it holds `expected` (it is written within 200 ms). */
async function expectSettingsFile(dataDir: string, expected: string): Promise<void> {
  await expect
    .poll(() => (existsSync(join(dataDir, 'drovr-settings.json')) ? readSettingsFile(dataDir) : ''))
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
  expect(existsSync(join(dataDir, 'drovr-settings.json'))).toBe(false)
})

test('AC1: opening Settings, leaving the family field and closing writes no settings file', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await page.getByTestId('settings-open').click()
  await dialog(page).getByLabel('Font family').focus()
  await dialog(page).getByLabel('Font size').focus()
  await dialog(page).getByRole('button', { name: 'Done' }).click()
  await expect(dialog(page)).toHaveCount(0)
  // Give a stray write the save interval (200 ms) and more to land before checking.
  await page.waitForTimeout(500)
  expect(existsSync(join(dataDir, 'drovr-settings.json'))).toBe(false)
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
    join(dataDir, 'drovr-settings.json'),
    '{"version":1,"settings":{"theme":"light","fontSize":13,"fontFamily":"Menlo, Consolas, monospace"}}'
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
    join(dataDir, 'drovr-settings.json'),
    '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo, Consolas, monospace"}}'
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
  await expect(dialog(page).getByLabel('Font size')).toHaveValue('13')
  await expect(dialog(page).getByLabel('Font family')).toHaveValue('')
  await expect(dialog(page).getByLabel('Font family')).toHaveAttribute(
    'placeholder',
    'Menlo, Consolas, monospace'
  )
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
  await expect(page.getByTestId('card-view').getByTestId('card-status-label')).toHaveText('Running')
  expect(await bufferLines(page)).toEqual(scrollback)

  await dialog(page).getByRole('radio', { name: 'Dark' }).check()
  await expect.poll(() => boardColours(page)).toEqual(DARK)
  await expect.poll(() => terminalColours(page)).toEqual(DARK_TERMINAL)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('card-view').getByTestId('card-status-label')).toHaveText('Running')
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
  await page.getByTestId('card-back').click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByTestId('card').filter({ hasText: 'api' }).getByTestId('card-open').click()
  await expect(page.getByTestId('card-view-title')).toHaveText('api')
  await expect.poll(() => terminalColours(page)).toEqual(DARK_TERMINAL)
  await expect(page.getByTestId('card-view').getByTestId('card-status-label')).toHaveText('Running')
})

test('AC5: font size 18 applies at once, refits the open terminal and resizes its shell', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await alphaWithApi(page)
  await expect.poll(async () => (await openLook(page)).fontSize).toBe(13)
  const before = (await openLook(page)).cols

  await page.keyboard.press(SHORTCUT)
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
  await expect(dialog(page).getByLabel('Font size')).toHaveValue('18')
})

/** Goes back to the board and opens `title` at full size. */
async function openCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('card-back').click()
  await page.getByTestId('card').filter({ hasText: title }).getByTestId('card-open').click()
  await expect(page.getByTestId('card-view-title')).toHaveText(title)
}

test('AC6: the trimmed family applies to every terminal; clearing it restores the default', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await alphaWithApi(page)
  // A second card, web, left on the board while api is open.
  await page.getByTestId('card-back').click()
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('web')
  await page.getByTestId('new-card-input').press('Enter')
  await expect(page.getByTestId('card-view-title')).toHaveText('web')
  await openCard(page, 'api')

  await page.keyboard.press(SHORTCUT)
  const family = dialog(page).getByLabel('Font family')
  await family.fill('  Courier New, monospace  ')
  await family.press('Enter')
  await expect.poll(async () => (await openLook(page)).fontFamily).toBe('Courier New, monospace')
  await page.keyboard.press('Escape')
  await openCard(page, 'web')
  expect((await openLook(page)).fontFamily).toBe('Courier New, monospace')

  await page.keyboard.press(SHORTCUT)
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
  const family = dialog(page).getByLabel('Font family')
  await expect(family).toHaveAttribute('maxlength', '200')
  await family.fill('Courier New')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect.poll(async () => (await openLook(page)).fontFamily).toBe('Courier New')
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"system","fontSize":13,"fontFamily":"Courier New"}}'
  )

  await page.keyboard.press(SHORTCUT)
  await family.fill('Courier New, monospace')
  await page.mouse.click(5, 5)
  await expect(dialog(page)).toHaveCount(0)
  await expect.poll(async () => (await openLook(page)).fontFamily).toBe('Courier New, monospace')
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"system","fontSize":13,"fontFamily":"Courier New, monospace"}}'
  )
})

test('font fields: an invalid size shows the error and is not applied; the family is trimmed; both save', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await page.getByTestId('settings-open').click()
  const size = dialog(page).getByLabel('Font size')
  const family = dialog(page).getByLabel('Font family')

  await size.fill('18')
  await expect(dialog(page).getByTestId('settings-error-font-size')).toHaveCount(0)
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"system","fontSize":18,"fontFamily":"Menlo, Consolas, monospace"}}'
  )
  for (const text of ['40', '7', '12.5', 'abc']) {
    await size.fill(text)
    await expect(dialog(page).getByTestId('settings-error-font-size')).toHaveText(
      'Font size must be a whole number from 8 to 32'
    )
    await expect(size).toHaveAttribute('aria-invalid', 'true')
  }

  await family.fill('  Courier New, monospace  ')
  await family.press('Enter')
  await expect(family).toHaveValue('Courier New, monospace')
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"system","fontSize":18,"fontFamily":"Courier New, monospace"}}'
  )

  // Closing drops the invalid size; reopening shows the last valid one.
  await dialog(page).getByRole('button', { name: 'Done' }).click()
  await page.getByTestId('settings-open').click()
  await expect(size).toHaveValue('18')
  await expect(dialog(page).getByTestId('settings-error-font-size')).toHaveCount(0)

  // Clearing the family (applied on blur) restores the default and shows the placeholder.
  await family.fill('')
  await size.focus()
  await expect(family).toHaveValue('')
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"system","fontSize":18,"fontFamily":"Menlo, Consolas, monospace"}}'
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
  await dialog(page).getByLabel('Font size').fill('16')
  await dialog(page).getByLabel('Font family').fill('Courier New, monospace')
  await dialog(page).getByLabel('Font family').press('Enter')
  await dialog(page).getByRole('button', { name: 'Done' }).click()
  await expect(dialog(page)).toHaveCount(0)

  await app.close()
  const expected =
    '{"version":1,"settings":{"theme":"light","fontSize":16,"fontFamily":"Courier New, monospace"}}'
  expect(readSettingsFile(dataDir)).toBe(expected)
  const statePath = join(dataDir, 'drovr-state.json')
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
  await expect(dialog(page).getByLabel('Font size')).toHaveValue('16')
  await expect(dialog(page).getByLabel('Font family')).toHaveValue('Courier New, monospace')
  expect(readSettingsFile(dataDir)).toBe(expected)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  // api's terminal, started again on opening it, uses the kept look.
  await page.getByTestId('card').filter({ hasText: 'api' }).getByTestId('card-open').click()
  await expect(page.getByTestId('card-view-title')).toHaveText('api')
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
    join(dataDir, 'drovr-settings.json'),
    '{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New"}}'
  )
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched

  await page.getByTestId('settings-open').click()
  await expect(dialog(page).getByRole('radio', { name: 'System' })).toBeChecked()
  await expect(dialog(page).getByLabel('Font size')).toHaveValue('13')
  await expect(dialog(page).getByLabel('Font family')).toHaveValue('Courier New')

  await dialog(page).getByRole('radio', { name: 'Dark' }).check()
  await expectSettingsFile(
    dataDir,
    '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Courier New"}}'
  )
  // The app works: a workspace and a running card.
  await page.keyboard.press('Escape')
  await alphaWithApi(page)
  await expect(page.getByTestId('card-view').getByTestId('card-status-label')).toHaveText('Running')
})

test('AC8: a settings file that is not JSON gives all defaults', async () => {
  const dataDir = newDataDir()
  writeFileSync(join(dataDir, 'drovr-settings.json'), 'not json')
  const launched = await launchApp({ dataDir })
  app = launched.app
  const { page } = launched

  await page.getByTestId('settings-open').click()
  await expect(dialog(page).getByRole('radio', { name: 'System' })).toBeChecked()
  await expect(dialog(page).getByLabel('Font size')).toHaveValue('13')
  await expect(dialog(page).getByLabel('Font family')).toHaveValue('')
})
