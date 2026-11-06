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
