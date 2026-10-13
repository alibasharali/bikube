import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, removeDataDirs } from './launch'
import { claudeLogLines, fakeClaudeHome } from './fake-claude'

// Startup commands (#5): choosing one at creation, the workspace default, changing a card's,
// and the Claude Code resume. Electron runs with SHELL=/bin/bash and HOME set to a temp
// directory whose .bash_profile puts a fake `claude` first on PATH (spec: test seams).

let app: ElectronApplication
let page: Page
let root: string
let home: string
let log: string

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-startup-'))
  const fake = fakeClaudeHome(root)
  home = fake.home
  log = fake.log
  ;({ app, page } = await launchApp({ env: fake.env }))
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
})

/** The fake claude's log, one line per run. */
const logLines = (): string[] => claudeLogLines(log)

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

/** The selected option's label in a startup command select. */
function selected(select: Locator): Locator {
  return select.locator('option:checked')
}

/** Creates a card through `+ New card` with the given startup choice; its view opens. */
async function newCard(
  title: string,
  startup?: 'Shell' | 'Claude Code' | 'Custom…',
  command?: string
): Promise<void> {
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  if (startup) await page.getByTestId('new-card-startup').selectOption({ label: startup })
  if (command !== undefined) {
    await page.getByTestId('new-card-command').fill(command)
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

/**
 * The open card's terminal buffer, one trimmed string per line; a line the terminal wrapped
 * is joined back, so a long typed command reads as one line.
 */
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
      // Keep a wrapped row's trailing spaces: they may be the space between two words.
      const text = line?.translateToString(!next?.isWrapped) ?? ''
      if (line?.isWrapped && rows.length > 0) rows[rows.length - 1] += text
      else rows.push(text)
    }
    return rows.map((r) => r.trim())
  })
}

/** The open card's buffer once the shell is idle: its non-blank lines. */
async function settledScreen(): Promise<string[]> {
  await expect.poll(async () => (await bufferLines()).some((l) => l !== '')).toBe(true)
  await page.waitForTimeout(500)
  return (await bufferLines()).filter((l) => l !== '')
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

const viewStatus = (): Locator => page.getByTestId('card-view').getByTestId('card-status-label')

/** Waits for the board after the open card's shell exited: it is Stopped (#5 D6). */
async function stoppedToBoard(title: string): Promise<void> {
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(card(title).getByTestId('card-status-line')).toHaveCount(0)
}

test('AC1: a new card is a Shell by default, nothing typed, no tag', async () => {
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  await column('Backlog').getByTestId('new-card').click()
  await expect(selected(page.getByTestId('new-card-startup'))).toHaveText('Shell')
  await page.getByTestId('new-card-input').fill('sh')
  await page.getByTestId('new-card-input').press('Enter')
  await expect(page.getByTestId('card-view-title')).toHaveText('sh')
  await expect(viewStatus()).toHaveText('Running')
  const screen = await settledScreen()
  expect(screen.join('\n')).not.toContain('claude')
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
  await back()
  await expect(card('sh').getByTestId('card-tag')).toHaveCount(0)
  expect(logLines()).toEqual([])
})

/** Creates `agent` with Claude Code and returns its agent session id, read from the log. */
async function claudeAgent(dir: string): Promise<string> {
  await createWorkspace(dir, 'alpha')
  await newCard('agent', 'Claude Code')
  await expect.poll(logLines).toHaveLength(1)
  const [line] = logLines()
  expect(line).toMatch(/^--session-id /)
  return line.slice('--session-id '.length)
}

/** Quits the fake claude with Enter, then exits the shell: the card is Stopped (AC3). */
async function stopAgent(dir: string): Promise<void> {
  await page.keyboard.press('Enter')
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
  await expect(viewStatus()).toHaveText('Running')
  await run('exit')
  await stoppedToBoard('agent')
}

test('AC2: a Claude Code card runs claude with a new session id and shows the Claude tag', async () => {
  const u = await claudeAgent(makeDir('alpha'))
  expect(u).toMatch(UUID_V4)
  await expect
    .poll(async () => (await bufferLines()).some((l) => l.endsWith(`claude --session-id ${u}`)))
    .toBe(true)
  await expect.poll(bufferLines).toContain(`fake-claude --session-id ${u}`)
  expect(logLines().at(-1)).toBe(`--session-id ${u}`)
  await expect(viewStatus()).toHaveText('Running')
  await back()
  await expect(card('agent').getByTestId('card-tag')).toHaveText('Claude')
})

test('AC3/AC4: claude quits to a shell; exit stops the card; opening it resumes', async () => {
  const dir = makeDir('alpha')
  const u = await claudeAgent(dir)
  await expect.poll(bufferLines).toContain(`fake-claude --session-id ${u}`)
  await stopAgent(dir)

  await openCard('agent')
  const resume = `claude --resume ${u} || claude --session-id ${u}`
  await expect.poll(bufferLines).toContain(`fake-claude --resume ${u}`)
  // A new screen: the resume was typed, none of the first run's output is left.
  const lines = await bufferLines()
  expect(lines.some((l) => l.endsWith(resume))).toBe(true)
  expect(lines).not.toContain(`fake-claude --session-id ${u}`)
  expect(lines).not.toContain(dir)
  expect(logLines().at(-1)).toBe(`--resume ${u}`)
  await expect(viewStatus()).toHaveText('Running')
  // It ran in the card's directory: quit claude and ask the shell.
  await page.keyboard.press('Enter')
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
})

test('AC5: with nothing to resume, claude starts fresh with the same session id', async () => {
  const dir = makeDir('alpha')
  const u = await claudeAgent(dir)
  await expect.poll(bufferLines).toContain(`fake-claude --session-id ${u}`)
  await stopAgent(dir)
  appendFileSync(join(home, '.bash_profile'), 'export FAKE_CLAUDE_RESUME_FAILS=1\n')

  await openCard('agent')
  await expect.poll(() => logLines().slice(-2)).toEqual([`--resume ${u}`, `--session-id ${u}`])
  await expect.poll(bufferLines).toContain(`fake-claude --session-id ${u}`)
  // Still running: nothing after its output, no prompt yet.
  await page.waitForTimeout(500)
  const lines = (await bufferLines()).filter((l) => l !== '')
  expect(lines.at(-1)).toBe(`fake-claude --session-id ${u}`)
  await expect(viewStatus()).toHaveText('Running')
})

test('AC7: a Custom card runs its command on every start; an empty command is refused', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')

  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('empty')
  await page.getByTestId('new-card-startup').selectOption({ label: 'Custom…' })
  await page.getByTestId('new-card-command').press('Enter')
  await expect(page.getByTestId('new-card-error-command')).toHaveText('Command is required')
  await page.getByTestId('new-card-input').press('Enter')
  await expect(page.getByTestId('new-card-error-command')).toHaveText('Command is required')
  await page.getByTestId('new-card-command').press('Escape')
  await expect(page.getByTestId('new-card-form')).toHaveCount(0)
  await expect(page.getByTestId('card')).toHaveCount(0)

  await newCard('c', 'Custom…', 'echo drovr-custom')
  await expect.poll(bufferLines).toContain('drovr-custom')
  await back()
  const tag = card('c').getByTestId('card-tag')
  await expect(tag).toHaveText('Custom')
  await expect(tag).toHaveAttribute('title', 'echo drovr-custom')

  await openCard('c')
  await run('exit')
  await stoppedToBoard('c')
  await openCard('c')
  await expect.poll(bufferLines).toContain('drovr-custom')
})

/** Opens the edit dialog of the workspace row at `index`; row actions show on hover. */
async function editWorkspace(index: number): Promise<void> {
  const row = page.locator('.workspace-row').nth(index)
  await row.hover()
  await row.getByTestId('workspace-edit').click()
  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
}

test('AC8: the workspace default presets new cards and never changes existing ones', async () => {
  await page.getByTestId('workspace-add').click()
  await expect(selected(page.getByTestId('workspace-startup'))).toHaveText('Shell')
  await expect(page.getByTestId('workspace-command')).toHaveCount(0)
  await page.getByTestId('workspace-cancel').click()

  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  await newCard('sh')
  const fresh = await settledScreen()
  await back()

  await editWorkspace(0)
  await expect(selected(page.getByTestId('workspace-startup'))).toHaveText('Shell')
  await page.getByTestId('workspace-startup').selectOption({ label: 'Claude Code' })
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  await column('Backlog').getByTestId('new-card').click()
  await expect(selected(page.getByTestId('new-card-startup'))).toHaveText('Claude Code')
  await page.getByTestId('new-card-input').press('Escape')
  await expect(card('sh').getByTestId('card-tag')).toHaveCount(0)

  await openCard('sh')
  await run('exit')
  await stoppedToBoard('sh')
  await openCard('sh')
  await expect(viewStatus()).toHaveText('Running')
  const screen = await settledScreen()
  expect(screen).toHaveLength(fresh.length)
  expect(screen.join('\n')).not.toContain('claude')
  expect(logLines()).toEqual([])

  // The edit dialog shows the stored default; a Custom default prefills new cards' Command.
  await back()
  await editWorkspace(0)
  await expect(selected(page.getByTestId('workspace-startup'))).toHaveText('Claude Code')
  await page.getByTestId('workspace-startup').selectOption({ label: 'Custom…' })
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-command')).toHaveText('Command is required')
  await page.getByTestId('workspace-command').fill('echo drovr-default')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await column('Backlog').getByTestId('new-card').click()
  await expect(selected(page.getByTestId('new-card-startup'))).toHaveText('Custom…')
  await expect(page.getByTestId('new-card-command')).toHaveValue('echo drovr-default')
})

/** Sets a card's startup command from its menu (#5 D11); `save: false` cancels instead. */
async function setStartup(
  title: string,
  startup: 'Shell' | 'Claude Code' | 'Custom…',
  { save = true, current }: { save?: boolean; current?: string } = {}
): Promise<void> {
  await card(title).getByTestId('card-menu').click()
  await page.getByTestId('card-menu-startup').click()
  const dialog = page.getByTestId('startup-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading')).toHaveText('Startup command')
  await expect(dialog).toContainText('Used the next time this card starts.')
  if (current)
    await expect(selected(dialog.getByTestId('startup-dialog-startup'))).toHaveText(current)
  await dialog.getByTestId('startup-dialog-startup').selectOption({ label: startup })
  await dialog.getByTestId(save ? 'startup-dialog-save' : 'startup-dialog-cancel').click()
  await expect(dialog).toHaveCount(0)
}

/**
 * Opens a Stopped `sh` that is set to Claude Code, waits for `expected` to be typed and claude
 * to run, quits it, checks the shell is in `dir` and exits.
 */
async function restartAndStop(dir: string, expected: string): Promise<void> {
  await openCard('sh')
  await expect.poll(async () => (await bufferLines()).some((l) => l.endsWith(expected))).toBe(true)
  await expect
    .poll(async () => (await bufferLines()).some((l) => l.startsWith('fake-claude')))
    .toBe(true)
  await page.keyboard.press('Enter')
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
  await run('exit')
  await stoppedToBoard('sh')
}

test("AC9: changing a card's command applies at its next start, keeping its session id", async () => {
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  await newCard('sh')
  const fresh = await settledScreen()
  await back()

  // Cancel changes nothing.
  await setStartup('sh', 'Claude Code', { save: false, current: 'Shell' })
  await expect(card('sh').getByTestId('card-tag')).toHaveCount(0)

  await setStartup('sh', 'Claude Code', { current: 'Shell' })
  await expect(card('sh').getByTestId('card-tag')).toHaveText('Claude')
  await expect(card('sh').getByTestId('card-status-label')).toHaveText('Running')
  // The running shell is untouched: nothing typed into it.
  await openCard('sh')
  const screen = await settledScreen()
  expect(screen).toHaveLength(fresh.length)
  expect(screen.join('\n')).not.toContain('claude')
  expect(logLines()).toEqual([])
  await run('exit')
  await stoppedToBoard('sh')

  await openCard('sh')
  await expect.poll(logLines).toHaveLength(1)
  const u = logLines()[0].slice('--session-id '.length)
  expect(u).toMatch(UUID_V4)
  await expect
    .poll(async () => (await bufferLines()).some((l) => l.endsWith(`claude --session-id ${u}`)))
    .toBe(true)
  await page.keyboard.press('Enter')
  await run('exit')
  await stoppedToBoard('sh')

  // Away to Shell and back: the same conversation resumes.
  await setStartup('sh', 'Shell', { current: 'Claude Code' })
  await expect(card('sh').getByTestId('card-tag')).toHaveCount(0)
  await openCard('sh')
  const shell = await settledScreen()
  expect(shell.join('\n')).not.toContain('claude')
  await run('exit')
  await stoppedToBoard('sh')
  await setStartup('sh', 'Claude Code', { current: 'Shell' })
  await restartAndStop(dir, `claude --resume ${u} || claude --session-id ${u}`)
  expect(logLines()).toEqual([`--session-id ${u}`, `--resume ${u}`])
})

test('AC9/D2: a Custom command set from the menu is required and shown in the tag', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('sh')
  await back()
  await card('sh').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-startup').click()
  const dialog = page.getByTestId('startup-dialog')
  await dialog.getByTestId('startup-dialog-startup').selectOption({ label: 'Custom…' })
  await dialog.getByTestId('startup-dialog-save').click()
  await expect(dialog.getByTestId('startup-dialog-error-command')).toHaveText('Command is required')
  await dialog.getByTestId('startup-dialog-command').fill('  echo drovr-menu  ')
  await dialog.getByTestId('startup-dialog-command').press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(card('sh').getByTestId('card-tag')).toHaveAttribute('title', 'echo drovr-menu')

  await card('sh').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-startup').click()
  await expect(selected(dialog.getByTestId('startup-dialog-startup'))).toHaveText('Custom…')
  await expect(dialog.getByTestId('startup-dialog-command')).toHaveValue('echo drovr-menu')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('D9: moving between the new-card fields keeps the form; leaving it unchanged cancels', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  const form = page.getByTestId('new-card-form')

  // Leaving with an empty title and the default command cancels (as #4 D4).
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('board-title').click()
  await expect(form).toHaveCount(0)

  // Tabbing between the title, select and command keeps the form open.
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-startup').selectOption({ label: 'Custom…' })
  await page.getByTestId('new-card-input').focus()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('new-card-startup')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('new-card-command')).toBeFocused()
  await expect(form).toHaveCount(1)
  // A changed command survives a click elsewhere; Esc from any field cancels.
  await page.getByTestId('board-title').click()
  await expect(form).toHaveCount(1)
  await page.getByTestId('new-card-startup').press('Escape')
  await expect(form).toHaveCount(0)
  await expect(page.getByTestId('card')).toHaveCount(0)

  // Enter in the title creates with the chosen command.
  await newCard('agent', 'Claude Code')
  await expect.poll(logLines).toHaveLength(1)
})
