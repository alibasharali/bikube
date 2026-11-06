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
import { join } from 'node:path'
import { backToBoard, cardView, expectCardOpen } from './card-view'
import { pickAppTheme } from './app-theme'
import { agentLogLines, fakeAgentsHome } from './fake-agents'
import { claudeLogLines } from './fake-claude'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'
import { showShells } from './shells-tab'

// The Split sidebar (#79): Settings' Sidebar layout and the palette rows, the workspaces above an
// Agents section that lists every workspace's agents by Needs you, Working and Idle, each naming
// its workspace; the waiting dot on expanded badges, and the held terminal digits in both
// sections.

let app: ElectronApplication
let page: Page
const dirs: string[] = []

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PALETTE = process.platform === 'darwin' ? 'Meta+K' : 'Control+Shift+P'
const TERMINAL_MOD = process.platform === 'darwin' ? 'Control' : 'Alt'
const SPLIT_SETTINGS = '{"version":1,"settings":{"sidebarLayout":"split"}}'

const settingsPath = (dataDir: string): string => join(dataDir, 'bikube-settings.json')

/** The saved settings' `sidebarLayout`, or undefined with no file or no key. */
function savedLayout(dataDir: string): unknown {
  if (!existsSync(settingsPath(dataDir))) return undefined
  return JSON.parse(readFileSync(settingsPath(dataDir), 'utf8')).settings.sidebarLayout
}

/** A data directory whose settings file holds `text`. */
function dataDirWith(text: string): string {
  const dataDir = newDataDir()
  writeFileSync(settingsPath(dataDir), text)
  return dataDir
}

async function createWorkspace(name: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'bikube-sidebar-split-'))
  dirs.push(dir)
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Creates card `title` in the first column with `agent` (else the workspace's plain default). */
async function newCard(title: string, agent?: string): Promise<void> {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  if (agent) await page.getByTestId('new-card-startup').selectOption({ label: agent })
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await backToBoard(page)
}

const agents = (): Locator => page.getByTestId('sidebar-agents')

/** Workspace `name`'s sidebar row, its nested rows included. */
const workspaceRow = (name: string): Locator =>
  page
    .locator('[data-workspace-id]')
    .filter({ has: page.getByTestId('workspace-item').getByText(name, { exact: true }) })

const terminal = (scope: Locator, title: string): Locator =>
  scope
    .getByTestId('workspace-terminal')
    .filter({ has: page.getByTestId('workspace-terminal-title').getByText(title, { exact: true }) })

/** Each workspace's nested rows as `<workspace>: <title>, <title>`, in sidebar order. */
const nested = (): Promise<string[]> =>
  page.locator('[data-workspace-id]').evaluateAll((rows) =>
    rows.map((row) => {
      const name = row.querySelector('.workspace-name')?.textContent
      const titles = [...row.querySelectorAll('[data-testid=workspace-terminal-title]')].map(
        (el) => el.textContent
      )
      return `${name}: ${titles.join(', ')}`
    })
  )

/** The Agents section's groups as `<heading>: <title> (<workspace>), …`. */
const groups = (): Promise<string[]> =>
  agents()
    .getByTestId('agent-group')
    .evaluateAll((els) =>
      els.map((group) => {
        const heading = group.querySelector('[data-testid=agent-group-heading]')?.textContent
        const rows = [...group.querySelectorAll('[data-testid=workspace-terminal]')].map(
          (row) =>
            `${row.querySelector('[data-testid=workspace-terminal-title]')?.textContent} (` +
            `${row.querySelector('[data-testid=agent-row-workspace]')?.textContent})`
        )
        return `${heading}: ${rows.join(', ')}`
      })
    )

const activeWorkspace = (): Locator =>
  page.getByTestId('workspace-item').and(page.locator('[aria-current="true"]'))

async function openPaletteAt(query: string): Promise<void> {
  await page.keyboard.press(PALETTE)
  await expect(page.getByTestId('palette-input')).toBeFocused()
  await page.getByTestId('palette-input').fill(query)
}

/** Types `line` in the open card's terminal and runs it. */
async function run(line: string): Promise<void> {
  await cardView(page).getByTestId('terminal').click()
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

/**
 * AC3's board in Split: A runs Claude Code card `Fix` then plain card `Logs`, B runs Codex card
 * `Port`. Each fake agent waits for a line on stdin: one empty line ends it, leaving its card's
 * shell running for `board` lines. With `clock`, the page's clock is faked (time still flowing)
 * from launch, before the rows' redraw timer starts, so `page.clock.fastForward` fires it.
 */
async function threeCards({ clock = false } = {}): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'bikube-sidebar-split-agents-'))
  dirs.push(root)
  const fake = fakeAgentsHome(root)
  ;({ app, page } = await launchApp({ env: fake.env, dataDir: dataDirWith(SPLIT_SETTINGS) }))
  if (clock) await page.clock.install()
  await createWorkspace('A')
  await newCard('Fix', 'Claude Code')
  await newCard('Logs')
  await createWorkspace('B')
  await newCard('Port', 'Codex')
  await expect.poll(() => claudeLogLines(fake.log).length).toBe(1)
  await expect.poll(() => agentLogLines(fake.agentLog).length).toBe(1)
  for (const [workspace, title] of [
    ['A', 'Fix'],
    ['B', 'Port']
  ]) {
    await terminal(agents(), title).click()
    await expect(activeWorkspace()).toContainText(workspace)
    await expectCardOpen(page, title)
    await run('')
    await backToBoard(page)
  }
}

/** Opens agent row `title`, runs `board activity . <activity>` in it and goes back. */
async function setActivity(title: string, activity: string): Promise<void> {
  await terminal(agents(), title).click()
  await expectCardOpen(page, title)
  await run(`"$BIKUBE_BIN/board" activity . ${activity}`)
  await backToBoard(page)
}

test('AC1: the Sidebar layout row and the palette switch to Split and back, kept across a restart', async () => {
  const launched = await launchApp()
  ;({ app, page } = launched)
  const { dataDir } = launched
  await page.getByTestId('settings-open').click()
  const dialog = page.getByTestId('settings-dialog')
  await expect(dialog.getByRole('group', { name: 'Sidebar layout' })).toBeVisible()
  await expect(dialog.getByTestId('settings-sidebar-nested')).toBeChecked()
  await expect(dialog.getByTestId('settings-sidebar-split')).not.toBeChecked()
  expect(savedLayout(dataDir)).toBeUndefined()
  await expect(agents()).toHaveCount(0)

  await dialog.getByTestId('settings-sidebar-split').check()
  await expect(agents()).toBeVisible()
  await expect.poll(() => savedLayout(dataDir)).toBe('split')
  await dialog.getByTestId('settings-done').click()

  await app.close()
  ;({ app, page } = await launchApp({ dataDir }))
  await expect(agents()).toBeVisible()

  await openPaletteAt('Sidebar')
  const titles = page.getByTestId('palette-row').getByTestId('palette-row-title')
  await expect(titles).toHaveText(['Sidebar: Nested'])
  await page.keyboard.press('Enter')
  await expect(agents()).toHaveCount(0)
  await expect.poll(() => savedLayout(dataDir)).toBeUndefined()
})

test('AC2: an unknown layout in the settings file reads Nested', async () => {
  ;({ app, page } = await launchApp({
    dataDir: dataDirWith('{"version":1,"settings":{"sidebarLayout":"sideways"}}')
  }))
  await expect(page.getByTestId('sidebar')).toBeVisible()
  await expect(agents()).toHaveCount(0)
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('settings-sidebar-nested')).toBeChecked()
  await expect(page.getByTestId('settings-sidebar-split')).not.toBeChecked()
})

test('AC7, AC13: Split with nothing running shows No agents running.; Nested has no Agents heading', async () => {
  ;({ app, page } = await launchApp({ dataDir: dataDirWith(SPLIT_SETTINGS) }))
  await createWorkspace('A')
  await newCard('Logs')
  await expect(agents().getByRole('heading', { name: 'Agents' })).toBeVisible()
  await expect(agents().getByTestId('sidebar-agents-empty')).toHaveText('No agents running.')
  await expect(agents().getByTestId('agent-group-heading')).toHaveCount(0)
  await expect.poll(nested).toEqual(['A: Logs'])

  await openPaletteAt('Sidebar: Nested')
  await page.keyboard.press('Enter')
  await expect(agents()).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Agents' })).toHaveCount(0)
  await expect.poll(nested).toEqual(['A: Logs'])
})

test('AC3, AC4: agents leave their workspace for the Agents section, grouped by activity', async () => {
  await threeCards()
  await expect.poll(nested).toEqual(['A: Logs', 'B: '])
  await expect(workspaceRow('B').getByTestId('workspace-terminals')).toHaveCount(0)
  await expect.poll(groups).toEqual(['Idle 2: Fix (A), Port (B)'])
  await expect(terminal(agents(), 'Port')).toHaveAttribute('title', 'Port (Codex) · B')
  await expect(terminal(agents(), 'Fix').locator('..')).toHaveAttribute('data-kind', 'claude')

  await setActivity('Fix', 'working')
  // The first `board` of a run starts Bikube's executable as Node from a cold disk cache.
  await expect.poll(groups, { timeout: 15_000 }).toEqual(['Working 1: Fix (A)', 'Idle 1: Port (B)'])
  await setActivity('Port', 'question')
  await expect.poll(groups).toEqual(['Needs you 1: Port (B)', 'Working 1: Fix (A)'])
  await expect(terminal(agents(), 'Port')).toHaveClass(/needs-you/)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

  await setActivity('Port', 'none')
  await expect.poll(groups).toEqual(['Working 1: Fix (A)', 'Idle 1: Port (B)'])
  await expect.poll(nested).toEqual(['A: Logs', 'B: '])
})

test('AC8: an agent row opens in its workspace, marked current; Agent setup stays nested', async () => {
  await threeCards()
  await workspaceRow('A').getByTestId('workspace-item').click()
  await expect(activeWorkspace()).toContainText('A')
  await page.getByTestId('toolbar-agent-setup').click()
  await expect(workspaceRow('A').getByTestId('workspace-agent-setup')).toHaveCount(1)

  await terminal(agents(), 'Port').click()
  await expect(activeWorkspace()).toContainText('B')
  await expectCardOpen(page, 'Port')
  await expect(terminal(agents(), 'Port')).toHaveAttribute('aria-current', 'true')
  await expect(terminal(agents(), 'Fix')).not.toHaveAttribute('aria-current', 'true')
  await expect(workspaceRow('A').getByTestId('workspace-agent-setup')).toHaveCount(1)
  await expect(agents().getByTestId('workspace-agent-setup')).toHaveCount(0)
})

test('AC9: a waiting agent dots its expanded workspace badge in Split only', async () => {
  await threeCards()
  await terminal(agents(), 'Fix').click()
  await expectCardOpen(page, 'Fix')
  // Waiting for you clears once the card is seen: set it once A is out of view.
  await run('sleep 2; "$BIKUBE_BIN/board" activity . waiting')
  await workspaceRow('B').getByTestId('workspace-item').click()
  await expect(activeWorkspace()).toContainText('B')
  const dot = workspaceRow('A').getByTestId('workspace-waiting-dot')
  await expect(dot).toHaveText('1', { timeout: 15_000 })
  await expect.poll(groups).toEqual(['Needs you 1: Fix (A)', 'Idle 1: Port (B)'])
  await expect(workspaceRow('B').getByTestId('workspace-waiting-dot')).toHaveCount(0)

  await openPaletteAt('Sidebar: Nested')
  await page.keyboard.press('Enter')
  await expect(agents()).toHaveCount(0)
  await expect(terminal(workspaceRow('A'), 'Fix')).toHaveClass(/needs-you/)
  await expect(dot).toHaveCount(0)
})

test('AC11: held digits number the active workspace’s rows in both sections; Ctrl+2 opens Logs', async () => {
  await threeCards()
  await workspaceRow('A').getByTestId('workspace-item').click()
  await expect(activeWorkspace()).toContainText('A')
  await page.keyboard.down(TERMINAL_MOD)
  await expect(terminal(agents(), 'Fix').getByTestId('terminal-number')).toHaveText('1')
  await expect(terminal(workspaceRow('A'), 'Logs').getByTestId('terminal-number')).toHaveText('2')
  await expect(terminal(agents(), 'Port').getByTestId('terminal-number')).toHaveCount(0)
  await page.keyboard.press('Digit2')
  await expectCardOpen(page, 'Logs')
  await page.keyboard.up(TERMINAL_MOD)
  await expect(page.getByTestId('terminal-number')).toHaveCount(0)
})

// Like Claude Code as a shell sees it (#58 D1): focus reporting on and its probe while it runs,
// waiting for a line on stdin, then focus reporting off as it exits.
const FAKE_CLAUDE = `#!/bin/sh
printf '\\033[?1004h\\033]7501;?\\007'
echo claude-ready
read line
printf '\\033[?1004l'
echo claude-done
`

test('AC5: a shell running Claude Code moves to the Agents section and back; a plain card’s activity puts it in Working', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bikube-sidebar-split-claude-'))
  dirs.push(root)
  const claude = join(root, 'bin', 'claude')
  mkdirSync(join(root, 'bin'))
  writeFileSync(claude, FAKE_CLAUDE)
  chmodSync(claude, 0o755)
  ;({ app, page } = await launchApp({ dataDir: dataDirWith(SPLIT_SETTINGS) }))
  await createWorkspace('A')
  await newCard('Logs')
  await showShells(page)
  await page.getByTestId('shell').first().getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await expect.poll(nested).toEqual(['A: Logs, Default shell'])
  await expect(agents().getByTestId('sidebar-agents-empty')).toBeVisible()

  await run(`'${claude}'`)
  await expect.poll(groups).toEqual(['Idle 1: Default shell (A)'])
  await expect.poll(nested).toEqual(['A: Logs'])

  await run('')
  await expect(agents().getByTestId('sidebar-agents-empty')).toBeVisible()
  await expect.poll(nested).toEqual(['A: Logs, Default shell'])
  await expect(agents().getByTestId('agent-group')).toHaveCount(0)
  await backToBoard(page)

  await terminal(workspaceRow('A'), 'Logs').click()
  await expectCardOpen(page, 'Logs')
  await run('"$BIKUBE_BIN/board" activity . working')
  // The first `board` of a run starts Bikube's executable as Node from a cold disk cache.
  await expect.poll(groups, { timeout: 15_000 }).toEqual(['Working 1: Logs (A)'])
  await expect.poll(nested).toEqual(['A: Default shell'])
})

/** Agent row `title`'s time in its group, as shown. */
const age = (title: string): Locator => terminal(agents(), title).getByTestId('agent-row-time')

test('AC6: an agent row shows how long it has been in its group, from its last group change', async () => {
  await threeCards({ clock: true })
  await expect(age('Fix')).toHaveText('now')
  await setActivity('Fix', 'working')
  // The first `board` of a run starts Bikube's executable as Node from a cold disk cache.
  await expect.poll(groups, { timeout: 15_000 }).toEqual(['Working 1: Fix (A)', 'Idle 1: Port (B)'])
  await expect(age('Fix')).toHaveText('now')

  await page.clock.fastForward('03:00')
  await expect(age('Fix')).toHaveText('3m')
  await expect(age('Port')).toHaveText('3m')

  await setActivity('Fix', 'waiting')
  await expect.poll(groups).toEqual(['Needs you 1: Fix (A)', 'Idle 1: Port (B)'])
  await expect(age('Fix')).toHaveText('now')
  await expect(age('Port')).toHaveText('3m')
})

/** The collapsed Split sidebar's agent icons, in order. */
const agentIcons = (): Locator => page.getByTestId('sidebar-agent-icons').getByTestId('agent-icon')

test('AC10: collapsed, Split shows a divider and one icon per agent after the badges; Nested none', async () => {
  await threeCards()
  await setActivity('Fix', 'working')
  // The first `board` of a run starts Bikube's executable as Node from a cold disk cache.
  await expect.poll(groups, { timeout: 15_000 }).toEqual(['Working 1: Fix (A)', 'Idle 1: Port (B)'])
  await setActivity('Port', 'question')
  await expect.poll(groups).toEqual(['Needs you 1: Port (B)', 'Working 1: Fix (A)'])

  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
  await expect(agents()).toHaveCount(0)
  const icons = page.getByTestId('sidebar-agent-icons')
  await expect(icons).toBeVisible()
  // After the badges, with a divider (its top border) between.
  const list = await page.locator('.workspace-list').boundingBox()
  const box = await icons.boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(list!.y + list!.height - 1)
  expect(await icons.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid')
  await expect(agentIcons()).toHaveCount(2)
  await expect(agentIcons().nth(0)).toHaveAttribute('title', 'Port · B · Needs your answer')
  await expect(agentIcons().nth(0)).toHaveClass(/needs-you/)
  await expect(agentIcons().nth(1)).toHaveAttribute('title', 'Fix · A · Working')
  await expect(agentIcons().nth(0).getByTestId('workspace-terminal-activity')).toHaveAttribute(
    'data-activity',
    'question'
  )
  await expect(agentIcons().nth(1).getByTestId('workspace-terminal-activity')).toHaveAttribute(
    'data-activity',
    'working'
  )
  await expect(agentIcons().nth(1).getByTestId('workspace-terminal-kind')).toBeVisible()

  await agentIcons().nth(1).click()
  await expect(activeWorkspace()).toHaveAttribute('aria-label', 'A')
  await expectCardOpen(page, 'Fix')
  await expect(agentIcons().nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(agentIcons().nth(0)).not.toHaveAttribute('aria-current', 'true')
  // Held, the active workspace's agent shows its digit on its icon too (D9).
  await backToBoard(page)
  await page.keyboard.down(TERMINAL_MOD)
  await expect(agentIcons().nth(1).getByTestId('terminal-number')).toHaveText('1')
  await expect(agentIcons().nth(0).getByTestId('terminal-number')).toHaveCount(0)
  await page.keyboard.up(TERMINAL_MOD)

  await openPaletteAt('Sidebar: Nested')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
  await expect(page.getByTestId('sidebar-agent-icons')).toHaveCount(0)
  await expect(page.getByTestId('agent-icon')).toHaveCount(0)
})

/** Picks Settings' Theme `name` (Dark or Light) and closes Settings. */
async function pickTheme(name: 'Dark' | 'Light'): Promise<void> {
  const settings = page.getByTestId('settings-dialog')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma')
  await settings.getByRole('radio', { name, exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
}

const LONG = 'A workspace with a name far too long for the sidebar'

test('AC12: the workspaces scroll within half the sidebar, the agents on their own; no row scrolls sideways; theme tokens', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bikube-sidebar-split-layout-'))
  dirs.push(root)
  const fake = fakeAgentsHome(root)
  ;({ app, page } = await launchApp({ env: fake.env, dataDir: dataDirWith(SPLIT_SETTINGS) }))
  await page.emulateMedia({ colorScheme: null })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 720))
  for (let i = 1; i <= 12; i++) {
    await createWorkspace(i === 12 ? LONG : `W${i}`)
    // 8 agent rows: a Claude Code card is one while it runs (D2 rule 1).
    if (i <= 8)
      await newCard(
        i === 1 ? 'An agent card whose title is far too long' : `Agent ${i}`,
        'Claude Code'
      )
  }
  await expect.poll(() => claudeLogLines(fake.log).length).toBe(8)
  await expect.poll(groups).toEqual([expect.stringMatching(/^Idle 8: /)])
  await page.mouse.move(900, 700)

  const sidebar = page.getByTestId('sidebar')
  const list = page.locator('.workspace-list')
  const layout = (): Promise<Record<string, number>> =>
    sidebar.evaluate((nav) => {
      const list = nav.querySelector('.workspace-list') as HTMLElement
      const agents = nav.querySelector('[data-testid=sidebar-agents]') as HTMLElement
      return {
        sidebar: nav.clientHeight,
        list: list.getBoundingClientRect().height,
        listBottom: list.getBoundingClientRect().bottom,
        listOverflow: list.scrollHeight - list.clientHeight,
        agentsTop: agents.getBoundingClientRect().top,
        agentsOverflow: agents.scrollHeight - agents.clientHeight
      }
    })
  await expect.poll(async () => (await layout()).sidebar).toBeGreaterThan(600)
  const box = await layout()
  expect(box.listOverflow).toBeGreaterThan(0)
  expect(box.list).toBeLessThanOrEqual(box.sidebar / 2 + 1)
  expect(box.agentsTop).toBeGreaterThanOrEqual(box.listBottom - 1)
  expect(box.agentsOverflow).toBeGreaterThan(0)
  // Each scrolls on its own.
  await agents().evaluate((el) => el.scrollBy(0, 1000))
  expect(await agents().evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(await list.evaluate((el) => el.scrollTop)).toBe(0)

  // At the minimum window width, nothing in the sidebar scrolls sideways, expanded or collapsed.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(320, 720))
  const noSideways = (): Promise<string[]> =>
    sidebar.evaluate((nav) =>
      [
        nav,
        ...nav.querySelectorAll<HTMLElement>(
          '.workspace-list, .sidebar-agents, .sidebar-agent-icons, .workspace-item, .workspace-terminal, .agent-icon'
        )
      ]
        .filter(
          (el) =>
            el.scrollWidth > el.clientWidth ||
            el.getBoundingClientRect().right > document.documentElement.clientWidth
        )
        .map((el) => el.className || el.tagName)
    )
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(320)
  await expect.poll(noSideways).toEqual([])
  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('agent-icon')).toHaveCount(8)
  // Once its width's transition has ended.
  await expect(sidebar).toHaveCSS('width', '56px')
  await expect.poll(noSideways).toEqual([])
  await page.getByTestId('sidebar-toggle').click()
  await expect(agents()).toBeVisible()

  /** The headings', workspace names' and times' colours, each with its token's resolved colour. */
  const colours = (): Promise<Record<string, [string, string]>> =>
    sidebar.evaluate((nav) => {
      const resolve = (token: string): string => {
        const probe = document.createElement('span')
        probe.style.color = `var(${token})`
        document.body.append(probe)
        const colour = getComputedStyle(probe).color
        probe.remove()
        return colour
      }
      const color = (selector: string): string => {
        const el = nav.querySelector(selector)
        return el ? getComputedStyle(el).color : 'missing'
      }
      const muted = resolve('--text-muted')
      const text = resolve('--text')
      const other = '[data-testid=workspace-terminal]:not([aria-current])'
      const current = '[data-testid=workspace-terminal][aria-current=true]'
      return {
        agents: [color('.sidebar-section-title'), muted],
        group: [color('[data-testid=agent-group-heading]'), muted],
        workspace: [color(`${other} [data-testid=agent-row-workspace]`), muted],
        time: [color(`${other} [data-testid=agent-row-time]`), muted],
        // The current row's on the accent tint, where muted text falls short of 4.5:1.
        currentWorkspace: [color(`${current} [data-testid=agent-row-workspace]`), text],
        currentTime: [color(`${current} [data-testid=agent-row-time]`), text],
        title: [color('.sidebar-title'), muted]
      }
    })
  const expectThemed = async (): Promise<string> => {
    const shown = await colours()
    for (const [what, [colour, token]] of Object.entries(shown)) expect(colour, what).toBe(token)
    return shown.agents[1]
  }

  // One agent row current, its card open, the pointer off every row.
  await terminal(agents(), 'Agent 2').click()
  await expect(terminal(agents(), 'Agent 2')).toHaveAttribute('aria-current', 'true')
  await page.mouse.move(900, 700)
  await pickTheme('Dark')
  const dark = await expectThemed()
  await pickTheme('Light')
  await expect.poll(async () => (await colours()).agents[1]).not.toBe(dark)
  const light = await expectThemed()
  await pickAppTheme(page, 'Nord')
  await expect.poll(async () => (await colours()).agents[1]).not.toBe(light)
  await expectThemed()
})
