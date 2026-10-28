import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { backToBoard, boardCard, cardView, expectCardOpen } from './card-view'
import { fakeSshHome, removeRemoteForwards, type FakeSshHome } from './fake-ssh'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'
import { showShells } from './shells-tab'

// The side panel beside an open card (#55 S1) and beside the board (#57): shown by default,
// toggled by its title bar button, its hide button and the Toggle panel shortcut, resized from its
// left edge, saved app-wide in bikube-settings.json, and its Files tab's SSH message.

const darwin = process.platform === 'darwin'
/** The Toggle panel default (#55 D2) as a Playwright press. */
const TOGGLE = darwin ? 'Alt+Meta+B' : 'Control+Alt+B'
/** The command palette's default shortcut (#40 D1) as a Playwright press. */
const PALETTE = darwin ? 'Meta+K' : 'Control+Shift+P'

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
  root = mkdtempSync(join(tmpdir(), 'bikube-panel-'))
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

const settingsPath = (): string => join(dataDir, 'bikube-settings.json')
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
async function openC1(launchEnv?: Record<string, string>): Promise<void> {
  await launch(launchEnv)
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
  // Its tabs are in the title bar above it.
  const tabs = page.getByTestId('titlebar-panel-side').getByRole('tab')
  await expect(tabs).toHaveText(['Files', 'Shells'])
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'true')
  // Nothing is saved while the panel is as by default.
  expect(savedSettings()).not.toHaveProperty('sidePanelOpen')

  // Back on the board, the panel and its button stay (#57 D1, D4).
  await backToBoard(page)
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'true')
  await expect(panel()).toBeVisible()
})

test('#57 AC1: the panel shows at the right of the board, 280 px, with the workspace folder', async () => {
  await launch()
  // No panel and no button on the empty state.
  await expect(page.getByTestId('empty-state')).toBeVisible()
  await expect(panel()).toHaveCount(0)
  await expect(panelButton()).toHaveCount(0)

  await createWorkspace(repo, 'repo')
  const board = page.getByTestId('board')
  await expect(board).toBeVisible()
  await expect(panel()).toBeVisible()
  const panelBox = (await panel().boundingBox())!
  const boardBox = (await board.boundingBox())!
  expect(panelBox.width).toBe(280)
  expect(panelBox.x).toBeGreaterThanOrEqual(boardBox.x + boardBox.width - 1)
  // Full height of the content area, beside the toolbar and the board.
  const toolbarBox = (await page.getByTestId('workspace-toolbar').boundingBox())!
  expect(Math.abs(panelBox.y - toolbarBox.y)).toBeLessThanOrEqual(1)
  expect(
    Math.abs(panelBox.y + panelBox.height - (boardBox.y + boardBox.height))
  ).toBeLessThanOrEqual(1)
  await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true')
  await expect(row('')).toHaveText('repo')
  await expect(row('')).toHaveAttribute('title', repo)
  await expect(row('src')).toBeVisible()
  await expect(row('README.md')).toBeVisible()
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'true')
  // The board still scrolls its columns sideways rather than pushing the panel out.
  await expect
    .poll(() => page.locator('.board-columns').evaluate((el) => getComputedStyle(el).overflowX))
    .toBe('auto')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth)
  )
})

test('#57 AC2: the shortcut, the button and the palette toggle it on the board, shared with cards', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await expect(panel()).toBeVisible()

  await page.keyboard.press(TOGGLE)
  await expect(panel()).toHaveCount(0)
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => savedSettings()['sidePanelOpen']).toBe(false)

  // One open state (D3): a card opened now shows no panel.
  await newCard('c1')
  await expect(panel()).toHaveCount(0)
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'false')
  await backToBoard(page)

  await panelButton().click()
  await expect(panel()).toBeVisible()
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => 'sidePanelOpen' in savedSettings()).toBe(false)

  // The palette's Toggle panel row on the board.
  for (const shown of [false, true]) {
    await page.keyboard.press(PALETTE)
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await page.keyboard.type('Toggle panel')
    await expect(palette.getByTestId('palette-row-title').first()).toHaveText('Toggle panel')
    await page.keyboard.press('Enter')
    await expect(palette).toHaveCount(0)
    await expect(panel()).toHaveCount(shown ? 1 : 0)
  }

  // The title bar's button over the panel on the board hides it everywhere too.
  await panelButton().click()
  await expect(panel()).toHaveCount(0)
  await openCard('c1')
  await expect(panel()).toHaveCount(0)
  await backToBoard(page)

  // Held down, it toggles once; behind a dialog it does nothing (D4).
  const [mod, alt, key] = TOGGLE.split('+') as [string, string, string]
  await page.keyboard.down(mod)
  await page.keyboard.down(alt)
  await page.keyboard.down(key)
  await page.keyboard.down(key)
  await page.keyboard.down(key)
  await page.keyboard.up(key)
  await page.keyboard.up(alt)
  await page.keyboard.up(mod)
  await expect(panel()).toBeVisible()
  await page.keyboard.press(darwin ? 'Meta+,' : 'Control+,')
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await page.keyboard.press(TOGGLE)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect(panel()).toBeVisible()
})

test('#55 AC2: the shortcut and the title bar button toggle it, with no hide button, saved across a restart', async () => {
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

  // No close button of its own: the title bar's button is the one show/hide.
  await expect(page.getByTestId('side-panel-hide')).toHaveCount(0)

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

test('the panel runs from the window top: its tabs and button in the title bar, as wide as the panel', async () => {
  await openC1()
  const section = page.getByTestId('titlebar-panel-side')
  await expect(section.getByRole('tab')).toHaveText(['Files', 'Shells'])
  await expect(section.getByTestId('titlebar-panel')).toHaveAttribute('aria-pressed', 'true')
  const above = (await section.boundingBox())!
  const body = (await panel().boundingBox())!
  expect(above.y).toBe(0)
  expect(above.x).toBe(body.x)
  expect(above.width).toBe(body.width)
  expect(body.y).toBeCloseTo(above.y + above.height, 0)
  // A drag of its edge widens both at once.
  const edge = (await page.getByTestId('side-panel-resize').boundingBox())!
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 200)
  await page.mouse.down()
  await page.mouse.move(edge.x + edge.width / 2 - 60, edge.y + 200)
  await expect.poll(async () => (await section.boundingBox())!.width).toBe(body.width + 60)
  await page.mouse.up()
  await expect.poll(async () => (await panel().boundingBox())!.width).toBe(body.width + 60)

  // A tab picked in the title bar shows in the panel.
  await section.getByRole('tab', { name: 'Shells' }).click()
  await expect(panel().getByRole('tabpanel')).toHaveAttribute(
    'aria-labelledby',
    'side-panel-tab-shells'
  )

  // Hidden: the section is gone and the button sits at the title bar's end.
  await section.getByTestId('titlebar-panel').click()
  await expect(section).toHaveCount(0)
  await expect(panel()).toHaveCount(0)
  await expect(panelButton()).toHaveAttribute('aria-pressed', 'false')

  // On the board, the toolbar ends where the panel starts.
  await panelButton().click()
  await backToBoard(page)
  const toolbar = (await page.getByTestId('workspace-toolbar').boundingBox())!
  const boardPanel = (await panel().boundingBox())!
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(boardPanel.x + 1)
  expect(boardPanel.y).toBeLessThan(toolbar.y + 1)
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
  const REMOTE_DIR = '/tmp/bikube-remote'
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

  test("#57 AC3: an SSH workspace's board shows the panel with the SSH message", async () => {
    await launch(fake.env)
    await page.getByTestId('workspace-add').click()
    await plainCards(page)
    await page.getByTestId('workspace-location-ssh').check()
    await page.getByTestId('workspace-host').fill('devbox')
    await page.getByTestId('workspace-directory').fill(REMOTE_DIR)
    await page.getByTestId('workspace-name').fill('remote')
    await page.getByTestId('workspace-submit').click()
    await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

    await expect(page.getByTestId('board')).toBeVisible()
    await expect(panel()).toBeVisible()
    await expect(panel().getByTestId('files-tab')).toHaveText("Files aren't available over SSH yet")
  })
})

// The Files tab's tree (#55 S2): the card's folder, lazily listed, ignored entries dimmed.

const filesTab = (): Locator => panel().getByTestId('files-tab')
/** The tree's row for `path` (relative, `''` for the root row). */
const row = (path: string): Locator =>
  filesTab().locator(`[data-testid=files-row][data-path="${path}"]`)
/** The change letter on `path`'s row. */
const change = (path: string): Locator => row(path).getByTestId('files-change')
const changedOnly = (): Locator => filesTab().getByTestId('files-changed-only')
/** The names of the rows that show, in order, indented two spaces per level. */
const shownRows = (): Promise<string[]> =>
  filesTab()
    .locator('[data-testid=files-row]')
    .evaluateAll((rows) =>
      rows.map(
        (r) =>
          '  '.repeat(Number(r.getAttribute('aria-level')) - 1) +
          (r.querySelector('.files-name')?.textContent ?? '')
      )
    )

test('#55 AC5: the tree lists folders, then files, without .git, ignored ones dimmed', async () => {
  await openC1()
  await expect(row('')).toHaveText('repo')
  await expect(row('')).toHaveAttribute('title', repo)
  await expect.poll(shownRows).toEqual(['repo', '  dist', '  src', '  .gitignore', '  README.md'])
  await expect(row('dist')).toHaveAttribute('data-ignored', 'true')
  await expect(row('src')).toHaveAttribute('data-ignored', 'false')
  await expect(row('README.md')).toHaveAttribute('data-ignored', 'false')

  await row('src').dblclick()
  await expect(row('src')).toHaveAttribute('aria-expanded', 'true')
  await row('dist').dblclick()
  await expect
    .poll(shownRows)
    .toEqual([
      'repo',
      '  dist',
      '    out.js',
      '  src',
      '    a.ts',
      '    b.ts',
      '  .gitignore',
      '  README.md'
    ])
  await expect(row('dist/out.js')).toHaveAttribute('data-ignored', 'true')
  await expect(row('src/a.ts')).toHaveAttribute('data-ignored', 'false')

  // Double-clicking an expanded folder collapses it.
  await row('dist').dblclick()
  await expect(row('dist/out.js')).toHaveCount(0)
})

test("the tree's rows show vscode-icons by file type and folder name, open folders opened", async () => {
  await openC1()
  const icon = (path: string): Locator => row(path).getByTestId('files-icon')
  await expect(icon('')).toHaveAttribute('data-icon', 'default_root_folder_opened.svg')
  await expect(icon('src')).toHaveAttribute('data-icon', 'folder_type_src.svg')
  await expect(icon('dist')).toHaveAttribute('data-icon', 'folder_type_dist.svg')
  await expect(icon('.gitignore')).toHaveAttribute('data-icon', 'file_type_git.svg')
  await expect(icon('README.md')).toHaveAttribute('data-icon', 'file_type_readme.svg')
  await row('src').dblclick()
  await expect(icon('src')).toHaveAttribute('data-icon', 'folder_type_src_opened.svg')
  await expect(icon('src/a.ts')).toHaveAttribute('data-icon', 'file_type_typescript.svg')
  // Every icon shown has loaded.
  await expect
    .poll(() =>
      page
        .getByTestId('files-icon')
        .evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0))
    )
    .toBe(true)
})

test('#55 AC6: expanded folders are remembered after going Back and reopening the card', async () => {
  await openC1()
  await row('src').dblclick()
  await expect(row('src/a.ts')).toBeVisible()
  await backToBoard(page)
  await openCard('c1')
  await expect(row('src')).toHaveAttribute('aria-expanded', 'true')
  await expect(row('src/a.ts')).toBeVisible()
  await expect(row('dist')).toHaveAttribute('aria-expanded', 'false')
})

test('#55 D7: the tree is keyboard-navigable', async () => {
  await openC1()
  await expect(row('src')).toBeVisible()
  await row('').click()
  await expect(row('')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(row('dist')).toBeFocused()
  await expect(row('dist')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await expect(row('src')).toHaveAttribute('aria-expanded', 'true')
  await expect(row('src/a.ts')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(row('src/a.ts')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(row('src')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(row('src')).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await expect(row('src')).toHaveAttribute('aria-expanded', 'true')
  await expect(row('src')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(row('dist')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(row('')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(row('')).toHaveAttribute('aria-expanded', 'false')
  await expect(row('src')).toHaveCount(0)
})

test('#55 AC9: a new file shows under an expanded folder within 4 s, and at once with Refresh', async () => {
  await openC1()
  await row('src').dblclick()
  await row('dist').dblclick()
  await expect(row('dist/out.js')).toBeVisible()
  await terminalArea().click()
  await page.keyboard.type('touch src/z.ts')
  await page.keyboard.press('Enter')
  await expect(row('src/z.ts')).toBeVisible({ timeout: 4000 })
  await expect(change('src/z.ts')).toHaveText('U', { timeout: 4000 })
  // Nothing collapsed.
  await expect(row('dist/out.js')).toBeVisible()
  await expect(row('src')).toHaveAttribute('aria-expanded', 'true')

  // Refresh reads at once: the file is made right after a read, well before the next one.
  await row('src/z.ts').click()
  await expect(row('src/z.ts')).toHaveAttribute('aria-selected', 'true')
  writeFileSync(join(repo, 'src', 'y.ts'), '')
  await panel().getByTestId('files-refresh').click()
  await expect(row('src/y.ts')).toBeVisible({ timeout: 1000 })
  await expect(change('src/y.ts')).toHaveText('U', { timeout: 1000 })
  await expect(row('src/z.ts')).toHaveAttribute('aria-selected', 'true')
})

test("#55 AC10: a worktree card shows its worktree, the workspace's Default shell the workspace folder", async () => {
  await openC1()
  await backToBoard(page)
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('Own tree')
  await page.getByTestId('new-card-worktree').check()
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'Own tree')
  await expect(row('')).toHaveText('own-tree')
  await expect(row('')).toHaveAttribute(
    'title',
    new RegExp(`${join('worktrees', '[^/]+', 'own-tree')}$`)
  )
  await expect
    .poll(shownRows)
    .toEqual(['own-tree', '  dist', '  src', '  .gitignore', '  README.md'])

  await backToBoard(page)
  await showShells(page)
  await page.getByTestId('shell').filter({ hasText: 'Default' }).getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await page.getByTestId('side-panel-tab-files').click()
  await expect(row('')).toHaveText('repo')
  await expect(row('')).toHaveAttribute('title', repo)
  await expect.poll(shownRows).toEqual(['repo', '  dist', '  src', '  .gitignore', '  README.md'])
})

test('#55 AC11: outside a git repository the tree lists every file and dims nothing', async () => {
  const plain = join(root, 'plain')
  mkdirSync(join(plain, 'dist'), { recursive: true })
  writeFileSync(join(plain, '.gitignore'), 'dist/\n')
  writeFileSync(join(plain, 'notes.txt'), '')
  await launch()
  await createWorkspace(plain, 'plain')
  await newCard('c1')
  await expect.poll(shownRows).toEqual(['plain', '  dist', '  .gitignore', '  notes.txt'])
  await expect(filesTab().locator('[data-ignored=true]')).toHaveCount(0)
  // Nothing is marked, and Changed only is disabled.
  await expect(changedOnly()).toBeDisabled()
  await expect(changedOnly()).toHaveAttribute('title', 'Not a git repository')
  await expect(filesTab().getByTestId('files-change')).toHaveCount(0)
  await expect(filesTab().locator('[data-dot=true]')).toHaveCount(0)
})

// The changes (#55 S3): git's letters, folder dots, deleted rows and the Changed only filter.

/** AC7's changes: `src/a.ts` modified, `src/new.ts` untracked, `README.md` deleted, `src/b.ts` staged as renamed to `src/c.ts`. */
function makeChanges(): void {
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 3\n')
  writeFileSync(join(repo, 'src', 'new.ts'), '')
  rmSync(join(repo, 'README.md'))
  execFileSync('git', ['mv', 'src/b.ts', 'src/c.ts'], { cwd: repo })
}

test('#55 AC7: changed paths read their letters, folders a dot, a deleted file struck through', async () => {
  makeChanges()
  await openC1()
  await row('src').dblclick()
  await expect(row('src')).toHaveAttribute('data-dot', 'true', { timeout: 4000 })
  await expect(change('src/a.ts')).toHaveText('M', { timeout: 4000 })
  await expect(change('src/new.ts')).toHaveText('U')
  await expect(change('src/c.ts')).toHaveText('R')
  await expect(change('src/c.ts')).toHaveAttribute('title', 'Renamed from src/b.ts')
  await expect(change('README.md')).toHaveText('D')
  await expect(row('README.md').locator('.files-name')).toHaveCSS(
    'text-decoration-line',
    'line-through'
  )
  await expect(row('dist')).toHaveAttribute('data-dot', 'false')
  await expect(change('.gitignore')).toHaveCount(0)
  // The deleted file is listed among the files, in order.
  await expect
    .poll(shownRows)
    .toEqual([
      'repo',
      '  dist',
      '  src',
      '    a.ts',
      '    c.ts',
      '    new.ts',
      '  .gitignore',
      '  README.md'
    ])
})

test('#55 AC8: Changed only lists just the changed paths and their folders; No changes without any', async () => {
  makeChanges()
  await openC1()
  await expect(change('README.md')).toHaveText('D', { timeout: 4000 })
  await expect(changedOnly()).toBeEnabled()
  await expect(changedOnly()).toHaveAttribute('aria-pressed', 'false')
  await changedOnly().click()
  await expect(changedOnly()).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(shownRows)
    .toEqual(['repo', '  src', '    a.ts', '    c.ts', '    new.ts', '  README.md'])
  await expect(change('src/c.ts')).toHaveText('R')

  // Remembered for the folder: Back and reopen keeps it on.
  await backToBoard(page)
  await openCard('c1')
  await expect(changedOnly()).toHaveAttribute('aria-pressed', 'true')

  // With nothing changed it reads No changes.
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'all'], {
    cwd: repo
  })
  await panel().getByTestId('files-refresh').click()
  await expect(filesTab().getByTestId('files-no-changes')).toHaveText('No changes')
  await expect(filesTab().locator('[data-testid=files-row]')).toHaveCount(0)

  await changedOnly().click()
  await expect(changedOnly()).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(shownRows).toEqual(['repo', '  dist', '  src', '  .gitignore'])
})

// Opening files (#55 S4): the editor setting, run through the login shell with its PATH.

/**
 * The environment to launch with: its login shell (`/bin/sh -l`, through `SHELL`) gets a PATH of
 * a fake `bin` and the system folders only, so a real `code` never runs; `commands` are fake
 * editors there, each run logging `run <name>` and then its arguments, one per line.
 */
function editorEnv(commands: string[]): Record<string, string> {
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  mkdirSync(home, { recursive: true })
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(home, '.profile'), `PATH='${bin}':/usr/bin:/bin; export PATH\n`)
  for (const name of commands) {
    const path = join(bin, name)
    writeFileSync(
      path,
      `#!/bin/sh\n{ echo "run $(basename "$0")"; printf '%s\\n' "$@"; } >> '${editorLog()}'\n`
    )
    chmodSync(path, 0o755)
  }
  const inherited: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) inherited[key] = value
  }
  return { ...inherited, SHELL: '/bin/sh', HOME: home }
}

const editorLog = (): string => join(root, 'editors.log')
const editorRuns = (): string[] =>
  existsSync(editorLog()) ? readFileSync(editorLog(), 'utf8').trimEnd().split('\n') : []
const openError = (): Locator => filesTab().getByTestId('files-open-error')

test('#55 AC13: double-click or Enter opens a file in VS Code with the folder; a folder only toggles', async () => {
  await openC1(editorEnv(['code']))
  await row('src').dblclick()
  await expect(row('src/a.ts')).toBeVisible()
  await expect(row('src')).toHaveAttribute('aria-expanded', 'true')
  await row('src/a.ts').dblclick()
  await expect.poll(editorRuns).toEqual(['run code', repo, join(repo, 'src', 'a.ts')])
  // Once: the double-click's two clicks open nothing.
  await page.waitForTimeout(500)
  expect(editorRuns()).toEqual(['run code', repo, join(repo, 'src', 'a.ts')])
  await expect(openError()).toHaveCount(0)

  // Enter on the selected file does the same.
  await row('src/b.ts').click()
  await expect(row('src/b.ts')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect
    .poll(editorRuns)
    .toEqual([
      'run code',
      repo,
      join(repo, 'src', 'a.ts'),
      'run code',
      repo,
      join(repo, 'src', 'b.ts')
    ])

  // A folder toggles and runs nothing.
  const before = editorRuns()
  await row('src').dblclick()
  await expect(row('src')).toHaveAttribute('aria-expanded', 'false')
  await page.waitForTimeout(500)
  expect(editorRuns()).toEqual(before)
})

test('#55 AC14: a custom command from Settings > Editor opens the file; a missing editor shows why', async () => {
  await openC1(editorEnv(['fake-editor']))
  // VS Code is the default, and it isn't installed here.
  await row('src').dblclick()
  await row('src/a.ts').dblclick()
  await expect(openError()).toHaveText("Couldn't open a.ts: code not found")
  await openError().getByTestId('files-open-error-dismiss').click()
  await expect(openError()).toHaveCount(0)

  await page.keyboard.press('Control+,')
  const dialog = page.getByTestId('settings-dialog')
  await dialog.getByTestId('settings-section-editor').click()
  await expect(dialog.getByTestId('settings-editor')).toHaveValue('vscode')
  await dialog.getByTestId('settings-editor').selectOption({ label: 'Custom command' })
  await dialog.getByTestId('settings-editor-command').fill('fake-editor --wait')
  await dialog.getByTestId('settings-done').click()
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(savedSettings)
    .toMatchObject({ editor: 'custom', editorCommand: 'fake-editor --wait' })

  await row('README.md').dblclick()
  await expect.poll(editorRuns).toEqual(['run fake-editor', '--wait', join(repo, 'README.md')])
  await expect(openError()).toHaveCount(0)

  // An empty custom command opens nothing and says where to set one.
  await page.keyboard.press('Control+,')
  await dialog.getByTestId('settings-section-editor').click()
  await dialog.getByTestId('settings-editor-command').fill('')
  await dialog.getByTestId('settings-done').click()
  await row('README.md').dblclick()
  await expect(openError()).toHaveText('Set a command in Settings > Editor')
  expect(editorRuns()).toEqual(['run fake-editor', '--wait', join(repo, 'README.md')])
})

test('#55 D13: a deleted file opens nothing', async () => {
  rmSync(join(repo, 'README.md'))
  await openC1(editorEnv(['code']))
  await expect(change('README.md')).toHaveText('D', { timeout: 4000 })
  await row('README.md').dblclick()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  expect(editorRuns()).toEqual([])
  await expect(openError()).toHaveCount(0)
})
