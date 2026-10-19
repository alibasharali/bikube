import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  backToBoard,
  belowSeparator,
  checkOnBoard,
  expectCardOpen,
  expectStatusOnBoard
} from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'
import {
  claudeLogLines,
  fakeClaudeHome,
  SETTINGS_ARGS,
  claudeFirstLine,
  claudeResumeLine,
  LOCAL_CLAUDE_SETTINGS
} from './fake-claude'
import { CLAUDE_INSTRUCTION } from '../src/core/claude-hooks'

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
  // Below any output kept from the card's last run (#46 D5).
  const shown = async (): Promise<string[]> => belowSeparator(await bufferLines())
  await expect.poll(async () => (await shown()).some((l) => l !== '')).toBe(true)
  await page.waitForTimeout(500)
  return (await shown()).filter((l) => l !== '')
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

/** Waits for the board after the open card's shell exited: it is Stopped (#5 D6). */
/** A click on the board's empty space, below its columns: focus leaves any form. */
async function clickBoardBackground(): Promise<void> {
  const box = (await page.getByTestId('board').boundingBox())!
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 20)
}

async function stoppedToBoard(title: string): Promise<void> {
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(card(title).getByTestId('card-status-line')).toHaveCount(0)
}

test('AC1: a new workspace presets Claude Code for new cards; Shell is no card choice', async () => {
  // Plain shells are the workspace's shells (e2e/shells.spec.ts); a card is an agent session.
  await page.getByTestId('workspace-add').click()
  await expect(selected(page.getByTestId('workspace-startup'))).toHaveText('Claude Code')
  await expect(page.getByTestId('workspace-startup').locator('option')).not.toContainText(['Shell'])
  await page.getByTestId('workspace-directory').fill(makeDir('alpha'))
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await column('Backlog').getByTestId('new-card').click()
  await expect(selected(page.getByTestId('new-card-startup'))).toHaveText('Claude Code')
  const choices = await page.getByTestId('new-card-startup').locator('option').allTextContents()
  expect(choices).not.toContain('Shell')
  await page.getByTestId('new-card-input').press('Escape')
  expect(logLines()).toEqual([])
})

/** Creates `agent` with Claude Code and returns its agent session id, read from the log. */
async function claudeAgent(dir: string): Promise<string> {
  await createWorkspace(dir, 'alpha')
  await newCard('agent', 'Claude Code')
  await expect.poll(logLines).toHaveLength(1)
  const [line] = logLines()
  expect(line.startsWith(`${SETTINGS_ARGS} --session-id `)).toBe(true)
  return line.slice(`${SETTINGS_ARGS} --session-id `.length)
}

/** Quits the fake claude with Enter, then exits the shell: the card is Stopped (AC3). */
async function stopAgent(dir: string): Promise<void> {
  await page.keyboard.press('Enter')
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
  await expectStatusOnBoard(page, 'agent', 'Running')
  await run('exit')
  await stoppedToBoard('agent')
}

test('AC2: a Claude Code card runs claude with a new session id and shows the Claude tag', async () => {
  const u = await claudeAgent(makeDir('alpha'))
  expect(u).toMatch(UUID_V4)
  await expect
    .poll(async () => (await bufferLines()).some((l) => l.endsWith(claudeFirstLine(u))))
    .toBe(true)
  await expect.poll(bufferLines).toContain(`fake-claude ${SETTINGS_ARGS} --session-id ${u}`)
  expect(logLines().at(-1)).toBe(`${SETTINGS_ARGS} --session-id ${u}`)
  await back()
  await expect(card('agent').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('agent').getByTestId('card-tag')).toHaveText('Claude')
})

test('AC3/AC4: claude quits to a shell; exit stops the card; opening it resumes', async () => {
  const dir = makeDir('alpha')
  const u = await claudeAgent(dir)
  await expect.poll(bufferLines).toContain(`fake-claude ${SETTINGS_ARGS} --session-id ${u}`)
  await stopAgent(dir)

  await openCard('agent')
  const resume = claudeResumeLine(u)
  await expect
    .poll(async () => belowSeparator(await bufferLines()))
    .toContain(`fake-claude ${SETTINGS_ARGS} --resume ${u}`)
  // A new screen below the kept output (#46 D5): the resume was typed, none of the first run's
  // output is there.
  const lines = belowSeparator(await bufferLines())
  expect(lines.some((l) => l.endsWith(resume))).toBe(true)
  expect(lines).not.toContain(`fake-claude ${SETTINGS_ARGS} --session-id ${u}`)
  expect(lines).not.toContain(dir)
  expect(logLines().at(-1)).toBe(`${SETTINGS_ARGS} --resume ${u}`)
  await expectStatusOnBoard(page, 'agent', 'Running')
  // It ran in the card's directory: quit claude and ask the shell.
  await page.keyboard.press('Enter')
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
})

test('AC5: with nothing to resume, claude starts fresh with the same session id', async () => {
  const dir = makeDir('alpha')
  const u = await claudeAgent(dir)
  await expect.poll(bufferLines).toContain(`fake-claude ${SETTINGS_ARGS} --session-id ${u}`)
  await stopAgent(dir)
  appendFileSync(join(home, '.bash_profile'), 'export FAKE_CLAUDE_RESUME_FAILS=1\n')

  await openCard('agent')
  await expect
    .poll(() => logLines().slice(-2))
    .toEqual([`${SETTINGS_ARGS} --resume ${u}`, `${SETTINGS_ARGS} --session-id ${u}`])
  await expect.poll(bufferLines).toContain(`fake-claude ${SETTINGS_ARGS} --session-id ${u}`)
  // Still running: nothing after its output, no prompt yet.
  await page.waitForTimeout(500)
  const lines = (await bufferLines()).filter((l) => l !== '')
  expect(lines.at(-1)).toBe(`fake-claude ${SETTINGS_ARGS} --session-id ${u}`)
  await back()
  await expect(card('agent').getByTestId('card-status-label')).toHaveText('Running')
})

type HookSettings = { hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]> }

/** The settings file a local card's `claude` got (#31 D14), parsed. */
function claudeSettingsFile(): HookSettings {
  return JSON.parse(readFileSync(LOCAL_CLAUDE_SETTINGS, 'utf8')) as HookSettings
}

test('#31 AC12: claude gets the settings file with the hooks, first start and resume', async () => {
  const dir = makeDir('alpha')
  const u = await claudeAgent(dir)
  expect(logLines()).toEqual([`--settings ${LOCAL_CLAUDE_SETTINGS} --session-id ${u}`])
  expect(Object.keys(claudeSettingsFile().hooks).sort()).toEqual(
    ['Notification', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort()
  )
  await stopAgent(dir)
  await openCard('agent')
  await expect.poll(logLines).toHaveLength(2)
  expect(logLines().at(-1)).toBe(`--settings ${LOCAL_CLAUDE_SETTINGS} --resume ${u}`)
})

test("#31 AC13: each hook command sets the card's pill, exits 0, also with Drovr unreachable", async () => {
  const dir = makeDir('alpha')
  await claudeAgent(dir)
  // Quit the fake claude: its shell runs the hooks as Claude Code would, with its environment.
  await page.keyboard.press('Enter')
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)

  const hooks = claudeSettingsFile().hooks
  const base = { session_id: 's', transcript_path: '/t', cwd: dir }
  const tool = (name: string): object => ({
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: name,
    tool_input: name === 'Bash' ? { command: 'ls' } : { questions: [{ question: 'Which?' }] }
  })
  const steps: [string, object, string | null][] = [
    ['UserPromptSubmit', { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'hi' }, 'Working'],
    ['Stop', { ...base, hook_event_name: 'Stop', stop_hook_active: false }, 'Waiting for you'],
    ['PreToolUse', tool('Bash'), 'Working'],
    ['PreToolUse', tool('AskUserQuestion'), 'Needs your answer'],
    ['Stop', { ...base, hook_event_name: 'Stop', stop_hook_active: false }, 'Waiting for you'],
    [
      'Notification',
      {
        ...base,
        hook_event_name: 'Notification',
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission to use Bash'
      },
      'Needs your answer'
    ],
    ['SessionStart', { ...base, hook_event_name: 'SessionStart', source: 'startup' }, null]
  ]
  steps.forEach(([event, input], i) => {
    writeFileSync(join(root, `hook-${i}.sh`), hooks[event][0].hooks[0].command)
    writeFileSync(join(root, `input-${i}.json`), JSON.stringify(input))
  })
  const hook = (i: number, prefix = ''): string =>
    `${prefix}sh ${join(root, `hook-${i}.sh`)} < ${join(root, `input-${i}.json`)}`
  const pill = async (text: string): Promise<void> =>
    checkOnBoard(page, 'agent', (agent) =>
      expect(agent.getByTestId('card-activity')).toHaveText(text)
    )

  for (const [i, [, , text]] of steps.entries()) {
    await run(`${hook(i)}; echo "hook${i}=$?"`)
    await expect.poll(bufferLines).toContain(`hook${i}=0`)
    if (text) await pill(text)
  }
  // SessionStart printed the instruction (D16), and nothing else printed a thing.
  const lines = await bufferLines()
  expect(lines).toContain(CLAUDE_INSTRUCTION)
  for (let i = 0; i < steps.length - 1; i++) {
    expect(lines[lines.findIndex((l) => l.endsWith(`echo "hook${i}=$?"`)) + 1]).toBe(`hook${i}=0`)
  }

  // Drovr unreachable: every command still exits 0, silently, and the pill stays.
  for (const i of steps.keys()) {
    await run(`${hook(i, `DROVR_SOCKET=${join(root, 'dead.sock')} `)}; echo "dead${i}=$?"`)
    await expect.poll(bufferLines).toContain(`dead${i}=0`)
  }
  await pill('Needs your answer')
})

test('AC7: a Custom card runs its command on every start; an empty command is refused', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')

  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('empty')
  await page.getByTestId('new-card-startup').selectOption({ label: 'Custom…' })
  await page.getByTestId('new-card-command').fill('')
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

/** The open card's raw buffer rows, unjoined: each row's text and whether it continues a wrap. */
function rawRows(): Promise<{ text: string; wrapped: boolean }[]> {
  return page.evaluate(() => {
    type Line = { isWrapped: boolean; translateToString(trim: boolean): string }
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: { buffer: { active: { length: number; getLine(i: number): Line | undefined } } }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const rows: { text: string; wrapped: boolean }[] = []
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      rows.push({ text: line?.translateToString(true) ?? '', wrapped: line?.isWrapped ?? false })
    }
    return rows
  })
}

/** The open card's xterm size. */
function viewSize(): Promise<{ cols: number; rows: number } | undefined> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      (HTMLElement & { __xterm?: { cols: number; rows: number } }) | null
    const term = host?.__xterm
    return term && { cols: term.cols, rows: term.rows }
  })
}

test("#22 AC3: a startup line longer than 80 columns is typed at the open view's size", async () => {
  // A known prompt, so the line's length doesn't depend on the user, host or directory.
  appendFileSync(join(home, '.bash_profile'), "PS1='drovr> '\n")
  // The shell records its PTY's size as it starts, before anything could resize it (D1).
  const shell = join(root, 'sized-bash')
  const sizeLog = join(root, 'pty-size')
  writeFileSync(shell, `#!/bin/sh\nstty size > '${sizeLog}'\nexec /bin/bash "$@"\n`)
  chmodSync(shell, 0o755)
  await createWorkspace(makeDir('alpha'), 'alpha')
  // The side panel (#55) narrows the open view: hide it (from the Default shell, before the
  // sized shell is set), so the view is as wide as this line needs.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+T' : 'Control+Shift+T')
  await expect(page.getByTestId('card-view')).toBeVisible()
  await page.getByTestId('titlebar-panel').click()
  await expect(page.getByTestId('side-panel')).toHaveCount(0)
  await backToBoard(page)
  await app.evaluate((_, path) => {
    process.env.SHELL = path
  }, shell)
  // Longer than 80 columns with the prompt, short enough for the open view (about 103).
  const word = 'drovr-long-startup-line-'.padEnd(70, 'x')
  const command = `tput cols; echo ${word}`
  await newCard('long', 'Custom…', command)
  await expect.poll(bufferLines).toContain(word)
  const size = await viewSize()
  // Wide enough for the prompt and the command on one row (more than 80 columns).
  expect(size?.cols).toBeGreaterThan(`drovr> ${command}`.length)
  // The shell's PTY has the open view's columns, and had them from the start.
  const lines = await settledScreen()
  expect(lines[lines.indexOf(word) - 1]).toBe(String(size?.cols))
  expect(readFileSync(sizeLog, 'utf8').trim()).toBe(`${size?.rows} ${size?.cols}`)
  // The typed command sits on one unwrapped row, right after the prompt, and nothing wraps
  // onto the next row.
  const rows = await rawRows()
  const at = rows.findIndex((r) => r.text === `drovr> ${command}`)
  expect(at, rows.map((r) => r.text).join('\n')).toBeGreaterThanOrEqual(0)
  expect(rows[at].text.length).toBeGreaterThan(80)
  expect(rows[at].wrapped).toBe(false)
  expect(rows[at + 1].wrapped).toBe(false)
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
  await expect(selected(page.getByTestId('workspace-startup'))).toHaveText('Claude Code')
  await expect(page.getByTestId('workspace-command')).toHaveCount(0)
  await page.getByTestId('workspace-cancel').click()

  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  await newCard('sh')
  const fresh = await settledScreen()
  await back()

  await editWorkspace(0)
  await expect(selected(page.getByTestId('workspace-startup'))).toHaveText('Custom…')
  await page.getByTestId('workspace-startup').selectOption({ label: 'Claude Code' })
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  await column('Backlog').getByTestId('new-card').click()
  await expect(selected(page.getByTestId('new-card-startup'))).toHaveText('Claude Code')
  await page.getByTestId('new-card-input').press('Escape')
  await expect(card('sh').getByTestId('card-tag')).toHaveText('Custom')

  await openCard('sh')
  await run('exit')
  await stoppedToBoard('sh')
  await openCard('sh')
  await expectStatusOnBoard(page, 'sh', 'Running')
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
  startup: 'Claude Code' | 'Codex' | 'Custom…',
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
  // The fake claude of this start: kept output (#46) above can hold an earlier start's.
  await expect
    .poll(async () => {
      const lines = await bufferLines()
      const typed = lines.findLastIndex((l) => l.endsWith(expected))
      return lines.slice(typed + 1).some((l) => l.startsWith('fake-claude'))
    })
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
  await setStartup('sh', 'Claude Code', { save: false, current: 'Custom…' })
  await expect(card('sh').getByTestId('card-tag')).toHaveText('Custom')

  await setStartup('sh', 'Claude Code', { current: 'Custom…' })
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
  const u = logLines()[0].slice(`${SETTINGS_ARGS} --session-id `.length)
  expect(u).toMatch(UUID_V4)
  // The fake claude's own row: a redraw of the typed row can leave characters after it, never
  // before (#23 D1).
  await expect
    .poll(async () =>
      (await bufferLines()).some((l) =>
        l.startsWith(`fake-claude ${SETTINGS_ARGS} --session-id ${u}`)
      )
    )
    .toBe(true)
  await page.keyboard.press('Enter')
  await run('exit')
  await stoppedToBoard('sh')

  // Away to another agent and back: the same conversation resumes.
  await setStartup('sh', 'Codex', { current: 'Claude Code' })
  await expect(card('sh').getByTestId('card-tag')).toHaveText('Codex')
  await openCard('sh')
  const shell = await settledScreen()
  expect(shell.join('\n')).not.toContain('claude')
  await run('exit')
  await stoppedToBoard('sh')
  await setStartup('sh', 'Claude Code', { current: 'Codex' })
  await restartAndStop(dir, claudeResumeLine(u))
  expect(logLines()).toEqual([
    `${SETTINGS_ARGS} --session-id ${u}`,
    `${SETTINGS_ARGS} --resume ${u}`
  ])
})

test('AC9/D2: a Custom command set from the menu is required and shown in the tag', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('sh')
  await back()
  await card('sh').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-startup').click()
  const dialog = page.getByTestId('startup-dialog')
  await dialog.getByTestId('startup-dialog-startup').selectOption({ label: 'Custom…' })
  await dialog.getByTestId('startup-dialog-command').fill('')
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
  await clickBoardBackground()
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
  await page.keyboard.type(' && echo changed')
  await clickBoardBackground()
  await expect(form).toHaveCount(1)
  await page.getByTestId('new-card-startup').press('Escape')
  await expect(form).toHaveCount(0)
  await expect(page.getByTestId('card')).toHaveCount(0)

  // Enter in the title creates with the chosen command.
  await newCard('agent', 'Claude Code')
  await expect.poll(logLines).toHaveLength(1)
})

test('D9: Enter in the select creates the card once the type is picked', async () => {
  await createWorkspace(makeDir('alpha'), 'alpha')
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('picked')
  // Title first, then the type: the focus is on the select when Enter is pressed.
  const select = page.getByTestId('new-card-startup')
  await select.selectOption({ label: 'Claude Code' })
  await select.press('Enter')
  await expectCardOpen(page, 'picked')
  await expect.poll(logLines).toHaveLength(1)
})
