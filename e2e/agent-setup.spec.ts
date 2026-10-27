import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHORTCUTS, backToBoard, boardCard, expectCardOpen } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The Agent setup page (#68 S1): opened from the board's title bar or the palette, a workspace's
// view as an open card is (its sidebar row, Back, remembered per workspace for the run), its
// section list, search box and Refresh, the SSH message, the narrow layout and the keyboard.

const darwin = process.platform === 'darwin'
/** The command palette's default shortcut (#40 D1) as a Playwright press. */
const PALETTE = darwin ? 'Meta+K' : 'Control+Shift+P'
/** Mod+1 (#31 D18): the first workspace in sidebar order, keeping its view. */
const FIRST_WORKSPACE = darwin ? 'Meta+1' : 'Control+1'

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string

test.beforeEach(() => {
  dataDir = newDataDir()
  root = mkdtempSync(join(tmpdir(), 'bikube-agent-setup-'))
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

async function launch(): Promise<void> {
  ;({ app, page } = await launchApp({ dataDir }))
}

async function createWorkspace(name: string, host?: string): Promise<string> {
  const directory = host ? '/srv/app' : mkdtempSync(join(root, `${name}-`))
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  if (host) {
    await page.getByTestId('workspace-location-ssh').check()
    await page.getByTestId('workspace-host').fill(host)
  }
  await page.getByTestId('workspace-directory').fill(directory)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  return directory
}

const agentSetup = (): Locator => page.getByTestId('agent-setup')
const setupButton = (): Locator => page.getByTestId('titlebar-agent-setup')
/** The `Agent setup` row in the sidebar tree, under workspace `name`. */
const setupRow = (name: string): Locator =>
  page
    .locator('[data-workspace-id]')
    .filter({ has: page.getByTestId('workspace-item').getByText(name, { exact: true }) })
    .getByTestId('workspace-agent-setup')
/** Workspace `name`'s own sidebar row. */
const workspaceItem = (name: string): Locator =>
  page.getByTestId('workspace-item').filter({ hasText: name })
const board = (): Locator => page.getByTestId('board')

test('AC1: the title bar button opens the page; Back and its shortcut go back to the board', async () => {
  await launch()
  const folder = await createWorkspace('Proj')
  await expect(board()).toBeVisible()
  await expect(setupButton()).toHaveAttribute('aria-label', 'Agent setup')
  await expect(setupButton()).toHaveAttribute('title', 'Agent setup')
  await setupButton().click()

  await expect(agentSetup()).toBeVisible()
  await expect(agentSetup().getByRole('heading', { name: 'Agent setup' })).toBeVisible()
  await expect(page.getByTestId('agent-setup-subtitle')).toHaveText(`Claude Code · ${folder}`)
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('agent-setup-panel')).toHaveAttribute('data-section', 'overview')
  await expect(page.getByTestId('titlebar-title')).toContainText('Proj')
  await expect(page.getByTestId('titlebar-agent-setup-title')).toHaveText('Agent setup')
  await expect(page.getByTestId('titlebar-workspace')).toHaveText('Proj')
  await expect(setupRow('Proj')).toHaveText('Agent setup')
  await expect(setupRow('Proj')).toHaveAttribute('aria-current', 'true')
  await expect(page.getByTestId('side-panel')).toHaveCount(0)
  await expect(board()).toHaveCount(0)
  // Not offered while the page is in front.
  await expect(setupButton()).toHaveCount(0)
  expect(await page.title()).toBe('Agent setup — Proj')

  // Back in the title bar.
  await expect(page.getByTestId('titlebar-workspace')).toHaveAttribute('title', 'Back to Proj')
  await page.getByTestId('titlebar-workspace').click()
  await expect(board()).toBeVisible()
  await expect(agentSetup()).toHaveCount(0)
  await expect(setupRow('Proj')).toHaveCount(0)

  // The Back shortcut.
  await setupButton().click()
  await expect(agentSetup()).toBeVisible()
  await page.keyboard.press(SHORTCUTS.back)
  await expect(board()).toBeVisible()
  await expect(setupRow('Proj')).toHaveCount(0)
})

/** Creates card `title` in Backlog; its view opens, running. */
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

/** Picks the palette's action row `label`. */
async function pickAction(label: string): Promise<void> {
  await page.keyboard.press(PALETTE)
  const palette = page.getByTestId('command-palette')
  await expect(palette).toBeVisible()
  await page.keyboard.type(label)
  await palette
    .getByTestId('palette-row')
    .filter({ has: page.getByTestId('palette-row-title').getByText(label, { exact: true }) })
    .click()
  await expect(palette).toHaveCount(0)
}

test('AC2: the palette opens it over a running card; it is remembered for the run only', async () => {
  await launch()
  await createWorkspace('Proj')
  await newCard('c1')

  await pickAction('Agent setup')
  await expect(agentSetup()).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(setupRow('Proj')).toHaveAttribute('aria-current', 'true')
  // The card still runs: its row stays in the tree, and the board reads it Running.
  await expect(page.getByTestId('workspace-terminal')).toHaveCount(1)

  // Another workspace and back (Mod+1 keeps the view): the page shows again.
  await createWorkspace('Other')
  await expect(board()).toBeVisible()
  // Kept under Proj, not current while another workspace is in front.
  await expect(setupRow('Proj')).not.toHaveAttribute('aria-current', 'true')
  await page.keyboard.press(FIRST_WORKSPACE)
  await expect(agentSetup()).toBeVisible()
  await expect(page.getByTestId('titlebar-agent-setup-title')).toHaveText('Agent setup')
  // Its row, from another workspace, shows it too.
  await workspaceItem('Other').click()
  await expect(board()).toBeVisible()
  await setupRow('Proj').click()
  await expect(agentSetup()).toBeVisible()
  await expect(page.getByTestId('board-title')).toHaveCount(0)

  // Proj's own row shows its board and forgets the page.
  await workspaceItem('Proj').click()
  await expect(board()).toBeVisible()
  await expect(setupRow('Proj')).toHaveCount(0)
  await expect(boardCard(page, 'c1').getByTestId('card-status-label')).toHaveText('Running')

  // Opening a card replaces it.
  await setupButton().click()
  await expect(agentSetup()).toBeVisible()
  await page.getByTestId('workspace-terminal').click()
  await expectCardOpen(page, 'c1')
  await expect(setupRow('Proj')).toHaveCount(0)
  await backToBoard(page)

  // Never saved: after a restart Proj shows its board.
  await setupButton().click()
  await expect(agentSetup()).toBeVisible()
  await app!.close()
  await launch()
  await expect(board()).toBeVisible()
  await expect(agentSetup()).toHaveCount(0)
  await expect(setupRow('Proj')).toHaveCount(0)
})

test('AC3: an SSH workspace shows only that the page is not available', async () => {
  await launch()
  await createWorkspace('Remote', 'devbox')
  await expect(setupButton()).toBeVisible()
  await setupButton().click()
  await expect(page.getByTestId('agent-setup-ssh')).toHaveText(
    "Agent setup isn't available for SSH workspaces yet"
  )
  await expect(page.getByRole('tablist', { name: 'Agent setup sections' })).toHaveCount(0)
  await expect(page.getByTestId('agent-setup-search')).toHaveCount(0)
})

test('AC18: at 320 px the sections are a strip above the content, with no page scroll', async () => {
  await launch()
  await createWorkspace('Proj')
  await setupButton().click()
  const sections = page.getByTestId('agent-setup-sections')
  await expect(sections).toHaveAttribute('aria-orientation', 'vertical')

  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(320, 700))
  await expect(sections).toHaveAttribute('aria-orientation', 'horizontal')
  // Beside the expanded sidebar (whose own width the board overflows too), the page still fits.
  await expect
    .poll(() => agentSetup().evaluate((el) => el.scrollWidth <= el.clientWidth))
    .toBe(true)
  // With it collapsed, nothing scrolls sideways.
  await page.getByTestId('sidebar-toggle').click()
  await expect(sections).toHaveAttribute('aria-orientation', 'horizontal')
  // Above the content (polled: the sidebar collapses with a transition).
  await expect
    .poll(async () => {
      const strip = (await sections.boundingBox())!
      const panel = (await page.getByTestId('agent-setup-panel').boundingBox())!
      return strip.y + strip.height <= panel.y + 1 && Math.abs(strip.x - panel.x) < 40
    })
    .toBe(true)
  // The strip scrolls inside itself; the page never does.
  await expect.poll(() => sections.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth)
  )
  // Right moves along the strip.
  await page.getByRole('tab', { name: 'Overview' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Status' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Status' })).toBeFocused()
})

test('AC19: the arrow keys move through the sections; Tab reaches search and Refresh', async () => {
  await launch()
  await createWorkspace('Proj')
  await setupButton().click()
  const overview = page.getByRole('tab', { name: 'Overview' })
  await overview.focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
  const plugins = page.getByRole('tab', { name: 'Plugins' })
  await expect(plugins).toHaveAttribute('aria-selected', 'true')
  await expect(plugins).toBeFocused()
  await expect(page.getByTestId('agent-setup-panel')).toHaveAttribute('data-section', 'plugins')
  await expect(page.getByTestId('agent-setup-panel').getByRole('heading')).toHaveText('Plugins')
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('tab', { name: 'Stats' })).toBeFocused()

  // Tab order: the search box, Refresh, then the selected section.
  await page.getByTestId('agent-setup-search').focus()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('agent-setup-refresh')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tab', { name: 'Stats' })).toBeFocused()

  // The section and the search are kept for the workspace after Back (D7, D25); Esc clears it.
  await page.getByTestId('agent-setup-search').fill('lint')
  await page.keyboard.press(SHORTCUTS.back)
  await expect(board()).toBeVisible()
  await setupButton().click()
  await expect(page.getByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('agent-setup-search')).toHaveValue('lint')
  await page.getByTestId('agent-setup-search').press('Escape')
  await expect(page.getByTestId('agent-setup-search')).toHaveValue('')
})
