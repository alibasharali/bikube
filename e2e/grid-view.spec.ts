import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The grid view: a workspace's cards in one grid, latest first, instead of its columns, set per
// workspace with Settings' default for new ones, and the first launch's prompt picking it.

let app: ElectronApplication
let page: Page
let dataDir: string
let root: string

const PALETTE = process.platform === 'darwin' ? 'Meta+K' : 'Control+Shift+P'

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikube-grid-'))
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

async function launch(options: { prompt?: boolean; dataDir?: string } = {}): Promise<void> {
  ;({ app, page, dataDir } = await launchApp({
    ...(options.dataDir && { dataDir: options.dataDir }),
    ...(options.prompt && {
      env: { ...(process.env as Record<string, string>), BIKUBE_E2E_VIEW_PROMPT: '1' }
    })
  }))
}

const readSettings = (): Record<string, unknown> => {
  const file = join(dataDir, 'bikube-settings.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).settings : {}
}

interface SavedState {
  workspaces: { name: string; view?: string; cards: { title: string; columnId: string }[] }[]
}

/** The saved state, or none while the first save hasn't come. */
const readState = (): SavedState => {
  const file = join(dataDir, 'bikube-state.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).state : { workspaces: [] }
}

type ViewChoice = 'default' | 'kanban' | 'grid'

async function createWorkspace(name: string, view?: ViewChoice): Promise<void> {
  const dir = join(root, name)
  mkdirSync(dir)
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  if (view) await page.getByTestId(`workspace-view-${view}`).check()
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

async function editView(view: ViewChoice): Promise<void> {
  const row = page.locator('.workspace-row').first()
  await row.getByTestId('workspace-item').click()
  await row.page().getByTestId('workspace-edit').click()
  await page.getByTestId(`workspace-view-${view}`).check()
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

const grid = (): Locator => page.getByTestId('grid-view')

function column(name: string): Locator {
  return page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
}

function card(title: string): Locator {
  return page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })
}

const titles = (scope: Locator): Promise<string[]> =>
  scope.getByTestId('card-title').allTextContents()

/** Creates a card through the New card form (the grid's, or a column's) and goes back. */
async function newCard(title: string, scope: Locator = grid()): Promise<void> {
  await scope.getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await backToBoard(page)
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

async function run(command: string): Promise<void> {
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

test('a first launch asks for the view, and Grid becomes the default for new workspaces', async () => {
  await launch({ prompt: true })
  const prompt = page.getByTestId('view-prompt')
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('How do you want to see your session cards?')
  await expect(prompt).toContainText('This becomes the default view for your workspaces.')
  await expect(prompt).toContainText('Each workspace can still have its own')
  await expect(prompt.getByTestId('view-prompt-kanban').locator('input')).toBeChecked()
  await expect(prompt.locator('.view-preview')).toHaveCount(2)

  await prompt.getByTestId('view-prompt-grid').click()
  await page.getByTestId('view-prompt-continue').click()
  await expect(prompt).toHaveCount(0)
  await expect.poll(readSettings).toMatchObject({ defaultView: 'grid', viewChosen: true })

  await page.getByTestId('workspace-add').click()
  // A new workspace follows the default, its label naming it.
  await expect(page.getByTestId('workspace-view-default')).toBeChecked()
  await expect(
    page
      .getByTestId('workspace-dialog')
      .locator('label', { has: page.getByTestId('workspace-view-default') })
  ).toHaveText('Default (Grid)')
  await page.getByTestId('workspace-cancel').click()
  await createWorkspace('alpha')
  await expect(grid()).toBeVisible()
  await expect(page.getByTestId('column')).toHaveCount(0)
  await expect.poll(() => readState().workspaces[0]?.name).toBe('alpha')
  expect(readState().workspaces[0]).not.toHaveProperty('view')

  // Answered once: never again, even with no workspace left.
  const dir = dataDir
  await app.close()
  rmSync(join(dir, 'bikube-state.json'))
  await launch({ prompt: true, dataDir: dir })
  await expect(page.getByTestId('empty-state')).toBeVisible()
  await expect(page.getByTestId('view-prompt')).toHaveCount(0)
})

test('Esc on the prompt keeps Kanban, and a board from before it never asks', async () => {
  await launch({ prompt: true })
  await expect(page.getByTestId('view-prompt')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('view-prompt')).toHaveCount(0)
  await expect.poll(readSettings).toEqual(expect.objectContaining({ viewChosen: true }))
  expect(readSettings()).not.toHaveProperty('defaultView')

  // A data folder with a workspace and no answer, as before the prompt existed.
  const fresh = await launchApp()
  await fresh.page.getByTestId('workspace-add').click()
  await plainCards(fresh.page)
  mkdirSync(join(root, 'beta'))
  await fresh.page.getByTestId('workspace-directory').fill(join(root, 'beta'))
  await fresh.page.getByTestId('workspace-submit').click()
  await expect(fresh.page.getByTestId('board')).toBeVisible()
  await fresh.app.close()
  await app.close()
  await launch({ prompt: true, dataDir: fresh.dataDir })
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('view-prompt')).toHaveCount(0)
})

test('switching a workspace between Kanban and Grid changes no card', async () => {
  await launch()
  await createWorkspace('alpha')
  await newCard('one', column('Backlog'))
  await newCard('two', column('Review'))
  await newCard('three', column('Backlog'))
  await expect.poll(() => readState().workspaces[0]?.cards.length).toBe(3)
  const before = readState().workspaces[0]!.cards

  await editView('grid')
  await expect(grid()).toBeVisible()
  // Latest first, whatever their columns.
  await expect.poll(() => titles(grid())).toEqual(['three', 'two', 'one'])
  // No moves in the grid: no drag, no Move to.
  await expect(card('two').getByTestId('card-open')).toHaveAttribute('draggable', 'false')
  await card('two').getByTestId('card-menu').click()
  await expect(page.getByTestId('card-menu-move-to')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Opening a card makes it the latest.
  await openCard('one')
  await backToBoard(page)
  await expect.poll(() => titles(grid())).toEqual(['one', 'three', 'two'])

  await editView('kanban')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect.poll(() => titles(column('Backlog'))).toEqual(['one', 'three'])
  await expect.poll(() => titles(column('Review'))).toEqual(['two'])
  // Every card in its column, in its place, as before the grid.
  await expect
    .poll(() => readState().workspaces[0]?.cards.map((c) => [c.title, c.columnId]))
    .toEqual(before.map((c) => [c.title, c.columnId]))
  await expect.poll(() => readState().workspaces[0]?.view).toBe('kanban')
  await editView('default')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect.poll(() => readState().workspaces[0]?.view).toBeUndefined()
})

test('the grid puts waiting cards first, folds stopped ones, and filters and searches', async () => {
  await launch()
  await createWorkspace('alpha', 'grid')
  await newCard('api server')
  await newCard('docs')
  await newCard('asks')

  // `docs` stops; `asks` needs an answer.
  await openCard('docs')
  await run('exit')
  await expect(page.getByTestId('grid-view')).toBeVisible()
  await openCard('asks')
  await run('board activity . question')
  await backToBoard(page)

  const section = (key: string): Locator => page.getByTestId(`grid-section-${key}`)
  await expect.poll(() => titles(section('waiting')), { timeout: 15_000 }).toEqual(['asks'])
  await expect.poll(() => titles(section('running'))).toEqual(['api server'])
  await expect.poll(() => titles(section('stopped'))).toEqual(['docs'])

  // The Stopped section folds and opens again.
  const toggle = page.getByTestId('grid-stopped-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(card('docs')).toHaveCount(0)

  // Picked on its own, Stopped shows its cards even folded.
  const counts = page.getByTestId('grid-filter-count')
  await expect(counts).toHaveText(['3', '1', '1', '1'])
  await page.getByTestId('grid-filter-stopped').click()
  await expect.poll(() => titles(grid())).toEqual(['docs'])
  await page.getByTestId('grid-filter-running').click()
  await expect.poll(() => titles(grid())).toEqual(['api server'])
  await page.getByTestId('grid-filter-all').click()
  await toggle.click()

  const search = page.getByTestId('grid-search')
  await search.fill('API')
  await expect.poll(() => titles(grid())).toEqual(['api server'])
  await expect(counts).toHaveText(['1', '0', '1', '0'])
  await search.fill('nothing like it')
  await expect(page.getByTestId('grid-empty')).toHaveText('No cards match')
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect.poll(() => titles(grid())).toEqual(['asks', 'api server', 'docs'])
})

test("the palette switches the active workspace's view, and New card opens the grid's form", async () => {
  await launch()
  await createWorkspace('alpha')
  await page.keyboard.press(PALETTE)
  await page.getByTestId('palette-input').fill('View: Grid')
  await page.keyboard.press('Enter')
  await expect(grid()).toBeVisible()
  await expect.poll(() => readState().workspaces[0]?.view).toBe('grid')

  await page.keyboard.press(PALETTE)
  await page.getByTestId('palette-input').fill('New card')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('new-card-input')).toBeFocused()
  await page.getByTestId('new-card-input').fill('first')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'first')
  await backToBoard(page)
  // A card made in the grid goes to the first column.
  await expect.poll(() => readState().workspaces[0]?.cards.map((c) => c.title)).toEqual(['first'])

  await page.keyboard.press(PALETTE)
  await page.getByTestId('palette-input').fill('View: Kanban')
  await page.keyboard.press('Enter')
  await expect.poll(() => titles(column('Backlog'))).toEqual(['first'])
})

test("Settings' Default view sets new workspaces' view", async () => {
  await launch()
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-view-grid').check()
  await expect.poll(readSettings).toMatchObject({ defaultView: 'grid' })
  await page.keyboard.press('Escape')
  await createWorkspace('alpha')
  await expect(grid()).toBeVisible()
})

test("a workspace on Default follows Settings' Default view live; one with its own keeps it", async () => {
  await launch()
  await createWorkspace('alpha')
  await createWorkspace('beta', 'kanban')
  await page.getByTestId('workspace-item').filter({ hasText: 'alpha' }).click()
  await expect(page.getByTestId('board')).toBeVisible()

  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-view-grid').check()
  await page.keyboard.press('Escape')
  await expect(grid()).toBeVisible()
  await page.getByTestId('workspace-item').filter({ hasText: 'beta' }).click()
  await expect(page.getByTestId('board')).toBeVisible()
})

test('each grid section shows its first cards up to the Card display limit, then Show all', async () => {
  await launch()
  await createWorkspace('alpha', 'grid')
  await newCard('runner')
  await openCard('runner')
  await run('for i in $(seq 1 4); do board create Backlog c$i; done')
  await backToBoard(page)
  const stopped = page.getByTestId('grid-section-stopped')
  await expect(stopped.getByTestId('card')).toHaveCount(4, { timeout: 15_000 })

  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-column-card-limit').fill('2')
  await page.keyboard.press('Escape')
  // Latest first: the last created two.
  await expect.poll(() => titles(stopped)).toEqual(['c4', 'c3'])
  const showAll = stopped.getByTestId('grid-show-all')
  await expect(showAll).toHaveText('Show all 4 cards')
  // Running has one card: no button.
  await expect(page.getByTestId('grid-section-running').getByTestId('grid-show-all')).toHaveCount(0)

  await showAll.click()
  await expect.poll(() => titles(stopped)).toEqual(['c4', 'c3', 'c2', 'c1'])
  await expect(showAll).toHaveText('Show fewer')
  await openCard('runner')
  await backToBoard(page)
  await expect.poll(() => titles(stopped)).toEqual(['c4', 'c3', 'c2', 'c1'])
  await stopped.getByTestId('grid-show-all').click()
  await expect.poll(() => titles(stopped)).toEqual(['c4', 'c3'])
})
