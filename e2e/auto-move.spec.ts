import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Automatic moves (#42): a workspace's rules, set in its Edit dialog (D6), saved (D7), moving
// cards as their activity changes or their shell stops (D3, D4).

let app: ElectronApplication | undefined
let page: Page
let root: string
let dataDir: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-auto-move-'))
  dataDir = newDataDir()
  ;({ app, page } = await launchApp({ dataDir }))
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

const RULES = ['When working', 'When waiting for you', 'When stopped'] as const

/** A rule's select in the open workspace dialog, found by its label. */
const rule = (label: (typeof RULES)[number]): Locator =>
  page.getByTestId('workspace-dialog').getByLabel(label, { exact: true })

const column = (name: string): Locator =>
  page.getByTestId('column').filter({ has: page.getByRole('heading', { name, exact: true }) })

async function renameColumn(from: string, to: string): Promise<void> {
  await column(from).getByTestId('column-menu').click()
  await page.getByTestId('menu-rename').click()
  await page.getByTestId('column-rename-input').fill(to)
  await page.getByTestId('column-rename-input').press('Enter')
  await expect(column(to)).toHaveCount(1)
}

/** A workspace `alpha` with columns Backlog, Running, Needs me, Done (the spec's board). */
async function createWorkspace(name = 'alpha'): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  const dir = join(root, name)
  mkdirSync(dir)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await renameColumn('In Progress', 'Running')
  await renameColumn('Review', 'Needs me')
}

async function openEdit(index = 0): Promise<void> {
  const row = page.locator('.workspace-row').nth(index)
  await row.getByTestId('workspace-item').click()
  await row.page().getByTestId('workspace-edit').click()
  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
}

async function closeDialog(button: 'workspace-submit' | 'workspace-cancel'): Promise<void> {
  await page.getByTestId(button).click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** The labels of a select's options, in order. */
const optionLabels = (select: Locator): Promise<string[]> =>
  select.locator('option').allTextContents()

/** The label of a select's chosen option. */
const chosen = (select: Locator): Promise<string> =>
  select.evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.textContent ?? '')

test('#42 AC7: the Edit dialog sets the rules, Save keeps them, Cancel changes nothing', async () => {
  await createWorkspace()

  // The Create dialog has no rules.
  await page.getByTestId('workspace-add').click()
  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
  await expect(page.getByText('Move cards automatically')).toHaveCount(0)
  await expect(rule('When working')).toHaveCount(0)
  await closeDialog('workspace-cancel')

  await openEdit()
  await expect(
    page.getByRole('group', { name: 'Move cards automatically', exact: true })
  ).toBeVisible()
  for (const label of RULES) {
    await expect(rule(label)).toBeVisible()
    expect(await chosen(rule(label))).toBe("Don't move")
    expect(await optionLabels(rule(label))).toEqual([
      "Don't move",
      'Backlog',
      'Running',
      'Needs me',
      'Done'
    ])
  }
  await rule('When waiting for you').selectOption({ label: 'Needs me' })
  await closeDialog('workspace-submit')

  await openEdit()
  expect(await chosen(rule('When waiting for you'))).toBe('Needs me')
  expect(await chosen(rule('When working'))).toBe("Don't move")
  // Cancel keeps the saved rules.
  await rule('When waiting for you').selectOption({ label: 'Done' })
  await rule('When stopped').selectOption({ label: 'Done' })
  await closeDialog('workspace-cancel')

  await openEdit()
  expect(await chosen(rule('When waiting for you'))).toBe('Needs me')
  expect(await chosen(rule('When stopped'))).toBe("Don't move")
  // Don't move turns a rule off again.
  await rule('When waiting for you').selectOption({ label: "Don't move" })
  await closeDialog('workspace-submit')
  await openEdit()
  expect(await chosen(rule('When waiting for you'))).toBe("Don't move")
})

test('#42 AC8: renaming the rule’s column keeps it, deleting the column turns it off', async () => {
  await createWorkspace()
  await openEdit()
  await rule('When waiting for you').selectOption({ label: 'Needs me' })
  await closeDialog('workspace-submit')

  await renameColumn('Needs me', 'Attention')
  await openEdit()
  expect(await chosen(rule('When waiting for you'))).toBe('Attention')
  await closeDialog('workspace-cancel')

  await column('Attention').getByTestId('column-menu').click()
  await page.getByTestId('menu-delete').click()
  await expect(column('Attention')).toHaveCount(0)
  await openEdit()
  expect(await chosen(rule('When waiting for you'))).toBe("Don't move")
  expect(await optionLabels(rule('When waiting for you'))).toEqual([
    "Don't move",
    'Backlog',
    'Running',
    'Done'
  ])
})

test('#42 AC9: the rules survive a restart and are in the state file', async () => {
  await createWorkspace('alpha')
  await createWorkspace('beta')
  await openEdit(0)
  await rule('When waiting for you').selectOption({ label: 'Needs me' })
  await closeDialog('workspace-submit')

  await app?.close()
  ;({ app, page } = await launchApp({ dataDir }))

  await openEdit(0)
  expect(await chosen(rule('When waiting for you'))).toBe('Needs me')
  expect(await chosen(rule('When working'))).toBe("Don't move")
  expect(await chosen(rule('When stopped'))).toBe("Don't move")
  await closeDialog('workspace-cancel')
  const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
  const [alpha, beta] = saved.state.workspaces
  const needsMe = alpha.columns.find((c: { name: string }) => c.name === 'Needs me')
  expect(alpha.autoMove).toEqual({ waiting: needsMe.id })
  expect(beta).not.toHaveProperty('autoMove')
})

// Moving cards (S2): `board activity` and `exit` typed into a card's shell, read on the board.

/** Sets the first workspace's rules (column names; absent ones Don't move) and saves. */
async function setRules(rules: Partial<Record<(typeof RULES)[number], string>>): Promise<void> {
  await openEdit()
  for (const label of RULES) {
    await rule(label).selectOption({ label: rules[label] ?? "Don't move" })
  }
  await closeDialog('workspace-submit')
}

const card = (title: string): Locator =>
  page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })

const titlesIn = (name: string): Locator => column(name).getByTestId('card-title')

const terminalFocused = (): Promise<boolean> =>
  page.evaluate(
    () => document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
  )

/** Creates a card through `+ New card`; its full-size view opens with the terminal focused. */
async function newCard(columnName: string, title: string): Promise<void> {
  await column(columnName).getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await expect.poll(terminalFocused).toBe(true)
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
  await expect.poll(terminalFocused).toBe(true)
}

async function back(): Promise<void> {
  await backToBoard(page)
  await expect(page.getByTestId('board')).toBeVisible()
}

/** Types a command into the focused terminal and presses Enter. */
async function run(command: string): Promise<void> {
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

let commands = 0

/**
 * Runs `command` in the open card's shell (in the workspace folder `alpha`) and waits until it has
 * exited 0: its exit code is written to a file there.
 */
async function board(command: string): Promise<void> {
  const file = join(root, 'alpha', `rc-${++commands}`)
  await run(`${command}; echo $? > ${file}`)
  // The first `board` of a run starts Bikube's executable as Node from a cold disk cache.
  await expect
    .poll(() => (existsSync(file) ? readFileSync(file, 'utf8').trim() : ''), { timeout: 15_000 })
    .toBe('0')
}

/** Waits for the board after the open card's shell exited: it is Stopped (#5 D6). */
async function exitToBoard(title: string): Promise<void> {
  await run('exit')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
}

/** Widens the window so every column is on screen: a drag doesn't scroll the board. */
async function showAllColumns(): Promise<void> {
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1800, 800))
  await expect
    .poll(() => column('Done').evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThan(1700)
}

/** Drags a card's body onto `target` and releases it there, as the user moves a card. */
async function drag(title: string, target: Locator): Promise<void> {
  const from = await card(title).getByTestId('card-open').boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('nothing to drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 5, from.y + from.height / 2 + 5, { steps: 3 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 })
  await page.mouse.up()
}

test('#42 AC1: waiting or a question moves the card to the bottom of the Waiting rule’s column', async () => {
  await createWorkspace()
  await setRules({ 'When waiting for you': 'Needs me' })
  await newCard('Needs me', 'first')
  await back()

  await newCard('Running', 'api')
  await board('board activity . waiting')
  await back()
  await expect(titlesIn('Needs me')).toHaveText(['first', 'api'], { timeout: 2_000 })
  // It waited while open, so it was seen at once: moved, its pill already gone.
  await expect(card('api').getByTestId('card-activity')).toHaveCount(0)
  await expect(titlesIn('Running')).toHaveCount(0)

  await newCard('Running', 'web')
  await board('board activity . question')
  await back()
  await expect(titlesIn('Needs me')).toHaveText(['first', 'api', 'web'], { timeout: 2_000 })
  await expect(card('web').getByTestId('card-activity')).toHaveText('Needs your answer')
})

test('#42 AC2: working moves the card to the bottom of the Working rule’s column', async () => {
  await createWorkspace()
  await setRules({ 'When working': 'Running' })
  await newCard('Running', 'first')
  await back()

  await newCard('Needs me', 'api')
  await board('board activity . working')
  await back()
  await expect(titlesIn('Running')).toHaveText(['first', 'api'])
  await expect(titlesIn('Needs me')).toHaveCount(0)
})

test('#42 AC3: a shell that exits, or a Close from the menu, moves the card to the Stopped rule’s column', async () => {
  await createWorkspace()
  await setRules({ 'When stopped': 'Done' })
  await newCard('Done', 'first')
  await back()
  await newCard('Running', 'web')
  await back()

  await newCard('Running', 'api')
  await exitToBoard('api')
  await expect(titlesIn('Done')).toHaveText(['first', 'api'])

  await card('web').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-close').click()
  await page.getByTestId('confirm-close').click()
  await expect(card('web').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(titlesIn('Done')).toHaveText(['first', 'api', 'web'])
  await expect(titlesIn('Running')).toHaveCount(0)
})

test('#42 AC4: no rule, or another rule only, leaves the card in its column', async () => {
  await createWorkspace()
  await newCard('Running', 'api')
  await board('board activity . waiting')
  await board('board activity . working')
  await back()
  await expect(card('api').getByTestId('card-activity')).toHaveText('Working')
  await expect(titlesIn('Running')).toHaveText(['api'])
  await openCard('api')
  await exitToBoard('api')
  await expect(titlesIn('Running')).toHaveText(['api'])

  await setRules({ 'When waiting for you': 'Needs me' })
  await newCard('Running', 'web')
  await board('board activity . working')
  await back()
  await expect(card('web').getByTestId('card-activity')).toHaveText('Working')
  await expect(titlesIn('Running')).toHaveText(['api', 'web'])
  await openCard('web')
  await exitToBoard('web')
  await expect(titlesIn('Running')).toHaveText(['api', 'web'])
  await expect(titlesIn('Needs me')).toHaveCount(0)
})

test('#42 AC5: only a change moves the card; a manual move stays until the next one', async () => {
  await createWorkspace()
  await showAllColumns()
  await setRules({ 'When waiting for you': 'Needs me' })
  // Needs your answer, which stays while the card is open (Waiting for you clears once seen).
  await newCard('Running', 'api')
  await board('board activity . question')
  await back()
  await expect(titlesIn('Needs me')).toHaveText(['api'])

  await drag('api', column('Backlog'))
  await expect(titlesIn('Backlog')).toHaveText(['api'])
  await openCard('api')
  await board('board activity . question')
  await back()
  await expect(titlesIn('Backlog')).toHaveText(['api'])

  await openCard('api')
  await board('board activity . working')
  await board('board activity . question')
  await back()
  await expect(titlesIn('Needs me')).toHaveText(['api'])

  await drag('api', column('Backlog'))
  await expect(titlesIn('Backlog')).toHaveText(['api'])
  await openCard('api')
  await board('board activity . none')
  await back()
  await expect(card('api').getByTestId('card-activity')).toHaveCount(0)
  await expect(titlesIn('Backlog')).toHaveText(['api'])
})

test('#42 AC6: a restart leaves restored Stopped cards where they were', async () => {
  await createWorkspace()
  await setRules({ 'When stopped': 'Done' })
  await newCard('Running', 'api')
  await back()

  await app?.close()
  ;({ app, page } = await launchApp({ dataDir }))

  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(titlesIn('Running')).toHaveText(['api'])
  await expect(titlesIn('Done')).toHaveCount(0)
  const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
  const [alpha] = saved.state.workspaces
  const running = alpha.columns.find((c: { name: string }) => c.name === 'Running')
  expect(alpha.cards.map((c: { columnId: string }) => c.columnId)).toEqual([running.id])
})

test('#42 AC8: after a rename, cards still move to the rule’s column', async () => {
  await createWorkspace()
  await setRules({ 'When waiting for you': 'Needs me' })
  await renameColumn('Needs me', 'Attention')

  await newCard('Running', 'api')
  await board('board activity . waiting')
  await back()
  await expect(titlesIn('Attention')).toHaveText(['api'])
})

test('#42 AC6: quitting moves no card, even while a shell that ignores the hangup holds the quit', async () => {
  await createWorkspace()
  await setRules({ 'When stopped': 'Done' })
  await newCard('Running', 'api')
  await back()
  // `sleep` ignoring the hangup keeps the quit held until its SIGKILL (#18 D1), so `api`'s exit
  // reaches the window first.
  await newCard('Running', 'slow')
  const pidFile = join(root, 'alpha', 'slow.pid')
  await run(`trap '' HUP; echo $$ > slow.pid; exec sleep 600`)
  await expect
    .poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '')
    .toBe(true)
  await back()

  await app?.close()
  ;({ app, page } = await launchApp({ dataDir }))

  await expect(titlesIn('Running')).toHaveText(['api', 'slow'])
  await expect(titlesIn('Done')).toHaveCount(0)
})

test('a workspace shown as Grid hides its rules and runs none, keeping them for Kanban', async () => {
  await createWorkspace()
  await setRules({ 'When waiting for you': 'Needs me' })
  await newCard('Running', 'api')
  await back()

  await openEdit()
  const rules = page.getByRole('group', { name: 'Move cards automatically', exact: true })
  await page.getByTestId('workspace-view-grid').check()
  await expect(rules).toHaveCount(0)
  // Default follows Settings' Default view, Kanban here.
  await page.getByTestId('workspace-view-default').check()
  await expect(rules).toBeVisible()
  await page.getByTestId('workspace-view-grid').check()
  await closeDialog('workspace-submit')
  await expect(page.getByTestId('grid-view')).toBeVisible()

  await openCard('api')
  await board('board activity . waiting')
  await backToBoard(page)
  await expect(page.getByTestId('grid-view')).toBeVisible()

  await openEdit()
  await page.getByTestId('workspace-view-kanban').check()
  expect(await chosen(rule('When waiting for you'))).toBe('Needs me')
  await closeDialog('workspace-submit')
  await expect(titlesIn('Running')).toHaveText(['api'])
  await expect(titlesIn('Needs me')).toHaveCount(0)
})
