import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeProjectFolder } from '../src/core/claude-stats'
import { pickAppTheme } from './app-theme'
import { backToBoard, boardCard, cardView, closeCard, expectCardOpen } from './card-view'
import { clipboardWrites, recordClipboardWrites } from './clipboard-writes'
import { claudeLogLines } from './fake-claude'
import { fakeSshHome, removeRemoteForwards, type FakeSshHome } from './fake-ssh'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The side panel's Agent tab (#75): the third tab, saved like the others; its messages for the
// board, a card that isn't Claude Code, a workspace shell, an SSH card and a Claude Code card with
// no transcript; its collapsible groups once the card's transcript exists; and (S2) the header and
// the Commands group read live from fixture transcripts the tests write and append to. The fake
// home (`fakeSshHome`: a fake `claude` and `ssh` on the login PATH) is also BIKUBE_HOME_DIR, so
// main looks for transcripts under its `.claude/projects`.

const REMOTE_DIR = '/tmp/bikube-remote'

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string
let repo: string
let fake: FakeSshHome

test.beforeEach(() => {
  dataDir = newDataDir()
  root = mkdtempSync(join(tmpdir(), 'bikube-agent-tab-'))
  repo = join(root, 'repo')
  mkdirSync(repo)
  mkdirSync(REMOTE_DIR, { recursive: true })
  fake = fakeSshHome(root)
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  removeRemoteForwards(fake.sshLog)
  rmSync(root, { recursive: true, force: true })
})

async function launch(): Promise<void> {
  ;({ app, page } = await launchApp({
    dataDir,
    env: { ...fake.env, BIKUBE_HOME_DIR: fake.home }
  }))
}

async function restart(): Promise<void> {
  await app?.close()
  await launch()
}

async function createWorkspace(directory: string, name: string, host?: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  if (host) {
    await page.getByTestId('workspace-location-ssh').check()
    await page.getByTestId('workspace-host').fill(host)
  }
  await page.getByTestId('workspace-directory').fill(directory)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Creates card `title` in Backlog, Claude Code or the workspace's plain default; its view opens. */
async function newCard(title: string, claude = false): Promise<void> {
  await page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    .getByTestId('new-card')
    .click()
  await page.getByTestId('new-card-input').fill(title)
  if (claude) {
    await page.getByTestId('new-card-startup').selectOption({ label: 'Claude Code' })
  }
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

const panel = (): Locator => page.getByTestId('side-panel')
const agentTab = (): Locator => page.getByTestId('side-panel-tab-agent')
const message = (): Locator => panel().getByTestId('agent-tab-message')
const group = (name: string): Locator =>
  panel().getByTestId('agent-tab-group').filter({ hasText: name })
const groupToggle = (name: string): Locator => group(name).getByTestId('agent-tab-group-toggle')

/** The saved `agentSessionId` of the first workspace's card `title`, once the state file has it. */
async function sessionIdOf(title: string): Promise<string> {
  let id = ''
  await expect
    .poll(() => {
      try {
        const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
        const cards: { title: string; agentSessionId: string }[] = saved.state.workspaces[0].cards
        id = cards.find((c) => c.title === title)?.agentSessionId ?? ''
      } catch {
        id = ''
      }
      return id
    })
    .not.toBe('')
  return id
}

test('#75 AC1: the Agent tab is the third, shows the board message and stays selected', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  const tabs = page.getByTestId('titlebar-panel-side').getByRole('tab')
  await expect(tabs).toHaveText(['Files', 'Shells', 'Agent'])
  await agentTab().click()
  await expect(agentTab()).toHaveAttribute('aria-selected', 'true')
  await expect(panel().getByRole('tabpanel')).toHaveAttribute(
    'aria-labelledby',
    'side-panel-tab-agent'
  )
  await expect(message()).toHaveText('Open a Claude Code card to see its agent.')

  await restart()
  await expect(agentTab()).toHaveAttribute('aria-selected', 'true')
  await expect(message()).toHaveText('Open a Claude Code card to see its agent.')
})

test('#75 AC2, AC3: a plain card, the Default shell and a Claude Code card with no transcript', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await agentTab().click()

  await newCard('plain')
  await expect(message()).toHaveText('The Agent tab follows Claude Code cards.')
  await backToBoard(page)

  await page.getByTestId('toolbar-new-shell').click()
  await expect(cardView(page)).toBeVisible()
  await expect(message()).toHaveText('Run claude in this shell to see its agent here.')
  await backToBoard(page)
  await expect(message()).toHaveText('Open a Claude Code card to see its agent.')

  await newCard('agent', true)
  await expect.poll(() => claudeLogLines(fake.log)).toHaveLength(1)
  await expect(message()).toHaveText('No conversation yet.')
  await expect(panel().getByTestId('agent-tab-group')).toHaveCount(0)

  // In a card window (#53) the panel's own header shows the tab, selected, with the same body.
  await backToBoard(page)
  const opened = app!.waitForEvent('window')
  await boardCard(page, 'agent').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-open-window').click()
  const window = await opened
  await expect(window.getByTestId('card-view')).toHaveAttribute('aria-label', 'agent')
  const windowPanel = window.getByTestId('side-panel')
  // The Default shell still runs: Shells shows its count.
  await expect(windowPanel.getByRole('tab')).toHaveText(['Files', /^Shells/, 'Agent'])
  await expect(windowPanel.getByTestId('side-panel-tab-agent')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(windowPanel.getByTestId('agent-tab-message')).toHaveText('No conversation yet.')
})

test("#75 D6: a Claude Code card's transcript shows the three groups, collapsed for the run", async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await agentTab().click()
  await newCard('agent', true)
  await expect(message()).toHaveText('No conversation yet.')
  await backToBoard(page)

  const id = await sessionIdOf('agent')
  const dir = join(fake.home, '.claude', 'projects', encodeProjectFolder(repo))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.jsonl`), '{}\n')

  await boardCard(page, 'agent').getByTestId('card-open').click()
  await expectCardOpen(page, 'agent')
  await expect(message()).toHaveCount(0)
  await expect(panel().getByTestId('agent-tab-group-name')).toHaveText([
    'Agents',
    'What changed',
    'Commands'
  ])
  for (const name of ['Agents', 'What changed', 'Commands']) {
    await expect(groupToggle(name)).toHaveAttribute('aria-expanded', 'true')
  }
  await groupToggle('Commands').click()
  await expect(groupToggle('Commands')).toHaveAttribute('aria-expanded', 'false')
  await backToBoard(page)
  await boardCard(page, 'agent').getByTestId('card-open').click()
  await expect(groupToggle('Commands')).toHaveAttribute('aria-expanded', 'false')
  await expect(groupToggle('Agents')).toHaveAttribute('aria-expanded', 'true')

  await restart()
  await boardCard(page, 'agent').getByTestId('card-open').click()
  await expect(groupToggle('Commands')).toHaveAttribute('aria-expanded', 'true')
})

test("#75 AC2: an SSH workspace's Claude Code card reads that the tab isn't available", async () => {
  await launch()
  await createWorkspace(REMOTE_DIR, 'remote', 'devbox')
  await agentTab().click()
  await newCard('agent', true)
  await expect(message()).toHaveText("The Agent tab isn't available over SSH.")
})

// S2's fixtures: transcript lines in Claude Code's shapes.

const T0 = Date.parse('2026-10-29T14:32:00.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()

const line = (entry: object): string => `${JSON.stringify(entry)}\n`

const assistant = (content: object[], seconds: number, usage?: object): string =>
  line({
    type: 'assistant',
    timestamp: at(seconds),
    isSidechain: false,
    uuid: randomUUID(),
    message: { model: 'claude-opus-4-8', role: 'assistant', content, ...(usage && { usage }) }
  })

const bashUse = (id: string, command: string, description: string, seconds: number): string =>
  assistant([{ type: 'tool_use', id, name: 'Bash', input: { command, description } }], seconds)

const bashResult = (
  id: string,
  content: string,
  seconds: number,
  isError = false,
  toolUseResult: unknown = { stdout: content, stderr: '', interrupted: false }
): string =>
  line({
    type: 'user',
    timestamp: at(seconds),
    isSidechain: false,
    uuid: randomUUID(),
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }]
    },
    toolUseResult
  })

/** AC4's header: a TodoWrite, then the last main-agent entry on claude-opus-4-8 at 42% context. */
const HEADER_FIXTURE = [
  assistant(
    [
      {
        type: 'tool_use',
        id: 'todo1',
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Write the parser', status: 'completed', activeForm: 'Writing the parser' },
            { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
            { content: 'Ship it', status: 'pending', activeForm: 'Shipping it' }
          ]
        }
      }
    ],
    0
  ),
  assistant([{ type: 'text', text: 'Working on it.' }], 1, {
    input_tokens: 20_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 400_000,
    output_tokens: 100
  })
]

const DENIAL =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."

/** AC6's three commands: ok, failed with exit code 1, denied. */
const COMMANDS_FIXTURE = [
  bashUse('t1', 'git status', 'Show status', 0),
  bashResult('t1', 'On branch main', 1),
  bashUse('t2', 'cd /repo && npm test | tail -5', 'Run tests', 10),
  bashResult(
    't2',
    'Exit code 1\nFAIL src/a.test.ts\nTests: 1 failed',
    72,
    true,
    'Error: Exit code 1'
  ),
  bashUse('t3', 'rm -rf build', 'Remove build', 80),
  bashResult('t3', DENIAL, 81, true, 'User rejected tool use')
]

const transcriptOf = (id: string): string =>
  join(fake.home, '.claude', 'projects', encodeProjectFolder(repo), `${id}.jsonl`)

function writeTranscript(id: string, lines: string[]): string {
  const path = transcriptOf(id)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, lines.join(''))
  return path
}

const commandRows = (): Locator => group('Commands').getByTestId('agent-command')
const commandTitles = (): Locator => commandRows().getByTestId('agent-command-title')

/** Focuses the open card's terminal and types `text` with Enter. */
async function typeInCard(text: string): Promise<void> {
  await cardView(page).getByTestId('terminal').first().click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

/**
 * Creates Claude Code card `title` with the Agent tab selected and writes its transcript; the card
 * stays open. Returns its session id.
 */
async function claudeCard(title: string, lines: string[]): Promise<string> {
  await newCard(title, true)
  await expect.poll(() => claudeLogLines(fake.log).length).toBeGreaterThan(0)
  const id = await sessionIdOf(title)
  writeTranscript(id, lines)
  return id
}

/**
 * Ends the fake `claude` (a message sent), leaving the card's shell at its prompt to run what is
 * typed next.
 */
async function endFakeClaude(): Promise<void> {
  await typeInCard('')
  await page.waitForTimeout(500)
}

const requestCount = (sessionId: string): Promise<number> =>
  app!.evaluate(
    (_, id) =>
      (globalThis as unknown as { __bikubeAgentTabRequests?: Record<string, number> })
        .__bikubeAgentTabRequests?.[id] ?? 0,
    sessionId
  )

test("#75 AC4: the header shows the model, the board card's context bar and the todos", async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await agentTab().click()
  const id = await claudeCard('agent', HEADER_FIXTURE)
  await endFakeClaude()
  await typeInCard(`board usage . ${transcriptOf(id)}`)
  await backToBoard(page)
  const boardUsage = boardCard(page, 'agent').getByTestId('card-usage')
  await expect(boardUsage).toContainText('42% context')
  const tooltip = await boardUsage.getAttribute('title')
  expect(tooltip).toContain('Context 420,000')

  await boardCard(page, 'agent').getByTestId('card-open').click()
  await expectCardOpen(page, 'agent')
  const header = panel().getByTestId('agent-tab-header')
  await expect(header.getByTestId('agent-tab-model')).toHaveText('claude-opus-4-8')
  const bar = header.getByTestId('card-usage')
  await expect(bar.getByTestId('card-context-text')).toHaveText('42% context')
  await expect(bar).toHaveAttribute('title', tooltip!)
  await expect(header.getByTestId('agent-todos-count')).toHaveText('1/3')
  const todos = header.getByTestId('agent-todo')
  await expect(todos).toHaveText(['Write the parser', 'Running tests', 'Ship it'])
  await expect(todos.nth(0)).toHaveCSS('text-decoration-line', 'line-through')
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  )
  const accentRgb = await page.evaluate((color) => {
    const probe = document.createElement('span')
    probe.style.color = color
    document.body.append(probe)
    const rgb = getComputedStyle(probe).color
    probe.remove()
    return rgb
  }, accent)
  await expect(todos.nth(1)).toHaveCSS('color', accentRgb)
  await expect(todos.nth(2)).not.toHaveCSS('text-decoration-line', 'line-through')
})

test('#75 AC5, AC14: a command appended shows within 3 s; hidden, the tab asks main nothing', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await agentTab().click()
  const id = await claudeCard('agent', HEADER_FIXTURE)
  await expect(panel().getByTestId('agent-tab-model')).toHaveText('claude-opus-4-8')
  await expect(group('Commands').getByTestId('agent-commands-empty')).toHaveText('No commands yet.')

  appendFileSync(transcriptOf(id), bashUse('u1', 'npm run test:unit', 'Run unit tests', 5))
  await expect(commandTitles().first()).toHaveText('Run unit tests', { timeout: 3000 })
  await expect(commandRows().first().getByTestId('agent-command-status')).toHaveText('Running')
  appendFileSync(transcriptOf(id), bashResult('u1', '12 passed', 9))
  await expect(commandRows().first().getByTestId('agent-command-status')).toHaveText('OK', {
    timeout: 3000
  })
  await expect(commandRows().first().getByTestId('agent-command-duration')).toHaveText('4s')

  // AC14: on the Files tab main gets no request for it, until the Agent tab shows again.
  await expect.poll(() => requestCount(id)).toBeGreaterThan(2)
  await page.getByTestId('side-panel-tab-files').click()
  await expect(panel().getByTestId('agent-tab')).toHaveCount(0)
  const stopped = await requestCount(id)
  await page.waitForTimeout(3000)
  expect(await requestCount(id)).toBe(stopped)
  await agentTab().click()
  await expect.poll(() => requestCount(id)).toBeGreaterThan(stopped)
})

test('#75 AC6, AC7, AC13: Commands rows, an expanded command, Copy and a collapsed group', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await recordClipboardWrites(app!)
  await agentTab().click()
  await claudeCard('agent', COMMANDS_FIXTURE)

  await expect(commandTitles()).toHaveText(['Remove build', 'Run tests', 'Show status'])
  await expect(commandRows().getByTestId('agent-command-status')).toHaveText([
    'Denied',
    'Failed · exit 1',
    'OK'
  ])
  await expect(commandRows().getByTestId('agent-command-line')).toHaveText([
    'rm -rf build',
    'cd /repo && npm test | tail -5',
    'git status'
  ])
  await expect(commandRows().first().getByTestId('agent-command-line')).toHaveCSS(
    'font-family',
    /Menlo|Consolas|monospace/
  )
  await expect(group('Commands').getByTestId('agent-tab-group-count')).toHaveText('3')

  // AC7: the Run tests row expanded.
  const tests = commandRows().nth(1)
  await tests.getByTestId('agent-command-toggle').click()
  await expect(tests.getByTestId('agent-command-toggle')).toHaveAttribute('aria-expanded', 'true')
  const steps = tests.getByTestId('agent-command-step')
  await expect(steps).toHaveText(['cd /repo', '&& npm test', '| tail -5'])
  await expect(steps.nth(0)).toHaveAttribute('data-dim', 'true')
  await expect(steps.nth(1)).toHaveAttribute('data-dim', 'false')
  await expect(tests.getByTestId('agent-command-output')).toContainText('Tests: 1 failed')
  await tests.getByTestId('agent-command-copy').click()
  await expect.poll(() => clipboardWrites(app!)).toEqual(['cd /repo && npm test | tail -5'])

  // AC13: collapsed, it stays so for another Claude Code card, and not after a restart.
  await groupToggle('Commands').click()
  await expect(groupToggle('Commands')).toHaveAttribute('aria-expanded', 'false')
  await expect(commandRows().first()).toBeHidden()
  await backToBoard(page)
  await claudeCard('second', COMMANDS_FIXTURE)
  await expect(panel().getByTestId('agent-tab-model')).toHaveText('claude-opus-4-8')
  await expect(groupToggle('Commands')).toHaveAttribute('aria-expanded', 'false')
  await expect(commandRows().first()).toBeHidden()

  await restart()
  await boardCard(page, 'agent').getByTestId('card-open').click()
  await expectCardOpen(page, 'agent')
  await expect(groupToggle('Commands')).toHaveAttribute('aria-expanded', 'true')
  await expect(commandTitles()).toHaveText(['Remove build', 'Run tests', 'Show status'])
})

test("#75 AC15: `board session` in the card switches the tab to the new session's commands", async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await agentTab().click()
  await claudeCard('agent', COMMANDS_FIXTURE)
  await expect(commandTitles()).toHaveCount(3)

  const other = randomUUID()
  writeTranscript(other, [bashUse('b1', 'echo B', 'Echo B', 0), bashResult('b1', 'B', 1)])
  await endFakeClaude()
  await typeInCard(`board session . ${other}`)
  await expect(commandTitles()).toHaveText(['Echo B'], { timeout: 3000 })
})

// S2a (#75 D3a): Claude Code in a workspace shell. Its hooks' `board session .` and `board usage .`
// are kept for the running shell, runtime only; the transcript is found by the session id alone
// in any one folder under `.claude/projects`.

/** Session C's transcript in another project folder: one command, and a 42%-context reply. */
function writeShellTranscript(id: string): string {
  const path = join(fake.home, '.claude', 'projects', '-some-other-folder', `${id}.jsonl`)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(
    path,
    [bashUse('c1', 'echo C', 'Echo C', 0), bashResult('c1', 'C', 1), HEADER_FIXTURE[1]].join('')
  )
  return path
}

const mainAgent = (): Locator =>
  group('Agents').getByTestId('agent-row').filter({ hasText: 'Main agent' })

test('#75 AC15a: Claude Code in the Default and a temporary shell, runtime only', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await agentTab().click()
  const session = randomUUID()
  const transcript = writeShellTranscript(session)

  await page.getByTestId('toolbar-new-shell').click()
  await expectCardOpen(page, 'Default')
  await expect(message()).toHaveText('Run claude in this shell to see its agent here.')
  await typeInCard(`board session . ${session}`)
  await expect(commandTitles()).toHaveText(['Echo C'], { timeout: 3000 })
  await expect(mainAgent().getByTestId('agent-row-status')).toHaveText('Idle')
  await typeInCard('board activity . working')
  await expect(mainAgent().getByTestId('agent-row-status')).toHaveText('Running')
  // D7: the context bar from the shell's own usage.
  await typeInCard(`board usage . ${transcript}`)
  await expect(panel().getByTestId('agent-tab-header').getByTestId('card-context-text')).toHaveText(
    '42% context'
  )

  // A temporary shell (New shell with the Default shell running) follows its own report.
  await backToBoard(page)
  await page.getByTestId('toolbar-new-shell').click()
  await expectCardOpen(page, 'Terminal 1')
  await expect(message()).toHaveText('Run claude in this shell to see its agent here.')
  await typeInCard(`board session . ${session}`)
  await expect(commandTitles()).toHaveText(['Echo C'], { timeout: 3000 })
  await typeInCard('board activity . working')
  await expect(mainAgent().getByTestId('agent-row-status')).toHaveText('Running')

  // Closed and started again, the Default shell has no session.
  await page.getByTestId('workspace-terminal').filter({ hasText: 'Default' }).click()
  await expectCardOpen(page, 'Default')
  await expect(commandTitles()).toHaveText(['Echo C'])
  await closeCard(page)
  await page.getByTestId('confirm-close').click()
  await expect(cardView(page)).toHaveCount(0)
  await page.getByTestId('toolbar-new-shell').click()
  await expectCardOpen(page, 'Default')
  await expect(message()).toHaveText('Run claude in this shell to see its agent here.')

  // Never saved.
  await page.waitForTimeout(1000)
  expect(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8')).not.toContain(session)
})

// S3 (#75 D8): subagents, read from `<session>/subagents/agent-<id>.jsonl` beside the transcript
// and matched to their Task by prompt, and background commands.

const agentRow = (name: string): Locator =>
  group('Agents')
    .getByTestId('agent-row')
    .filter({ has: page.getByTestId('agent-row-name').getByText(name, { exact: true }) })

const EXPLORE_PROMPT = 'Find where the side panel is drawn.'

const taskUse = (seconds: number): string =>
  assistant(
    [
      {
        type: 'tool_use',
        id: 'task1',
        name: 'Task',
        input: {
          subagent_type: 'Explore',
          description: 'Find the panel code',
          prompt: EXPLORE_PROMPT
        }
      }
    ],
    seconds
  )

/** The Explore subagent's own transcript: its prompt, then `ls src`. */
const SUBAGENT_FIXTURE = [
  line({
    type: 'user',
    timestamp: at(2),
    isSidechain: true,
    agentId: 'a1b2c3',
    uuid: randomUUID(),
    message: { role: 'user', content: EXPLORE_PROMPT }
  }),
  line({
    type: 'assistant',
    timestamp: at(3),
    isSidechain: true,
    agentId: 'a1b2c3',
    uuid: randomUUID(),
    message: {
      model: 'claude-haiku-4-5',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 's1',
          name: 'Bash',
          input: { command: 'ls src', description: 'List src' }
        }
      ]
    }
  })
]

test('#75 AC8: a running subagent, its command tagged, Done with a duration on its result', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await agentTab().click()
  await newCard('agent', true)
  await expect.poll(() => claudeLogLines(fake.log).length).toBeGreaterThan(0)
  const id = await sessionIdOf('agent')
  const subagents = join(transcriptOf(id).replace(/\.jsonl$/, ''), 'subagents')
  mkdirSync(subagents, { recursive: true })
  writeFileSync(join(subagents, 'agent-a1b2c3.jsonl'), SUBAGENT_FIXTURE.join(''))
  writeTranscript(id, [taskUse(1)])

  await expect(group('Agents').getByTestId('agent-row-name')).toHaveText(['Main agent', 'Explore'])
  const explore = agentRow('Explore')
  await expect(explore.getByTestId('agent-row-description')).toHaveText('Find the panel code')
  await expect(explore.getByTestId('agent-row-status')).toHaveText('Running')
  await expect(explore.getByTestId('agent-row-tools')).toHaveText('1 tool use')
  await expect(commandTitles()).toHaveText(['List src'])
  await expect(commandRows().first().getByTestId('agent-command-agent')).toHaveText('Explore')

  appendFileSync(
    transcriptOf(id),
    bashResult('task1', 'The panel is in SidePanel.tsx.', 42, false, {
      status: 'completed',
      totalToolUseCount: 4
    })
  )
  await expect(explore.getByTestId('agent-row-status')).toHaveText('Done', { timeout: 3000 })
  await expect(explore.getByTestId('agent-row-duration')).toHaveText('41s')
  await expect(explore.getByTestId('agent-row-tools')).toHaveText('4 tool uses')
})

test('#75 AC9: a background command runs in Agents and reads Background in Commands', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await agentTab().click()
  // Started 5 s ago, so its duration counts live from there.
  const started = new Date(Date.now() - 5000).toISOString()
  await claudeCard('agent', [
    line({
      type: 'assistant',
      timestamp: started,
      isSidechain: false,
      uuid: randomUUID(),
      message: {
        model: 'claude-opus-4-8',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'bg1',
            name: 'Bash',
            input: {
              command: 'npm run dev',
              description: 'Start dev server',
              run_in_background: true
            }
          }
        ]
      }
    }),
    line({
      type: 'user',
      timestamp: started,
      isSidechain: false,
      uuid: randomUUID(),
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'bg1',
            content: 'Command running in background with ID: bash_1',
            is_error: false
          }
        ]
      },
      toolUseResult: { backgroundTaskId: 'bash_1' }
    })
  ])

  const dev = agentRow('Start dev server')
  await expect(dev).toHaveAttribute('data-kind', 'background')
  await expect(dev.getByTestId('agent-row-status')).toHaveText('Running')
  const duration = dev.getByTestId('agent-row-duration')
  await expect(duration).toHaveText(/^\d+s$/)
  const first = await duration.textContent()
  await expect(duration).not.toHaveText(first!, { timeout: 3000 })
  await expect(commandTitles()).toHaveText(['Start dev server'])
  await expect(commandRows().first().getByTestId('agent-command-status')).toHaveText('Background')
})

// S4 (#75 D9): What changed, from the prompts and the edit tools and simple commands in them.

const userPrompt = (text: string, seconds: number): string =>
  line({
    type: 'user',
    timestamp: at(seconds),
    isSidechain: false,
    uuid: randomUUID(),
    cwd: repo,
    message: { role: 'user', content: text }
  })

const toolUse = (id: string, name: string, input: object, seconds: number): string =>
  line({
    type: 'assistant',
    timestamp: at(seconds),
    isSidechain: false,
    uuid: randomUUID(),
    cwd: repo,
    message: {
      model: 'claude-opus-4-8',
      role: 'assistant',
      content: [{ type: 'tool_use', id, name, input }]
    }
  })

/**
 * AC10's session: prompt 1 writes `src/a.ts` (10 lines) and edits `src/b.ts` (+2 −1, from its
 * structured patch); prompt 2 runs `git mv src/b.ts src/c.ts`, edits `docs/x.md` (+1 −0, counted
 * from its strings) and replies `Renamed b to c.`
 */
const changesFixture = (): string[] => [
  userPrompt('Add the panel', 100),
  toolUse('w1', 'Write', { file_path: join(repo, 'src/a.ts'), content: 'a\n'.repeat(10) }, 101),
  bashResult('w1', 'File created successfully', 102, false, {
    type: 'create',
    filePath: join(repo, 'src/a.ts')
  }),
  toolUse(
    'e1',
    'Edit',
    { file_path: join(repo, 'src/b.ts'), old_string: 'x', new_string: 'y\nz' },
    103
  ),
  bashResult('e1', 'The file has been updated.', 104, false, {
    filePath: join(repo, 'src/b.ts'),
    structuredPatch: [{ oldStart: 1, lines: [' keep', '-x', '+y', '+z'] }]
  }),
  assistant([{ type: 'text', text: 'Added the panel.' }], 105),
  userPrompt('Rename b', 200),
  toolUse('m1', 'Bash', { command: 'git mv src/b.ts src/c.ts', description: 'Rename b' }, 201),
  bashResult('m1', '', 202),
  toolUse(
    'e2',
    'Edit',
    { file_path: join(repo, 'docs/x.md'), old_string: 'one', new_string: 'one\ntwo' },
    203
  ),
  bashResult('e2', 'The file has been updated.', 204),
  assistant([{ type: 'text', text: 'Renamed b to c.' }], 205)
]

const changes = (): Locator => group('What changed')
const changeRows = (): Locator => changes().getByTestId('agent-change')

/** Each shown file as `<folder> <name> <badge> <size>`, the size empty when it shows none. */
const shownChanges = (): Promise<string[]> =>
  changes()
    .getByTestId('agent-changes-folder')
    .evaluateAll((folders) =>
      folders.flatMap((folder) =>
        [...folder.querySelectorAll('[data-testid=agent-change]')].map((row) =>
          [
            folder.querySelector('[data-testid=agent-changes-folder-name]')?.textContent,
            row.querySelector('[data-testid=agent-change-name]')?.textContent,
            row.querySelector('[data-testid=agent-change-badge]')?.textContent,
            row.querySelector('[data-testid=agent-change-size]')?.textContent ?? ''
          ].join(' ')
        )
      )
    )

test('#75 AC10, AC11: What changed for the last prompt, the whole session and an earlier prompt', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await agentTab().click()
  await claudeCard('agent', changesFixture())

  const select = changes().getByTestId('agent-changes-view')
  await expect(select).toHaveValue('last')
  await expect(select.locator('option:checked')).toHaveText('Last prompt')
  await expect(select.locator('option')).toHaveText([
    'Last prompt',
    'Whole session',
    '#1 Add the panel'
  ])
  await expect(changes().getByTestId('agent-changes-heading')).toHaveText('2 files · +1 −0')
  await expect.poll(shownChanges).toEqual(['docs x.md Edited +1 −0', 'src b.ts → c.ts Renamed '])
  await expect(changes().getByTestId('agent-changes-summary')).toHaveText('Renamed b to c.')
  await expect(group('What changed').getByTestId('agent-tab-group-count')).toHaveText('2')

  // AC11: the whole session, then prompt 1.
  await select.selectOption({ label: 'Whole session' })
  await expect
    .poll(shownChanges)
    .toEqual(['docs x.md Edited +1 −0', 'src a.ts New +10 −0', 'src b.ts → c.ts Renamed '])
  await expect(changes().getByTestId('agent-changes-summary')).toHaveCount(0)
  await select.selectOption({ label: '#1 Add the panel' })
  await expect.poll(shownChanges).toEqual(['src a.ts New +10 −0', 'src b.ts Edited +2 −1'])
  await expect(changes().getByTestId('agent-changes-summary')).toHaveText('Added the panel.')

  // Another card starts at Last prompt again, with its empty line.
  await backToBoard(page)
  await claudeCard('second', [userPrompt('Nothing yet', 1)])
  await expect(changes().getByTestId('agent-changes-view')).toHaveValue('last')
  await expect(changes().getByTestId('agent-changes-empty')).toHaveText(
    'No file changes in this prompt.'
  )
})

test('#75 AC12: clicking a changed file opens it with the folder, as the Files tab does', async () => {
  const log = join(root, 'editor.log')
  const code = join(fake.home, 'bin', 'code')
  writeFileSync(code, `#!/bin/sh\n{ echo "run code"; printf '%s\\n' "$@"; } >> '${log}'\n`)
  chmodSync(code, 0o755)
  mkdirSync(join(repo, 'docs'), { recursive: true })
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'docs', 'x.md'), 'one\ntwo\n')
  writeFileSync(join(repo, 'src', 'c.ts'), 'c\n')
  const runs = (): string[] =>
    existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n') : []

  await launch()
  await createWorkspace(repo, 'repo')
  await agentTab().click()
  const id = await claudeCard('agent', [...changesFixture(), userPrompt('Delete it', 300)])
  // Deleted and outside files aren't buttons.
  appendFileSync(
    transcriptOf(id),
    [
      toolUse('d1', 'Bash', { command: 'rm src/c.ts', description: 'Remove c' }, 301),
      bashResult('d1', '', 302),
      toolUse(
        'o1',
        'Edit',
        { file_path: '/tmp/elsewhere.txt', old_string: 'a', new_string: 'b' },
        303
      ),
      bashResult('o1', 'ok', 304)
    ].join('')
  )
  await expect.poll(shownChanges).toEqual(['src c.ts Deleted ', '/tmp elsewhere.txt Edited +1 −1'])
  await expect(changeRows().getByRole('button')).toHaveCount(0)

  await changes().getByTestId('agent-changes-view').selectOption({ label: '#2 Rename b' })
  const file = changeRows().filter({ hasText: 'x.md' }).getByRole('button', { name: 'x.md' })
  await file.click()
  await expect.poll(runs).toEqual(['run code', repo, join(repo, 'docs', 'x.md')])
  await expect(changes().getByTestId('agent-changes-open-error')).toHaveCount(0)
})

test('#75 AC17: at 200 px the tab has no sideways scroll, and its colours are the theme’s', async () => {
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Bikube Dark","terminalThemeLight":"Bikube Light","useGhosttyConfig":false,"sidePanelWidth":200,"sidePanelTab":"agent"}}'
  )
  await launch()
  await page.emulateMedia({ colorScheme: null })
  await createWorkspace(repo, 'repo')
  await claudeCard('agent', [
    ...COMMANDS_FIXTURE,
    ...changesFixture(),
    toolUse(
      'long',
      'Edit',
      {
        file_path: join(
          repo,
          'a-very-long-folder-name-that-goes-on/and-on/file-with-a-long-name.ts'
        ),
        old_string: 'a',
        new_string: 'b'
      },
      206
    ),
    bashResult('long', 'ok', 207)
  ])
  await expect(changes().getByTestId('agent-changes-heading')).toHaveText('3 files · +2 −1')
  await expect(panel()).toHaveCSS('width', '200px')
  await commandRows().nth(1).getByTestId('agent-command-toggle').click()
  await expect(commandRows().nth(1).getByTestId('agent-command-detail')).toBeVisible()

  const body = panel().getByTestId('agent-tab')
  const noSideways = (): Promise<boolean> =>
    panel()
      .locator('.side-panel-body')
      .evaluate(
        (el) =>
          el.scrollWidth <= el.clientWidth &&
          (el.querySelector('[data-testid=agent-tab]') as HTMLElement).scrollWidth <=
            (el.querySelector('[data-testid=agent-tab]') as HTMLElement).clientWidth
      )

  /** The tab's colours, each with the token it should come from resolved in the page. */
  const colours = (): Promise<Record<string, [string, string]>> =>
    body.evaluate((tab) => {
      const resolve = (token: string): string => {
        const probe = document.createElement('span')
        probe.style.color = `var(${token})`
        document.body.append(probe)
        const colour = getComputedStyle(probe).color
        probe.remove()
        return colour
      }
      const color = (selector: string): string => {
        const el = tab.querySelector(selector)
        return el ? getComputedStyle(el).color : 'missing'
      }
      return {
        name: [color('[data-testid=agent-change-name]'), resolve('--text')],
        edited: [
          color('[data-testid=agent-change-badge][data-badge=Edited]'),
          resolve('--pill-question-text')
        ],
        renamed: [
          color('[data-testid=agent-change-badge][data-badge=Renamed]'),
          resolve('--pill-working-text')
        ],
        added: [color('.agent-change-added'), resolve('--pill-waiting-text')],
        removed: [color('.agent-change-removed'), resolve('--danger')],
        heading: [color('[data-testid=agent-changes-heading]'), resolve('--text-muted')],
        summary: [color('[data-testid=agent-changes-summary]'), resolve('--text')],
        command: [color('[data-testid=agent-command-title]'), resolve('--text')]
      }
    })
  const expectThemed = async (): Promise<void> => {
    await expect.poll(noSideways).toBe(true)
    for (const [what, [shown, token]] of Object.entries(await colours())) {
      expect(shown, what).toBe(token)
    }
  }

  await expect(changeRows().first()).toBeVisible()
  await expectThemed()
  const darkText = (await colours()).name[1]

  const settings = page.getByTestId('settings-dialog')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma')
  await settings.getByRole('radio', { name: 'Light' }).check()
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await expect.poll(async () => (await colours()).name[1]).not.toBe(darkText)
  await expectThemed()
  const lightText = (await colours()).name[1]

  await pickAppTheme(page, 'Nord')
  await expect.poll(async () => (await colours()).name[1]).not.toBe(lightText)
  await expectThemed()
})
