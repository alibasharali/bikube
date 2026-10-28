import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeLogLines, fakeClaudeHome, SETTINGS_ARGS, claudeResumeLine } from './fake-claude'
import { backToBoard, expectCardOpen, expectStatusOnBoard } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Persistence (#8): the board survives a restart. Each test launches with its own data directory
// and "restarts" by closing the app and launching it again with the same one (spec: AC intro).
// Electron runs with the fake `claude` home of #5, and a login shell that logs every start.

let app: ElectronApplication | undefined
let page: Page
let root: string
let dataDir: string
let env: Record<string, string>
let claudeLog: string
let shellLog: string

/** A login shell that appends a line to $BIKUBE_SHELL_LOG on every start, then runs bash. */
const LOGGING_SHELL = `#!/bin/bash
echo started >> "$BIKUBE_SHELL_LOG"
exec /bin/bash "$@"
`

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-persist-'))
  const fake = fakeClaudeHome(root)
  claudeLog = fake.log
  shellLog = join(root, 'shells.log')
  const shell = join(root, 'logging-shell')
  writeFileSync(shell, LOGGING_SHELL)
  chmodSync(shell, 0o755)
  env = { ...fake.env, SHELL: shell, BIKUBE_SHELL_LOG: shellLog }
  dataDir = newDataDir()
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

async function launch(): Promise<void> {
  ;({ app, page } = await launchApp({ dataDir, env }))
}

/** Quits the app (Cmd+Q path: pending state is flushed) and launches it on the same data. */
async function restart(): Promise<void> {
  await app?.close()
  await launch()
}

const shellStarts = (): number =>
  existsSync(shellLog) ? readFileSync(shellLog, 'utf8').split('\n').filter(Boolean).length : 0

async function createWorkspace(dir: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

async function selectWorkspace(name: string): Promise<void> {
  await page.getByTestId('workspace-item').filter({ hasText: name }).click()
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

/** Opens the edit dialog of the workspace row at `index`; Edit and Delete are on its board's toolbar. */
async function workspaceAction(
  index: number,
  action: 'workspace-edit' | 'workspace-delete'
): Promise<void> {
  const row = page.locator('.workspace-row').nth(index)
  await row.getByTestId('workspace-item').click()
  await row.page().getByTestId(action).click()
}

function column(name: string): Locator {
  return page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
}

const columnNames = (): Promise<string[]> => page.getByTestId('column-name').allTextContents()

async function columnAction(name: string, action: string): Promise<void> {
  await column(name).getByTestId('column-menu').click()
  await page.getByTestId(action).click()
}

async function renameColumn(from: string, to: string): Promise<void> {
  await columnAction(from, 'menu-rename')
  await page.getByTestId('column-rename-input').fill(to)
  await page.getByTestId('column-rename-input').press('Enter')
  await expect(column(to)).toHaveCount(1)
}

function card(title: string): Locator {
  return page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })
}

const titles = (columnName: string): Locator => column(columnName).getByTestId('card-title')

const status = (title: string): Locator => card(title).getByTestId('card-status-label')

/** The selected option's label in a startup command select. */
const selected = (select: Locator): Locator => select.locator('option:checked')

/** Creates a card through `+ New card` (its view opens on it), then goes back to the board. */
async function newCard(
  columnName: string,
  title: string,
  startup?: { label: 'Shell' | 'Claude Code' | 'Custom…'; command?: string }
): Promise<void> {
  await column(columnName).getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  if (startup) await page.getByTestId('new-card-startup').selectOption({ label: startup.label })
  if (startup?.command !== undefined) {
    await page.getByTestId('new-card-command').fill(startup.command)
    await page.getByTestId('new-card-command').press('Enter')
  } else {
    await page.getByTestId('new-card-input').press('Enter')
  }
  await expect(page.getByTestId('card-view')).toBeVisible()
  if (title) await expectCardOpen(page, title)
  await back()
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

async function back(): Promise<void> {
  await backToBoard(page)
  await expect(page.getByTestId('board')).toBeVisible()
}

async function cardAction(title: string, action: string): Promise<void> {
  await card(title).getByTestId('card-menu').click()
  await page.getByTestId(action).click()
}

/** The open card's terminal buffer, one trimmed string per line, wrapped rows joined back. */
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

/** Types a command into the open card's terminal and presses Enter. */
async function run(command: string): Promise<void> {
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

test('AC1: workspaces, columns and card order survive a restart', async () => {
  await launch()
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 800))
  await createWorkspace(makeDir('alpha'), 'alpha')
  await renameColumn('Backlog', 'Todo')
  await renameColumn('In Progress', 'Doing')
  await columnAction('Done', 'menu-move-left')
  await columnAction('Review', 'menu-delete')
  await expect.poll(columnNames).toEqual(['Todo', 'Doing', 'Done'])
  await newCard('Doing', 'api')
  await newCard('Todo', 'web')
  await newCard('Todo', 'db')
  // Drop `web` on the bottom half of `api`: below it in Doing (#6 D5).
  const from = await card('web').getByTestId('card-open').boundingBox()
  const to = await card('api').boundingBox()
  if (!from || !to) throw new Error('nothing to drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 5, from.y + from.height / 2 + 5, { steps: 3 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.75, { steps: 10 })
  await page.mouse.up()
  await expect(titles('Doing')).toHaveText(['api', 'web'])
  await createWorkspace(makeDir('beta'), 'beta')
  await expect(page.getByTestId('board-title')).toHaveText('beta')

  await restart()

  const items = page.getByTestId('workspace-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('alpha')
  await expect(items.nth(1)).toContainText('beta')
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(page.getByTestId('board-title')).toHaveText('beta')
  await selectWorkspace('alpha')
  await expect.poll(columnNames).toEqual(['Todo', 'Doing', 'Done'])
  await expect(titles('Todo')).toHaveText(['db'])
  await expect(titles('Doing')).toHaveText(['api', 'web'])
  await expect(titles('Done')).toHaveCount(0)
})

test('#32 AC8: the order of workspaces moved in the sidebar survives a restart', async () => {
  await launch()
  for (const name of ['alpha', 'beta', 'gamma']) await createWorkspace(makeDir(name), name)
  await selectWorkspace('alpha')
  // Drop `gamma` on the top half of `alpha` (#32 D4).
  const from = await page.getByTestId('workspace-item').filter({ hasText: 'gamma' }).boundingBox()
  const to = await page.getByTestId('workspace-item').filter({ hasText: 'alpha' }).boundingBox()
  if (!from || !to) throw new Error('nothing to drag')
  await page.mouse.move(from.x + from.width / 3, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 3 + 5, from.y + from.height / 2 + 5, { steps: 3 })
  await page.mouse.move(to.x + to.width / 3, to.y + to.height * 0.25, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('.workspace-name')).toHaveText(['gamma', 'alpha', 'beta'])

  await restart()

  await expect(page.locator('.workspace-name')).toHaveText(['gamma', 'alpha', 'beta'])
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
})

test('#59 AC3: a workspace logo survives a restart and is in the state file', async () => {
  await launch()
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(makeDir('alpha'))
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-logo-rocket').check()
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await createWorkspace(makeDir('beta'), 'beta')
  // A function, not a locator: `restart` gives a new page.
  const badges = (): Locator => page.getByTestId('workspace-badge')
  await expect(badges().nth(0)).toHaveAttribute('data-logo', 'rocket')

  await restart()

  await expect(badges().nth(0)).toHaveAttribute('data-logo', 'rocket')
  await expect(badges().nth(0).locator('svg')).toBeVisible()
  await expect(badges().nth(1)).not.toHaveAttribute('data-logo')
  await expect(badges().nth(1)).toHaveText('B')
  const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
  const [alpha, beta] = saved.state.workspaces
  expect(alpha.logo).toBe('rocket')
  expect(beta).not.toHaveProperty('logo')
})

test('AC2: titles, directories and startup commands survive a restart', async () => {
  await launch()
  const alpha = makeDir('alpha')
  const beta = makeDir('beta')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'older')
  await cardAction('older', 'card-menu-rename')
  await page.getByTestId('card-rename-input').fill('server')
  await page.getByTestId('card-rename-input').press('Enter')
  await expect(card('server')).toHaveCount(1)
  await newCard('Backlog', 'dev', { label: 'Custom…', command: 'npm run dev' })
  await workspaceAction(0, 'workspace-edit')
  await page.getByTestId('workspace-directory').fill(beta)
  await page.getByTestId('workspace-startup').selectOption({ label: 'Claude Code' })
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  await restart()

  await expect(page.getByTestId('card-title')).toHaveText(['server', 'dev'])
  await cardAction('dev', 'card-menu-startup')
  const dialog = page.getByTestId('startup-dialog')
  await expect(selected(dialog.getByTestId('startup-dialog-startup'))).toHaveText('Custom…')
  await expect(dialog.getByTestId('startup-dialog-command')).toHaveValue('npm run dev')
  await dialog.getByTestId('startup-dialog-cancel').click()
  await expect(dialog).toHaveCount(0)

  await workspaceAction(0, 'workspace-edit')
  await expect(page.getByTestId('workspace-directory')).toHaveValue(beta)
  await expect(selected(page.getByTestId('workspace-startup'))).toHaveText('Claude Code')
  await page.getByTestId('workspace-cancel').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  await openCard('server')
  await run('pwd')
  await expect.poll(bufferLines).toContain(alpha)
})

test('AC3: restored cards are Stopped, start nothing and get Stopped actions', async () => {
  await launch()
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await newCard('Backlog', 'old')
  await openCard('old')
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(status('old')).toHaveText('Stopped')
  await expect(status('api')).toHaveText('Running')
  const before = shellStarts()
  expect(before).toBe(2)

  await restart()

  await expect(status('api')).toHaveText('Stopped')
  await expect(status('old')).toHaveText('Stopped')
  await expect(card('api').getByTestId('card-status-line')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(shellStarts()).toBe(before)

  for (const title of ['api', 'old']) {
    await card(title).getByTestId('card-menu').click()
    await expect(page.getByTestId('card-menu-delete')).toBeVisible()
    await expect(page.getByTestId('card-menu-close')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('card-menu-delete')).toHaveCount(0)
  }

  await cardAction('api', 'card-menu-delete')
  await expect(card('api')).toHaveCount(0)
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)

  await workspaceAction(0, 'workspace-delete')
  await expect(page.getByTestId('confirm-dialog').locator('.modal-message')).toHaveText(
    'Delete "alpha"? This removes its board.'
  )
  expect(shellStarts()).toBe(before)
})

test('AC4: opening restored cards starts them; Claude Code resumes its session', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'sh')
  await newCard('Backlog', 'agent', { label: 'Claude Code' })
  await expect.poll(() => claudeLogLines(claudeLog)).toHaveLength(1)
  const [first] = claudeLogLines(claudeLog)
  expect(first.startsWith(`${SETTINGS_ARGS} --session-id `)).toBe(true)
  const u = first.slice(`${SETTINGS_ARGS} --session-id `.length)
  // A message sent: the fake reports its session, as the hook does, so there is one to resume.
  await openCard('agent')
  await expect.poll(bufferLines).toContain(`fake-claude ${SETTINGS_ARGS} --session-id ${u}`)
  await page.keyboard.press('Enter')
  await run('pwd')
  await expect.poll(bufferLines).toContain(alpha)
  await back()

  await restart()

  await openCard('sh')
  await expectStatusOnBoard(page, 'sh', 'Running')
  await run('pwd')
  await expect.poll(bufferLines).toContain(alpha)
  await back()

  await openCard('agent')
  await expect.poll(bufferLines).toContain(`fake-claude ${SETTINGS_ARGS} --resume ${u}`)
  expect(claudeLogLines(claudeLog).at(-1)).toBe(`${SETTINGS_ARGS} --resume ${u}`)
  // The typed line, from the shell's history: its echo on screen can be garbled when bash's
  // readline wraps it at the width the PTY had before the view was fitted.
  await page.keyboard.press('Enter')
  await run('fc -ln -1')
  // After the screen clear typed before it (`typedStartLine`).
  await expect
    .poll(async () => (await bufferLines()).some((l) => l.endsWith(claudeResumeLine(u))))
    .toBe(true)
})

test('AC5: default titles continue and new items work alongside restored ones', async () => {
  await launch()
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', '')
  await newCard('Backlog', '')
  await expect(titles('Backlog')).toHaveText(['Terminal 1', 'Terminal 2'])

  await restart()

  await newCard('Backlog', '')
  await expect(titles('Backlog')).toHaveText(['Terminal 1', 'Terminal 2', 'Terminal 3'])

  // New and restored cards rename, move and delete side by side.
  await cardAction('Terminal 1', 'card-menu-rename')
  await page.getByTestId('card-rename-input').fill('one')
  await page.getByTestId('card-rename-input').press('Enter')
  await cardAction('Terminal 3', 'card-menu-rename')
  await page.getByTestId('card-rename-input').fill('three')
  await page.getByTestId('card-rename-input').press('Enter')
  await card('three').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-move-to').getByText('In Progress', { exact: true }).click()
  await card('Terminal 2').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-move-to').getByText('In Progress', { exact: true }).click()
  await expect(titles('Backlog')).toHaveText(['one'])
  await expect(titles('In Progress')).toHaveText(['three', 'Terminal 2'])
  await cardAction('one', 'card-menu-delete')
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect(titles('Backlog')).toHaveCount(0)

  // A new column and a new workspace, each with cards, next to the restored board.
  await page.getByTestId('add-column').click()
  await page.getByTestId('add-column-input').fill('Later')
  await page.getByTestId('add-column-input').press('Enter')
  await newCard('Later', 'later')
  await createWorkspace(makeDir('beta'), 'beta')
  await newCard('Backlog', '')
  await expect(titles('Backlog')).toHaveText(['Terminal 1'])
  await selectWorkspace('alpha')
  await expect(titles('In Progress')).toHaveText(['three', 'Terminal 2'])
  await expect(titles('Later')).toHaveText(['later'])

  await restart()

  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await expect.poll(columnNames).toEqual(['Backlog', 'In Progress', 'Review', 'Done', 'Later'])
  await expect(titles('In Progress')).toHaveText(['three', 'Terminal 2'])
  await expect(titles('Later')).toHaveText(['later'])
  await selectWorkspace('beta')
  await expect(titles('Backlog')).toHaveText(['Terminal 1'])
})

test('AC6: the board is saved without a clean quit', async () => {
  await launch()
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await page.waitForTimeout(1000)
  app!.process().kill('SIGKILL')
  await expect.poll(() => app!.process().exitCode !== null || app!.process().killed).toBe(true)
  app = undefined

  await launch()

  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await expect(card('api')).toHaveCount(1)
  await expect(status('api')).toHaveText('Stopped')
})

for (const [name, contents] of [
  ['not JSON', '{not json'],
  ['another version', '{"version": 2, "state": {}}']
] as const) {
  test(`AC7: an unreadable file (${name}) is moved aside and the app starts empty`, async () => {
    writeFileSync(join(dataDir, 'bikube-state.json'), contents)

    await launch()

    await expect(page.getByTestId('empty-state')).toBeVisible()
    await expect(page.getByTestId('workspace-item')).toHaveCount(0)
    const corrupt = readdirSync(dataDir).filter((f) => /^bikube-state\.corrupt-.*\.json$/.test(f))
    expect(corrupt).toHaveLength(1)
    expect(readFileSync(join(dataDir, corrupt[0]), 'utf8')).toBe(contents)

    await createWorkspace(makeDir('alpha'), 'alpha')
    await expect
      .poll(() => {
        try {
          const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
          return saved.version === 1
            ? saved.state.workspaces.map((w: { name: string }) => w.name)
            : []
        } catch {
          return []
        }
      })
      .toEqual(['alpha'])
  })
}

test('AC8: the app opens on the board, not the card that was open', async () => {
  await launch()
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('Backlog', 'api')
  await openCard('api')
  await expect(page.getByTestId('card-view')).toBeVisible()

  await restart()

  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await expect(status('api')).toHaveText('Stopped')
})

test('#31 AC18: after a restart no workspace comes back to the card open in it', async () => {
  await launch()
  await createWorkspace(makeDir('alpha'), 'alpha')
  await createWorkspace(makeDir('beta'), 'beta')
  await selectWorkspace('alpha')
  await newCard('Backlog', 'api')
  await openCard('api')
  // alpha remembers `api` while beta is active, until the app quits (#31 D19).
  await selectWorkspace('beta')

  await restart()

  await expect(page.getByTestId('board-title')).toHaveText('beta')
  await selectWorkspace('alpha')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(status('api')).toHaveText('Stopped')
})

/** The Electron binary (`require('electron')` gives its path outside Electron). */
const electronBinary = createRequire(__filename)('electron') as string

/** Launches the app outside Playwright on this test's data directory; resolves when it exits. */
function launchSecond(timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(electronBinary, ['.', '--no-sandbox'], {
      env: { ...env, BIKUBE_USER_DATA_DIR: dataDir },
      stdio: 'ignore'
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`second instance still running after ${timeoutMs} ms`))
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

const savedWorkspaceNames = (): string[] => {
  try {
    const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
    return saved.state.workspaces.map((w: { name: string }) => w.name)
  } catch {
    return []
  }
}

test('AC10: a second instance on the same data directory exits; the first keeps its board', async () => {
  await launch()
  await createWorkspace(makeDir('alpha'), 'alpha')
  await expect.poll(savedWorkspaceNames).toEqual(['alpha'])

  await launchSecond(10_000)

  expect(app!.process().exitCode).toBeNull()
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  expect(savedWorkspaceNames()).toEqual(['alpha'])
  await createWorkspace(makeDir('beta'), 'beta')
  await expect.poll(savedWorkspaceNames).toEqual(['alpha', 'beta'])
})

/** The main window's bounds, maximized and full-screen state, read from main. */
const mainWindowState = (): Promise<{
  bounds: { x: number; y: number; width: number; height: number }
  normal: { x: number; y: number; width: number; height: number }
  maximized: boolean
}> =>
  app!.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    return {
      bounds: window.getBounds(),
      normal: window.getNormalBounds(),
      maximized: window.isMaximized()
    }
  })

const savedWindow = (): unknown => {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'bikube-window.json'), 'utf8'))
  } catch {
    return null
  }
}

test('#66 AC9: the main window opens at the size and place it was left at', async () => {
  await launch()
  await app!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setBounds({ x: 60, y: 40, width: 900, height: 650 })
  )
  await expect
    .poll(async () => (await mainWindowState()).bounds)
    .toEqual({ x: 60, y: 40, width: 900, height: 650 })
  // Saved after a resize (debounced), before any quit.
  await expect.poll(savedWindow).toEqual({
    version: 1,
    bounds: { x: 60, y: 40, width: 900, height: 650 },
    maximized: false,
    fullScreen: false
  })

  await restart()

  expect((await mainWindowState()).bounds).toEqual({ x: 60, y: 40, width: 900, height: 650 })
  await expect(page.getByTestId('workspace-add')).toBeVisible()
})

test('#66 AC9: a window maximized at quit opens maximized, its normal size kept', async () => {
  writeFileSync(
    join(dataDir, 'bikube-window.json'),
    JSON.stringify({
      version: 1,
      bounds: { x: 60, y: 40, width: 900, height: 650 },
      maximized: true,
      fullScreen: false
    })
  )

  await launch()

  expect((await mainWindowState()).normal).toEqual({ x: 60, y: 40, width: 900, height: 650 })
  if (process.platform === 'darwin' && process.env['BIKUBE_E2E_SHOW'] !== '1') {
    // On macOS the tests' window is never shown, and maximizing would show it.
    test.info().annotations.push({ type: 'note', description: 'hidden window: not maximized' })
    return
  }
  if (!(await mainWindowState()).maximized) {
    // xvfb has no window manager, which maximizes nothing: then only the normal size is checked.
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize())
    await page.waitForTimeout(1_000)
    const canMaximize = (await mainWindowState()).maximized
    expect(canMaximize, 'the display maximizes, but the launch did not').toBe(false)
    test.info().annotations.push({ type: 'note', description: 'no window manager to maximize' })
    return
  }
  // Where a window manager maximizes, the state is saved as maximized again at quit.
  await app!.close()
  app = undefined
  expect(savedWindow()).toEqual({
    version: 1,
    bounds: { x: 60, y: 40, width: 900, height: 650 },
    maximized: true,
    fullScreen: false
  })
})

for (const [name, contents] of [
  [
    'bounds outside every display',
    JSON.stringify({
      version: 1,
      bounds: { x: 50_000, y: 50_000, width: 900, height: 650 },
      maximized: false,
      fullScreen: false
    })
  ],
  ['invalid JSON', '{"version": 1, "bounds": ']
] as const) {
  test(`#66 AC10: a window file with ${name} opens at 1100×720, centred`, async () => {
    writeFileSync(join(dataDir, 'bikube-window.json'), contents)

    await launch()

    const { bounds } = await mainWindowState()
    const area = await app!.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
    expect({ width: bounds.width, height: bounds.height }).toEqual({ width: 1100, height: 720 })
    // Centred, to a pixel of rounding.
    expect(Math.abs(bounds.x - (area.x + (area.width - 1100) / 2))).toBeLessThanOrEqual(1)
    expect(Math.abs(bounds.y - (area.y + (area.height - 720) / 2))).toBeLessThanOrEqual(1)
    await createWorkspace(makeDir('alpha'), 'alpha')
    await expect(page.getByTestId('board-title')).toHaveText('alpha')
  })
}
