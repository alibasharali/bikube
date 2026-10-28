import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pickAppTheme } from './app-theme'
import { SHORTCUTS, backToBoard, boardCard, expectCardOpen } from './card-view'
import { installedOutsideHome, openedPaths, recordOpenPath } from './editors'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The Agent setup page (#68 S1): opened from the board's title bar or the palette, a workspace's
// view as an open card is (its sidebar row, Back, remembered per workspace for the run), its
// section list, search box and Refresh, the SSH message, the narrow layout and the keyboard; and
// (#68 S2) what it reads from a fake home (`BIKUBE_HOME_DIR`) and the workspace folder: Overview,
// Skills, Agents, Commands and Memory with their sources, counts, warnings, search and refresh;
// (#68 S3) Hooks with Bikube's own, Permissions, and Status with `claude --version` read through
// the login shell (a fake `claude` on a fake login PATH); (#68 S4) Plugins and MCP servers with
// their switches, written to the workspace's `.claude/settings.local.json` and read from the test;
// (#68 S5) Config with its switch, number field and Reset, written there too; (#68 S7) Stats from
// transcripts in the fake home, a worktree card's folder among them, and the page in each theme;
// (#71 S1) the source filter's chip row, page-wide, with the search and per workspace.

const darwin = process.platform === 'darwin'
/** The command palette's default shortcut (#40 D1) as a Playwright press. */
const PALETTE = darwin ? 'Meta+K' : 'Control+Shift+P'
/** Mod+1 (#31 D18): the first workspace in sidebar order, keeping its view. */
const FIRST_WORKSPACE = darwin ? 'Meta+1' : 'Control+1'

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string
/** The fake home every launch reads as `~` (`BIKUBE_HOME_DIR`). */
let home: string

test.beforeEach(() => {
  dataDir = newDataDir()
  root = mkdtempSync(join(tmpdir(), 'bikube-agent-setup-'))
  home = join(root, 'home')
  mkdirSync(home)
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

/** Launches with the fake home, and `extra` over the inherited variables. */
async function launch(extra: Record<string, string> = {}): Promise<void> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  env['BIKUBE_HOME_DIR'] = home
  Object.assign(env, extra)
  ;({ app, page } = await launchApp({ dataDir, env }))
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
const setupButton = (): Locator => page.getByTestId('toolbar-agent-setup')
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

test("AC1: the workspace toolbar's button opens the page; Back and its shortcut go back to the board", async () => {
  await launch()
  const folder = await createWorkspace('Proj')
  await expect(board()).toBeVisible()
  await expect(setupButton()).toHaveText('Agent setup')
  await expect(page.getByTestId('workspace-toolbar')).toBeVisible()
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

  // Back in the title bar: the board, the page still open in the sidebar as a card would be.
  await expect(page.getByTestId('titlebar-workspace')).toHaveAttribute('title', 'Back to Proj')
  await page.getByTestId('titlebar-workspace').click()
  await expect(board()).toBeVisible()
  await expect(agentSetup()).toHaveCount(0)
  await expect(setupRow('Proj')).toHaveText('Agent setup')
  await expect(setupRow('Proj')).not.toHaveAttribute('aria-current', 'true')

  // Its row shows it again; the Back shortcut goes back too.
  await setupRow('Proj').click()
  await expect(agentSetup()).toBeVisible()
  await expect(setupRow('Proj')).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press(SHORTCUTS.back)
  await expect(board()).toBeVisible()
  await expect(setupRow('Proj')).toBeVisible()

  // Its close button closes it: the board, and no row.
  await setupRow('Proj').click()
  await expect(page.getByTestId('agent-setup-close')).toHaveAccessibleName('Close Agent setup')
  await page.getByTestId('agent-setup-close').click()
  await expect(board()).toBeVisible()
  await expect(agentSetup()).toHaveCount(0)
  await expect(setupRow('Proj')).toHaveCount(0)

  // Close pane (Cmd+W) and Close card close it as they close a card.
  for (const shortcut of [SHORTCUTS.closePane, SHORTCUTS.closeCard]) {
    await setupButton().click()
    await expect(agentSetup()).toBeVisible()
    await page.keyboard.press(shortcut)
    await expect(board()).toBeVisible()
    await expect(setupRow('Proj')).toHaveCount(0)
  }
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

  // Proj's own row shows its board; the page stays open in the sidebar.
  await workspaceItem('Proj').click()
  await expect(board()).toBeVisible()
  await expect(setupRow('Proj')).toBeVisible()
  await expect(setupRow('Proj')).not.toHaveAttribute('aria-current', 'true')
  await expect(boardCard(page, 'c1').getByTestId('card-status-label')).toHaveText('Running')

  // Opening a card shows it in the page's place; the page's row stays, and shows it again.
  await setupRow('Proj').click()
  await expect(agentSetup()).toBeVisible()
  await page.getByTestId('workspace-terminal').click()
  await expectCardOpen(page, 'c1')
  await expect(setupRow('Proj')).toBeVisible()
  await expect(setupRow('Proj')).not.toHaveAttribute('aria-current', 'true')
  await setupRow('Proj').click()
  await expect(agentSetup()).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await page.getByTestId('workspace-terminal').click()
  await expectCardOpen(page, 'c1')
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
  // Polled too: a busy machine can still be laying out the collapsed sidebar.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
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
  // The panel's own heading (its sections have subheadings of their own, #68 S4).
  await expect(page.getByTestId('agent-setup-panel').getByRole('heading', { level: 3 })).toHaveText(
    'Plugins'
  )
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

/** Writes `text` to `path`, making its folders. */
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const frontmatter = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`

/** AC4's fixtures in `folder` and the fake home. */
function ac4Fixtures(folder: string): void {
  write(join(folder, '.claude/skills/review/SKILL.md'), frontmatter('review', 'Reviews the diff'))
  write(join(home, '.claude/skills/notes/SKILL.md'), frontmatter('notes', 'Takes notes'))
  write(join(folder, '.claude/agents/tester.md'), frontmatter('tester', 'Runs the tests'))
  const installPath = join(home, '.claude/plugins/cache/market/kit/1.0.0')
  write(
    join(home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: { 'kit@market': [{ scope: 'user', installPath, version: '1.0.0' }] }
    })
  )
  write(join(installPath, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit' }))
  write(join(installPath, 'skills/lint/SKILL.md'), frontmatter('lint', 'Lints the code'))
  write(join(installPath, 'agents/fixer.md'), frontmatter('fixer', 'Fixes what lint finds'))
  write(
    join(home, '.claude/settings.json'),
    JSON.stringify({ enabledPlugins: { 'kit@market': true } })
  )
}

const tab = (label: string): Locator => page.getByRole('tab', { name: label })
const panel = (): Locator => page.getByTestId('agent-setup-panel')
/** The section list's count of section `id`. */
const count = (id: string): Locator =>
  page.getByTestId(`agent-setup-section-${id}`).getByTestId('agent-setup-section-count')
/** The rows of the section shown, by name. */
const rowNames = (): Locator => panel().getByTestId('agent-setup-row-name')
/** The shown section's row named `name`. */
const row = (name: string): Locator =>
  panel()
    .getByTestId('agent-setup-row')
    .filter({ has: page.getByTestId('agent-setup-row-name').getByText(name, { exact: true }) })

/** Status' row for settings file `label`. */
const statusFile = (label: string): Locator =>
  panel()
    .getByTestId('agent-setup-status-file')
    .filter({
      has: page.getByTestId('agent-setup-status-file-name').getByText(label, { exact: true })
    })

/**
 * Creates workspace `Proj` with `fixtures` written to its folder first, and opens the page;
 * `extra` variables over the inherited ones.
 */
async function openWith(
  fixtures: (folder: string) => void,
  extra: Record<string, string> = {}
): Promise<string> {
  await launch(extra)
  const folder = await createWorkspace('Proj')
  fixtures(folder)
  await setupButton().click()
  await expect(agentSetup()).toBeVisible()
  return folder
}

test('AC4: skills and agents from the project, the user and a plugin, counted by source', async () => {
  await openWith(ac4Fixtures)
  await expect(count('skills')).toHaveText('3')
  await expect(count('agents')).toHaveText('2')
  await expect(
    page.getByTestId('agent-setup-overview-skills').getByTestId('agent-setup-overview-split')
  ).toHaveText('1 Project · 1 User · 1 Plugin')
  await expect(page.getByTestId('agent-setup-no-warnings')).toHaveText('No problems found')

  await page.getByTestId('agent-setup-overview-skills').click()
  await expect(tab('Skills')).toHaveAttribute('aria-selected', 'true')
  await expect(rowNames()).toHaveText(['review', 'notes', 'kit:lint'])
  await expect(row('review').getByTestId('agent-setup-source')).toHaveText('Project')
  await expect(row('notes').getByTestId('agent-setup-source')).toHaveText('User')
  await expect(row('kit:lint').getByTestId('agent-setup-source')).toHaveText('Plugin kit')
  await expect(row('review')).toContainText('Reviews the diff')
  await expect(row('kit:lint')).toHaveAttribute('data-plugin-off', 'false')

  await tab('Agents').click()
  await expect(rowNames()).toHaveText(['tester', 'kit:fixer'])
})

test('AC8: an agent without frontmatter is warned about on its row and in Overview', async () => {
  await openWith((folder) => {
    write(join(folder, '.claude/agents/bare.md'), 'You are a helper.\n')
    write(join(folder, '.claude/settings.json'), '{ "model": ')
  })
  const warnings = page.getByTestId('agent-setup-warning-item')
  await expect(warnings).toHaveCount(2)
  await expect(warnings.filter({ hasText: 'bare' })).toContainText('.claude/agents/bare.md')
  await expect(warnings.filter({ hasText: 'bare' })).toContainText('⚠ No frontmatter')
  await expect(warnings.filter({ hasText: '.claude/settings.json' })).toContainText(
    'Invalid JSON: '
  )
  // Both with Open file and Reveal (#68 D27).
  await expect(warnings.getByRole('button', { name: 'Open file' })).toHaveCount(2)
  await expect(warnings.getByRole('button', { name: 'Reveal' })).toHaveCount(2)
  await expect(
    page.getByTestId('agent-setup-section-agents').getByTestId('agent-setup-section-warning')
  ).toBeVisible()

  // The entry's name shows its section.
  await warnings.filter({ hasText: 'bare' }).getByRole('button', { name: 'bare' }).click()
  await expect(tab('Agents')).toHaveAttribute('aria-selected', 'true')
  await expect(row('bare').getByTestId('agent-setup-row-warning')).toHaveText('⚠ No frontmatter')

  // Status reads the settings file Invalid with the parser's message, and has the warning dot.
  await expect(
    page.getByTestId('agent-setup-section-status').getByTestId('agent-setup-section-warning')
  ).toBeVisible()
  await tab('Status').click()
  const file = statusFile('.claude/settings.json')
  await expect(file.getByTestId('agent-setup-status-file-state')).toHaveText('Invalid')
  await expect(file.getByTestId('agent-setup-row-warning')).toContainText('⚠ Invalid JSON: ')
})

test('AC9: memory files in load order, imports nested, a missing import warned about', async () => {
  await openWith((folder) => {
    write(join(folder, 'CLAUDE.md'), '# Project\n@docs/rules.md\n@missing.md\n')
    write(join(folder, 'docs/rules.md'), 'Be kind.\n')
    write(join(home, '.claude/CLAUDE.md'), '# Me\n')
  })
  await tab('Memory').click()
  const memory = panel().getByTestId('agent-setup-memory')
  const top = memory.locator(':scope > [data-testid="agent-setup-memory-row"]')
  await expect(top).toHaveCount(2)
  await expect(top.nth(0)).toHaveAttribute('data-label', '~/.claude/CLAUDE.md')
  await expect(top.nth(0).getByTestId('agent-setup-source').first()).toHaveText('User')
  await expect(top.nth(1)).toHaveAttribute('data-label', 'CLAUDE.md')
  await expect(top.nth(1).getByTestId('agent-setup-source').first()).toHaveText('Project')
  const imports = top
    .nth(1)
    .locator('.agent-setup-imports > [data-testid="agent-setup-memory-row"]')
  await expect(imports).toHaveCount(2)
  await expect(imports.nth(0)).toHaveAttribute('data-label', 'docs/rules.md')
  await expect(imports.nth(1)).toHaveAttribute('data-label', 'missing.md')
  await expect(imports.nth(1).getByTestId('agent-setup-row-warning')).toHaveText(
    '⚠ Imported file not found'
  )

  // Expanding a row shows its first lines.
  await top.nth(1).getByRole('button', { name: 'CLAUDE.md' }).click()
  await expect(top.nth(1).getByTestId('agent-setup-memory-preview').first()).toContainText(
    '# Project'
  )
})

test('AC15: the search filters every section, dims those without a match, and Esc clears it', async () => {
  await openWith(ac4Fixtures)
  await tab('Skills').click()
  await expect(rowNames()).toHaveCount(3)
  const search = page.getByTestId('agent-setup-search')
  await search.fill('lint')
  await expect(count('skills')).toHaveText('1')
  await expect(rowNames()).toHaveText(['kit:lint'])
  // The plugin's agent matches by its description; the commands and memory have no match.
  await expect(count('agents')).toHaveText('1')
  await expect(page.getByTestId('agent-setup-section-commands')).toHaveAttribute(
    'data-dimmed',
    'true'
  )
  await expect(page.getByTestId('agent-setup-section-memory')).toHaveAttribute(
    'data-dimmed',
    'true'
  )
  await expect(page.getByTestId('agent-setup-section-skills')).toHaveAttribute(
    'data-dimmed',
    'false'
  )
  // Dimmed by a muted text colour, not opacity, so its text keeps its contrast: a section without
  // a match reads in another colour than an unselected one with a match.
  const style = (id: string): Promise<{ color: string; opacity: string }> =>
    page.getByTestId(`agent-setup-section-${id}`).evaluate((el) => {
      const computed = getComputedStyle(el)
      return { color: computed.color, opacity: computed.opacity }
    })
  const dimmedTab = await style('commands')
  const matchingTab = await style('agents')
  expect(dimmedTab.opacity).toBe('1')
  expect(dimmedTab.color).not.toBe(matchingTab.color)
  // Not filtered: Status and Stats.
  await expect(page.getByTestId('agent-setup-section-status')).toHaveAttribute(
    'data-dimmed',
    'false'
  )

  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(count('skills')).toHaveText('3')
  await expect(rowNames()).toHaveText(['review', 'notes', 'kit:lint'])
  await expect(page.getByTestId('agent-setup-section-commands')).toHaveAttribute(
    'data-dimmed',
    'false'
  )
})

test('AC16: a new skill shows within 4 seconds, keeping the scroll and the search', async () => {
  const folder = await openWith((at) => {
    // Enough skills to scroll the section.
    for (let i = 0; i < 40; i++) {
      write(
        join(at, `.claude/skills/s${i}/SKILL.md`),
        frontmatter(`skill-${i}`, `Skill number ${i}`)
      )
    }
  })
  await tab('Skills').click()
  await expect(rowNames()).toHaveCount(40)
  const search = page.getByTestId('agent-setup-search')
  await search.fill('skill')
  await panel().evaluate((el) => {
    el.scrollTop = 200
  })
  const scrolled = await panel().evaluate((el) => el.scrollTop)
  expect(scrolled).toBeGreaterThan(0)

  write(join(folder, '.claude/skills/zz-new/SKILL.md'), frontmatter('skill-new', 'Just added'))
  await expect(row('skill-new')).toBeVisible({ timeout: 4000 })
  await expect(count('skills')).toHaveText('41')
  await expect(search).toHaveValue('skill')
  expect(await panel().evaluate((el) => el.scrollTop)).toBe(scrolled)
})

test("AC7: Hooks lists Bikube's hooks and a project hook whose file is missing, warned about", async () => {
  await openWith((folder) => {
    write(
      join(folder, '.claude/settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/hooks/check.sh' }]
            }
          ]
        }
      })
    )
  })
  // Bikube's five hooks and the project's.
  await expect(count('hooks')).toHaveText('6')
  await expect(
    page.getByTestId('agent-setup-section-hooks').getByTestId('agent-setup-section-warning')
  ).toBeVisible()
  const warning = page
    .getByTestId('agent-setup-warning-item')
    .filter({ hasText: '$CLAUDE_PROJECT_DIR/hooks/check.sh' })
  await expect(warning).toContainText('⚠ Command not found')
  await expect(
    page.getByTestId('agent-setup-overview-hooks').getByTestId('agent-setup-overview-split')
  ).toHaveText('1 Project · 5 Bikube')

  await tab('Hooks').click()
  const groups = panel().getByTestId('agent-setup-hook-group')
  await expect(groups.getByTestId('agent-setup-group-name')).toHaveText([
    'PreToolUse',
    'Notification',
    'UserPromptSubmit',
    'Stop',
    'SessionStart'
  ])
  const preToolUse = groups.filter({ has: page.getByRole('heading', { name: 'PreToolUse' }) })
  const hookRows = preToolUse.getByTestId('agent-setup-row')
  await expect(hookRows).toHaveCount(2)
  // Bikube's first (D10), with its chip and no Open file.
  await expect(hookRows.nth(0).getByTestId('agent-setup-source')).toHaveText('Bikube')
  await expect(hookRows.nth(0).getByTestId('agent-setup-hook-matcher')).toHaveText('All')
  await expect(hookRows.nth(0).getByTestId('agent-setup-row-warning')).toHaveCount(0)
  await expect(hookRows.nth(0).getByRole('button')).toHaveCount(0)
  await expect(hookRows.nth(1).getByTestId('agent-setup-hook-command')).toHaveText(
    '$CLAUDE_PROJECT_DIR/hooks/check.sh'
  )
  await expect(hookRows.nth(1).getByTestId('agent-setup-hook-matcher')).toHaveText('Bash')
  await expect(hookRows.nth(1).getByTestId('agent-setup-source')).toHaveText('Project')
  await expect(hookRows.nth(1).getByTestId('agent-setup-row-warning')).toHaveText(
    '⚠ Command not found'
  )
  // Every Bikube row carries its chip.
  const bikube = panel()
    .getByTestId('agent-setup-row')
    .filter({ has: page.getByTestId('agent-setup-source').getByText('Bikube', { exact: true }) })
  await expect(bikube).toHaveCount(5)

  // The search covers hooks too.
  await page.getByTestId('agent-setup-search').fill('check.sh')
  await expect(count('hooks')).toHaveText('1')
  await expect(panel().getByTestId('agent-setup-row')).toHaveCount(1)
})

test('AC10: Permissions lists each rule with its source, read-only', async () => {
  await openWith((folder) => {
    write(
      join(folder, '.claude/settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } })
    )
    write(
      join(folder, '.claude/settings.local.json'),
      JSON.stringify({ permissions: { deny: ['Read(./secrets/**)'] } })
    )
  })
  await expect(count('permissions')).toHaveText('2')
  await tab('Permissions').click()
  const list = (name: string): Locator => panel().getByTestId(`agent-setup-permissions-${name}`)
  await expect(list('allow').getByTestId('agent-setup-permission-rule')).toHaveText([
    'Bash(npm test)'
  ])
  await expect(list('allow').getByTestId('agent-setup-source')).toHaveText(['Project'])
  await expect(list('deny').getByTestId('agent-setup-permission-rule')).toHaveText([
    'Read(./secrets/**)'
  ])
  await expect(list('deny').getByTestId('agent-setup-source')).toHaveText(['Local'])
  await expect(list('ask')).toHaveText('None')
  await expect(page.getByTestId('agent-setup-default-mode')).toContainText('Default')
  // No editing controls.
  await expect(panel().locator('input, select, textarea, [role="switch"]')).toHaveCount(0)
})

/**
 * The variables whose login shell (`/bin/sh -l`, through `SHELL`) gets a PATH of a fake `bin` and
 * the system folders only, with a fake `claude` there when `claude`. `HOME` is the fake home the
 * page also reads as `~` (`BIKUBE_HOME_DIR`).
 */
function loginShell(claude: boolean): Record<string, string> {
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(home, '.profile'), `PATH='${bin}':/usr/bin:/bin; export PATH\n`)
  if (claude) {
    writeFileSync(join(bin, 'claude'), "#!/bin/sh\necho '2.1.0 (Claude Code)'\n")
    chmodSync(join(bin, 'claude'), 0o755)
  }
  return { SHELL: '/bin/sh', HOME: home }
}

test("AC13: Status reads Claude Code's version and path, the account and each file's state", async () => {
  const shell = loginShell(true)
  write(
    join(home, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c', organizationName: 'Org' } })
  )
  await openWith((folder) => {
    write(join(folder, '.claude/settings.json'), '{}')
  }, shell)
  await tab('Status').click()
  const status = (id: string): Locator => panel().getByTestId(`agent-setup-status-${id}`)
  await expect(status('claude')).toContainText('2.1.0 (Claude Code)')
  await expect(status('claude')).toContainText(join(root, 'bin', 'claude'))
  await expect(status('account')).toContainText('a@b.c · Org')
  await expect(status('model')).toHaveText(/^Model\s*Default$/)
  await expect(status('output-style')).toContainText('Default')
  await expect(status('bikube')).toContainText('Active in Claude Code cards')
  await expect(status('bikube')).toContainText('Claude Code status: On')
  const state = (label: string): Locator =>
    statusFile(label).getByTestId('agent-setup-status-file-state')
  await expect(state('claude-settings.json')).toHaveText('Found')
  await expect(state('.claude/settings.local.json')).toHaveText('Missing')
  await expect(state('.claude/settings.json')).toHaveText('Found')
  await expect(state('~/.claude/settings.json')).toHaveText('Missing')
  await expect(state('~/.claude.json')).toHaveText('Found')
  await expect(state('.mcp.json')).toHaveText('Missing')
  await expect(statusFile('claude-settings.json').getByTestId('agent-setup-source')).toHaveText(
    'Bikube'
  )

  // With only the fake bin on the login PATH and no claude there (a runner may have one in
  // /usr/bin), Refresh reads it Not installed; the check needs nothing but the shell's builtins.
  rmSync(join(root, 'bin', 'claude'))
  writeFileSync(join(home, '.profile'), `PATH='${join(root, 'bin')}'; export PATH\n`)
  await page.getByTestId('agent-setup-refresh').click()
  await expect(status('claude')).toContainText('Not installed')
})

test('the Toggle panel shortcut does nothing while the page is in front', async () => {
  await launch()
  await createWorkspace('Proj')
  const sidePanel = page.getByTestId('side-panel')
  await expect(sidePanel).toBeVisible()
  await setupButton().click()
  await expect(agentSetup()).toBeVisible()
  await page.keyboard.press(darwin ? 'Alt+Meta+B' : 'Control+Alt+B')
  await page.keyboard.press(SHORTCUTS.back)
  await expect(board()).toBeVisible()
  await expect(sidePanel).toBeVisible()
})

/**
 * The workspace's settings.local.json, as the page wrote it; `null` until it exists, so a poll
 * started before the first write keeps polling instead of throwing.
 */
const localSettings = (folder: string): string => {
  const file = join(folder, '.claude/settings.local.json')
  return existsSync(file) ? readFileSync(file, 'utf8') : 'null'
}

const pluginSwitch = (): Locator =>
  panel()
    .getByTestId('agent-setup-plugin')
    .filter({ has: page.getByTestId('agent-setup-row-name').getByText('kit', { exact: true }) })
    .getByTestId('agent-setup-plugin-switch')

test("AC5: a plugin's switch writes settings.local.json only, and its entries read Plugin off", async () => {
  const userSettings = join(home, '.claude/settings.json')
  const folder = await openWith((at) => {
    ac4Fixtures(at)
    write(join(at, '.claude/settings.local.json'), '{\n  "model": "opus"\n}\n')
  })
  const before = readFileSync(userSettings, 'utf8')
  await expect(count('plugins')).toHaveText('1')
  await tab('Plugins').click()
  const plugin = panel().getByTestId('agent-setup-plugin')
  await expect(plugin).toHaveCount(1)
  await expect(plugin.getByTestId('agent-setup-source')).toHaveText('User')
  await expect(plugin).toContainText('@market')
  await expect(plugin.getByTestId('agent-setup-plugin-provides')).toHaveText('1 skill · 1 agent')
  await expect(pluginSwitch()).toBeChecked()
  await expect(page.getByTestId('agent-setup-saved-note')).toHaveCount(0)

  await pluginSwitch().click()
  await expect(pluginSwitch()).not.toBeChecked()
  await expect
    .poll(() => localSettings(folder))
    .toBe('{\n  "model": "opus",\n  "enabledPlugins": {\n    "kit@market": false\n  }\n}\n')
  expect(readFileSync(userSettings, 'utf8')).toBe(before)
  await expect(page.getByTestId('agent-setup-saved-note')).toHaveText(
    'Changes apply to Claude Code sessions started from now on'
  )

  // The provides-count shows Skills with the filter at the plugin (#71 D8); its entries read
  // Plugin off.
  await plugin.getByRole('button', { name: '1 skill' }).click()
  await expect(tab('Skills')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('agent-setup-filter-plugin')).toHaveText('Plugin kit 1')
  await expect(page.getByTestId('agent-setup-search')).toHaveValue('')
  await expect(rowNames()).toHaveText(['kit:lint'])
  await expect(row('kit:lint')).toHaveAttribute('data-plugin-off', 'true')
  await expect(row('kit:lint').getByTestId('agent-setup-plugin-off')).toHaveText('Plugin off')
  await tab('Agents').click()
  await expect(row('kit:fixer')).toHaveAttribute('data-plugin-off', 'true')

  await tab('Plugins').click()
  await pluginSwitch().click()
  await expect(pluginSwitch()).toBeChecked()
  await expect
    .poll(() => JSON.parse(localSettings(folder)) as unknown)
    .toEqual({ model: 'opus', enabledPlugins: { 'kit@market': true } })
  await tab('Skills').click()
  await expect(row('kit:lint')).toHaveAttribute('data-plugin-off', 'false')
  expect(readFileSync(userSettings, 'utf8')).toBe(before)
})

test('AC6: MCP servers with their type, command, variable names and switches', async () => {
  const folder = await openWith((at) => {
    write(
      join(at, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          db: { command: 'db-server', args: ['--port', '5432'], env: { TOKEN: 's3cret' } },
          api: { type: 'http', url: 'https://api.example/mcp' }
        }
      })
    )
    write(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://docs.example/mcp' } } })
    )
  })
  await expect(count('mcp')).toHaveText('3')
  await tab('MCP servers').click()
  const server = (name: string): Locator =>
    panel().locator(`[data-testid="agent-setup-mcp-server"][data-name="${name}"]`)
  await expect(server('db').getByTestId('agent-setup-mcp-type')).toHaveText('stdio')
  await expect(server('db').getByTestId('agent-setup-mcp-target')).toHaveText(
    'db-server --port 5432'
  )
  await expect(server('db')).toContainText('TOKEN')
  await expect(panel()).not.toContainText('s3cret')
  for (const name of ['db', 'api']) {
    await expect(server(name).getByTestId('agent-setup-mcp-state')).toHaveText('Not approved yet')
    await expect(server(name).getByTestId('agent-setup-mcp-switch')).not.toBeChecked()
  }
  await expect(server('api').getByTestId('agent-setup-mcp-type')).toHaveText('http')
  await expect(server('docs').getByTestId('agent-setup-source')).toHaveText('User')
  await expect(server('docs').getByTestId('agent-setup-mcp-state')).toHaveText('Enabled')
  await expect(server('docs').getByTestId('agent-setup-mcp-switch')).toHaveCount(0)

  await server('db').getByTestId('agent-setup-mcp-switch').click()
  await expect
    .poll(() => JSON.parse(localSettings(folder)) as unknown)
    .toEqual({ enabledMcpjsonServers: ['db'] })
  await expect(server('db').getByTestId('agent-setup-mcp-switch')).toBeChecked()
  await expect(server('db').getByTestId('agent-setup-mcp-state')).toHaveText('Enabled')

  await server('db').getByTestId('agent-setup-mcp-switch').click()
  await expect
    .poll(() => JSON.parse(localSettings(folder)) as unknown)
    .toEqual({ enabledMcpjsonServers: [], disabledMcpjsonServers: ['db'] })
  await expect(server('db').getByTestId('agent-setup-mcp-switch')).not.toBeChecked()
  await expect(server('db').getByTestId('agent-setup-mcp-state')).toHaveText('Disabled')
})

test('AC12: an invalid settings.local.json is left as it is and the switch goes back', async () => {
  const invalid = '{ "model": '
  const folder = await openWith((at) => {
    ac4Fixtures(at)
    write(join(at, '.claude/settings.local.json'), invalid)
  })
  await tab('Plugins').click()
  await expect(pluginSwitch()).toBeChecked()
  await pluginSwitch().click()
  await expect(page.getByTestId('agent-setup-save-error')).toHaveText(
    "Couldn't save: settings.local.json is not valid JSON"
  )
  await expect(pluginSwitch()).toBeChecked()
  expect(localSettings(folder)).toBe(invalid)
  await expect(page.getByTestId('agent-setup-saved-note')).toHaveCount(0)
})

/** Config's row for settings key `key`. */
const configRow = (key: string): Locator =>
  panel().locator(`[data-testid="agent-setup-config-row"][data-key="${key}"]`)

test('AC11: Config edits booleans and numbers in settings.local.json, and Reset removes them', async () => {
  const userSettings = join(home, '.claude/settings.json')
  const folder = await openWith(() => {
    write(
      userSettings,
      JSON.stringify({ includeCoAuthoredBy: true, cleanupPeriodDays: 30, model: 'opus' })
    )
    write(
      join(home, '.claude.json'),
      JSON.stringify({ autoUpdates: false, numStartups: 4, userID: 'x', tipsShownAt: 2 })
    )
  })
  const before = readFileSync(userSettings, 'utf8')
  await expect(count('config')).toHaveText('4')
  await tab('Config').click()
  const coAuthored = configRow('includeCoAuthoredBy')
  const days = configRow('cleanupPeriodDays')
  const model = configRow('model')
  const toggle = coAuthored.getByTestId('agent-setup-config-switch')
  const field = days.getByTestId('agent-setup-config-number')
  await expect(toggle).toBeChecked()
  await expect(field).toHaveValue('30')
  await expect(model.getByTestId('agent-setup-config-value')).toHaveText('opus')
  await expect(model.getByTestId('agent-setup-config-switch')).toHaveCount(0)
  await expect(model.getByTestId('agent-setup-config-number')).toHaveCount(0)
  for (const row of [coAuthored, days, model]) {
    await expect(row.getByTestId('agent-setup-source')).toHaveText('User')
    await expect(row.getByTestId('agent-setup-config-reset')).toHaveCount(0)
  }
  // Preferences from ~/.claude.json: read-only, runtime counters left out.
  const preferences = panel().getByTestId('agent-setup-preference')
  await expect(preferences).toHaveCount(1)
  await expect(preferences).toContainText('autoUpdates')
  await expect(preferences).toContainText('false')
  await expect(preferences.locator('input')).toHaveCount(0)

  // The switch writes settings.local.json; the row reads Local, the User value struck through.
  await toggle.click()
  await expect
    .poll(() =>
      existsSync(join(folder, '.claude/settings.local.json')) ? localSettings(folder) : ''
    )
    .toBe('{\n  "includeCoAuthoredBy": false\n}\n')
  await expect(toggle).not.toBeChecked()
  await expect(coAuthored.getByTestId('agent-setup-source')).toHaveText('Local')
  const overridden = coAuthored.getByTestId('agent-setup-config-overridden')
  await expect(overridden).toHaveText('User: true')
  await expect(overridden).toHaveCSS('text-decoration-line', 'line-through')
  await expect(page.getByTestId('agent-setup-saved-note')).toHaveText(
    'Changes apply to Claude Code sessions started from now on'
  )
  expect(readFileSync(userSettings, 'utf8')).toBe(before)

  // Anything but a finite number is refused and nothing is written.
  await field.fill('abc')
  await field.press('Enter')
  await expect(days.getByTestId('agent-setup-config-error')).toHaveText('Enter a number')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await field.blur()
  await expect(days.getByTestId('agent-setup-config-error')).toHaveText('Enter a number')
  expect(localSettings(folder)).toBe('{\n  "includeCoAuthoredBy": false\n}\n')
  // A number is saved on Enter.
  await field.fill('7')
  await field.press('Enter')
  await expect(days.getByTestId('agent-setup-config-error')).toHaveCount(0)
  await expect
    .poll(() => JSON.parse(localSettings(folder)) as unknown)
    .toEqual({ includeCoAuthoredBy: false, cleanupPeriodDays: 7 })
  await expect(days.getByTestId('agent-setup-source')).toHaveText('Local')
  await expect(field).toHaveValue('7')

  // Reset removes the key; the row reads User again.
  await coAuthored.getByTestId('agent-setup-config-reset').click()
  await expect
    .poll(() => JSON.parse(localSettings(folder)) as unknown)
    .toEqual({ cleanupPeriodDays: 7 })
  await expect(coAuthored.getByTestId('agent-setup-source')).toHaveText('User')
  await expect(toggle).toBeChecked()
  await expect(coAuthored.getByTestId('agent-setup-config-overridden')).toHaveCount(0)
  await expect(coAuthored.getByTestId('agent-setup-config-reset')).toHaveCount(0)
  expect(readFileSync(userSettings, 'utf8')).toBe(before)

  // A string settings.local.json sets is read-only: no Reset (D22, D28).
  write(
    join(folder, '.claude/settings.local.json'),
    JSON.stringify({ cleanupPeriodDays: 7, model: 'sonnet' })
  )
  await expect(model.getByTestId('agent-setup-source')).toHaveText('Local')
  await expect(model.getByTestId('agent-setup-config-value')).toHaveText('sonnet')
  await expect(model.getByTestId('agent-setup-config-reset')).toHaveCount(0)
  await expect(days.getByTestId('agent-setup-config-reset')).toHaveCount(1)
})

// Open file and Reveal (#68 S6).

const editorLog = (): string => join(root, 'editors.log')
const editorRuns = (): string[] =>
  existsSync(editorLog()) ? readFileSync(editorLog(), 'utf8').trimEnd().split('\n') : []

/** A fake `code` in the fake login PATH's `bin` (`loginShell`), logging `run code` and its arguments. */
function fakeCode(): void {
  const code = join(root, 'bin', 'code')
  writeFileSync(code, `#!/bin/sh\n{ echo "run code"; printf '%s\\n' "$@"; } >> '${editorLog()}'\n`)
  chmodSync(code, 0o755)
}

/** Replaces `shell.showItemInFolder` in main with a recorder, so no file manager opens. */
async function recordRevealed(): Promise<void> {
  await app!.evaluate(({ shell }) => {
    const revealed: string[] = []
    ;(globalThis as { revealedPaths?: string[] }).revealedPaths = revealed
    shell.showItemInFolder = (path: string) => {
      revealed.push(path)
    }
  })
}

const revealedPaths = (): Promise<string[]> =>
  app!.evaluate(() => [...((globalThis as { revealedPaths?: string[] }).revealedPaths ?? [])])

test("#70 AC1: a skill's Open file runs VS Code's bundle CLI when no code is on the login PATH", async () => {
  // A real VS Code at a system path would come first; CI has none.
  test.skip(installedOutsideHome('vscode'), 'a real VS Code is installed here')
  const shell = loginShell(false)
  const cli = darwin
    ? join(home, 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')
    : join(home, '.local/share/flatpak/exports/bin/com.visualstudio.code')
  mkdirSync(dirname(cli), { recursive: true })
  writeFileSync(cli, `#!/bin/sh\n{ echo "run bundle"; printf '%s\\n' "$@"; } >> '${editorLog()}'\n`)
  chmodSync(cli, 0o755)
  const folder = await openWith(ac4Fixtures, shell)
  const skill = join(folder, '.claude', 'skills', 'review', 'SKILL.md')
  await tab('Skills').click()
  await row('review').hover()
  await row('review').getByRole('button', { name: 'Open file' }).click()
  await expect.poll(editorRuns).toEqual(['run bundle', folder, skill])
  await page.waitForTimeout(500)
  await expect(panel().getByTestId('agent-setup-open-error')).toHaveCount(0)
})

test("#70 AC4: a skill's Open file with VS Code found nowhere opens it with the default app, with a note", async () => {
  test.skip(installedOutsideHome('vscode'), 'a real VS Code is installed here')
  const folder = await openWith(ac4Fixtures, loginShell(false))
  await recordOpenPath(app!)
  const skill = join(folder, '.claude', 'skills', 'review', 'SKILL.md')
  await tab('Skills').click()
  await row('review').hover()
  await row('review').getByRole('button', { name: 'Open file' }).click()
  const note = panel().getByTestId('agent-setup-open-error')
  await expect(note).toHaveText('Opened SKILL.md with the default app: code not found')
  await expect(note).toHaveAttribute('role', 'status')
  expect(await openedPaths(app!)).toEqual([skill])
  expect(editorRuns()).toEqual([])
})

test("AC17: a skill's Open file runs code with the workspace and SKILL.md, Reveal shows it; unlisted paths open nothing", async () => {
  const shell = loginShell(false)
  fakeCode()
  const folder = await openWith(ac4Fixtures, shell)
  await recordRevealed()
  const skillFolder = join(folder, '.claude', 'skills', 'review')
  const skill = join(skillFolder, 'SKILL.md')
  await tab('Skills').click()
  const review = row('review')
  await review.hover()
  const open = review.getByRole('button', { name: 'Open file' })
  const reveal = review.getByRole('button', { name: 'Reveal' })
  await expect(open).toBeVisible()
  // A project skill opens with the workspace, as the Files tab opens its files.
  await open.click()
  await expect.poll(editorRuns).toEqual(['run code', folder, skill])
  await expect(panel().getByTestId('agent-setup-open-error')).toHaveCount(0)
  await reveal.click()
  await expect.poll(revealedPaths).toEqual([skill])
  // A user skill, outside the workspace, opens with its own folder.
  const notesFolder = join(home, '.claude', 'skills', 'notes')
  await row('notes').hover()
  await row('notes').getByRole('button', { name: 'Open file' }).click()
  await expect
    .poll(editorRuns)
    .toEqual(['run code', folder, skill, 'run code', notesFolder, join(notesFolder, 'SKILL.md')])

  // AC19: hidden until hovered or focused, the buttons are in the Tab order: from the control
  // before them, Tab shows and focuses Open file, then Reveal, then the next row's Open file.
  const opacity = (button: Locator): Promise<string> =>
    button.evaluate((el) => getComputedStyle(el.parentElement!).opacity)
  await open.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(open).not.toBeFocused()
  await page.mouse.move(0, 0)
  await expect.poll(() => opacity(open)).toBe('0')
  await page.keyboard.press('Tab')
  await expect(open).toBeFocused()
  await expect.poll(() => opacity(open)).toBe('1')
  await page.keyboard.press('Tab')
  await expect(reveal).toBeFocused()
  await expect.poll(() => opacity(reveal)).toBe('1')
  await page.keyboard.press('Tab')
  await expect(row('notes').getByRole('button', { name: 'Open file' })).toBeFocused()
  await expect.poll(() => opacity(open)).toBe('0')

  // Paths the read didn't list, asked for from the page: nothing runs, nothing is shown.
  const notes = join(folder, 'notes.md')
  write(notes, 'x')
  const asked = await page.evaluate(
    async ([dir, paths]) => {
      const api = (
        window as unknown as {
          bikube: {
            agentSetup: {
              openFile: (folder: string, path: string) => Promise<unknown>
              reveal: (folder: string, path: string) => Promise<boolean>
            }
          }
        }
      ).bikube.agentSetup
      const results: unknown[] = []
      for (const path of paths) {
        results.push(await api.openFile(dir, path), await api.reveal(dir, path))
      }
      return results
    },
    [folder, [notes, `${skillFolder}/../review/SKILL.md`, join(home, '.profile')]] as const
  )
  expect(asked).toEqual([
    { ok: false, reason: 'refused' },
    false,
    { ok: false, reason: 'refused' },
    false,
    { ok: false, reason: 'refused' },
    false
  ])
  await page.waitForTimeout(500)
  expect(editorRuns()).toEqual([
    'run code',
    folder,
    skill,
    'run code',
    notesFolder,
    join(notesFolder, 'SKILL.md')
  ])
  expect(await revealedPaths()).toEqual([skill])

  // Bikube's own hooks and settings file have neither button, nor does a missing file (D27).
  await tab('Hooks').click()
  await expect(panel().getByTestId('agent-setup-hook-group').first()).toBeVisible()
  await expect(panel().getByTestId('agent-setup-file-actions')).toHaveCount(0)
  await tab('Status').click()
  const actions = (label: string): Locator =>
    statusFile(label).getByTestId('agent-setup-file-actions')
  await expect(actions('~/.claude/settings.json')).toHaveCount(1)
  await expect(actions('claude-settings.json')).toHaveCount(0)
  await expect(actions('.claude/settings.local.json')).toHaveCount(0)
})

// #68 S7: Stats from transcripts written into the fake home's `.claude/projects`.

/** A Claude Code project folder's name (D14): every character outside A-Z a-z 0-9 a dash. */
const encoded = (folder: string): string => folder.replace(/[^A-Za-z0-9]/g, '-')

/** The local date (`YYYY-MM-DD`) of `date`, as main reads it. */
const localDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** An assistant entry at `at` with `tokens` input tokens, model `claude-x` and `tools` used. */
const assistantLine = (
  at: Date,
  id: string,
  tokens: number,
  tools: { name: string; input?: Record<string, unknown> }[] = []
): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: at.toISOString(),
    requestId: `req-${id}`,
    message: {
      id: `msg-${id}`,
      model: 'claude-x',
      content: tools.map((tool, i) => ({
        type: 'tool_use',
        id: `tool-${id}-${i}`,
        name: tool.name,
        input: tool.input ?? {}
      })),
      usage: { input_tokens: tokens, output_tokens: 0 }
    }
  })

/** Writes session `name`'s transcript for `folder` in the fake home. */
function writeTranscript(folder: string, name: string, lines: string[]): void {
  const dir = join(home, '.claude', 'projects', encoded(folder))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.jsonl`), lines.map((l) => l + '\n').join(''))
}

const statsView = (): Locator => page.getByTestId('agent-setup-stats')

test('AC14: Stats count the workspace and its worktree card, by day, model and use, with no cost', async () => {
  await launch()
  // A repository, so a card can get its own worktree.
  const folder = mkdtempSync(join(root, 'Proj-'))
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: folder })
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(folder, 'README.md'), '# proj\n')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(folder)
  await page.getByTestId('workspace-name').fill('Proj')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('Fix')
  await page.getByTestId('new-card-worktree').check()
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'Fix')
  await backToBoard(page)
  const worktrees = join(dataDir, 'worktrees')
  const [repoFolder] = readdirSync(worktrees)
  const worktree = join(worktrees, repoFolder!, 'fix')
  expect(existsSync(worktree)).toBe(true)

  // With no transcripts yet.
  await setupButton().click()
  await page.getByRole('tab', { name: 'Stats' }).click()
  await expect(statsView()).toContainText('No Claude Code sessions in the last 30 days')

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 1)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12)
  writeTranscript(folder, 'one', [
    JSON.stringify({ type: 'user', timestamp: yesterday.toISOString(), message: {} }),
    assistantLine(yesterday, 'a', 4000, [{ name: 'Skill', input: { skill: 'review' } }])
  ])
  writeTranscript(folder, 'two', [
    assistantLine(today, 'b', 1000, [{ name: 'Bash' }, { name: 'Bash' }])
  ])
  writeTranscript(worktree, 'three', [assistantLine(today, 'c', 500)])
  // Stats aren't read on the periodic refresh (D26), only on Refresh.
  await page.waitForTimeout(3500)
  await expect(statsView()).toContainText('No Claude Code sessions in the last 30 days')
  await page.getByTestId('agent-setup-refresh').click()

  await expect(page.getByTestId('agent-setup-stats-sessions')).toHaveText('3 sessions')
  await expect(page.getByTestId('agent-setup-stats-tokens')).toHaveText('5,500 tokens')
  await expect(page.getByTestId('agent-setup-stats-folders')).toHaveText('2 folders')
  await expect(page.getByTestId('agent-setup-stats-folders')).toHaveAttribute(
    'title',
    `${folder}\n${worktree}`
  )
  const dayRow = (date: Date): Locator =>
    page.locator(`[data-testid=agent-setup-stats-day][data-date="${localDate(date)}"]`)
  await expect(page.getByTestId('agent-setup-stats-day')).toHaveCount(30)
  await expect(dayRow(yesterday).locator('td').nth(0)).toHaveText('4,000')
  await expect(dayRow(yesterday).locator('td').nth(1)).toHaveText('1')
  await expect(dayRow(today).locator('td').nth(0)).toHaveText('1,500')
  await expect(dayRow(today).locator('td').nth(1)).toHaveText('2')

  const model = page.getByTestId('agent-setup-stats-model')
  await expect(model).toHaveCount(1)
  await expect(model.getByTestId('agent-setup-stats-name')).toHaveText('claude-x')
  await expect(model.getByTestId('agent-setup-stats-value')).toHaveText('5,500')
  const used = (list: string, name: string): Locator =>
    page
      .getByTestId(`agent-setup-stats-${list}`)
      .getByTestId('agent-setup-stats-used')
      .filter({ has: page.getByTestId('agent-setup-stats-name').getByText(name, { exact: true }) })
      .getByTestId('agent-setup-stats-value')
  await expect(used('tools', 'Bash')).toHaveText('2')
  await expect(used('tools', 'Skill')).toHaveText('1')
  await expect(used('skills', 'review')).toHaveText('1')
  await expect(page.getByTestId('agent-setup-stats-subagents')).toContainText('None')

  // The chart's hover tooltip gives the day's numbers.
  const bars = page.getByTestId('agent-setup-stats-bar')
  await expect(bars).toHaveCount(30)
  await bars.last().hover()
  await expect(page.getByTestId('agent-setup-stats-tooltip')).toContainText('1,500 tokens')
  await expect(page.getByTestId('agent-setup-stats-tooltip')).toContainText('2 sessions')

  // No cost anywhere.
  const text = await page.getByTestId('agent-setup-panel').innerText()
  expect(text).not.toContain('$')
  expect(text.toLowerCase()).not.toContain('cost')
  // Stats are not filtered by the search (D25).
  await page.getByTestId('agent-setup-search').fill('zzz-nothing')
  await expect(page.getByTestId('agent-setup-stats-tokens')).toHaveText('5,500 tokens')
})

/** The page's background and `--bg` resolved in the page, with a Stats bar's and `--accent`. */
const themeColours = (): Promise<{ page: string; bg: string; bar: string; accent: string }> =>
  page.evaluate(() => {
    const resolve = (token: string): string => {
      const probe = document.createElement('div')
      probe.style.background = `var(${token})`
      document.body.append(probe)
      const colour = getComputedStyle(probe).backgroundColor
      probe.remove()
      return colour
    }
    const bar = document.querySelector('.agent-setup-chart-tokens > span')
    return {
      page: getComputedStyle(document.querySelector('[data-testid=agent-setup]')!).backgroundColor,
      bg: resolve('--bg'),
      bar: bar ? getComputedStyle(bar).backgroundColor : '',
      accent: resolve('--accent')
    }
  })

test("AC18: in Dark, Light and Nord the page and its Stats use the theme's colours", async () => {
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
  await launch()
  // Follow the app's Theme setting, not Playwright's pinned light scheme.
  await page.emulateMedia({ colorScheme: null })
  const folder = await createWorkspace('Proj')
  writeTranscript(folder, 'one', [assistantLine(new Date(), 'a', 1200, [{ name: 'Read' }])])
  await setupButton().click()
  await page.getByRole('tab', { name: 'Stats' }).click()
  await expect(page.getByTestId('agent-setup-stats-tokens')).toHaveText('1,200 tokens')

  // Default's dark version.
  await expect.poll(themeColours).toMatchObject({ page: 'rgb(20, 21, 26)', bg: 'rgb(20, 21, 26)' })
  let colours = await themeColours()
  expect(colours.bar).toBe(colours.accent)

  const settings = page.getByTestId('settings-dialog')
  await page.keyboard.press(darwin ? 'Meta+Comma' : 'Control+Comma')
  await settings.getByRole('radio', { name: 'Light' }).check()
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await expect
    .poll(themeColours)
    .toMatchObject({ page: 'rgb(246, 247, 249)', bg: 'rgb(246, 247, 249)' })
  colours = await themeColours()
  expect(colours.bar).toBe(colours.accent)

  // Nord's light version (nord6).
  await pickAppTheme(page, 'Nord')
  await expect
    .poll(themeColours)
    .toMatchObject({ page: 'rgb(236, 239, 244)', bg: 'rgb(236, 239, 244)' })
  colours = await themeColours()
  expect(colours.bar).toBe(colours.accent)
  await expect(agentSetup()).toBeVisible()

  // At 320 px the chart and lists fit: no sideways scroll in the page or the panel.
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(320, 700))
  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('agent-setup-sections')).toHaveAttribute(
    'aria-orientation',
    'horizontal'
  )
  const panel = page.getByTestId('agent-setup-panel')
  // With the tooltip shown at either end of the chart too.
  for (const bar of [
    page.getByTestId('agent-setup-stats-bar').last(),
    page.getByTestId('agent-setup-stats-bar').first()
  ]) {
    await bar.hover()
    await expect(page.getByTestId('agent-setup-stats-tooltip')).toBeVisible()
    await expect.poll(() => panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth)
    )
  }
})

// The source filter (#71 S1): a chip row at the top of each filterable section, page-wide.

/**
 * #71's fixtures in `folder` and the fake home: 2 Project, 3 User and 1 kit skill (kit a User
 * install, `tools` a Project one with nothing), only User agents, a Project command, only
 * `~/.claude/CLAUDE.md`, User hooks under PreToolUse and SessionStart beside Bikube's, Config keys
 * from Local and User, a Preference and a marketplace.
 */
function filterFixtures(folder: string): void {
  write(join(folder, '.claude/skills/review/SKILL.md'), frontmatter('review', 'Reviews the diff'))
  write(join(folder, '.claude/skills/publish/SKILL.md'), frontmatter('publish', 'Publishes docs'))
  write(join(home, '.claude/skills/notes/SKILL.md'), frontmatter('notes', 'Takes notes'))
  write(join(home, '.claude/skills/blog/SKILL.md'), frontmatter('blog', 'Writes posts'))
  write(join(home, '.claude/skills/draft/SKILL.md'), frontmatter('draft', 'Drafts text'))
  write(join(home, '.claude/agents/helper.md'), frontmatter('helper', 'Helps out'))
  write(join(folder, '.claude/commands/deploy.md'), frontmatter('deploy', 'Ships it'))
  write(join(home, '.claude/CLAUDE.md'), '# Me\n')
  const kitPath = join(home, '.claude/plugins/cache/market/kit/1.0.0')
  const toolsPath = join(home, '.claude/plugins/cache/market/tools/1.0.0')
  write(
    join(home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'kit@market': [{ scope: 'user', installPath: kitPath, version: '1.0.0' }],
        'tools@market': [
          { scope: 'project', projectPath: folder, installPath: toolsPath, version: '1.0.0' }
        ]
      }
    })
  )
  write(join(kitPath, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit' }))
  write(join(kitPath, 'skills/lint/SKILL.md'), frontmatter('lint', 'Lints the code'))
  write(join(toolsPath, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'tools' }))
  write(
    join(home, '.claude/plugins/known_marketplaces.json'),
    JSON.stringify({ market: { source: { source: 'github', repo: 'me/market' } } })
  )
  write(
    join(home, '.claude/settings.json'),
    JSON.stringify({
      enabledPlugins: { 'kit@market': true },
      cleanupPeriodDays: 30,
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/bin/echo pre' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: '/bin/echo start' }] }]
      }
    })
  )
  write(join(folder, '.claude/settings.local.json'), JSON.stringify({ verbose: true }))
  write(join(home, '.claude.json'), JSON.stringify({ autoUpdates: true }))
}

const chipRow = (): Locator => panel().getByTestId('agent-setup-filter')
/** The chip row's chips, each reading `<label> <count>`. */
const chips = (): Locator => chipRow().getByRole('button')
const chip = (kind: string): Locator => page.getByTestId(`agent-setup-filter-${kind}`)
const pluginChip = (): Locator => chip('plugin')
const pluginItems = (): Locator => page.getByTestId('agent-setup-filter-plugin-item')
const dimmed = (id: string): Locator => page.getByTestId(`agent-setup-section-${id}`)

test('#71 AC1, AC2: Skills shows its sources as chips; User shows only its rows, again All', async () => {
  await openWith(filterFixtures)
  await tab('Skills').click()
  await expect(chipRow()).toHaveAttribute('role', 'group')
  await expect(chipRow()).toHaveAccessibleName('Filter by source')
  await expect(chips()).toHaveText(['All 6', 'Project 2', 'User 3', 'Plugin 1'])
  await expect(chip('all')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip('user')).toHaveAttribute('aria-pressed', 'false')
  await expect(rowNames()).toHaveCount(6)

  await chip('user').click()
  await expect(rowNames()).toHaveText(['blog', 'draft', 'notes'])
  await expect(chip('user')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip('all')).toHaveAttribute('aria-pressed', 'false')
  await expect(count('skills')).toHaveText('3')

  // The active chip again: All.
  await chip('user').click()
  await expect(rowNames()).toHaveCount(6)
  await expect(chip('all')).toHaveAttribute('aria-pressed', 'true')
  await expect(count('skills')).toHaveText('6')

  // Agents' rows all come from the user: no chip row at All.
  await tab('Agents').click()
  await expect(rowNames()).toHaveText(['helper'])
  await expect(chipRow()).toHaveCount(0)
})

test('#71 AC3: the filter is page-wide: Hooks follows it, Status is all there, sections dim', async () => {
  await openWith(filterFixtures)
  await tab('Skills').click()
  await chip('user').click()

  await tab('Hooks').click()
  await expect(chip('user')).toHaveAttribute('aria-pressed', 'true')
  const sources = panel().getByTestId('agent-setup-row').getByTestId('agent-setup-source')
  await expect(sources).toHaveText(['User', 'User'])
  await expect(panel().getByTestId('agent-setup-hook-command')).toHaveText([
    '/bin/echo pre',
    '/bin/echo start'
  ])
  await expect(count('hooks')).toHaveText('2')

  // Status is never filtered.
  await tab('Status').click()
  await expect(panel().getByTestId('agent-setup-status-file')).toHaveCount(6)
  await expect(panel().getByTestId('agent-setup-filter')).toHaveCount(0)

  // Sections with no User row are dimmed: Commands has only a Project one.
  await expect(dimmed('commands')).toHaveAttribute('data-dimmed', 'true')
  await expect(dimmed('mcp')).toHaveAttribute('data-dimmed', 'true')
  await expect(dimmed('skills')).toHaveAttribute('data-dimmed', 'false')
  await expect(dimmed('memory')).toHaveAttribute('data-dimmed', 'false')
  await expect(dimmed('status')).toHaveAttribute('data-dimmed', 'false')
  await expect(count('commands')).toHaveText('0')
  // Config: the User key and the preference, not the Local key.
  await expect(count('config')).toHaveText('2')
})

test('#71 AC4: the filter and the search together; Esc clears only the search', async () => {
  await openWith(filterFixtures)
  await tab('Skills').click()
  await chip('user').click()
  const search = page.getByTestId('agent-setup-search')
  await search.fill('bl')
  await expect(rowNames()).toHaveText(['blog'])
  // Each chip counts its rows matching the search; the chips stay.
  await expect(chips()).toHaveText(['All 2', 'Project 1', 'User 1', 'Plugin 0'])
  await expect(count('skills')).toHaveText('1')

  await search.fill('blz')
  await expect(panel().getByTestId('agent-setup-no-match')).toHaveText(
    'No skills from User match “blz”.'
  )
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(chip('user')).toHaveAttribute('aria-pressed', 'true')
  await expect(rowNames()).toHaveText(['blog', 'draft', 'notes'])
})

test('#71 AC5: an active filter with no rows in a section keeps its chip and says so', async () => {
  await openWith(filterFixtures)
  await tab('Skills').click()
  await chip('project').click()
  await tab('Memory').click()
  await expect(chips()).toHaveText(['All 1', 'Project 0', 'User 1'])
  await expect(chip('project')).toHaveAttribute('aria-pressed', 'true')
  await expect(panel().getByTestId('agent-setup-no-match')).toHaveText(
    'No memory files from Project.'
  )
  await chip('all').click()
  await expect(panel().getByTestId('agent-setup-memory-row')).toHaveCount(1)
  // One source and the filter at All: no chip row.
  await expect(chipRow()).toHaveCount(0)
})

test("#71 AC6, AC7: the Plugin chip's menu picks a plugin; Plugins then shows only it", async () => {
  await openWith(filterFixtures)
  await tab('Skills').click()
  await pluginChip().click()
  await expect(pluginChip()).toHaveAttribute('aria-expanded', 'true')
  await expect(pluginItems()).toHaveText(['All plugins 1', 'kit 1'])
  await expect(pluginItems().first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(pluginItems()).toHaveCount(0)
  await expect(pluginChip()).toHaveText('Plugin kit 1')
  await expect(pluginChip()).toHaveAttribute('aria-pressed', 'true')
  await expect(rowNames()).toHaveText(['kit:lint'])

  // Esc on the open menu closes it, focus back on the chip.
  await pluginChip().click()
  await expect(pluginItems()).toHaveCount(2)
  await expect(pluginItems().nth(1)).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(pluginItems()).toHaveCount(0)
  await expect(pluginChip()).toBeFocused()

  // Plugins: kit's row only, no Marketplaces.
  await tab('Plugins').click()
  await expect(panel().getByTestId('agent-setup-plugin')).toHaveCount(1)
  await expect(panel().getByTestId('agent-setup-plugin')).toHaveAttribute('data-key', 'kit@market')
  await expect(panel().getByRole('heading', { name: 'Marketplaces' })).toHaveCount(0)
  await expect(pluginChip()).toHaveText('Plugin kit 1')

  await chip('all').click()
  await expect(panel().getByTestId('agent-setup-plugin')).toHaveCount(2)
  await expect(panel().getByRole('heading', { name: 'Marketplaces' })).toBeVisible()
  await expect(panel().getByTestId('agent-setup-marketplace')).toHaveCount(1)
})

test("#71 AC8: a plugin's provides-count shows its section filtered by the plugin, the search unchanged", async () => {
  await openWith(filterFixtures)
  await tab('Plugins').click()
  const kit = panel().getByTestId('agent-setup-plugin').filter({ hasText: 'kit' })
  await kit.getByRole('button', { name: '1 skill' }).click()
  await expect(tab('Skills')).toHaveAttribute('aria-selected', 'true')
  await expect(pluginChip()).toHaveText('Plugin kit 1')
  await expect(pluginChip()).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('agent-setup-search')).toHaveValue('')
  await expect(rowNames()).toHaveText(['kit:lint'])
})

test("#71 AC9: Overview's split parts set the filter; its cards follow it; the card shows its section", async () => {
  await openWith(filterFixtures)
  const skills = page.getByTestId('agent-setup-overview-skills')
  const split = skills.getByTestId('agent-setup-overview-split')
  await expect(split).toHaveText('2 Project · 3 User · 1 Plugin')
  // Overview's chips are the sources across its cards' sections (#71 D3).
  await expect(chips()).toHaveText([
    /^All \d+$/,
    'Project 4',
    /^User \d+$/,
    /^Bikube \d+$/,
    'Plugin 3'
  ])

  await split.getByRole('button', { name: '3 User' }).click()
  await expect(tab('Skills')).toHaveAttribute('aria-selected', 'true')
  await expect(chip('user')).toHaveAttribute('aria-pressed', 'true')
  await expect(rowNames()).toHaveText(['blog', 'draft', 'notes'])

  await tab('Overview').click()
  await expect(chip('user')).toHaveAttribute('aria-pressed', 'true')
  await expect(skills.locator('.agent-setup-card-count')).toHaveText('3')
  await expect(split).toHaveText('3 User')
  await expect(page.getByTestId('agent-setup-overview-commands')).toHaveAttribute(
    'data-dimmed',
    'true'
  )
  await expect(skills).toHaveAttribute('data-dimmed', 'false')

  // The card's name shows Skills, the filter unchanged.
  await skills.getByRole('button', { name: /Skills/ }).click()
  await expect(tab('Skills')).toHaveAttribute('aria-selected', 'true')
  await expect(chip('user')).toHaveAttribute('aria-pressed', 'true')

  // Plugin sets All plugins.
  await chip('all').click()
  await tab('Overview').click()
  await split.getByRole('button', { name: '1 Plugin' }).click()
  await expect(tab('Skills')).toHaveAttribute('aria-selected', 'true')
  await expect(pluginChip()).toHaveText('Plugin 1')
  await expect(pluginChip()).toHaveAttribute('aria-pressed', 'true')
  await expect(rowNames()).toHaveText(['kit:lint'])
})

test("#71 AC12: each workspace's page keeps its own filter for the run, none after a restart", async () => {
  await launch()
  const a = await createWorkspace('A')
  filterFixtures(a)
  await setupButton().click()
  await tab('Skills').click()
  await chip('user').click()
  await expect(chip('user')).toHaveAttribute('aria-pressed', 'true')

  const b = await createWorkspace('B')
  filterFixtures(b)
  await setupButton().click()
  await tab('Skills').click()
  await expect(chip('all')).toHaveAttribute('aria-pressed', 'true')
  await expect(rowNames()).toHaveCount(6)

  await setupRow('A').click()
  await expect(tab('Skills')).toHaveAttribute('aria-selected', 'true')
  await expect(chip('user')).toHaveAttribute('aria-pressed', 'true')
  await expect(rowNames()).toHaveCount(3)

  await app!.close()
  await launch()
  await workspaceItem('A').click()
  await setupButton().click()
  await tab('Skills').click()
  await expect(chip('all')).toHaveAttribute('aria-pressed', 'true')
  await expect(rowNames()).toHaveCount(6)
})

/** `filterFixtures` and a Project permission rule, so every group under a heading has a row. */
function groupFixtures(folder: string): void {
  filterFixtures(folder)
  write(
    join(folder, '.claude/settings.json'),
    JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } })
  )
}

/** The shown section's group heading button for group `name`, reading `<name> <count>`. */
const groupToggle = (name: string): Locator =>
  panel()
    .getByTestId('agent-setup-group-toggle')
    .filter({ has: page.getByTestId('agent-setup-group-name').getByText(name, { exact: true }) })
/** The rows' container a group's heading button controls. */
const groupBody = async (name: string): Promise<Locator> =>
  page.locator(`[id="${await groupToggle(name).getAttribute('aria-controls')}"]`)

test("#71 AC10: a group's heading shows its count and collapses it, kept across reads, sections and reopening", async () => {
  await openWith(groupFixtures)
  await tab('Hooks').click()
  const pre = groupToggle('PreToolUse')
  // Bikube's and the user's.
  await expect(pre).toHaveText('PreToolUse 2')
  await expect(pre).toHaveAttribute('aria-expanded', 'true')
  await expect(groupToggle('SessionStart')).toHaveText('SessionStart 2')
  const preRows = await groupBody('PreToolUse')
  await expect(preRows.getByTestId('agent-setup-row')).toHaveCount(2)
  await expect(preRows).toBeVisible()

  await pre.click()
  await expect(pre).toHaveAttribute('aria-expanded', 'false')
  await expect(preRows).toBeHidden()
  // The others stay open.
  await expect(await groupBody('SessionStart')).toBeVisible()

  // Enter on a focused heading too.
  const stop = groupToggle('Stop')
  await stop.focus()
  await page.keyboard.press('Enter')
  await expect(stop).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await expect(stop).toHaveAttribute('aria-expanded', 'true')

  // Kept after Refresh, a switch to Config and back, and Back to the board and reopening.
  await page.getByTestId('agent-setup-refresh').click()
  await expect(pre).toHaveAttribute('aria-expanded', 'false')
  await tab('Config').click()
  await tab('Hooks').click()
  await expect(pre).toHaveAttribute('aria-expanded', 'false')
  await expect(await groupBody('PreToolUse')).toBeHidden()
  await page.getByTestId('titlebar-workspace').click()
  await expect(board()).toBeVisible()
  await setupButton().click()
  await expect(tab('Hooks')).toHaveAttribute('aria-selected', 'true')
  await expect(pre).toHaveAttribute('aria-expanded', 'false')
  await expect(groupToggle('Stop')).toHaveAttribute('aria-expanded', 'true')

  // Config's Preferences, Permissions' Allow and Plugins' Marketplaces collapse the same way.
  await tab('Config').click()
  await expect(groupToggle('Settings')).toHaveText('Settings 2')
  await expect(groupToggle('Preferences')).toHaveText('Preferences 1')
  const preferences = await groupBody('Preferences')
  await expect(preferences.getByTestId('agent-setup-preference')).toHaveCount(1)
  await groupToggle('Preferences').click()
  await expect(groupToggle('Preferences')).toHaveAttribute('aria-expanded', 'false')
  await expect(preferences).toBeHidden()
  await expect(await groupBody('Settings')).toBeVisible()

  await tab('Permissions').click()
  await expect(groupToggle('Allow')).toHaveText('Allow 1')
  await expect(groupToggle('Ask')).toHaveText('Ask 0')
  const allow = await groupBody('Allow')
  await groupToggle('Allow').click()
  await expect(groupToggle('Allow')).toHaveAttribute('aria-expanded', 'false')
  await expect(allow).toBeHidden()

  await tab('Plugins').click()
  await expect(groupToggle('Installed')).toHaveText('Installed 2')
  await expect(groupToggle('Marketplaces')).toHaveText('Marketplaces 1')
  const markets = await groupBody('Marketplaces')
  await groupToggle('Marketplaces').click()
  await expect(groupToggle('Marketplaces')).toHaveAttribute('aria-expanded', 'false')
  await expect(markets).toBeHidden()
  await expect(await groupBody('Installed')).toBeVisible()
})

test("#71 AC11: the headings' counts follow the filter", async () => {
  await openWith(groupFixtures)
  await tab('Hooks').click()
  await expect(panel().getByTestId('agent-setup-group-toggle')).toHaveCount(5)
  await chip('user').click()
  // Only the events with a User hook, each counting its User hooks.
  await expect(panel().getByTestId('agent-setup-group-toggle')).toHaveText([
    'PreToolUse 1',
    'SessionStart 1'
  ])
  await tab('Config').click()
  // cleanupPeriodDays from ~/.claude/settings.json; settings.local.json's verbose is Local.
  await expect(groupToggle('Settings')).toHaveText('Settings 1')
  await expect(groupToggle('Preferences')).toHaveText('Preferences 1')
})

test("#71 AC12: each workspace's page keeps its own collapsed groups for the run, none after a restart", async () => {
  await launch()
  const a = await createWorkspace('A')
  groupFixtures(a)
  await setupButton().click()
  await tab('Hooks').click()
  await chip('user').click()
  await groupToggle('PreToolUse').click()
  await expect(groupToggle('PreToolUse')).toHaveAttribute('aria-expanded', 'false')

  const b = await createWorkspace('B')
  groupFixtures(b)
  await setupButton().click()
  await tab('Hooks').click()
  await expect(chip('all')).toHaveAttribute('aria-pressed', 'true')
  await expect(groupToggle('PreToolUse')).toHaveText('PreToolUse 2')
  const toggles = (): Locator => panel().getByTestId('agent-setup-group-toggle')
  await expect(toggles()).toHaveCount(5)
  for (const toggle of await toggles().all()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }

  await setupRow('A').click()
  await expect(tab('Hooks')).toHaveAttribute('aria-selected', 'true')
  await expect(chip('user')).toHaveAttribute('aria-pressed', 'true')
  await expect(groupToggle('PreToolUse')).toHaveAttribute('aria-expanded', 'false')
  await expect(groupToggle('SessionStart')).toHaveAttribute('aria-expanded', 'true')

  await app!.close()
  await launch()
  await workspaceItem('A').click()
  await setupButton().click()
  await tab('Hooks').click()
  await expect(chip('all')).toHaveAttribute('aria-pressed', 'true')
  await expect(toggles()).toHaveCount(5)
  for (const toggle of await toggles().all()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
})

test("#71 AC13: at 320 px the chips wrap with no sideways scroll; the pressed chip takes the theme's accent", async () => {
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyTheme":false}}'
  )
  await openWith(filterFixtures)
  await page.emulateMedia({ colorScheme: null })
  await tab('Skills').click()
  await chip('user').click()
  /** The pressed chip's colours, and the theme's accent and accent text resolved in the page. */
  const colours = (): Promise<{ bg: string; fg: string; accent: string; accentText: string }> =>
    page.evaluate(() => {
      const resolve = (token: string): string => {
        const probe = document.createElement('div')
        probe.style.background = `var(${token})`
        document.body.append(probe)
        const colour = getComputedStyle(probe).backgroundColor
        probe.remove()
        return colour
      }
      const pressed = document.querySelector('.agent-setup-filter [aria-pressed="true"]')!
      return {
        bg: getComputedStyle(pressed).backgroundColor,
        fg: getComputedStyle(pressed).color,
        accent: resolve('--accent'),
        accentText: resolve('--accent-text')
      }
    })
  const expectAccent = async (): Promise<void> => {
    await expect
      .poll(async () => {
        const c = await colours()
        return c.bg === c.accent && c.fg === c.accentText
      })
      .toBe(true)
  }
  await expectAccent()
  const settings = page.getByTestId('settings-dialog')
  await page.keyboard.press(darwin ? 'Meta+Comma' : 'Control+Comma')
  await settings.getByRole('radio', { name: 'Light' }).check()
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await expectAccent()
  await pickAppTheme(page, 'Nord')
  await expectAccent()

  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(320, 700))
  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('agent-setup-sections')).toHaveAttribute(
    'aria-orientation',
    'horizontal'
  )
  await expect(chips()).toHaveCount(4)
  // Wrapped: the last chip on a line below the first.
  await expect
    .poll(async () => {
      const first = (await chips().first().boundingBox())!
      const last = (await chips().last().boundingBox())!
      return last.y > first.y
    })
    .toBe(true)
  await expect.poll(() => chipRow().evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect.poll(() => panel().evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
})
