import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, closeCard, expectCardOpen } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Cards waiting for the user (#41): each workspace's row in the sidebar counts its cards and
// shells whose activity is Waiting for you or Needs your answer, set with `board activity`.

let app: ElectronApplication | undefined
let page: Page
let root: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-waiting-'))
  ;({ app, page } = await launchApp({ dataDir: newDataDir() }))
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

async function createWorkspace(name: string): Promise<void> {
  const dir = join(root, name)
  mkdirSync(dir)
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

async function selectWorkspace(name: 'Alpha' | 'Beta'): Promise<void> {
  await row(name).getByTestId('workspace-item').click()
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

/** The sidebar row of `Alpha` or `Beta`, by place: a collapsed row shows no name. */
const row = (name: 'Alpha' | 'Beta'): Locator =>
  page.locator('[data-workspace-id]').nth(name === 'Alpha' ? 0 : 1)

const pill = (name: 'Alpha' | 'Beta'): Locator => row(name).getByTestId('workspace-waiting')

function boardCard(title: string): Locator {
  return page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })
}

/** Creates a running card in Backlog and goes back to the board. */
async function newCard(title: string): Promise<void> {
  await page.getByTestId('new-card').first().click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await backToBoard(page)
}

async function openCard(title: string): Promise<void> {
  await boardCard(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.closest('[data-testid=card-view] [data-testid=pane]') != null
      )
    )
    .toBe(true)
}

/** Opens card `title`, types `board activity . <activity>` in it and waits for its pill. */
async function setActivity(title: string, activity: string, pillText: string): Promise<void> {
  await openCard(title)
  await page.keyboard.type(`board activity . ${activity}`)
  await page.keyboard.press('Enter')
  await backToBoard(page)
  // The first `board` of a run starts Drovr's executable as Node from a cold disk cache.
  await expect(boardCard(title).getByTestId('card-activity')).toHaveText(pillText, {
    timeout: 15_000
  })
}

/** Alpha (active) and Beta, each with two running plain cards; Beta's wait and need an answer. */
async function twoWaitingInBeta(): Promise<void> {
  await createWorkspace('Alpha')
  await newCard('a1')
  await newCard('a2')
  await createWorkspace('Beta')
  await newCard('b1')
  await newCard('b2')
  await setActivity('b1', 'waiting', 'Waiting for you')
  await setActivity('b2', 'question', 'Needs your answer')
  await selectWorkspace('Alpha')
}

test('AC1: a workspace row counts its waiting cards, live', async () => {
  await twoWaitingInBeta()
  await expect(pill('Beta')).toHaveText('2')
  await expect(pill('Beta')).toHaveAttribute('title', '2 waiting for you')
  await expect(pill('Alpha')).toHaveCount(0)

  // The pill stays visible while the row's edit and delete buttons show.
  await row('Beta').hover()
  await expect(row('Beta').getByTestId('workspace-edit')).toBeVisible()
  await expect(pill('Beta')).toBeVisible()
  const pillBox = (await pill('Beta').boundingBox())!
  const editBox = (await row('Beta').getByTestId('workspace-edit').boundingBox())!
  expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(editBox.x)

  await selectWorkspace('Beta')
  await setActivity('b2', 'working', 'Working')
  await expect(pill('Beta')).toHaveText('1')
  await expect(pill('Beta')).toHaveAttribute('title', '1 waiting for you')

  await openCard('b1')
  await closeCard(page)
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(pill('Beta')).toHaveCount(0)
  await expect(pill('Alpha')).toHaveCount(0)
})

test('AC2: the collapsed sidebar shows the count as a dot on the badge', async () => {
  await twoWaitingInBeta()
  await expect(pill('Beta')).toHaveText('2')

  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
  const dot = row('Beta').getByTestId('workspace-waiting-dot')
  await expect(dot).toHaveText('2')
  await expect(dot).toHaveAttribute('title', '2 waiting for you')
  await expect(dot).toBeVisible()
  await expect(row('Alpha').getByTestId('workspace-waiting-dot')).toHaveCount(0)
  await expect(page.getByTestId('workspace-waiting')).toHaveCount(0)

  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'false')
  await expect(row('Beta').getByTestId('workspace-waiting-dot')).toHaveCount(0)
  await expect(pill('Beta')).toHaveText('2')
})
