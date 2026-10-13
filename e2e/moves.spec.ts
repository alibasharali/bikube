import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Moving cards with the keyboard and the card menu (#6 D4, D7, D8, D10). Dragging is in
// its own tests.

let app: ElectronApplication
let page: Page
let root: string

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-moves-'))
  app = await electron.launch({ args: ['.', '--no-sandbox'] })
  page = await app.firstWindow()
  await page.waitForSelector('[data-testid=app]')
})

test.afterEach(async () => {
  await app?.close()
})

async function createWorkspace(dir: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
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
  await expect(page.getByTestId('card-view-title')).toHaveText(title)
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expect(page.getByTestId('card-view-title')).toHaveText(title)
}

async function back(): Promise<void> {
  await page.getByTestId('card-back').click()
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
  await expect(titles('Running')).toHaveText(['b'])
  await expect(column('Backlog').getByTestId('column-count')).toHaveText('1')
  await expect(column('Running').getByTestId('column-count')).toHaveText('1')
  await expect.poll(focusedCard).toBe('b')

  // Alt+Left from the first column changes nothing.
  await card('a').getByTestId('card-open').focus()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(titles('Backlog')).toHaveText(['a'])
  await expect.poll(focusedCard).toBe('a')

  // Alt+Right lands at the bottom of the next column.
  await page.keyboard.press('Alt+ArrowRight')
  await expect(titles('Running')).toHaveText(['b', 'a'])
  await expect(column('Backlog').getByTestId('card')).toHaveCount(0)
  await expect.poll(focusedCard).toBe('a')

  // Plain arrows don't move; Enter still opens.
  await page.keyboard.press('ArrowUp')
  await expect(titles('Running')).toHaveText(['b', 'a'])
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('card-view-title')).toHaveText('a')
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
  await expect(group.getByRole('menuitem')).toHaveText(['Running', 'Needs me', 'Done'])
  // Between Rename and Startup command…, keyboard-reachable like every other item.
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Rename',
    'Running',
    'Needs me',
    'Done',
    'Startup command…',
    'Delete'
  ])
  await expect(page.getByTestId('card-menu-rename')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(group.getByRole('menuitem', { name: 'Running' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  await menuMove('a', 'Done')
  await expect(titles('Done')).toHaveText(['x', 'a'])
  await expect(column('Backlog').getByTestId('column-count')).toHaveText('0')
  await expect(column('Done').getByTestId('column-count')).toHaveText('2')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

test('D8: with one column the card menu has no Move to group', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  for (const name of ['Running', 'Needs me', 'Done']) {
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
    'Delete'
  ])
  await expect(page.getByTestId('card-menu-move-to')).toHaveCount(0)
})

test('AC1/D4: a moved running card keeps its process, output and status', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await run("export DROVR_X=7; printf 'drovr-marker'; sleep 30")
  await expect.poll(async () => (await bufferLines()).includes('drovr-marker')).toBe(true)
  await back()

  await menuMove('api', 'Running')
  await expect(titles('Running')).toHaveText(['api'])
  await expect(column('Backlog').getByTestId('column-count')).toHaveText('0')
  await expect(column('Running').getByTestId('column-count')).toHaveText('1')
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('api').getByTestId('card-status-line')).toHaveText('drovr-marker')

  // The keyboard moves it on without touching the terminal either.
  await card('api').getByTestId('card-open').focus()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(titles('Needs me')).toHaveText(['api'])
  await expect(card('api').getByTestId('card-status-line')).toHaveText('drovr-marker')

  await openCard('api')
  expect(await bufferLines()).toContain('drovr-marker')
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.press('Control+C')
  await run('echo $DROVR_X')
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
  await expect(page.getByTestId('card-view').getByTestId('card-status-label')).toHaveText(reason)
  await back()

  await menuMove('f', 'Done')
  await card('s').getByTestId('card-open').focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowRight')
  await expect(titles('Done')).toHaveText(['f', 's'])
  await expect.poll(focusedCard).toBe('s')
  await expect(card('s').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(card('f').getByTestId('card-status-label')).toHaveText(reason)

  // Opening the Stopped card starts it again with its startup command (#5 D7).
  await openCard('s')
  await expect(page.getByTestId('card-view').getByTestId('card-status-label')).toHaveText('Running')
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

  await menuMove('api', 'Running')
  await column('Backlog').getByTestId('column-menu').click()
  await expect(column('Backlog').getByTestId('menu-delete-hint')).toHaveCount(0)
  await column('Backlog').getByTestId('menu-delete').click()
  await expect(column('Backlog')).toHaveCount(0)
  await expect(titles('Running')).toHaveText(['api'])
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
})
