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
  await expect(page.getByTestId('card-view-title')).toHaveText('api server')
  await expect(view.getByTestId('card-status-label')).toHaveText('Running')
  await expect.poll(terminalFocused).toBe(true)

  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
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

test('AC5/D8: selecting a workspace in the sidebar leaves the full-size view', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await createWorkspace(makeDir('beta'), 'beta')
  await selectWorkspace('alpha')
  await newCard('Backlog', 'api')
  await page.getByTestId('workspace-item').filter({ hasText: 'beta' }).click()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(page.getByTestId('board-title')).toHaveText('beta')
  await selectWorkspace('alpha')
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
})

test('AC6: an exited card keeps its final output, read-only', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await run('echo last-words')
  await expect.poll(bufferLines).toContain('last-words')
  await run('exit 3')
  const view = page.getByTestId('card-view')
  await expect(view.getByTestId('card-status-label')).toHaveText('Exited (code 3)')

  await back()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Exited (code 3)')

  await openCard('api')
  await expect.poll(bufferLines).toContain('last-words')
  const before = await bufferLines()
  await page.getByTestId('card-terminal').click()
  await run('echo typed-after-exit')
  await page.waitForTimeout(500)
  expect(await bufferLines()).toEqual(before)
})

test("AC7: a card whose directory is gone shows Couldn't start", async () => {
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  rmSync(dir, { recursive: true })

  await newCard('Backlog', 'x')
  const reason = "Couldn't start: working directory not found"
  await expect(page.getByTestId('card-view').getByTestId('card-status-label')).toHaveText(reason)
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
  await expect(page.getByTestId('card-view-title')).toHaveText('Terminal 1')
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
  await expect(page.getByTestId('card-view-title')).toHaveText('Terminal 1')
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
