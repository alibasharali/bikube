import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ORCHESTRATOR_FIRST_PROMPT } from '../src/core/orchestrator'
import { backToBoard, cardView, expectCardOpen } from './card-view'
import { agentLogLines, fakeAgentsHome, type FakeAgentsHome } from './fake-agents'
import { claudeLogLines, SETTINGS_ARGS } from './fake-claude'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The workspace's Orchestrator (#81 S2): the toolbar button, its shortcut and palette rows, its
// Claude Code start and resume with kept output, the Orchestrator agent setting, New
// conversation, and its signals (waiting, Split's Agents, the Agent tab). The fake `claude` and
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

async function launch(): Promise<void> {
  ;({ app, page } = await launchApp({ dataDir, env: { ...fake.env, BIKUBE_HOME_DIR: fake.home } }))
}

async function createWorkspace(directory: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
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
