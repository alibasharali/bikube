import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeLogLines, fakeClaudeHome } from './fake-claude'

// Close card (#7): from the card menu and the full-size header, with a confirmation; the card
// stays where it is as Stopped and resumes when opened. Electron runs with the fake `claude`
// of #5's smoke tests on the login PATH.

let app: ElectronApplication
let page: Page
let root: string
let log: string

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-close-'))
  const fake = fakeClaudeHome(root)
  log = fake.log
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: fake.env })
  page = await app.firstWindow()
  await page.waitForSelector('[data-testid=app]')
})

test.afterEach(async () => {
  await app?.close()
})

const logLines = (): string[] => claudeLogLines(log)

const CLOSE_MESSAGE =
  'Close "api"? Its terminal will be stopped. Open the card again to start it with its startup command.'

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

const status = (title: string): Locator => card(title).getByTestId('card-status-label')

/** Creates a card through `+ New card`, optionally with a startup choice; its view opens. */
async function newCard(columnName: string, title: string, startup?: 'Claude Code'): Promise<void> {
  await column(columnName).getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  if (startup) await page.getByTestId('new-card-startup').selectOption({ label: startup })
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

/** The open card's terminal buffer, one trimmed string per line (wrapped lines joined). */
function bufferLines(): Promise<string[]> {
  return page.evaluate(() => {
    type Line = { isWrapped: boolean; translateToString(trim: boolean): string }
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: { buffer: { active: { length: number; getLine(i: number): Line | undefined } } }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const rows: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      const next = buffer.getLine(i + 1)
      const text = line?.translateToString(!next?.isWrapped) ?? ''
      if (line?.isWrapped && rows.length > 0) rows[rows.length - 1] += text
      else rows.push(text)
    }
    return rows.map((r) => r.trim())
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
  await run(`echo $$ > '${file}'`)
  await expect.poll(() => existsSync(file) && readFileSync(file, 'utf8').trim() !== '').toBe(true)
  return Number(readFileSync(file, 'utf8').trim())
}

async function openMenu(title: string): Promise<void> {
  await card(title).getByTestId('card-menu').click()
  await expect(page.getByTestId('card-menu-delete')).toBeVisible()
}

/** Picks `Close` from the card's menu; the confirmation opens. */
async function menuClose(title: string): Promise<void> {
  await openMenu(title)
  await page.getByTestId('card-menu-close').click()
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
}

/** Confirms the open `Close card` dialog. */
async function confirmClose(): Promise<void> {
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
}

test('AC1: Close from the menu asks, stops the shell, and keeps the card in place as Stopped', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Running', 'first')
  await back()
  await newCard('Running', 'api')
  const pid = await shellPid()
  await back()
  await newCard('Running', 'third')
  await back()
  const titles = column('Running').getByTestId('card-title')
  await expect(titles).toHaveText(['first', 'api', 'third'])

  // The menu offers Close between Startup command… and Delete.
  await openMenu('api')
  await expect(page.getByRole('menuitem')).toHaveText([
    'Rename',
    'Backlog',
    'Needs me',
    'Done',
    'Startup command…',
    'Close',
    'Delete'
  ])
  await page.getByTestId('card-menu-close').click()

  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog.getByRole('heading')).toHaveText('Close card')
  await expect(dialog.locator('.modal-message')).toHaveText(CLOSE_MESSAGE)
  await expect(page.getByTestId('confirm-cancel')).toHaveText('Cancel')
  await expect(page.getByTestId('confirm-close')).toHaveText('Close')
  await confirmClose()

  await expect(status('api')).toHaveText('Stopped')
  await expect.poll(() => alive(pid)).toBe(false)
  await expect(titles).toHaveText(['first', 'api', 'third'])
  await expect(status('first')).toHaveText('Running')
})

test('AC2: Cancel or Esc in the Close dialog changes nothing', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Running', 'api')
  const pid = await shellPid()
  await back()

  await menuClose('api')
  await page.getByTestId('confirm-cancel').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)

  await menuClose('api')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)

  await page.waitForTimeout(500)
  await expect(status('api')).toHaveText('Running')
  expect(alive(pid)).toBe(true)
})

test('AC3: Close from the full-size header goes back to the board with the card Stopped', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Running', 'api')
  const pid = await shellPid()

  const view = page.getByTestId('card-view')
  await expect(view.getByTestId('card-close')).toHaveText('Close')
  await view.getByTestId('card-close').click()
  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog.getByRole('heading')).toHaveText('Close card')
  await expect(dialog.locator('.modal-message')).toHaveText(CLOSE_MESSAGE)

  // The Back shortcut does nothing while the dialog is open; Esc cancels.
  await page.keyboard.press('Control+Shift+B')
  await expect(dialog).toBeVisible()
  await expect(view).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(view).toBeVisible()
  expect(alive(pid)).toBe(true)

  await view.getByTestId('card-close').click()
  await confirmClose()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(status('api')).toHaveText('Stopped')
  await expect.poll(() => alive(pid)).toBe(false)
})

test('AC4: a closed card resumes with its startup command when opened again', async () => {
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  await newCard('Backlog', 'agent', 'Claude Code')
  await expect.poll(logLines).toHaveLength(1)
  const [first] = logLines()
  expect(first).toMatch(/^--session-id /)
  const u = first.slice('--session-id '.length)
  await expect.poll(bufferLines).toContain(`fake-claude --session-id ${u}`)
  await back()

  await menuClose('agent')
  await confirmClose()
  await expect(status('agent')).toHaveText('Stopped')

  await openCard('agent')
  const resume = `claude --resume ${u} || claude --session-id ${u}`
  await expect.poll(bufferLines).toContain(`fake-claude --resume ${u}`)
  expect((await bufferLines()).some((l) => l.endsWith(resume))).toBe(true)
  expect(logLines().at(-1)).toBe(`--resume ${u}`)
  await back()

  // A closed Shell card opened again runs a new shell in the card's directory.
  await newCard('Backlog', 'api')
  const pid = await shellPid()
  await page.getByTestId('card-close').click()
  await confirmClose()
  await expect(status('api')).toHaveText('Stopped')
  await openCard('api')
  await expect(page.getByTestId('card-view').getByTestId('card-status-label')).toHaveText('Running')
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
  expect(await shellPid()).not.toBe(pid)
})

test("AC5: Close isn't offered for a Stopped card or one that couldn't start", async () => {
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  await newCard('Backlog', 'old')
  await run('exit')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(status('old')).toHaveText('Stopped')

  rmSync(dir, { recursive: true })
  await newCard('Backlog', 'x')
  const reason = "Couldn't start: working directory not found"
  const view = page.getByTestId('card-view')
  await expect(view.getByTestId('card-status-label')).toHaveText(reason)
  await expect(view.getByTestId('card-back')).toBeVisible()
  await expect(view.getByTestId('card-close')).toHaveCount(0)
  await back()

  for (const title of ['old', 'x']) {
    await openMenu(title)
    await expect(page.getByTestId('card-menu-startup')).toBeVisible()
    await expect(page.getByTestId('card-menu-close')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('card-menu-delete')).toHaveCount(0)
  }
})

test('a card that stops by itself while its Close dialog is open drops the dialog', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await run('sleep 2; exit')
  await back()
  await menuClose('api')
  await expect(status('api')).toHaveText('Running')

  await expect(status('api')).toHaveText('Stopped', { timeout: 10_000 })
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
})

test('AC6: a closed card is deleted without asking and not counted as running', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await back()
  await newCard('Backlog', 'sh')
  await back()

  await menuClose('api')
  await confirmClose()
  await expect(status('api')).toHaveText('Stopped')

  const row = page.locator('.workspace-row').first()
  await row.hover()
  await row.getByTestId('workspace-delete').click()
  await expect(page.getByTestId('confirm-dialog').locator('.modal-message')).toHaveText(
    'Delete "alpha"? This removes its board. 1 terminal is still running and will be stopped.'
  )
  await page.getByTestId('confirm-cancel').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)

  await openMenu('api')
  await page.getByTestId('card-menu-delete').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect(card('api')).toHaveCount(0)
  await expect(card('sh')).toHaveCount(1)
})
