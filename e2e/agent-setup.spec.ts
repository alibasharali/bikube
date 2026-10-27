import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
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
import { SHORTCUTS, backToBoard, boardCard, expectCardOpen } from './card-view'
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
// (#68 S5) Config with its switch, number field and Reset, written there too.

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
  await expect(groups.getByRole('heading')).toHaveText([
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

/** The workspace's settings.local.json, as the page wrote it. */
const localSettings = (folder: string): string =>
  readFileSync(join(folder, '.claude/settings.local.json'), 'utf8')

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

  // The provides-count shows Skills filtered by the plugin; its entries read Plugin off.
  await plugin.getByRole('button', { name: '1 skill' }).click()
  await expect(tab('Skills')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('agent-setup-search')).toHaveValue('Plugin kit')
  await expect(rowNames()).toHaveText(['kit:lint'])
  await expect(row('kit:lint')).toHaveAttribute('data-plugin-off', 'true')
  await expect(row('kit:lint').getByTestId('agent-setup-plugin-off')).toHaveText('Plugin off')
  await tab('Agents').click()
  await expect(row('kit:fixer')).toHaveAttribute('data-plugin-off', 'true')

  await page.getByTestId('agent-setup-search').press('Escape')
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
})
