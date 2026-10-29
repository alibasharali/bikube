import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeProjectFolder } from '../src/core/claude-stats'
import { backToBoard, boardCard, cardView, expectCardOpen } from './card-view'
import { claudeLogLines } from './fake-claude'
import { fakeSshHome, removeRemoteForwards, type FakeSshHome } from './fake-ssh'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The side panel's Agent tab (#75 S1): the third tab, saved like the others; its messages for
// the board, a card that isn't Claude Code, a workspace shell, an SSH card and a Claude Code card
// with no transcript; and its collapsible groups once the card's transcript exists. The fake
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
