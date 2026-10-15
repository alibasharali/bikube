import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen, expectStatusOnBoard } from './card-view'
import { launchApp, removeDataDirs } from './launch'

// The Shell setting, the terminal theme pickers and "Use Ghostty theme". Each test launches with
// its own data directory.

let app: ElectronApplication | undefined

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

const dialog = (page: Page): Locator => page.getByTestId('settings-dialog')

/** Creates a workspace in a fresh directory and its card `title`, left open at full size. */
async function workspaceWithCard(page: Page, title: string): Promise<void> {
  const dir = join(mkdtempSync(join(tmpdir(), 'drovr-themes-')), 'alpha')
  mkdirSync(dir)
  await page.getByTestId('workspace-add').click()
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await newCard(page, title)
}

async function newCard(page: Page, title: string): Promise<void> {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

/** The open card's terminal: its xterm background and red, and its buffer as trimmed lines. */
function openTerminal(page: Page): Promise<{ background: string; red: string; lines: string[] }> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: {
            options: { theme: { background: string; red: string } }
            buffer: {
              active: {
                length: number
                getLine(i: number): { translateToString(trim: boolean): string } | undefined
              }
            }
          }
        })
      | null
    const term = host?.__xterm
    if (!term) return { background: '', red: '', lines: [] }
    const lines: string[] = []
    for (let i = 0; i < term.buffer.active.length; i++) {
      lines.push(term.buffer.active.getLine(i)?.translateToString(true).trim() ?? '')
    }
    return { background: term.options.theme.background, red: term.options.theme.red, lines }
  })
}

const savedSettings = (dataDir: string): Record<string, unknown> => {
  const path = join(dataDir, 'drovr-settings.json')
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { settings: Record<string, unknown> }).settings
    : {}
}

test('the dark theme picker: search, preview, pick with Enter; Cancel and Escape keep the theme', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await page.emulateMedia({ colorScheme: 'dark' })
  await workspaceWithCard(page, 'api')
  await page.getByTestId('settings-open').click()
  await dialog(page).getByTestId('settings-theme-dark').check()
  await dialog(page).getByTestId('settings-section-terminal').click()

  // Cancel leaves the theme as it was and returns to Settings, on the Terminal section.
  await dialog(page).getByTestId('settings-terminal-theme-dark').click()
  await expect(dialog(page).getByTestId('theme-picker')).toBeVisible()
  await expect(dialog(page).getByTestId('theme-filter-dark')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await dialog(page).getByTestId('theme-cancel').click()
  await expect(dialog(page).getByTestId('settings-terminal-theme-dark')).toContainText('Drovr Dark')

  // Escape in the picker closes only the picker.
  await dialog(page).getByTestId('settings-terminal-theme-dark').click()
  await page.keyboard.press('Escape')
  await expect(dialog(page).getByTestId('settings-terminal-theme-dark')).toBeVisible()

  await dialog(page).getByTestId('settings-terminal-theme-dark').click()
  const search = dialog(page).getByTestId('theme-search')
  await search.fill('catppuccin')
  // Only the dark Catppuccins at first; Latte is light.
  await expect(dialog(page).getByTestId('theme-option')).toHaveText([
    'Catppuccin Frappe',
    'Catppuccin Macchiato',
    'Catppuccin Mocha'
  ])
  await search.press('ArrowDown')
  await search.press('ArrowDown')
  await search.press('ArrowDown')
  await expect(dialog(page).getByTestId('theme-highlighted')).toHaveText('Catppuccin Mocha')
  await expect(dialog(page).getByTestId('theme-preview')).toHaveAttribute(
    'data-background',
    '#1e1e2e'
  )
  await search.press('Enter')
  await expect(dialog(page).getByTestId('settings-terminal-theme-dark')).toContainText(
    'Catppuccin Mocha'
  )
  await page.keyboard.press('Escape')

  await expect.poll(async () => (await openTerminal(page)).background).toBe('#1e1e2e')
  await expect.poll(() => savedSettings(dataDir).terminalThemeDark).toBe('Catppuccin Mocha')
  expect(savedSettings(dataDir).terminalThemeLight).toBe('Drovr Light')
})

test("Use Ghostty theme reads the user's Ghostty config, per appearance, and is kept across a restart", async () => {
  const home = mkdtempSync(join(tmpdir(), 'drovr-ghostty-home-'))
  const config = join(home, '.config')
  mkdirSync(join(config, 'ghostty'), { recursive: true })
  writeFileSync(
    join(config, 'ghostty', 'config'),
    'theme = light:Catppuccin Latte,dark:Catppuccin Mocha\npalette = 1=#ff0000\n'
  )
  // HOME too, so a real macOS config in ~/Library/Application Support is never read.
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: config } as Record<string, string>
  let launched = await launchApp({ env })
  app = launched.app
  const { dataDir } = launched
  let page = launched.page
  await workspaceWithCard(page, 'api')

  await page.getByTestId('settings-open').click()
  await dialog(page).getByTestId('settings-section-terminal').click()
  await dialog(page).getByTestId('settings-use-ghostty').check()
  await expect(dialog(page).getByTestId('settings-ghostty-status')).toContainText(
    'Theme: light:Catppuccin Latte, dark:Catppuccin Mocha'
  )
  // The built-in themes' pickers give way to what was read from Ghostty.
  await expect(dialog(page).getByTestId('settings-terminal-theme-dark')).toHaveCount(0)
  await expect(dialog(page).getByTestId('settings-terminal-theme-light')).toHaveCount(0)
  // Playwright pins a light page: Latte, with the config's own red over the theme's.
  await expect.poll(async () => (await openTerminal(page)).background).toBe('#eff1f5')
  expect((await openTerminal(page)).red).toBe('#ff0000')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(async () => (await openTerminal(page)).background).toBe('#1e1e2e')

  // Reload picks up a changed config.
  writeFileSync(join(config, 'ghostty', 'config'), 'theme = Dracula\n')
  await dialog(page).getByTestId('settings-ghostty-reload').click()
  await expect.poll(async () => (await openTerminal(page)).background).toBe('#282a36')
  await expect.poll(() => savedSettings(dataDir).useGhosttyTheme).toBe(true)

  await app.close()
  launched = await launchApp({ env, dataDir })
  app = launched.app
  page = launched.page
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByTestId('card').filter({ hasText: 'api' }).getByTestId('card-open').click()
  await expect.poll(async () => (await openTerminal(page)).background).toBe('#282a36')

  // Turned off: the picked themes again.
  await page.getByTestId('settings-open').click()
  await dialog(page).getByTestId('settings-section-terminal').click()
  await dialog(page).getByTestId('settings-colours-builtin').check()
  await expect.poll(async () => (await openTerminal(page)).background).toBe('#14151a')
})

test('the Shell setting: a listed shell starts new cards with $SHELL set; a missing one fails to start', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await page.getByTestId('settings-open').click()
  await dialog(page).getByTestId('settings-section-shell').click()
  const shell = dialog(page).getByTestId('settings-shell')
  // Shells by name, then path: `Login shell — zsh — /bin/zsh`, `sh — /bin/sh`.
  await expect(shell.locator('option').first()).toHaveText(/^Login shell — \S+ — \/.+$/)
  await expect(shell.locator('option[value="/bin/sh"]')).toHaveText('sh — /bin/sh')
  await shell.selectOption('/bin/sh')
  await expect.poll(() => savedSettings(dataDir).shell).toBe('/bin/sh')
  await page.keyboard.press('Escape')

  await workspaceWithCard(page, 'sh')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('echo "shell=$SHELL"')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await openTerminal(page)).lines).toContain('shell=/bin/sh')

  // Another path, typed; one that doesn't exist refuses to start.
  await page.getByTestId('settings-open').click()
  await dialog(page).getByTestId('settings-section-shell').click()
  await shell.selectOption({ label: 'Other…' })
  const path = dialog(page).getByTestId('settings-shell-path')
  await path.fill('fish')
  await path.press('Enter')
  await expect(dialog(page).getByTestId('settings-error-shell')).toBeVisible()
  await path.fill('/nonexistent/fish')
  await path.press('Enter')
  await expect(dialog(page).getByTestId('settings-error-shell')).toHaveCount(0)
  await expect.poll(() => savedSettings(dataDir).shell).toBe('/nonexistent/fish')
  await page.keyboard.press('Escape')
  await backToBoard(page)
  await newCard(page, 'missing')
  await expectStatusOnBoard(page, 'missing', "Couldn't start: shell not found: /nonexistent/fish")
})
