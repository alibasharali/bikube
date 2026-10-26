import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen, expectStatusOnBoard } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Moving cards with the keyboard, the card menu and drag and drop (#6 D4, D5, D6, D7, D8,
// D10).

let app: ElectronApplication
let page: Page
let root: string

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-moves-'))
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
})

async function createWorkspace(dir: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

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

/** The titles of a column's cards, top to bottom. */
function titles(name: string): Locator {
  return column(name).getByTestId('card-title')
}

/** Creates a card through `+ New card`; the full-size view opens on it. */
async function newCard(
  columnName: string,
  title: string,
  startup?: { command: string }
): Promise<void> {
  await column(columnName).getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  if (startup) {
    await page.getByTestId('new-card-startup').selectOption({ label: 'Custom…' })
    await page.getByTestId('new-card-command').fill(startup.command)
    await page.getByTestId('new-card-command').press('Enter')
  } else {
    await page.getByTestId('new-card-input').press('Enter')
  }
  await expectCardOpen(page, title)
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

async function back(): Promise<void> {
  await backToBoard(page)
  await expect(page.getByTestId('board')).toBeVisible()
}

/** The open card's terminal buffer, one trimmed string per line. */
function bufferLines(): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: {
            buffer: {
              active: {
                length: number
                getLine(i: number): { translateToString(trim: boolean): string } | undefined
              }
            }
          }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true).trim() ?? '')
    }
    return lines
  })
}

const terminalFocused = (): Promise<boolean> =>
  page.evaluate(
    () => document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
  )

/** Types a command into the focused terminal and presses Enter. */
async function run(command: string): Promise<void> {
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** The title of the card whose open button has focus, or null. */
const focusedCard = (): Promise<string | null> =>
  page.evaluate(() => {
    const el = document.activeElement
    if (el?.getAttribute('data-testid') !== 'card-open') return null
    return el.querySelector('[data-testid=card-title]')?.textContent ?? null
  })

/** Moves a card to a column through its menu's `Move to` group. */
async function menuMove(title: string, to: string): Promise<void> {
  await card(title).getByTestId('card-menu').click()
  await page.getByTestId('card-menu-move-to').getByText(to, { exact: true }).click()
}

test('AC7: Alt+arrows move the focused card and keep it focused', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'a')
  await back()
  await newCard('Backlog', 'b')
  await back()

  await card('b').getByTestId('card-open').focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect(titles('Backlog')).toHaveText(['b', 'a'])
  await expect.poll(focusedCard).toBe('b')

  await page.keyboard.press('Alt+ArrowUp')
  await expect(titles('Backlog')).toHaveText(['b', 'a'])
  await expect.poll(focusedCard).toBe('b')

  await page.keyboard.press('Alt+ArrowDown')
  await expect(titles('Backlog')).toHaveText(['a', 'b'])
  await expect.poll(focusedCard).toBe('b')

  await page.keyboard.press('Alt+ArrowRight')
  await expect(titles('Backlog')).toHaveText(['a'])
  await expect(titles('In Progress')).toHaveText(['b'])
  await expect(column('Backlog').getByTestId('column-count')).toHaveText('1')
  await expect(column('In Progress').getByTestId('column-count')).toHaveText('1')
  await expect.poll(focusedCard).toBe('b')

  // Alt+Left from the first column changes nothing.
  await card('a').getByTestId('card-open').focus()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(titles('Backlog')).toHaveText(['a'])
  await expect.poll(focusedCard).toBe('a')

  // Alt+Right lands at the bottom of the next column.
  await page.keyboard.press('Alt+ArrowRight')
  await expect(titles('In Progress')).toHaveText(['b', 'a'])
  await expect(column('Backlog').getByTestId('card')).toHaveCount(0)
  await expect.poll(focusedCard).toBe('a')

  // Plain arrows don't move; Enter still opens.
  await page.keyboard.press('ArrowUp')
  await expect(titles('In Progress')).toHaveText(['b', 'a'])
  await page.keyboard.press('Enter')
  await expectCardOpen(page, 'a')
})

test('AC8: the card menu moves a card to the bottom of another column', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'a')
  await back()
  await newCard('Done', 'x')
  await back()

  await card('a').getByTestId('card-menu').click()
  const menu = page.getByRole('menu', { name: 'a actions' })
  const group = menu.getByRole('group', { name: 'Move to' })
  await expect(group.getByRole('menuitem')).toHaveText(['In Progress', 'Review', 'Done'])
  // Between Rename and Startup command…, keyboard-reachable like every other item.
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Rename',
    'In Progress',
    'Review',
    'Done',
    'Startup command…',
    'Open in new window',
    'Close',
    'Delete'
  ])
  await expect(page.getByTestId('card-menu-rename')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(group.getByRole('menuitem', { name: 'In Progress' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  await menuMove('a', 'Done')
  await expect(titles('Done')).toHaveText(['x', 'a'])
  await expect.poll(focusedCard).toBe('a')
  await expect(column('Backlog').getByTestId('column-count')).toHaveText('0')
  await expect(column('Done').getByTestId('column-count')).toHaveText('2')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

test('D8: with one column the card menu has no Move to group', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  for (const name of ['In Progress', 'Review', 'Done']) {
    await column(name).getByTestId('column-menu').click()
    await column(name).getByTestId('menu-delete').click()
    await expect(column(name)).toHaveCount(0)
  }
  await newCard('Backlog', 'a')
  await back()
  await card('a').getByTestId('card-menu').click()
  await expect(page.getByRole('menu', { name: 'a actions' }).getByRole('menuitem')).toHaveText([
    'Rename',
    'Startup command…',
    'Open in new window',
    'Close',
    'Delete'
  ])
  await expect(page.getByTestId('card-menu-move-to')).toHaveCount(0)
})

test('AC1/D4: a moved running card keeps its process, output and status', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await run("export BIKUBE_X=7; printf 'bikube-marker'; sleep 30")
  await expect.poll(async () => (await bufferLines()).includes('bikube-marker')).toBe(true)
  await back()

  await menuMove('api', 'In Progress')
  await expect(titles('In Progress')).toHaveText(['api'])
  await expect(column('Backlog').getByTestId('column-count')).toHaveText('0')
  await expect(column('In Progress').getByTestId('column-count')).toHaveText('1')
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('api').getByTestId('card-status-line')).toHaveText('bikube-marker')

  // The keyboard moves it on without touching the terminal either.
  await card('api').getByTestId('card-open').focus()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(titles('Review')).toHaveText(['api'])
  await expect(card('api').getByTestId('card-status-line')).toHaveText('bikube-marker')

  await openCard('api')
  expect(await bufferLines()).toContain('bikube-marker')
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.press('Control+C')
  await run('echo $BIKUBE_X')
  await expect.poll(bufferLines).toContain('7')
})

test("AC9: Stopped and Couldn't start cards move and keep their status", async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 's', { command: 'echo started-$((40+2))' })
  await expect.poll(bufferLines).toContain('started-42')
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('s').getByTestId('card-status-label')).toHaveText('Stopped')

  // A card created after the workspace's directory moved to one that is then removed.
  const gone = makeDir('gone')
  const row = page.locator('.workspace-row').first()
  await row.hover()
  await row.getByTestId('workspace-edit').click()
  await page.getByTestId('workspace-directory').fill(gone)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  rmSync(gone, { recursive: true })
  await newCard('Backlog', 'f')
  const reason = "Couldn't start: working directory not found"
  await back()
  await expect(card('f').getByTestId('card-status-label')).toHaveText(reason)

  await menuMove('f', 'Done')
  await card('s').getByTestId('card-open').focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowRight')
  await expect(titles('Done')).toHaveText(['f', 's'])
  await expect.poll(focusedCard).toBe('s')
  await expect(card('s').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(card('f').getByTestId('card-status-label')).toHaveText(reason)

  // Opening the Stopped card starts it again with its startup command (#5 D7).
  await openCard('s')
  await expectStatusOnBoard(page, 's', 'Running')
  await expect.poll(bufferLines).toContain('started-42')
})

test('AC10: a column can be deleted once its cards are moved out', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await back()

  await column('Backlog').getByTestId('column-menu').click()
  await expect(column('Backlog').getByTestId('menu-delete')).toBeDisabled()
  await expect(column('Backlog').getByTestId('menu-delete-hint')).toHaveText(
    'Move or delete its cards first'
  )
  await page.keyboard.press('Escape')

  await menuMove('api', 'In Progress')
  await column('Backlog').getByTestId('column-menu').click()
  await expect(column('Backlog').getByTestId('menu-delete-hint')).toHaveCount(0)
  await column('Backlog').getByTestId('menu-delete').click()
  await expect(column('Backlog')).toHaveCount(0)
  await expect(titles('In Progress')).toHaveText(['api'])
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
})

/**
 * Starts a real pointer drag of a card's body and moves over `target` at `y` (a fraction of
 * its height, 0.25 = top half), with intermediate moves so HTML5 drag and drop runs.
 */
async function dragOver(title: string, target: Locator, y = 0.5): Promise<void> {
  const from = await card(title).getByTestId('card-open').boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('nothing to drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 5, from.y + from.height / 2 + 5, { steps: 3 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * y, { steps: 10 })
}

/**
 * Widens the window so every default column (300 px since #31 D11) is on screen: a drag doesn't
 * scroll the board.
 */
async function showAllColumns(): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1800, 800))
  await expect
    .poll(() => column('Done').evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThan(1700)
}

/** Drags a card onto `target` at `y` (see `dragOver`) and releases it there. */
async function drag(title: string, target: Locator, y = 0.5): Promise<void> {
  await dragOver(title, target, y)
  await page.mouse.up()
}

test('AC2: dragging onto the top or bottom half of a card reorders the column', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  for (const t of ['a', 'b', 'c']) {
    await newCard('Backlog', t)
    await back()
  }

  await drag('c', card('a'), 0.25)
  await expect(titles('Backlog')).toHaveText(['c', 'a', 'b'])
  await drag('c', card('b'), 0.75)
  await expect(titles('Backlog')).toHaveText(['a', 'b', 'c'])
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

/** Drags a card and releases it at a point on the page (not over any one element). */
async function dragToPoint(title: string, x: number, y: number): Promise<void> {
  const from = await card(title).getByTestId('card-open').boundingBox()
  if (!from) throw new Error('nothing to drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 5, from.y + from.height / 2 + 5, { steps: 3 })
  await page.mouse.move(x, y, { steps: 10 })
  await page.mouse.up()
}

test('D6: dropping in the gap between cards or just above the first uses the nearest card', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  for (const t of ['a', 'b', 'c']) {
    await newCard('Backlog', t)
    await back()
  }

  const a = await card('a').boundingBox()
  const b = await card('b').boundingBox()
  if (!a || !b) throw new Error('no cards')
  expect(b.y).toBeGreaterThan(a.y + a.height + 2)
  await dragToPoint('c', a.x + a.width / 2, (a.y + a.height + b.y) / 2)
  await expect(titles('Backlog')).toHaveText(['a', 'c', 'b'])

  const first = await card('a').boundingBox()
  if (!first) throw new Error('no card')
  await dragToPoint('b', first.x + first.width / 2, first.y - 2)
  await expect(titles('Backlog')).toHaveText(['b', 'a', 'c'])
  await expect(page.getByTestId('card-view')).toHaveCount(0)

  const top = await card('b').boundingBox()
  if (!top) throw new Error('no card')
  await dragToPoint('c', top.x + top.width / 2, top.y - 8)
  await expect(titles('Backlog')).toHaveText(['c', 'b', 'a'])
})

test('AC1/AC6: a running card dragged to another column keeps its terminal and still opens', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await run("export BIKUBE_X=7; printf 'bikube-marker'; sleep 30")
  await expect.poll(async () => (await bufferLines()).includes('bikube-marker')).toBe(true)
  await back()

  await drag('api', column('In Progress'))
  await expect(titles('In Progress')).toHaveText(['api'])
  await expect(column('Backlog').getByTestId('column-count')).toHaveText('0')
  await expect(column('In Progress').getByTestId('column-count')).toHaveText('1')
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('api').getByTestId('card-status-line')).toHaveText('bikube-marker')
  await page.waitForTimeout(400)
  await expect(page.getByTestId('card-view')).toHaveCount(0)

  // AC6: a click on the moved card opens it at full size.
  await card('api').getByTestId('card-title').click()
  await expectCardOpen(page, 'api')
  expect(await bufferLines()).toContain('bikube-marker')
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.press('Control+C')
  await run('echo $BIKUBE_X')
  await expect.poll(bufferLines).toContain('7')
})

test('AC3: dragging onto the bottom half of a card in another column lands below it', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('In Progress', 'x')
  await back()
  await newCard('In Progress', 'y')
  await back()
  await newCard('Backlog', 'a')
  await back()

  await drag('a', card('x'), 0.75)
  await expect(titles('In Progress')).toHaveText(['x', 'a', 'y'])
  await expect(column('Backlog').getByTestId('card')).toHaveCount(0)
  await expect(column('Backlog').getByText('No cards yet')).toBeVisible()
})

test("AC4: dropping on an empty column's area or a header lands at the bottom", async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await showAllColumns()
  await newCard('Backlog', 'a')
  await back()
  await newCard('Backlog', 'b')
  await back()

  await drag('a', column('Done').getByText('No cards yet'))
  await expect(titles('Done')).toHaveText(['a'])

  await drag('b', column('Done').getByTestId('column-name'))
  await expect(titles('Done')).toHaveText(['a', 'b'])
  await expect(column('Backlog').getByText('No cards yet')).toBeVisible()
})

test('D5/D6: while dragging, the card is dimmed and a line shows where it would land', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  for (const t of ['a', 'b']) {
    await newCard('Backlog', t)
    await back()
  }

  await dragOver('b', card('a'), 0.25)
  await expect(card('b')).toHaveClass(/card-dragging/)
  await expect(card('a')).toHaveAttribute('data-drop', 'before')
  await page.mouse.move(0, 0, { steps: 1 })
  const box = await card('a').boundingBox()
  if (!box) throw new Error('no card')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75, { steps: 5 })
  // Below `a` is where `b` already is: the line shows after the last card.
  await expect(card('a')).not.toHaveAttribute('data-drop')
  await expect(card('b')).toHaveAttribute('data-drop', 'after')

  const header = await column('In Progress').getByTestId('column-name').boundingBox()
  if (!header) throw new Error('no header')
  await page.mouse.move(header.x + 5, header.y + 5, { steps: 5 })
  await expect(column('In Progress').locator('.column-empty')).toHaveAttribute('data-drop', 'into')
  await expect(page.locator('[data-drop]')).toHaveCount(1)

  await page.mouse.up()
  await expect(titles('In Progress')).toHaveText(['b'])
  await expect(page.locator('[data-drop]')).toHaveCount(0)
  await expect(card('b')).not.toHaveClass(/card-dragging/)
})

test('AC5: releasing outside every column, or Esc, cancels the drag', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  for (const t of ['a', 'b']) {
    await newCard('Backlog', t)
    await back()
  }

  await drag('a', page.getByTestId('board-title'))
  await expect(titles('Backlog')).toHaveText(['a', 'b'])
  await expect(page.locator('[data-drop]')).toHaveCount(0)
  await expect(card('a')).not.toHaveClass(/card-dragging/)

  await dragOver('a', column('In Progress'))
  await expect(column('In Progress').locator('.column-empty')).toHaveAttribute('data-drop', 'into')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(titles('Backlog')).toHaveText(['a', 'b'])
  await expect(column('In Progress').getByTestId('card')).toHaveCount(0)
  await expect(page.locator('[data-drop]')).toHaveCount(0)

  await page.waitForTimeout(400)
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

/** `runner` in In Progress, then `c1`…`c<n>` at the bottom of Backlog through `board create`. */
async function fillBacklog(n: number): Promise<void> {
  await newCard('In Progress', 'runner')
  await run(`for i in $(seq 1 ${n}); do board create Backlog c$i; done`)
  await back()
  await expect(column('Backlog').getByTestId('column-count')).toHaveText(String(n), {
    timeout: 15_000
  })
}

const cs = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `c${from + i}`)

test('a column shows its first 10 cards; Show all unfolds it until Show fewer, across Back', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await fillBacklog(12)
  const toggle = column('Backlog').getByTestId('column-show-all')
  await expect(titles('Backlog')).toHaveText(cs(1, 10))
  await expect(toggle).toHaveText('Show all 12 cards')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  // A column within the limit has no button.
  await expect(column('In Progress').getByTestId('column-show-all')).toHaveCount(0)

  await toggle.click()
  await expect(titles('Backlog')).toHaveText(cs(1, 12))
  await expect(toggle).toHaveText('Show fewer')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await openCard('runner')
  await back()
  await expect(titles('Backlog')).toHaveText(cs(1, 12))

  await column('Backlog').getByTestId('column-show-all').click()
  await expect(titles('Backlog')).toHaveText(cs(1, 10))
  await expect(column('Backlog').getByTestId('column-count')).toHaveText('12')
})

test('a card put past the fold unfolds its column: by drag, Alt+Down and Move to', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await fillBacklog(10)
  await expect(column('Backlog').getByTestId('column-show-all')).toHaveCount(0)

  // Dropped below the 10th card, `runner` is the 11th, and shown.
  await showAllColumns()
  // Ten cards are taller than the window: the column scrolls, and a drag scrolls nothing.
  await card('c10').scrollIntoViewIfNeeded()
  await drag('runner', card('c10'), 0.75)
  await expect(titles('Backlog')).toHaveText([...cs(1, 10), 'runner'])
  await column('Backlog').getByTestId('column-show-all').click()
  await expect(titles('Backlog')).toHaveText(cs(1, 10))

  // Alt+Down from the 10th card keeps it in view and focused.
  await card('c10').getByTestId('card-open').focus()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(titles('Backlog')).toHaveText([...cs(1, 9), 'runner', 'c10'])
  await expect.poll(focusedCard).toBe('c10')
  await column('Backlog').getByTestId('column-show-all').click()

  // Moved to the bottom from another column through its menu, open over the cards under it.
  await menuMove('c1', 'In Progress')
  await menuMove('c1', 'Backlog')
  await expect(titles('Backlog')).toHaveText([...cs(2, 9), 'runner', 'c10', 'c1'])
  await expect.poll(focusedCard).toBe('c1')
})

test('Settings sets how many cards a column shows, live, refusing a number out of range', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await fillBacklog(5)
  await expect(column('Backlog').getByTestId('column-show-all')).toHaveCount(0)

  await page.getByTestId('settings-open').click()
  const field = page.getByTestId('settings-column-card-limit')
  await expect(field).toHaveValue('10')
  await field.fill('0')
  await expect(page.getByTestId('settings-error-column-card-limit')).toHaveText(
    'Cards per column must be a whole number from 1 to 100'
  )
  await field.fill('3')
  await expect(page.getByTestId('settings-error-column-card-limit')).toHaveCount(0)
  await field.press('ArrowDown')
  await expect(field).toHaveValue('2')
  await field.press('ArrowUp')
  await page.keyboard.press('Escape')

  await expect(titles('Backlog')).toHaveText(cs(1, 3))
  await expect(column('Backlog').getByTestId('column-show-all')).toHaveText('Show all 5 cards')
})
