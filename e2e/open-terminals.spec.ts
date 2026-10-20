import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The sidebar's Open terminals section: every running card and shell in every workspace, under
// the workspace list, each with its workspace, opening it as a palette pick does.

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
  const dir = mkdtempSync(join(tmpdir(), 'drovr-open-terminals-'))
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

const section = (): Locator => page.getByTestId('open-terminals')
const rows = (): Locator => section().getByTestId('open-terminal')
const row = (title: string): Locator =>
  rows().filter({ has: page.getByTestId('open-terminal-title').getByText(title, { exact: true }) })

/** Each row as `<title> | <workspace line>`. */
const listed = (): Promise<string[]> =>
  rows().evaluateAll((els) =>
    els.map(
      (el) =>
        `${el.querySelector('[data-testid=open-terminal-title]')?.textContent} | ` +
        `${el.querySelector('[data-testid=open-terminal-workspace]')?.textContent}`
    )
  )

const activeWorkspace = (): Locator =>
  page.getByTestId('workspace-item').and(page.locator('[aria-current="true"]'))

test('lists running cards and shells of every workspace, and opens one in its workspace', async () => {
  await createWorkspace('Alpha')
  await expect(section().getByTestId('open-terminals-empty')).toHaveText('No terminals running')
  await newCard('Agent A')
  await createWorkspace('Beta')
  await newCard('Agent B')
  await page.getByTestId('shell').first().getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await backToBoard(page)

  await expect
    .poll(listed)
    .toEqual(['Agent A | Alpha', 'Agent B | Beta', 'Default shell | Beta · Shell'])
  await expect(section().getByTestId('open-terminals-count')).toHaveText('3')

  // From Beta's board, a row in Alpha switches workspace and opens the card, marked current.
  await row('Agent A').click()
  await expect(activeWorkspace()).toContainText('Alpha')
  await expectCardOpen(page, 'Agent A')
  await expect(row('Agent A')).toHaveAttribute('aria-current', 'true')
  await expect(row('Agent B')).not.toHaveAttribute('aria-current', 'true')

  // A shell that exits leaves the list.
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect.poll(listed).toEqual(['Agent B | Beta', 'Default shell | Beta · Shell'])
})

test('shows a card’s activity and hides with the collapsed sidebar', async () => {
  await createWorkspace('Alpha')
  await newCard('Agent A')
  await row('Agent A').click()
  await expectCardOpen(page, 'Agent A')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('"$DROVR_BIN/board" activity . question')
  await page.keyboard.press('Enter')
  await expect(row('Agent A').getByTestId('open-terminal-activity')).toHaveAttribute(
    'title',
    'Needs your answer'
  )

  await page.getByTestId('sidebar-toggle').click()
  await expect(section()).toHaveCount(0)
  await page.getByTestId('sidebar-toggle').click()
  await expect(row('Agent A')).toHaveCount(1)
})
