import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen } from './card-view'
import { fakeAgentsHome } from './fake-agents'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The sidebar as a tree: under each workspace its running cards and shells, each opening as a
// palette pick does, with what waits for the user marked on the card; a workspace's click always
// shows its board.

let app: ElectronApplication
let page: Page
const dirs: string[] = []

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function createWorkspace(name: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'drovr-workspace-tree-'))
  dirs.push(dir)
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Creates card `title` in the first column; it opens and starts, then the board shows again. */
async function newCard(title: string): Promise<void> {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await backToBoard(page)
}

/** Workspace `name`'s sidebar row, its tree included. */
const workspaceRow = (name: string): Locator =>
  page
    .locator('[data-workspace-id]')
    .filter({ has: page.getByTestId('workspace-item').getByText(name, { exact: true }) })

const terminal = (title: string): Locator =>
  page
    .getByTestId('workspace-terminal')
    .filter({ has: page.getByTestId('workspace-terminal-title').getByText(title, { exact: true }) })

/** Each workspace's tree as `<workspace>: <title>, <title>`, in sidebar order. */
const tree = (): Promise<string[]> =>
  page.locator('[data-workspace-id]').evaluateAll((rows) =>
    rows.map((row) => {
      const name = row.querySelector('.workspace-name')?.textContent
      const titles = [...row.querySelectorAll('[data-testid=workspace-terminal]')].map(
        (el) =>
          `${el.querySelector('[data-testid=workspace-terminal-title]')?.textContent}` +
          (el.getAttribute('data-kind') === 'shell' ? ' (shell)' : '')
      )
      return `${name}: ${titles.join(', ')}`
    })
  )

const activeWorkspace = (): Locator =>
  page.getByTestId('workspace-item').and(page.locator('[aria-current="true"]'))

test('nests each workspace’s running cards and shells under it, and opens one in its workspace', async () => {
  await createWorkspace('Alpha')
  await expect(page.getByTestId('workspace-terminal')).toHaveCount(0)
  await newCard('Agent A')
  await createWorkspace('Beta')
  await newCard('Agent B')
  await page.getByTestId('shell').first().getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await backToBoard(page)

  await expect.poll(tree).toEqual(['Alpha: Agent A', 'Beta: Agent B, Default shell (shell)'])

  // From Beta's board, Alpha's card switches workspace and opens it, marked current.
  await terminal('Agent A').click()
  await expect(activeWorkspace()).toContainText('Alpha')
  await expectCardOpen(page, 'Agent A')
  await expect(terminal('Agent A')).toHaveAttribute('aria-current', 'true')
  await expect(terminal('Agent B')).not.toHaveAttribute('aria-current', 'true')

  // A shell that exits leaves the tree.
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect.poll(tree).toEqual(['Alpha: ', 'Beta: Agent B, Default shell (shell)'])
})

test('a workspace’s click shows its board, even when a card was open there', async () => {
  await createWorkspace('Alpha')
  await createWorkspace('Beta')
  await newCard('Agent B')
  await terminal('Agent B').click()
  await expectCardOpen(page, 'Agent B')

  await workspaceRow('Alpha').getByTestId('workspace-item').click()
  await expect(activeWorkspace()).toContainText('Alpha')
  await workspaceRow('Beta').getByTestId('workspace-item').click()
  await expect(activeWorkspace()).toContainText('Beta')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(terminal('Agent B')).not.toHaveAttribute('aria-current', 'true')
})

test('shows each terminal’s status: running, working, question; waiting while open is seen at once', async () => {
  await createWorkspace('Alpha')
  await newCard('Agent A')
  const mark = terminal('Agent A').getByTestId('workspace-terminal-activity')
  await expect(mark).toHaveAttribute('data-activity', 'running')
  await expect(mark).toHaveAttribute('title', 'Running')
  await terminal('Agent A').click()
  await expectCardOpen(page, 'Agent A')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  const set = async (activity: string): Promise<void> => {
    await page.keyboard.type(`"$DROVR_BIN/board" activity . ${activity}`)
    await page.keyboard.press('Enter')
  }
  for (const [activity, label] of [
    ['working', 'Working'],
    ['question', 'Needs your answer']
  ]) {
    await set(activity)
    // The first `board` of a run starts Drovr's executable as Node from a cold disk cache.
    await expect(mark).toHaveAttribute('data-activity', activity, { timeout: 15_000 })
    await expect(mark).toHaveAttribute('title', label)
  }
  await expect(mark.locator('svg')).toHaveCount(1)
  // Waiting for you while the card is open: the user sees it, so it is running again.
  await set('waiting')
  await expect(mark).toHaveAttribute('data-activity', 'running')
  await set('working')
  await expect(mark).toHaveAttribute('data-activity', 'working')
  await set('none')
  await expect(mark).toHaveAttribute('data-activity', 'running')

  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('workspace-terminals')).toHaveCount(0)
  await page.getByTestId('sidebar-toggle').click()
  await expect(terminal('Agent A')).toHaveCount(1)
})

test('shows what each terminal runs: its agent’s logo and colour, a shell neutral', async () => {
  // The fake `claude`, `codex`, `gemini` and `opencode` on the login PATH.
  const root = mkdtempSync(join(tmpdir(), 'drovr-workspace-tree-agents-'))
  dirs.push(root)
  const fake = fakeAgentsHome(root)
  await app.close()
  ;({ app, page } = await launchApp({ env: fake.env }))
  await createWorkspace('Alpha')
  const agents = [
    ['Claude card', 'Claude Code', 'claude'],
    ['Codex card', 'Codex', 'codex'],
    ['Gemini card', 'Gemini CLI', 'gemini'],
    ['OpenCode card', 'OpenCode', 'opencode']
  ] as const
  for (const [title, label] of agents) {
    await page.getByTestId('column').first().getByTestId('new-card').click()
    await page.getByTestId('new-card-input').fill(title)
    await page.getByTestId('new-card-startup').selectOption({ label })
    await page.getByTestId('new-card-input').press('Enter')
    await expectCardOpen(page, title)
    await backToBoard(page)
  }
  await page.getByTestId('shell').first().getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await backToBoard(page)

  for (const [title, label, kind] of agents) {
    await expect(terminal(title).locator('..')).toHaveAttribute('data-kind', kind)
    await expect(terminal(title)).toHaveAttribute('title', `${title} (${label})`)
    await expect(terminal(title).locator('.agent-logo')).toHaveCount(1)
  }
  // Each agent's colour, not the shell's: the board tag's `--kind`.
  const colour = (title: string): Promise<string> =>
    terminal(title)
      .getByTestId('workspace-terminal-kind')
      .evaluate((el) => getComputedStyle(el).color)
  const colours = await Promise.all(agents.map(([title]) => colour(title)))
  expect(new Set(colours).size).toBe(agents.length)
  expect(colours).not.toContain(await colour('Default shell'))
  await expect(terminal('Default shell').locator('..')).toHaveAttribute('data-kind', 'shell')
  await expect(terminal('Default shell').locator('.agent-logo')).toHaveCount(0)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
})

// Workspace switching's modifier (Mod+1…9) and the terminal digits' (Ctrl+1…9 on macOS, Alt+1…9
// elsewhere).
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const TERMINAL_MOD = process.platform === 'darwin' ? 'Control' : 'Alt'

test('the terminal digits open the active workspace’s running cards; held modifiers show the numbers', async () => {
  await createWorkspace('Alpha')
  await newCard('Agent A1')
  await newCard('Agent A2')
  await createWorkspace('Beta')
  await newCard('Agent B1')
  await workspaceRow('Alpha').getByTestId('workspace-item').click()
  await expect(activeWorkspace()).toContainText('Alpha')
  await expect.poll(tree).toEqual(['Alpha: Agent A1, Agent A2', 'Beta: Agent B1'])

  // From the board, then from a focused terminal; a number with no terminal does nothing.
  await page.keyboard.press(`${TERMINAL_MOD}+2`)
  await expectCardOpen(page, 'Agent A2')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.press(`${TERMINAL_MOD}+1`)
  await expectCardOpen(page, 'Agent A1')
  await expect(terminal('Agent A1')).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press(`${TERMINAL_MOD}+3`)
  await expectCardOpen(page, 'Agent A1')

  // Held alone, Mod numbers the workspaces and the terminal modifier the active one's terminals.
  await expect(page.getByTestId('workspace-number')).toHaveCount(0)
  await page.keyboard.down(MOD)
  await expect(page.getByTestId('workspace-number')).toHaveText(['1', '2'])
  await expect(page.getByTestId('terminal-number')).toHaveCount(0)
  await page.keyboard.up(MOD)
  await expect(page.getByTestId('workspace-number')).toHaveCount(0)
  await page.keyboard.down(TERMINAL_MOD)
  await expect(page.getByTestId('terminal-number')).toHaveText(['1', '2'])
  await expect(workspaceRow('Beta').getByTestId('terminal-number')).toHaveCount(0)
  await expect(page.getByTestId('workspace-number')).toHaveCount(0)
  // Still shown while a digit picks with it.
  await page.keyboard.press('Digit2')
  await expectCardOpen(page, 'Agent A2')
  await expect(page.getByTestId('terminal-number')).toHaveText(['1', '2'])
  await page.keyboard.up(TERMINAL_MOD)
  await expect(page.getByTestId('terminal-number')).toHaveCount(0)

  // Another key with the modifier is a combo: the numbers go until the modifier is pressed again.
  await page.keyboard.press(`${MOD}+2`)
  await expect(activeWorkspace()).toContainText('Beta')
  await page.keyboard.down(MOD)
  await expect(page.getByTestId('workspace-number')).toHaveText(['1', '2'])
  await page.keyboard.press('KeyB')
  await expect(page.getByTestId('workspace-number')).toHaveCount(0)
  await page.keyboard.up(MOD)
})
