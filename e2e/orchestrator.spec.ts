import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ORCHESTRATOR_FIRST_PROMPT } from '../src/core/orchestrator'
import { FIRST_PROMPT, ORCHESTRATED_FIRST_PROMPT } from '../src/core/startup-command'
import { orchestratorGuide } from '../src/core/orchestrator-guide'
import { backToBoard, cardView, expectCardOpen, splitRight } from './card-view'
import { agentLogLines, fakeAgentsHome, type FakeAgentsHome } from './fake-agents'
import { claudeLogLines, SETTINGS_ARGS } from './fake-claude'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The workspace's Orchestrator (#81 S2): the toolbar button, its shortcut and palette rows, its
// Claude Code start and resume with kept output, the Orchestrator agent setting, New
// conversation, and its signals (waiting, Split's Agents, the Agent tab); `board guide` (S3);
// `board start`, `open` and `terminal`, and an orchestrated card's first prompt (S4); `board send`,
// `wait` and `reply` (S5). The fake `claude` and
// agents run on the login PATH of a fake home, which is also BIKUBE_HOME_DIR.

const darwin = process.platform === 'darwin'
const OPEN_ORCHESTRATOR = darwin ? 'Alt+Meta+O' : 'Control+Alt+O'
const PALETTE = darwin ? 'Meta+K' : 'Control+Shift+P'
const NEXT_WAITING = darwin ? 'Meta+J' : 'Control+Shift+J'

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string
let repo: string
let fake: FakeAgentsHome

test.beforeEach(() => {
  dataDir = newDataDir()
  root = mkdtempSync(join(tmpdir(), 'bikube-orchestrator-'))
  repo = join(root, 'proj')
  mkdirSync(repo)
  fake = fakeAgentsHome(root)
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

async function launch(extra: Record<string, string> = {}): Promise<void> {
  ;({ app, page } = await launchApp({
    dataDir,
    env: { ...fake.env, BIKUBE_HOME_DIR: fake.home, ...extra }
  }))
}

async function createWorkspace(
  directory: string,
  name: string,
  startup?: 'Claude Code'
): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  if (startup) await page.getByTestId('workspace-startup').selectOption({ label: startup })
  await page.getByTestId('workspace-directory').fill(directory)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

const claudeLog = (): string[] => claudeLogLines(fake.log)

/** The saved state's first workspace's `orchestrator`, or undefined. */
function savedOrchestrator(): { agentSessionId: string; claudeStarted: boolean } | undefined {
  try {
    const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
    return saved.state.workspaces[0].orchestrator
  } catch {
    return undefined
  }
}

/** The open view's terminal buffer, one trimmed string per line, wrapped rows joined. */
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

/** Types a line into the focused terminal and presses Enter. */
async function run(line: string): Promise<void> {
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

const hasSeparator = async (): Promise<boolean> =>
  (await bufferLines()).some((l) => l.startsWith('── Previous output ·'))

/** The session id of the fake claude's last `--session-id` or `--resume` run. */
function lastSessionId(): string {
  const match = /--(?:session-id|resume) (\S+)$/.exec(claudeLog().at(-1) ?? '')
  return match?.[1] ?? ''
}

/** Opens the Orchestrator from the toolbar; the fake claude starts in it. */
async function openFromToolbar(): Promise<void> {
  await page.getByTestId('toolbar-orchestrator').click()
  await expectCardOpen(page, 'Orchestrator')
}

/** Ends the fake claude (a line sent: it reports its session) and then its shell. */
async function endClaudeAndShell(): Promise<void> {
  await run('hello')
  await expect.poll(() => savedOrchestrator()?.claudeStarted).toBe(true)
  await run('exit')
  await expect(cardView(page)).toHaveCount(0)
}

const sidebarRows = (): Locator =>
  page.locator('[data-workspace-id]').first().getByTestId('workspace-terminal-title')

test('AC3: the toolbar button, the shortcut and the palette open the Orchestrator running claude', async () => {
  await launch()
  await createWorkspace(repo, 'Proj')
  await openFromToolbar()
  await expect.poll(claudeLog).toHaveLength(1)
  const line = claudeLog()[0]!
  expect(line).toMatch(new RegExp(`^${SETTINGS_ARGS} --session-id [0-9a-f-]{36}$`))
  const id = lastSessionId()
  await expect.poll(() => savedOrchestrator()?.agentSessionId).toBe(id)
  await expect(page.getByTestId('titlebar-card')).toHaveText('Orchestrator')
  // Its row is first in Proj's tree.
  await page.keyboard.press(darwin ? 'Meta+T' : 'Control+Shift+T')
  await expectCardOpen(page, 'Terminal 1')
  await expect(sidebarRows()).toHaveText(['Orchestrator', 'Terminal 1'])
  await page.getByTestId('workspace-terminal').first().click()
  await expectCardOpen(page, 'Orchestrator')
  // Its shell's environment says it is the Orchestrator.
  await run('hello')
  await run('echo "orch=$BIKUBE_ORCHESTRATOR"')
  await expect.poll(bufferLines).toContain('orch=1')

  await backToBoard(page)
  await page.keyboard.press(OPEN_ORCHESTRATOR)
  await expectCardOpen(page, 'Orchestrator')
  await backToBoard(page)
  await page.keyboard.press(PALETTE)
  await page.getByTestId('palette-input').fill('Open orchestrator')
  await page.keyboard.press('Enter')
  await expectCardOpen(page, 'Orchestrator')
})

test('AC4: closed and opened again, and after a restart, it resumes with its kept output', async () => {
  await launch()
  await createWorkspace(repo, 'Proj')
  await openFromToolbar()
  await expect.poll(claudeLog).toHaveLength(1)
  const id = lastSessionId()
  await endClaudeAndShell()

  await openFromToolbar()
  await expect.poll(claudeLog).toHaveLength(2)
  expect(claudeLog()[1]).toBe(`${SETTINGS_ARGS} --resume ${id}`)
  await expect.poll(hasSeparator).toBe(true)

  await app!.close()
  await launch()
  await openFromToolbar()
  await expect.poll(claudeLog).toHaveLength(3)
  expect(claudeLog()[2]).toBe(`${SETTINGS_ARGS} --resume ${id}`)
  await expect.poll(hasSeparator).toBe(true)
})

test('AC5: the Orchestrator agent setting starts Codex with the first prompt, then resumes it', async () => {
  await launch()
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-section-agents').click()
  const select = page.getByTestId('settings-orchestrator-agent')
  await expect(select.locator('option:checked')).toHaveText('Claude Code')
  await select.selectOption({ label: 'Codex' })
  const settingsFile = (): string => {
    try {
      return readFileSync(join(dataDir, 'bikube-settings.json'), 'utf8')
    } catch {
      return ''
    }
  }
  await expect.poll(settingsFile).toContain('"orchestratorStartup":{"kind":"codex"}')
  await page.keyboard.press('Escape')

  await createWorkspace(repo, 'Proj')
  await openFromToolbar()
  await expect
    .poll(() => agentLogLines(fake.agentLog))
    .toEqual([`codex ${ORCHESTRATOR_FIRST_PROMPT}`])
  const quoted = `'${ORCHESTRATOR_FIRST_PROMPT.replace(/'/g, `'\\''`)}'`
  await expect
    .poll(async () => (await bufferLines()).some((l) => l.endsWith(`codex ${quoted}`)))
    .toBe(true)
  await run('hello')
  await run('exit')
  await expect(cardView(page)).toHaveCount(0)
  await openFromToolbar()
  await expect
    .poll(() => agentLogLines(fake.agentLog))
    .toEqual([`codex ${ORCHESTRATOR_FIRST_PROMPT}`, 'codex resume --last'])
  await expect
    .poll(async () => (await bufferLines()).some((l) => l.endsWith('codex resume --last || codex')))
    .toBe(true)

  await backToBoard(page)
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-section-agents').click()
  await page.getByTestId('settings-orchestrator-agent').selectOption({ label: 'Claude Code' })
  await expect.poll(settingsFile).not.toContain('orchestratorStartup')
})

test('AC13: New conversation… asks, Cancel changes nothing, confirming restarts with a new session', async () => {
  await launch()
  await createWorkspace(repo, 'Proj')
  await openFromToolbar()
  await expect.poll(claudeLog).toHaveLength(1)
  const first = lastSessionId()
  await run('hello')
  await expect.poll(() => savedOrchestrator()?.claudeStarted).toBe(true)
  await backToBoard(page)

  await page.getByTestId('toolbar-orchestrator-menu').click()
  await page.getByTestId('orchestrator-new-conversation').click()
  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog).toContainText(
    'Start a new orchestrator conversation? The current one is kept by Claude Code but the orchestrator won’t resume it.'
  )
  await dialog.getByTestId('confirm-cancel').click()
  await expect(dialog).toHaveCount(0)
  expect(savedOrchestrator()?.agentSessionId).toBe(first)
  expect(claudeLog()).toHaveLength(1)

  await page.getByTestId('toolbar-orchestrator-menu').click()
  await page.getByTestId('orchestrator-new-conversation').click()
  await page.getByTestId('confirm-new-conversation').click()
  await expectCardOpen(page, 'Orchestrator')
  await expect.poll(claudeLog).toHaveLength(2)
  const second = lastSessionId()
  expect(claudeLog()[1]).toBe(`${SETTINGS_ARGS} --session-id ${second}`)
  expect(second).not.toBe(first)
  await expect.poll(() => savedOrchestrator()?.agentSessionId).toBe(second)
  await expect
    .poll(async () => (await bufferLines()).some((l) => l.startsWith('fake-claude')))
    .toBe(true)
  expect(await hasSeparator()).toBe(false)
  // The palette offers it too, once the Orchestrator has a conversation.
  await backToBoard(page)
  await page.keyboard.press(PALETTE)
  await page.getByTestId('palette-input').fill('Orchestrator: New conversation')
  await expect(page.getByTestId('palette-row-title')).toHaveText(['Orchestrator: New conversation'])
})

test('AC15: waiting in the sidebar, Split and Next waiting card; the Agent tab shows its conversation', async () => {
  await launch()
  await createWorkspace(repo, 'Proj')
  await page.getByTestId('side-panel-tab-agent').click()
  await openFromToolbar()
  await expect.poll(claudeLog).toHaveLength(1)
  // The fake claude writes its transcript at its first line: the tab shows the conversation.
  await run('hello')
  await expect(page.getByTestId('side-panel').getByTestId('agent-tab-group-name')).toHaveText([
    'Agents',
    'What changed',
    'Files and artifacts',
    'Commands'
  ])
  // Waiting, set a moment later while the board shows.
  await run('sleep 1; board activity . waiting')
  await backToBoard(page)
  const row = page
    .getByTestId('workspace-terminal')
    .filter({ has: page.getByTestId('workspace-terminal-title').getByText('Orchestrator') })
  await expect(row.getByTestId('workspace-terminal-activity')).toHaveAttribute(
    'data-activity',
    'waiting'
  )
  await page.keyboard.press(PALETTE)
  await page.getByTestId('palette-input').fill('Sidebar: Split')
  await page.keyboard.press('Enter')
  const needsYou = page
    .getByTestId('sidebar-agents')
    .getByTestId('agent-group')
    .filter({ has: page.getByTestId('agent-group-heading').getByText('Needs you') })
  await expect(needsYou.getByTestId('workspace-terminal-title')).toHaveText(['Orchestrator'])
  await page.keyboard.press(NEXT_WAITING)
  await expectCardOpen(page, 'Orchestrator')
})

/** A file's text, or '' while it doesn't exist. */
function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

test('AC6: board guide prints the guide and Your orchestrator instructions, as the SessionStart hook does', async () => {
  const hookLog = join(root, 'hook.txt')
  await launch({ FAKE_CLAUDE_HOOK_LOG: hookLog })
  const settingsFile = (): string => readText(join(dataDir, 'bikube-settings.json'))
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-section-agents').click()
  const field = page.getByTestId('settings-orchestrator-instructions')
  await expect(field).toHaveValue('')
  // Typed, then Settings closed with Esc at once: saved as typed, trailing whitespace trimmed.
  await field.click()
  await field.pressSequentially('Always use worktrees.\n\n')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect.poll(settingsFile).toContain('"orchestratorInstructions":"Always use worktrees."')
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-section-agents').click()
  await expect(field).toHaveValue('Always use worktrees.')
  await page.keyboard.press('Escape')

  await createWorkspace(repo, 'Proj')
  await openFromToolbar()
  const expected = orchestratorGuide('Proj', repo, 'Always use worktrees.')
  expect(expected).toContain('## Your instructions\n\nAlways use worktrees.\n')
  // Claude Code's SessionStart hook, run by the fake claude with BIKUBE_ORCHESTRATOR=1.
  await expect.poll(() => readText(hookLog)).toBe(expected)
  await run('hello')
  const guide = join(root, 'guide.txt')
  await run(`board guide > ${guide}; echo "guide rc=$?"`)
  await expect.poll(bufferLines).toContain('guide rc=0')
  expect(readText(guide)).toBe(expected)

  // Emptied, there is no `## Your instructions`, and none is saved.
  await backToBoard(page)
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-section-agents').click()
  await page.getByTestId('settings-orchestrator-instructions').fill('')
  await page.getByTestId('settings-orchestrator-instructions').blur()
  await expect.poll(settingsFile).not.toContain('orchestratorInstructions')
  await page.keyboard.press('Escape')
  await page.getByTestId('workspace-terminal').first().click()
  await expectCardOpen(page, 'Orchestrator')
  await run(`board guide > ${guide}; echo "empty rc=$?"`)
  await expect.poll(bufferLines).toContain('empty rc=0')
  expect(readText(guide)).toBe(orchestratorGuide('Proj', repo, ''))

  // D16: its own socket, and an extra pane's own too, each serving board guide.
  await run('echo "sock=$BIKUBE_SOCKET"')
  const socketLine = async (): Promise<string> =>
    (await bufferLines()).find((l) => l.startsWith('sock=')) ?? ''
  await expect.poll(socketLine).toMatch(/^sock=\/\S+\/board\/o-[0-9a-f]{16}\.sock$/)
  const mainSocket = await socketLine()
  await splitRight(page)
  await expect.poll(terminalFocused).toBe(true)
  const sockets = join(root, 'sockets.txt')
  await page.keyboard.type(`echo "$BIKUBE_SOCKET" > ${sockets}; board guide > ${guide}.2`)
  await page.keyboard.press('Enter')
  await expect.poll(() => readText(`${guide}.2`)).toBe(orchestratorGuide('Proj', repo, ''))
  expect(readText(sockets).trim()).toMatch(/\/board\/o-[0-9a-f]{16}\.sock$/)
  expect(`sock=${readText(sockets).trim()}`).not.toBe(mainSocket)
})

/** The running terminals the sidebar lists under the workspace named `name`. */
const rowsOf = (name: string): Locator =>
  page
    .locator('[data-workspace-id]')
    .filter({ has: page.getByTestId('workspace-item').filter({ hasText: name }) })
    .getByTestId('workspace-terminal-title')

const activeWorkspace = (): Locator =>
  page.locator('[data-testid=workspace-item][aria-current=true]')

/** Opens Alpha's Orchestrator and ends its fake claude, leaving its shell to type `board` into. */
async function orchestratorShell(): Promise<void> {
  await page.getByTestId('workspace-item').filter({ hasText: 'Alpha' }).click()
  await expect(activeWorkspace()).toContainText('Alpha')
  await openFromToolbar()
  await expect.poll(claudeLog).toHaveLength(1)
  await run('hello')
  await expect.poll(() => savedOrchestrator()?.claudeStarted).toBe(true)
}

test("AC8: board start starts another workspace's card in the background; board open shows it", async () => {
  await launch()
  await createWorkspace(repo, 'Alpha')
  const other = join(root, 'other')
  mkdirSync(other)
  await createWorkspace(other, 'Beta')
  await orchestratorShell()
  const ids = join(root, 'ids.txt')
  await run(`board create --workspace Beta Backlog Review > ${ids}; echo "create rc=$?"`)
  await expect.poll(bufferLines).toContain('create rc=0')
  const id = readText(ids).split(' ')[0]!
  expect(readText(ids)).toBe(`${id} Beta\n`)
  await expect(rowsOf('Beta')).toHaveCount(0)

  await run(`board start ${id}; echo "start rc=$?"`)
  await expect.poll(bufferLines).toContain('start rc=0')
  await expect(rowsOf('Beta')).toHaveText(['Review'])
  // The view is unchanged.
  await expectCardOpen(page, 'Orchestrator')
  await expect(activeWorkspace()).toContainText('Alpha')

  await run(`board start ${id}; echo "again rc=$?"`)
  await expect.poll(bufferLines).toContain('again rc=0')
  expect(await bufferLines()).toContain('Review is already running')

  await run(`board open ${id}`)
  await expectCardOpen(page, 'Review')
  await expect(activeWorkspace()).toContainText('Beta')
})

test("AC9: an orchestrated card's fresh start passes the start-working prompt; a hand-made one #69's", async () => {
  await launch()
  await createWorkspace(repo, 'Alpha', 'Claude Code')
  await orchestratorShell()
  await run(
    'printf \'Review the branch\' | board create --description-file - Backlog Review; echo "create rc=$?"'
  )
  await expect.poll(bufferLines).toContain('create rc=0')
  await run('board start Review; echo "start rc=$?"')
  await expect.poll(bufferLines).toContain('start rc=0')
  await expect.poll(claudeLog).toHaveLength(2)
  expect(claudeLog()[1]).toMatch(
    new RegExp(
      `^${SETTINGS_ARGS} --session-id [0-9a-f-]{36} ${escapeRegExp(ORCHESTRATED_FIRST_PROMPT)}$`
    )
  )
  expect(ORCHESTRATED_FIRST_PROMPT).toBe(
    'This card has a task description. Read it with: board description .  Then start working on it.'
  )

  // A card made by hand with a description asks first (#69 D2).
  await backToBoard(page)
  await page.getByTestId('column').filter({ hasText: 'Backlog' }).getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('Mine')
  await page.getByTestId('new-card-description').fill('Fix the login bug')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'Mine')
  await expect.poll(claudeLog).toHaveLength(3)
  expect(claudeLog()[2]).toMatch(
    new RegExp(`^${SETTINGS_ARGS} --session-id [0-9a-f-]{36} ${escapeRegExp(FIRST_PROMPT)}$`)
  )
})

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('AC11: board terminal adds a running Terminal N in the background; --show opens it', async () => {
  await launch()
  await createWorkspace(repo, 'Alpha')
  await orchestratorShell()
  // `echo`, not AC11's `printf ready`: bash's prompt overwrites a line with no newline.
  await run('board terminal \'echo ready\'; echo "terminal rc=$?"')
  await expect.poll(bufferLines).toContain('terminal rc=0')
  const printed = (await bufferLines()).find((l) => /^Terminal 1 \S+$/.test(l))
  expect(printed).toBeDefined()
  await expect(rowsOf('Alpha')).toHaveText(['Orchestrator', 'Terminal 1'])
  await expectCardOpen(page, 'Orchestrator')

  await run("board terminal --show 'exec sleep 60'")
  await expectCardOpen(page, 'Terminal 2')
  await expect(rowsOf('Alpha')).toHaveText(['Orchestrator', 'Terminal 1', 'Terminal 2'])

  // Terminal 1 ran its command.
  await rowsOf('Alpha').filter({ hasText: 'Terminal 1' }).click()
  await expectCardOpen(page, 'Terminal 1')
  await expect.poll(bufferLines).toContain('ready')
})

/** Writes a fixture transcript for the session in `folder` under the fake home (#75 D3). */
function writeTranscript(folder: string, sessionId: string, entries: unknown[]): void {
  const dir = join(fake.home, '.claude', 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${sessionId}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  )
}

test('AC10: board send types into a card, board wait waits on its activity, board reply prints its last reply', async () => {
  const input = join(root, 'input.log')
  await launch({ FAKE_CLAUDE_INPUT_LOG: input })
  await createWorkspace(repo, 'Alpha')
  await orchestratorShell()
  const ids = join(root, 'ids.txt')
  await run(`board create --agent claude Backlog Review > ${ids}; echo "create rc=$?"`)
  await expect.poll(bufferLines).toContain('create rc=0')
  const id = readText(ids).split(' ')[0]!
  await run('board create Backlog Plain; board start Review; echo "start rc=$?"')
  await expect.poll(bufferLines).toContain('start rc=0')
  await expect.poll(claudeLog).toHaveLength(2)
  const session = /--session-id (\S+)/.exec(claudeLog()[1]!)?.[1] ?? ''
  writeTranscript(repo, session, [
    { type: 'user', message: { role: 'user', content: 'Review the branch' } },
    {
      type: 'assistant',
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Found 2 issues.' }] }
    }
  ])

  // The fake claude reads one line: `go on`, then Enter.
  await run(`board send Review 'go on'; echo "send rc=$?"`)
  await expect.poll(bufferLines).toContain('send rc=0')
  // The Orchestrator's own fake claude read `hello` first.
  await expect.poll(() => readText(input)).toBe('hello\ngo on\n')
  await expectCardOpen(page, 'Orchestrator')

  // Typed in the card (its shell now): working, then waiting a moment later.
  await run(
    `board send Review 'sleep 1; board activity ${id} working; sleep 1; board activity ${id} waiting'; ` +
      'board wait Review --timeout 5; echo "wait rc=$?"'
  )
  await expect.poll(bufferLines).toContain('wait rc=0')
  const lines = await bufferLines()
  expect(lines[lines.indexOf('wait rc=0') - 1]).toBe('waiting')

  // With no change it times out after about 5 s.
  await run(
    `board activity ${id} working; s=$(date +%s); board wait Review --timeout 5; ` +
      'echo "timeout rc=$? after=$(( $(date +%s) - s ))"'
  )
  await expect
    .poll(bufferLines, { timeout: 15_000 })
    .toContainEqual(expect.stringMatching(/^timeout rc=1 after=[56]$/))
  expect(await bufferLines()).toContain('board: timed out after 5 s')

  await run('board reply Review; echo "reply rc=$?"')
  await expect.poll(bufferLines).toContain('reply rc=0')
  const after = await bufferLines()
  expect(after[after.indexOf('reply rc=0') - 1]).toBe('Found 2 issues.')

  await run('board reply Plain; echo "plain rc=$?"')
  await expect.poll(bufferLines).toContain('plain rc=1')
  expect(await bufferLines()).toContain('board: "Plain" is not a Claude Code card')
})
