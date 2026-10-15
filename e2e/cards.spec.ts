import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  backToBoard,
  expectCardOpen,
  expectStatusOnBoard,
  SHORTCUTS,
  splitRight
} from './card-view'
import { launchApp, removeDataDirs } from './launch'

// Cards as terminals (#4): creation, full-size view, status, lifetime. Linux runs drive
// Ctrl+Shift+B; Cmd+Shift+B on macOS is checked by hand (spec: test seams).

let app: ElectronApplication
let page: Page
let root: string

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-cards-'))
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
})

async function createWorkspace(dir: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

async function selectWorkspace(name: string): Promise<void> {
  await page.getByTestId('workspace-item').filter({ hasText: name }).click()
  await expect(page.getByTestId('board-title')).toHaveText(name)
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

/** Creates a card through `+ New card`; the full-size view opens on it (D6). */
async function newCard(columnName: string, title: string): Promise<void> {
  await column(columnName).getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

const back = (): Promise<void> => backToBoard(page)

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

/** Types a command into the focused terminal and presses Enter. */
async function run(command: string): Promise<void> {
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

const terminalFocused = (): Promise<boolean> =>
  page.evaluate(
    () => document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
  )

test('AC1: + New card creates the card, opens it focused, shell in the workspace directory', async () => {
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')

  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('api server')
  await page.getByTestId('new-card-input').press('Enter')

  const view = page.getByTestId('card-view')
  await expect(view).toBeVisible()
  await expect(page.getByTestId('board')).toHaveCount(0)
  await expect(page.getByTestId('sidebar')).toBeVisible()
  await expectCardOpen(page, 'api server')
  await expectStatusOnBoard(page, 'api server', 'Running')
  await expect.poll(terminalFocused).toBe(true)

  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
})

test('#31 AC1: the open card has no bar; its terminal starts at the top of the main area', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')

  const view = page.getByTestId('card-view')
  for (const id of ['card-back', 'pane-split-right', 'pane-split-down', 'card-close']) {
    await expect(page.getByTestId(id)).toHaveCount(0)
  }
  await expect(view.getByRole('button')).toHaveCount(0)
  await expect(view.getByRole('heading')).toHaveCount(0)
  await expect(view.getByTestId('card-status')).toHaveCount(0)
  const main = await page.locator('main').boundingBox()
  const terminal = await view.getByTestId('terminal').boundingBox()
  expect(main).not.toBeNull()
  expect(terminal).not.toBeNull()
  expect(Math.abs(terminal!.y - main!.y)).toBeLessThanOrEqual(1)
})

test('#31 AC2: the Back shortcut and the active workspace go back; the card keeps running', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')

  await page.keyboard.press(SHORTCUTS.back)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')

  await openCard('api')
  await page.getByTestId('workspace-item').filter({ hasText: 'alpha' }).click()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
})

test('AC3: Back and Ctrl+Shift+B return to the board; Esc goes to the terminal', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')

  // Esc reaches the shell (cat -v echoes it as ^[) and the view stays.
  await expect.poll(terminalFocused).toBe(true)
  await run('cat -v')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await bufferLines()).some((l) => l.includes('^['))).toBe(true)
  await expect(page.getByTestId('card-view')).toBeVisible()

  await back()
  const backlog = column('Backlog')
  await expect(backlog.getByTestId('card').last()).toContainText('api')
  await expect(backlog.getByTestId('column-count')).toHaveText('1')
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')

  // The shortcut leaves from inside the terminal and never reaches the shell (no ^B).
  await openCard('api')
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.press('Control+Shift+B')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await openCard('api')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  expect((await bufferLines()).some((l) => l.includes('^B'))).toBe(false)
  await page.keyboard.press('Control+C')
})

test('AC4: the board shows the status and last output line', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await run("printf 'drovr-marker'; sleep 30")
  await expect.poll(async () => (await bufferLines()).includes('drovr-marker')).toBe(true)
  await back()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running', {
    timeout: 1000
  })
  await expect(card('api').getByTestId('card-status-line')).toHaveText('drovr-marker', {
    timeout: 1000
  })
})

test('AC5: the terminal and its process outlive the view and workspace switches', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await createWorkspace(makeDir('beta'), 'beta')
  await selectWorkspace('alpha')
  await newCard('Backlog', 'api')
  await run('export DROVR_X=42; echo before-switch')
  await expect.poll(bufferLines).toContain('before-switch')
  // Output keeps streaming into a card nobody is looking at (D10).
  await run('sleep 1; echo streamed-later')

  await back()
  await selectWorkspace('beta')
  await expect(page.getByTestId('card')).toHaveCount(0)
  await selectWorkspace('alpha')
  await openCard('api')

  const lines = await bufferLines()
  expect(lines).toContain('before-switch')
  await expect.poll(bufferLines).toContain('streamed-later')
  await expect.poll(terminalFocused).toBe(true)
  await run('echo $DROVR_X')
  await expect.poll(bufferLines).toContain('42')
})

test('AC5/#31 D19: selecting another workspace leaves the full-size view; back returns to it', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await createWorkspace(makeDir('beta'), 'beta')
  await selectWorkspace('alpha')
  await newCard('Backlog', 'api')
  await page.getByTestId('workspace-item').filter({ hasText: 'beta' }).click()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(page.getByTestId('board-title')).toHaveText('beta')
  // alpha was left with `api` open: it shows again (#31 D19), still running.
  await page.getByTestId('workspace-item').filter({ hasText: 'alpha' }).click()
  await expectCardOpen(page, 'api')
  await expectStatusOnBoard(page, 'api', 'Running')
})

/** Waits for the board after the open card's shell exited: it is Stopped (#5 D6). */
async function stoppedToBoard(title: string): Promise<void> {
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(card(title).getByTestId('card-status-line')).toHaveCount(0)
}

/** The open card's buffer once the shell is idle: its non-blank lines, nothing typed yet. */
async function settledScreen(): Promise<string[]> {
  await expect.poll(async () => (await bufferLines()).some((l) => l !== '')).toBe(true)
  await page.waitForTimeout(500)
  return (await bufferLines()).filter((l) => l !== '')
}

test('#5 AC3: when the shell exits the view goes back to the board and the card is Stopped', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'sh')
  await expect.poll(terminalFocused).toBe(true)
  await run('exit')
  await stoppedToBoard('sh')
})

test('#5 AC6: a Stopped shell card starts a new shell in its directory when opened', async () => {
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  await newCard('Backlog', 'sh')
  // A fresh login shell's screen here, whatever the machine's prompt or login banner.
  const fresh = await settledScreen()
  await expect.poll(terminalFocused).toBe(true)
  await run('echo last-words')
  await expect.poll(bufferLines).toContain('last-words')
  await run('exit 3')
  await stoppedToBoard('sh')

  await openCard('sh')
  await expectStatusOnBoard(page, 'sh', 'Running')
  // A new, empty screen like the first one: none of the earlier output, nothing typed.
  const screen = await settledScreen()
  expect(screen).toHaveLength(fresh.length)
  expect(screen.join('\n')).not.toContain('last-words')
  expect(screen.join('\n')).not.toContain('exit')
  await expect.poll(terminalFocused).toBe(true)
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
})

test("AC7: a card whose directory is gone shows Couldn't start", async () => {
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  rmSync(dir, { recursive: true })

  await newCard('Backlog', 'x')
  const reason = "Couldn't start: working directory not found"
  await back()
  await expect(card('x')).toHaveCount(1)
  await expect(card('x').getByTestId('card-status-label')).toHaveText(reason)
  await expect(card('x').getByTestId('card-status-line')).toHaveCount(0)
})

test('AC8: each card keeps the directory it was created in', async () => {
  const alphaDir = makeDir('alpha')
  const otherDir = makeDir('other')
  await createWorkspace(alphaDir, 'alpha')
  await newCard('Backlog', 'one')
  await back()

  const row = page.locator('.workspace-row').first()
  await row.hover()
  await row.getByTestId('workspace-edit').click()
  await page.getByTestId('workspace-directory').fill(otherDir)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  await newCard('Backlog', 'two')
  await run('pwd')
  await expect.poll(bufferLines).toContain(otherDir)
  await back()

  await openCard('one')
  await expect.poll(terminalFocused).toBe(true)
  await run('pwd')
  await expect.poll(bufferLines).toContain(alphaDir)
})

test('D4/D5/D7: inline creation cancels, defaults the title, Enter opens a focused card', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  const running = column('Running')

  // Esc cancels; blur with nothing typed cancels.
  await running.getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('nope')
  await page.getByTestId('new-card-input').press('Escape')
  await expect(page.getByTestId('new-card-input')).toHaveCount(0)
  await running.getByTestId('new-card').click()
  await page.getByTestId('board-title').click()
  await expect(page.getByTestId('new-card-input')).toHaveCount(0)
  await expect(page.getByTestId('card')).toHaveCount(0)

  // An empty title becomes Terminal 1, at the bottom of that column.
  await running.getByTestId('new-card').click()
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'Terminal 1')
  await back()
  await expect(running.getByTestId('card')).toHaveCount(1)
  await expect(running.getByTestId('column-count')).toHaveText('1')
  await expect(column('Backlog').getByTestId('column-count')).toHaveText('0')

  // A long title stays on one line with the full title in the tooltip.
  const long = 'a very long card title that will not fit on one line of the column at all'
  await newCard('Running', long)
  await back()
  await expect(card(long).getByTestId('card-title')).toHaveAttribute('title', long)
  await expect(running.getByTestId('card').last()).toContainText(long)

  // Enter on a focused card opens it.
  await card('Terminal 1').getByTestId('card-open').focus()
  await page.keyboard.press('Enter')
  await expectCardOpen(page, 'Terminal 1')
  await expect.poll(terminalFocused).toBe(true)
})

test('D7: the terminal fills the view and follows the window size', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  const cols = (): Promise<number> =>
    page.evaluate(() => {
      const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
        (HTMLElement & { __xterm?: { cols: number } }) | null
      return host?.__xterm?.cols ?? 0
    })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))
  await expect.poll(cols).toBeGreaterThan(100)
  const wide = await cols()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await expect.poll(cols).toBeLessThan(wide)
  await run('tput cols')
  await expect.poll(bufferLines).toContain(String(await cols()))
})

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The open card's shell pid, read back from a file the shell writes. */
async function shellPid(): Promise<number> {
  const file = join(root, `pid-${Math.random().toString(36).slice(2)}`)
  await expect.poll(terminalFocused).toBe(true)
  await run(`echo $$ > '${file}'`)
  await expect.poll(() => existsSync(file) && readFileSync(file, 'utf8').trim() !== '').toBe(true)
  return Number(readFileSync(file, 'utf8').trim())
}

async function cardAction(
  title: string,
  action: 'card-menu-rename' | 'card-menu-delete'
): Promise<void> {
  await card(title).getByTestId('card-menu').click()
  await page.getByTestId(action).click()
}

async function columnMenu(name: string): Promise<void> {
  await column(name).getByTestId('column-menu').click()
}

test('AC9: rename from the menu or by double-click; blank is rejected; Esc cancels', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await back()

  await cardAction('api', 'card-menu-rename')
  const input = page.getByTestId('card-rename-input')
  await expect(input).toBeFocused()
  await input.fill('api v2')
  await input.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(card('api v2')).toHaveCount(1)
  await expect(card('api v2').getByTestId('card-title')).toHaveAttribute('title', 'api v2')

  // Blank is rejected inline and keeps the title.
  await cardAction('api v2', 'card-menu-rename')
  await input.fill('   ')
  await input.press('Enter')
  await expect(page.getByTestId('card-rename-error')).toHaveText('Title is required')
  await expect(input).toBeVisible()
  // Esc cancels.
  await input.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(page.getByTestId('card-title')).toHaveText(['api v2'])

  // Double-clicking the title renames inline too, without opening the card.
  await card('api v2').getByTestId('card-title').dblclick()
  await expect(input).toBeFocused()
  await input.fill('discarded')
  await input.press('Escape')
  await page.waitForTimeout(400)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-title')).toHaveText(['api v2'])

  // The full-size view follows the new title (its name); a single click on the title still opens it.
  await card('api v2').getByTestId('card-title').click()
  await expectCardOpen(page, 'api v2')
})

test('AC10: deleting a running card asks first and stops it; a Stopped card goes at once', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  const pid = await shellPid()
  await back()
  expect(alive(pid)).toBe(true)

  await cardAction('api', 'card-menu-delete')
  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog).toContainText(
    'Delete "api"? Its terminal is still running and will be stopped.'
  )
  await page.getByTestId('confirm-cancel').click()
  await expect(dialog).toHaveCount(0)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  expect(alive(pid)).toBe(true)

  await cardAction('api', 'card-menu-delete')
  await page.getByTestId('confirm-delete').click()
  await expect(dialog).toHaveCount(0)
  await expect(card('api')).toHaveCount(0)
  await expect.poll(() => alive(pid)).toBe(false)

  await newCard('Backlog', 'old')
  await expect.poll(terminalFocused).toBe(true)
  await run('exit 0')
  await stoppedToBoard('old')
  await cardAction('old', 'card-menu-delete')
  await expect(card('old')).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('card')).toHaveCount(0)
})

test('AC11: a column with cards cannot be deleted until its cards are gone', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await expect.poll(terminalFocused).toBe(true)
  await run('exit 0')
  await stoppedToBoard('api')

  await columnMenu('Backlog')
  await expect(column('Backlog').getByTestId('menu-delete')).toBeDisabled()
  await expect(column('Backlog').getByTestId('menu-delete-hint')).toHaveText(
    'Move or delete its cards first'
  )
  await page.keyboard.press('Escape')

  await cardAction('api', 'card-menu-delete')
  await expect(card('api')).toHaveCount(0)
  await columnMenu('Backlog')
  await expect(column('Backlog').getByTestId('menu-delete-hint')).toHaveCount(0)
  await column('Backlog').getByTestId('menu-delete').click()
  await expect(column('Backlog')).toHaveCount(0)
})

test('AC12: deleting a workspace names its running terminals and stops them', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'one')
  const one = await shellPid()
  await back()
  await newCard('Backlog', 'two')
  const two = await shellPid()
  await back()
  await newCard('Running', 'old')
  await expect.poll(terminalFocused).toBe(true)
  await run('exit 0')
  await stoppedToBoard('old')

  const row = page.locator('.workspace-row').first()
  await row.hover()
  await row.getByTestId('workspace-delete').click()
  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog).toContainText('2 terminals are still running and will be stopped.')
  await page.getByTestId('confirm-cancel').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('card')).toHaveCount(3)
  await expect(card('one').getByTestId('card-status-label')).toHaveText('Running')
  expect(alive(one)).toBe(true)
  expect(alive(two)).toBe(true)

  await row.hover()
  await row.getByTestId('workspace-delete').click()
  await page.getByTestId('confirm-delete').click()
  await expect(page.getByTestId('workspace-item')).toHaveCount(0)
  await expect(page.getByTestId('empty-state')).toBeVisible()
  await expect.poll(() => alive(one)).toBe(false)
  await expect.poll(() => alive(two)).toBe(false)
})

test('D15: without running cards the workspace delete dialog is unchanged', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'old')
  await expect.poll(terminalFocused).toBe(true)
  await run('exit 0')
  await stoppedToBoard('old')
  const row = page.locator('.workspace-row').first()
  await row.hover()
  await row.getByTestId('workspace-delete').click()
  await expect(page.getByTestId('confirm-dialog').locator('.modal-message')).toHaveText(
    'Delete "alpha"? This removes its board.'
  )
})

test('D8/D15: the back shortcut does nothing while a dialog is over the card view', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  const row = page.locator('.workspace-row').first()
  await row.hover()
  await row.getByTestId('workspace-delete').click()
  await expect(page.getByTestId('confirm-dialog')).toContainText(
    '1 terminal is still running and will be stopped.'
  )
  await page.keyboard.press('Control+Shift+B')
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
  await expect(page.getByTestId('card-view')).toBeVisible()
  // Confirming removes the open card's workspace, so the view closes.
  await page.getByTestId('confirm-delete').click()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(page.getByTestId('empty-state')).toBeVisible()
})

test('#31 AC17: a new workspace shows its empty board; deleting it brings back the open card', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  // Creating a workspace selects it; deleting the active one selects alpha again.
  await createWorkspace(makeDir('delta'), 'delta')
  await expect(page.getByTestId('board-title')).toHaveText('delta')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(page.getByTestId('card')).toHaveCount(0)
  const row = page.locator('.workspace-row').filter({ hasText: 'delta' })
  await row.hover()
  await row.getByTestId('workspace-delete').click()
  await page.getByTestId('confirm-delete').click()
  await expectCardOpen(page, 'api')
  await expectStatusOnBoard(page, 'api', 'Running')
})

test('AC2: default titles count on per workspace; duplicate titles are allowed', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  const untitled = async (expected: string): Promise<void> => {
    await column('Backlog').getByTestId('new-card').click()
    await page.getByTestId('new-card-input').press('Enter')
    await expectCardOpen(page, expected)
    await back()
  }
  for (const expected of ['Terminal 1', 'Terminal 2', 'Terminal 3']) await untitled(expected)
  await cardAction('Terminal 2', 'card-menu-delete')
  await page.getByTestId('confirm-delete').click()
  await expect(card('Terminal 2')).toHaveCount(0)
  await untitled('Terminal 4')
  await expect(page.getByTestId('card-title')).toHaveText([
    'Terminal 1',
    'Terminal 3',
    'Terminal 4'
  ])

  await newCard('Running', 'api')
  await back()
  await newCard('Running', 'api')
  await back()
  await expect(column('Running').getByTestId('card-title')).toHaveText(['api', 'api'])
})

test('D15: the workspace delete dialog follows terminals that exit while it is open', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'one')
  const one = await shellPid()
  await back()
  await newCard('Backlog', 'two')
  const two = await shellPid()
  await back()

  const row = page.locator('.workspace-row').first()
  await row.hover()
  await row.getByTestId('workspace-delete').click()
  const message = page.getByTestId('confirm-dialog').locator('.modal-message')
  await expect(message).toContainText('2 terminals are still running and will be stopped.')
  process.kill(one, 'SIGKILL')
  await expect(message).toHaveText(
    'Delete "alpha"? This removes its board. 1 terminal is still running and will be stopped.'
  )
  process.kill(two, 'SIGKILL')
  await expect(message).toHaveText('Delete "alpha"? This removes its board.')
})

test("#5 AC10: a card that couldn't start tries again when opened", async () => {
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  rmSync(dir, { recursive: true })

  await newCard('Backlog', 'x')
  const reason = "Couldn't start: working directory not found"
  // No retry on its own while the view stays open: the board still shows the failure after it.
  await page.waitForTimeout(1000)
  mkdirSync(dir)
  await page.waitForTimeout(500)
  await back()
  await expect(card('x').getByTestId('card-status-label')).toHaveText(reason)

  await openCard('x')
  await expectStatusOnBoard(page, 'x', 'Running')
  await expect.poll(terminalFocused).toBe(true)
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
})

test("#5 AC11: a Stopped card isn't counted as running and is deleted without asking", async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'agent')
  await expect.poll(terminalFocused).toBe(true)
  await run('exit')
  await stoppedToBoard('agent')
  await newCard('Backlog', 'sh')
  await back()

  const row = page.locator('.workspace-row').first()
  await row.hover()
  await row.getByTestId('workspace-delete').click()
  await expect(page.getByTestId('confirm-dialog').locator('.modal-message')).toHaveText(
    'Delete "alpha"? This removes its board. 1 terminal is still running and will be stopped.'
  )
  await page.getByTestId('confirm-cancel').click()

  await cardAction('agent', 'card-menu-delete')
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect(card('agent')).toHaveCount(0)
  await expect(card('sh')).toHaveCount(1)

  await row.hover()
  await row.getByTestId('workspace-delete').click()
  await expect(page.getByTestId('confirm-dialog')).toContainText(
    '1 terminal is still running and will be stopped.'
  )
})

// Workspace switching (#31 D18, D19). Linux runs drive Ctrl+digit; Cmd+digit on macOS is
// checked by hand.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** The open card's panes: whether each is marked focused and has keyboard focus. */
function paneFocus(): Promise<{ marked: boolean; active: boolean }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid=card-view] [data-testid=pane]')].map((pane) => ({
      marked: pane.getAttribute('data-focused') === 'true',
      active: pane.contains(document.activeElement)
    }))
  )
}

test('#31 AC16: Ctrl+digit in a focused terminal switches workspace; the shell gets nothing', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await createWorkspace(makeDir('beta'), 'beta')
  await selectWorkspace('alpha')
  await newCard('Backlog', 'api')
  await expect.poll(terminalFocused).toBe(true)
  await run('echo ready-$((40+2))')
  await expect.poll(bufferLines).toContain('ready-42')
  // Half a command line: anything the shell received would show in it or change its output.
  await page.keyboard.type('echo ab')
  await page.waitForTimeout(300)
  const before = await bufferLines()

  await page.keyboard.press(`${MOD}+2`)
  await expect(page.getByTestId('board-title')).toHaveText('beta')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+1`)
  await expectCardOpen(page, 'api')
  await page.waitForTimeout(300)
  expect(await bufferLines()).toEqual(before)
  await expect.poll(terminalFocused).toBe(true)
  await run('c')
  await expect.poll(bufferLines).toContain('abc')
})

test('#31 AC17: each workspace comes back to its view, panes and focus; the active one goes to its board', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await createWorkspace(makeDir('beta'), 'beta')
  await selectWorkspace('alpha')
  await newCard('Backlog', 'api')
  await expect.poll(terminalFocused).toBe(true)
  await run('echo earlier-$((40+2))')
  await expect.poll(bufferLines).toContain('earlier-42')
  await splitRight(page)
  await expect.poll(paneFocus).toEqual([
    { marked: false, active: false },
    { marked: true, active: true }
  ])

  // Away and back by click, then by Ctrl+digit: the same view each time.
  for (const by of ['click', 'key'] as const) {
    if (by === 'click') await selectWorkspace('beta')
    else await page.keyboard.press(`${MOD}+2`)
    await expect(page.getByTestId('board-title')).toHaveText('beta')
    await expect(page.getByTestId('card-view')).toHaveCount(0)
    if (by === 'click')
      await page.getByTestId('workspace-item').filter({ hasText: 'alpha' }).click()
    else await page.keyboard.press(`${MOD}+1`)
    await expectCardOpen(page, 'api')
    await expect.poll(paneFocus).toEqual([
      { marked: false, active: false },
      { marked: true, active: true }
    ])
    expect(await bufferLines()).toContain('earlier-42')
  }

  // Selecting the active workspace goes to its board and forgets the card.
  await page.getByTestId('workspace-item').filter({ hasText: 'alpha' }).click()
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await selectWorkspace('beta')
  await selectWorkspace('alpha')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  // On its board, selecting the active workspace again (by Ctrl+digit too) changes nothing.
  await page.keyboard.press(`${MOD}+1`)
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await expect(page.getByTestId('card-view')).toHaveCount(0)

  // The Back shortcut forgets it too.
  await openCard('api')
  await back()
  await selectWorkspace('beta')
  await selectWorkspace('alpha')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

test('#31 AC18: a card whose shell exits while its workspace is away is forgotten', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await createWorkspace(makeDir('beta'), 'beta')
  await selectWorkspace('alpha')
  await newCard('Backlog', 'api')
  await expect.poll(terminalFocused).toBe(true)
  await run('sleep 1; exit')
  await selectWorkspace('beta')
  await page.waitForTimeout(2000)
  await selectWorkspace('alpha')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
})
