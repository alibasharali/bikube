import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { backToBoard, boardCard, cardView, expectCardOpen } from './card-view'
import { fakeSshHome, removeRemoteForwards, type FakeSshHome } from './fake-ssh'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The side panel beside an open card (#55 S1): shown by default, toggled by its title bar button,
// its hide button and the Toggle panel shortcut, resized from its left edge, saved app-wide in
// drovr-settings.json, and its Files tab's SSH message.

const darwin = process.platform === 'darwin'
/** The Toggle panel default (#55 D2) as a Playwright press. */
const TOGGLE = darwin ? 'Alt+Meta+B' : 'Control+Alt+B'

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string
let repo: string

/** The spec's repository: committed files, a .gitignore with `dist/` and an ignored file. */
function makeRepo(dir: string): void {
  const files: Record<string, string> = {
    'README.md': '# repo\n',
    'src/a.ts': 'export const a = 1\n',
    'src/b.ts': 'export const b = 2\n',
    '.gitignore': 'dist/\n',
    'dist/out.js': 'built\n'
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir })
  }
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
}

test.beforeEach(() => {
  dataDir = newDataDir()
  root = mkdtempSync(join(tmpdir(), 'drovr-panel-'))
  repo = join(root, 'repo')
  makeRepo(repo)
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

/** `env` replaces the whole environment (the fake ssh home's holds this process's). */
async function launch(env?: Record<string, string>): Promise<void> {
  ;({ app, page } = await launchApp({ dataDir, ...(env && { env }) }))
}

async function restart(): Promise<void> {
  await app?.close()
  await launch()
}

const settingsPath = (): string => join(dataDir, 'drovr-settings.json')
/** The settings file's `settings` object; empty while there is no file. */
const savedSettings = (): Record<string, unknown> =>
  existsSync(settingsPath())
    ? (JSON.parse(readFileSync(settingsPath(), 'utf8')) as { settings: Record<string, unknown> })
        .settings
    : {}

async function createWorkspace(directory: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(directory)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Creates card `title` in Backlog; its view opens. */
async function newCard(title: string): Promise<void> {
  await page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    .getByTestId('new-card')
    .click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

/** Opens card `title` from the board (starting it when stopped). */
async function openCard(title: string): Promise<void> {
  await boardCard(page, title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

const panel = (): Locator => page.getByTestId('side-panel')
const panelButton = (): Locator => page.getByTestId('titlebar-panel')
const terminalArea = (): Locator => cardView(page).getByTestId('card-terminal')

async function width(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  return box?.width ?? 0
}

/** Waits until the focus is in the open card's terminal. */
async function expectTerminalFocused(): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.closest('[data-testid=card-view] [data-testid=pane]') != null
      )
    )
    .toBe(true)
}

/** Opens `repo` with card `c1` open at full size. */
async function openC1(): Promise<void> {
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('c1')
}

test('#55 AC1: the panel shows by default at the right of the panes, 280 px, Files selected', async () => {
  await openC1()
  await expect(panel()).toBeVisible()
  const panelBox = (await panel().boundingBox())!
  const termBox = (await terminalArea().boundingBox())!
  expect(panelBox.width).toBe(280)
  expect(panelBox.x).toBeGreaterThanOrEqual(termBox.x + termBox.width - 1)
  // Full height of the content area, beside the panes.
  expect(Math.abs(panelBox.height - termBox.height)).toBeLessThanOrEqual(1)
  const tabs = panel().getByRole('tab')
  await expect(tabs).toHaveCount(1)
  await expect(tabs.first()).toHaveText('Files')
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'true')
  // Nothing is saved while the panel is as by default.
  expect(savedSettings()).not.toHaveProperty('sidePanelOpen')

  // The button shows only while a card is open.
  await backToBoard(page)
  await expect(panelButton()).toHaveCount(0)
  await expect(panel()).toHaveCount(0)
})

test('#55 AC2: the shortcut, the button and the hide button toggle it, saved across a restart', async () => {
  await openC1()
  await expectTerminalFocused()
  const narrow = await width(terminalArea())

  await page.keyboard.press(TOGGLE)
  await expect(panel()).toHaveCount(0)
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => width(terminalArea())).toBeGreaterThan(narrow + 200)
  await expect.poll(() => savedSettings()['sidePanelOpen']).toBe(false)
  // The shortcut never reaches the terminal, and focus stays in it.
  await expectTerminalFocused()

  await restart()
  await openCard('c1')
  await expect(panel()).toHaveCount(0)
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'false')

  await panelButton().click()
  await expect(panel()).toBeVisible()
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => 'sidePanelOpen' in savedSettings()).toBe(false)

  await panel().getByTestId('side-panel-hide').click()
  await expect(panel()).toHaveCount(0)
  await panelButton().click()
  await expect(panel()).toBeVisible()

  // Held down, it toggles once: the auto-repeats are swallowed.
  await terminalArea().click()
  await expectTerminalFocused()
  const [mod, alt, key] = TOGGLE.split('+') as [string, string, string]
  await page.keyboard.down(mod)
  await page.keyboard.down(alt)
  await page.keyboard.down(key)
  await page.keyboard.down(key)
  await page.keyboard.down(key)
  await page.keyboard.up(key)
  await page.keyboard.up(alt)
  await page.keyboard.up(mod)
  await expect(panel()).toHaveCount(0)

  // Behind an open dialog it does nothing.
  await page.keyboard.press(darwin ? 'Meta+,' : 'Control+,')
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await page.keyboard.press(TOGGLE)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect(panel()).toHaveCount(0)
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'false')
})

test('#55 AC3: Toggle panel is listed in Settings and can be recorded', async () => {
  test.skip(darwin, 'the AC names the Linux default')
  await openC1()
  await page.keyboard.press('Control+,')
  const dialog = page.getByTestId('settings-dialog')
  await dialog.getByTestId('settings-section-shortcuts').click()
  const field = dialog.getByTestId('settings-shortcut-togglePanel')
  await expect(dialog.getByRole('group', { name: 'Shortcuts' })).toContainText('Toggle panel')
  await expect(field).toHaveText('Ctrl+Alt+B')
  await field.click()
  await page.keyboard.press('Control+Alt+P')
  await expect(field).toHaveText('Ctrl+Alt+P')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await terminalArea().click()
  await expectTerminalFocused()
  await page.keyboard.press('Control+Alt+B')
  await expect(panel()).toBeVisible()
  await page.keyboard.press('Control+Alt+P')
  await expect(panel()).toHaveCount(0)
  await page.keyboard.press('Control+Alt+P')
  await expect(panel()).toBeVisible()
})

/** Drags the panel's left edge `dx` px (negative: to the left). */
async function dragEdge(dx: number): Promise<void> {
  const handle = panel().getByTestId('side-panel-resize')
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y, { steps: 4 })
  await page.mouse.move(x + dx, y, { steps: 4 })
  await page.mouse.up()
}

test('#55 AC4: dragging the left edge resizes it, kept across a restart, between 200 and half', async () => {
  await openC1()
  const handle = panel().getByTestId('side-panel-resize')
  await expect(handle).toHaveAttribute('role', 'separator')
  await expect(handle).toHaveCSS('cursor', 'col-resize')

  await dragEdge(-120)
  await expect.poll(() => width(panel())).toBe(400)
  await expect.poll(() => savedSettings()['sidePanelWidth']).toBe(400)

  await restart()
  await openCard('c1')
  await expect.poll(() => width(panel())).toBe(400)

  await dragEdge(2000)
  await expect.poll(() => width(panel())).toBe(200)
  const half = await page.evaluate(() => Math.floor(window.innerWidth / 2))
  await dragEdge(-4000)
  await expect.poll(() => width(panel())).toBe(half)
  await expect.poll(() => savedSettings()['sidePanelWidth']).toBe(half)

  // The arrow keys on the edge move it 16 px.
  await panel().getByTestId('side-panel-resize').focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => width(panel())).toBe(half - 16)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => width(panel())).toBe(half)
})

test.describe('over SSH', () => {
  const REMOTE_DIR = '/tmp/drovr-remote'
  let fake: FakeSshHome

  test.beforeEach(() => {
    mkdirSync(REMOTE_DIR, { recursive: true })
    fake = fakeSshHome(root)
  })

  test.afterEach(() => {
    removeRemoteForwards(fake.sshLog)
  })

  test("#55 AC12: an SSH card's panel shows and its Files tab says SSH isn't supported yet", async () => {
    await launch(fake.env)
    await page.getByTestId('workspace-add').click()
    await plainCards(page)
    await page.getByTestId('workspace-location-ssh').check()
    await page.getByTestId('workspace-host').fill('devbox')
    await page.getByTestId('workspace-directory').fill(REMOTE_DIR)
    await page.getByTestId('workspace-name').fill('remote')
    await page.getByTestId('workspace-submit').click()
    await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
    await newCard('c1')

    await expect(panel()).toBeVisible()
    await expect(panel().getByTestId('files-tab')).toHaveText("Files aren't available over SSH yet")
  })
})
