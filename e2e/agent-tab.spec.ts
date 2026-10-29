import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeProjectFolder } from '../src/core/claude-stats'
import { backToBoard, boardCard, cardView, expectCardOpen } from './card-view'
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
