import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen } from './card-view'
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

test('marks working, waiting and question on the card; hidden with the collapsed sidebar', async () => {
  await createWorkspace('Alpha')
  await newCard('Agent A')
  await terminal('Agent A').click()
  await expectCardOpen(page, 'Agent A')
  const mark = terminal('Agent A').getByTestId('workspace-terminal-activity')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  for (const [activity, label] of [
    ['working', 'Working'],
    ['waiting', 'Waiting for you'],
    ['question', 'Needs your answer']
  ]) {
    await page.keyboard.type(`"$DROVR_BIN/board" activity . ${activity}`)
    await page.keyboard.press('Enter')
    // The first `board` of a run starts Drovr's executable as Node from a cold disk cache.
    await expect(mark).toHaveAttribute('data-activity', activity, { timeout: 15_000 })
    await expect(mark).toHaveAttribute('title', label)
  }
  await page.keyboard.type('"$DROVR_BIN/board" activity . none')
  await page.keyboard.press('Enter')
  await expect(mark).toHaveCount(0)

  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('workspace-terminals')).toHaveCount(0)
  await page.getByTestId('sidebar-toggle').click()
  await expect(terminal('Agent A')).toHaveCount(1)
})
