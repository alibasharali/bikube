import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BOARD_USAGE } from '../src/core/board-args'
import { claudeSettings } from '../src/core/claude-hooks'
import { addFakeAgents, agentLogLines } from './fake-agents'
import { claudeLogLines, REMOTE_SETTINGS_ARGS } from './fake-claude'
import { fakeSshHome, removeRemoteForwards, sshLogLines, type FakeSshHome } from './fake-ssh'
import {
  backToBoard,
  checkOnBoard,
  expectCardOpen,
  expectStatusOnBoard,
  splitRight
} from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// SSH workspaces (#12): the dialog's Location choice and Host field, the sidebar tooltip, the
// host in the saved-state file, and SSH cards connecting. Each test has its own data directory
// and "restarts" by closing the app and launching it again on the same one. Electron runs with
// SHELL=/bin/bash and a temp HOME whose .bash_profile puts the fake `ssh` and `claude` first on
// PATH (e2e/fake-ssh.ts). `/tmp/drovr-remote` is an existing directory.

const REMOTE_DIR = '/tmp/drovr-remote'

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string
let fake: FakeSshHome
let extraEnv: Record<string, string> = {}

test.beforeAll(() => {
  mkdirSync(REMOTE_DIR, { recursive: true })
})

test.beforeEach(() => {
  dataDir = newDataDir()
  root = mkdtempSync(join(tmpdir(), 'drovr-ssh-'))
  fake = fakeSshHome(root)
  extraEnv = {}
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  removeRemoteForwards(fake.sshLog)
  rmSync(root, { recursive: true, force: true })
})

/** Launches with the fake ssh and claude; `env` adds to that environment (e.g. FAKE_SSH_DELAY). */
async function launch(env: Record<string, string> = extraEnv): Promise<void> {
  extraEnv = env
  ;({ app, page } = await launchApp({ dataDir, env: { ...fake.env, ...env } }))
}

async function restart(): Promise<void> {
  await app?.close()
  await launch()
}

/** The fake ssh's log, one line of arguments per connection. */
const sshLog = (): string[] => sshLogLines(fake.sshLog)

const stateFile = (): string => join(dataDir, 'drovr-state.json')

const dialog = (): Locator => page.getByTestId('workspace-dialog')

async function openCreateDialog(): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await expect(dialog()).toBeVisible()
}

/** Fills the open dialog for an SSH workspace; `name` is left to its default when omitted. */
async function fillSsh(host: string, directory: string, name?: string): Promise<void> {
  await page.getByTestId('workspace-location-ssh').check()
  await page.getByTestId('workspace-host').fill(host)
  await page.getByTestId('workspace-directory').fill(directory)
  if (name !== undefined) await page.getByTestId('workspace-name').fill(name)
}

async function submit(): Promise<void> {
  await page.getByTestId('workspace-submit').click()
  await expect(dialog()).toHaveCount(0)
}

async function createSsh(host: string, directory: string, name?: string): Promise<void> {
  await openCreateDialog()
  await fillSsh(host, directory, name)
  await submit()
}

async function createLocal(directory: string, name: string): Promise<void> {
  await openCreateDialog()
  await page.getByTestId('workspace-directory').fill(directory)
  await page.getByTestId('workspace-name').fill(name)
  await submit()
}

const workspaceItem = (name: string): Locator =>
  page.getByTestId('workspace-item').filter({ hasText: name })

async function selectWorkspace(name: string): Promise<void> {
  await workspaceItem(name).click()
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

async function openEditDialog(name: string): Promise<void> {
  const row = page.locator('.workspace-row').filter({ has: workspaceItem(name) })
  await row.hover()
  await row.getByTestId('workspace-edit').click()
  await expect(dialog()).toBeVisible()
}

function column(name: string): Locator {
  return page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
}

/** Creates a card through `+ New card` (its view opens on it), then goes back to the board. */
async function newCard(title: string): Promise<void> {
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await backToBoard(page)
  await expect(page.getByTestId('board')).toBeVisible()
}

interface SavedCard {
  title: string
  host?: string
}
interface SavedWorkspace {
  name: string
  host?: string
  cards: SavedCard[]
}

/** The saved file once it holds `names` (saves are debounced). */
async function savedFile(names: string[]): Promise<{
  version: number
  state: { workspaces: SavedWorkspace[] }
}> {
  await expect
    .poll(() => {
      try {
        return JSON.parse(readFileSync(stateFile(), 'utf8')).state.workspaces.map(
          (w: SavedWorkspace) => `${w.name}:${w.cards.map((c) => c.title).join(',')}`
        )
      } catch {
        return []
      }
    })
    .toEqual(names)
  return JSON.parse(readFileSync(stateFile(), 'utf8'))
}

test('AC1: creates an SSH workspace; the picker is hidden and the tooltip shows host:directory', async () => {
  await launch()
  await openCreateDialog()
  // AC10: the Location choice defaults to This computer, with the folder picker.
  await expect(page.getByTestId('workspace-location-local')).toBeChecked()
  await expect(page.getByTestId('workspace-location-ssh')).not.toBeChecked()
  await expect(page.getByTestId('workspace-host')).toHaveCount(0)
  await expect(page.getByTestId('workspace-browse')).toBeVisible()

  await page.getByTestId('workspace-location-ssh').check()
  await expect(page.getByTestId('workspace-host')).toBeVisible()
  await expect(page.getByTestId('workspace-browse')).toHaveCount(0)
  await page.getByTestId('workspace-host').fill('me@devbox')
  await page.getByTestId('workspace-directory').fill(REMOTE_DIR)
  await expect(page.getByTestId('workspace-name')).toHaveValue('drovr-remote')
  await expect(page.getByTestId('workspace-browse')).toHaveCount(0)
  await submit()

  await expect(page.getByTestId('workspace-item')).toHaveCount(1)
  await expect(workspaceItem('drovr-remote')).toHaveAttribute('title', `me@devbox:${REMOTE_DIR}`)
  await expect(page.getByTestId('board-title')).toHaveText('drovr-remote')
})

test('AC1: bad hosts and directories show inline errors and create nothing', async () => {
  await launch()
  await openCreateDialog()

  await fillSsh('-oProxyCommand=x', REMOTE_DIR, 'remote')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-host')).toHaveText(
    'Enter a host as ssh takes it, e.g. me@devbox'
  )

  await page.getByTestId('workspace-host').fill('')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-host')).toHaveText('Host is required')

  await page.getByTestId('workspace-host').fill('me@devbox')
  await page.getByTestId('workspace-directory').fill('relative/dir')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-host')).toHaveCount(0)
  await expect(page.getByTestId('workspace-error-directory')).toHaveText(
    'Enter an absolute path or one starting with ~'
  )
  await expect(dialog()).toBeVisible()
  await expect(page.getByTestId('workspace-item')).toHaveCount(0)

  // A directory that doesn't exist locally is accepted for SSH (#12 D3).
  await page.getByTestId('workspace-directory').fill('/nope/remote')
  await submit()
  await expect(workspaceItem('remote')).toHaveAttribute('title', 'me@devbox:/nope/remote')
})

test('D4: the name defaults to the host for ~', async () => {
  await launch()
  await createSsh('me@devbox', '~')
  await expect(workspaceItem('me@devbox')).toHaveAttribute('title', 'me@devbox:~')
})

test('AC3: an SSH workspace and its cards keep their host across a restart', async () => {
  await launch()
  await createLocal(REMOTE_DIR, 'local')
  await newCard('l')
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await selectWorkspace('remote')
  await newCard('a')
  // Editing the host changes new cards only (#12 D1).
  await openEditDialog('remote')
  await expect(page.getByTestId('workspace-location-ssh')).toBeChecked()
  await expect(page.getByTestId('workspace-host')).toHaveValue('me@devbox')
  await page.getByTestId('workspace-host').fill('other')
  await submit()
  await newCard('b')
  await savedFile(['local:l', 'remote:a,b'])

  await restart()

  await openEditDialog('remote')
  await expect(page.getByTestId('workspace-location-ssh')).toBeChecked()
  await expect(page.getByTestId('workspace-host')).toHaveValue('other')
  await expect(page.getByTestId('workspace-directory')).toHaveValue(REMOTE_DIR)
  await expect(page.getByTestId('workspace-browse')).toHaveCount(0)
  await page.getByTestId('workspace-cancel').click()
  await openEditDialog('local')
  await expect(page.getByTestId('workspace-location-local')).toBeChecked()
  await expect(page.getByTestId('workspace-host')).toHaveCount(0)
  await page.getByTestId('workspace-cancel').click()

  const file = await savedFile(['local:l', 'remote:a,b'])
  expect(file.version).toBe(1)
  const [local, remote] = file.state.workspaces
  expect(remote.host).toBe('other')
  expect(remote.cards.map((c) => c.host)).toEqual(['me@devbox', 'other'])
  expect('host' in local).toBe(false)
  expect('host' in local.cards[0]).toBe(false)

  // Card `a` still connects to the host it was created with.
  await selectWorkspace('remote')
  const before = sshLog().length
  await openCard('a')
  await expect.poll(sshLog).toHaveLength(before + 1)
  expect(sshLog().at(-1)).toMatch(/^-o ExitOnForwardFailure=no -R \S+ -t -- me@devbox /)
})

test('D1: switching an SSH workspace to This computer makes it local again', async () => {
  await launch()
  await createSsh('me@devbox', '~', 'remote')
  await openEditDialog('remote')
  await page.getByTestId('workspace-location-local').check()
  await expect(page.getByTestId('workspace-host')).toHaveCount(0)
  await expect(page.getByTestId('workspace-browse')).toBeVisible()
  await page.getByTestId('workspace-directory').fill('/tmp')
  await submit()
  await expect(workspaceItem('remote')).toHaveAttribute('title', '/tmp')
  await expect
    .poll(() => {
      try {
        const ws = JSON.parse(readFileSync(stateFile(), 'utf8')).state.workspaces[0]
        return `${ws.directory} ${'host' in ws}`
      } catch {
        return ''
      }
    })
    .toBe('/tmp false')
})

/** A version-1 file from before #12: one workspace with one card, no host anywhere. */
function oldFile(cardHost?: string): string {
  const card: Record<string, unknown> = {
    id: 'card-1',
    columnId: 'col-1',
    title: 'api',
    directory: REMOTE_DIR,
    startup: { kind: 'custom', command: ':' },
    agentSessionId: '00000000-0000-4000-8000-000000000001',
    claudeStarted: false
  }
  if (cardHost !== undefined) card.host = cardHost
  return JSON.stringify({
    version: 1,
    state: {
      workspaces: [
        {
          id: 'ws-1',
          name: 'old',
          directory: REMOTE_DIR,
          columns: [{ id: 'col-1', name: 'Backlog' }],
          cards: [card],
          nextCardNumber: 1,
          defaultStartup: { kind: 'shell' }
        }
      ],
      activeId: 'ws-1'
    }
  })
}

test('AC3: a version-1 file without any host loads with every workspace local', async () => {
  writeFileSync(stateFile(), oldFile())
  await launch()
  await expect(page.getByTestId('board-title')).toHaveText('old')
  await expect(workspaceItem('old')).toHaveAttribute('title', REMOTE_DIR)
  await openEditDialog('old')
  await expect(page.getByTestId('workspace-location-local')).toBeChecked()
  await expect(page.getByTestId('workspace-host')).toHaveCount(0)
})

test('AC3: a file whose card has host -x is moved aside and the app starts empty', async () => {
  const contents = oldFile('-x')
  writeFileSync(stateFile(), contents)
  await launch()
  await expect(page.getByTestId('empty-state')).toBeVisible()
  await expect(page.getByTestId('workspace-item')).toHaveCount(0)
  const corrupt = readdirSync(dataDir).filter((f) => /^drovr-state\.corrupt-.*\.json$/.test(f))
  expect(corrupt).toHaveLength(1)
  expect(readFileSync(join(dataDir, corrupt[0]), 'utf8')).toBe(contents)
})

/** The saved id of the card titled `title` (saves are debounced). */
async function cardId(title: string): Promise<string> {
  let id = ''
  await expect
    .poll(() => {
      try {
        const { workspaces } = JSON.parse(readFileSync(stateFile(), 'utf8')).state as {
          workspaces: { cards: { id: string; title: string }[] }[]
        }
        id = workspaces.flatMap((w) => w.cards).find((c) => c.title === title)?.id ?? ''
      } catch {
        id = ''
      }
      return id
    })
    .not.toBe('')
  return id
}

function card(title: string): Locator {
  return page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

async function back(): Promise<void> {
  await backToBoard(page)
  await expect(page.getByTestId('board')).toBeVisible()
}

/** Creates a card through `+ New card`, optionally with a startup command; its view opens on it. */
async function createCard(title: string, startup?: 'Claude Code' | 'Codex'): Promise<void> {
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  if (startup) await page.getByTestId('new-card-startup').selectOption({ label: startup })
  await page.getByTestId('new-card-input').press('Enter')
}

/** The open card's terminal buffer, one trimmed string per line, wrapped lines joined. */
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

/** Runs `command` in the open card and returns the line it printed after `<tag>:`. */
async function output(command: string, tag: string): Promise<string> {
  await run(`echo "${tag}:$(${command})"`)
  let found = ''
  await expect
    .poll(async () => {
      found = (await bufferLines()).find((l) => l.startsWith(`${tag}:`)) ?? ''
      return found !== ''
    })
    .toBe(true)
  return found.slice(tag.length + 1)
}

/** The open card shows no status (#31 D1): reads it on the board, then opens the card again. */
async function expectRunning(): Promise<void> {
  const title = await page.getByTestId('card-view').getAttribute('aria-label')
  await expectStatusOnBoard(page, title ?? '', 'Running')
}
const tileStatus = (title: string): Locator => card(title).getByTestId('card-status-label')

/**
 * Waits until the open card's remote shell answers. An SSH card keeps no keystrokes typed before
 * its session arrives (#25 D10), so the probe is typed again until one gets through.
 */
async function connected(): Promise<void> {
  await expectRunning()
  await expect(async () => {
    // No quotes or spaces: whatever part of a probe gets through ends at its Enter.
    await run('echo ready:$((40+2))')
    await expect.poll(bufferLines, { timeout: 2000 }).toContain('ready:42')
  }).toPass({ timeout: 20_000 })
}

test('AC4: a card runs on its host, in the remote directory; the local ssh has no board variables', async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('api')
  await expectCardOpen(page, 'api')
  // The open card shows no location (#31 D1): the sidebar's tooltip tells where it runs.
  await expect(workspaceItem('remote')).toHaveAttribute('title', `me@devbox:${REMOTE_DIR}`)
  await connected()
  await expect.poll(sshLog).toHaveLength(1)
  expect(sshLog()[0]).toMatch(
    /^-o ExitOnForwardFailure=no -R \S+ -t -- me@devbox cd '\/tmp\/drovr-remote' \|\| exit 255; /
  )
  expect(await output('pwd', 'pwd')).toBe(REMOTE_DIR)
  // The remote shell has the card's id for `board` (#25 D4) ...
  expect(await output('echo "[$DROVR_CARD_ID]"', 'card')).toBe(`[${await cardId('api')}]`)
  // ... but the local shell that ran ssh had none of the `board` variables (#12 D5, #25 D2).
  expect(sshLogLines(fake.sshEnvLog)).toEqual(['card=[] bin=[]'])
  await back()
  await expect(tileStatus('api')).toHaveText('Running')
  await expect(card('api').getByTestId('card-status-line')).not.toContainText('drovr-ready')

  // A local workspace's tooltip has no host.
  await createLocal('/tmp', 'local')
  await createCard('sh')
  await expectCardOpen(page, 'sh')
  await expect(workspaceItem('local')).toHaveAttribute('title', '/tmp')
})

test('AC4: with directory ~ the card starts in the remote home', async () => {
  await launch()
  await createSsh('me@devbox', '~', 'home')
  await createCard('api')
  await connected()
  expect(await output('pwd', 'pwd')).toBe(fake.home)
  await expect(workspaceItem('home')).toHaveAttribute('title', 'me@devbox:~')
})

test('AC2: editing the host changes new cards only; This computer makes them local', async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('a')
  await connected()
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(tileStatus('a')).toHaveText('Stopped')

  await openEditDialog('remote')
  await page.getByTestId('workspace-host').fill('other')
  await submit()
  await createCard('b')
  await connected()
  expect(sshLog().at(-1)).toMatch(/^-o ExitOnForwardFailure=no -R \S+ -t -- other /)
  await back()

  await openCard('a')
  await connected()
  expect(sshLog()).toHaveLength(3)
  expect(sshLog().at(-1)).toMatch(/^-o ExitOnForwardFailure=no -R \S+ -t -- me@devbox /)
  await back()

  await openEditDialog('remote')
  await page.getByTestId('workspace-location-local').check()
  await page.getByTestId('workspace-directory').fill('/tmp')
  await submit()
  await createCard('c')
  await expectRunning()
  expect(await output('pwd', 'pwd')).toBe('/tmp')
  await expect(workspaceItem('remote')).toHaveAttribute('title', '/tmp')
  expect(sshLog()).toHaveLength(3)
})

test('AC5: the startup command is typed once, after the ready marker', async () => {
  await launch({ FAKE_SSH_DELAY: '1' })
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('agent', 'Claude Code')
  await expectCardOpen(page, 'agent')
  await expect.poll(() => claudeLogLines(fake.log), { timeout: 15_000 }).toHaveLength(1)
  const [line] = claudeLogLines(fake.log)
  expect(line).toMatch(new RegExp(`^${REMOTE_SETTINGS_ARGS} --session-id [0-9a-f-]{36}$`))
  const screen = (await bufferLines()).join('\n')
  const password = screen.indexOf('Password:')
  expect(password).toBeGreaterThanOrEqual(0)
  expect(screen.slice(0, password)).not.toContain('claude')
  expect(screen).not.toContain('drovr-ready')
  await page.waitForTimeout(500)
  expect(claudeLogLines(fake.log)).toHaveLength(1)
  await back()
  await expect(card('agent').getByTestId('card-status-line')).not.toContainText('drovr-ready')
})

test("#31 AC12: an SSH card's claude gets a copy of the settings in its private directory, removed after", async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('agent', 'Claude Code')
  await expectCardOpen(page, 'agent')
  await expect.poll(() => claudeLogLines(fake.log), { timeout: 15_000 }).toHaveLength(1)
  const [line] = claudeLogLines(fake.log)
  expect(line).toMatch(new RegExp(`^${REMOTE_SETTINGS_ARGS} --session-id [0-9a-f-]{36}$`))
  const path = line.split(' ')[1]
  // Beside the session's board script, the same file as the local one.
  expect(existsSync(join(dirname(path), 'board'))).toBe(true)
  expect(readFileSync(path, 'utf8')).toBe(claudeSettings())
  // Quit the fake claude, then end the session: the directory and its copy are gone.
  await page.keyboard.press('Enter')
  await connected()
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect.poll(() => existsSync(path)).toBe(false)
  expect(existsSync(dirname(path))).toBe(false)
})

test('#21 AC8: a Codex card types codex once, after the ready marker, and resumes on reopen', async () => {
  const agentLog = join(root, 'agents.log')
  addFakeAgents(fake.home, agentLog)
  await launch({ FAKE_SSH_DELAY: '1' })
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('r', 'Codex')
  await expectCardOpen(page, 'r')
  await expect.poll(() => agentLogLines(agentLog), { timeout: 15_000 }).toEqual(['codex'])
  await expect.poll(bufferLines).toContain('fake-codex')
  const screen = (await bufferLines()).join('\n')
  const password = screen.indexOf('Password:')
  expect(password).toBeGreaterThanOrEqual(0)
  expect(screen.slice(0, password)).not.toContain('codex')
  await page.waitForTimeout(500)
  expect(agentLogLines(agentLog)).toEqual(['codex'])

  await page.keyboard.press('Enter')
  await connected()
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(tileStatus('r')).toHaveText('Stopped')
  await openCard('r')
  await expect
    .poll(() => agentLogLines(agentLog), { timeout: 15_000 })
    .toEqual(['codex', 'codex resume --last'])
  await expect.poll(bufferLines).toContain('fake-codex resume --last')
})

test('AC6: an unreachable host reads SSH failed with ssh error; opening it tries again', async () => {
  await launch()
  await createSsh('unreachable', REMOTE_DIR, 'remote')
  await createCard('api')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(tileStatus('api')).toHaveText(
    'SSH failed: ssh: Could not resolve hostname unreachable: Name or service not known'
  )
  await expect.poll(sshLog).toHaveLength(1)
  await card('api').getByTestId('card-open').click()
  await expect.poll(sshLog).toHaveLength(2)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(tileStatus('api')).toHaveText(/^SSH failed: ssh: Could not resolve hostname/)
})

test("AC6: a missing remote directory reads SSH failed with the shell's cd error", async () => {
  await launch()
  await createSsh('me@devbox', '/nope/remote', 'remote')
  await createCard('api')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(tileStatus('api')).toHaveText(/^SSH failed: .*\/nope\/remote/)
})

test('AC6: exit or Close leaves a running SSH card Stopped', async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('a')
  await connected()
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(tileStatus('a')).toHaveText('Stopped')

  await createCard('b')
  await connected()
  await back()
  await card('b').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-close').click()
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect(tileStatus('b')).toHaveText('Stopped')
})

test("D5: a remote shell's own exit 255 (after a failed command) reads Stopped", async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('a')
  await connected()
  // `exit` without a code exits with the last status, 255; the remote command reports it as 254.
  await run("bash -c 'exit 255' || exit")
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(tileStatus('a')).toHaveText('Stopped')
})

test('AC7: main refuses a bad host or remote directory from the page', async () => {
  rmSync('/tmp/pwned', { force: true })
  await launch()
  const spawn = (cwd: string, host: string | null): Promise<unknown> =>
    page.evaluate(({ cwd, host }) => window.drovr.terminal.spawn(80, 24, cwd, 'some-card', host), {
      cwd,
      host
    })
  expect(await spawn('/tmp', '-oProxyCommand=touch /tmp/pwned')).toEqual({
    ok: false,
    reason: 'invalid host'
  })
  expect(await spawn('relative', 'devbox')).toEqual({
    ok: false,
    reason: 'invalid working directory'
  })
  expect(await spawn('/nope/local', null)).toEqual({
    ok: false,
    reason: 'working directory not found'
  })
  await page.waitForTimeout(500)
  expect(existsSync('/tmp/pwned')).toBe(false)
  expect(sshLog()).toEqual([])
})

const panes = (): Locator => page.getByTestId('card-view').getByTestId('pane')

/** Pane `index`'s terminal buffer, one trimmed string per line (wrapped lines joined). */
function paneLines(index: number): Promise<string[]> {
  return panes()
    .nth(index)
    .evaluate((pane) => {
      type Line = { isWrapped: boolean; translateToString(trim: boolean): string }
      const host = pane.querySelector('[data-testid=terminal]') as
        | (HTMLElement & {
            __xterm?: {
              buffer: { active: { length: number; getLine(i: number): Line | undefined } }
            }
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

test('AC8: a split pane of an SSH card connects to its host, with no startup command', async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('api', 'Claude Code')
  await expectCardOpen(page, 'api')
  await expect.poll(() => claudeLogLines(fake.log), { timeout: 15_000 }).toHaveLength(1)
  expect(sshLog()).toHaveLength(1)

  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  await expect.poll(sshLog).toHaveLength(2)
  expect(sshLog()[1]).toMatch(
    /^-o ExitOnForwardFailure=no -R \S+ -t -- me@devbox cd '\/tmp\/drovr-remote' \|\| exit 255; /
  )
  await run('echo "pwd:$(pwd)"')
  await expect.poll(() => paneLines(1)).toContain(`pwd:${REMOTE_DIR}`)
  await page.waitForTimeout(500)
  expect(claudeLogLines(fake.log)).toHaveLength(1)
})

test('AC8: a pane whose ssh fails keeps its error and SSH failed until Close pane', async () => {
  await launch({ FAKE_SSH_FAIL_AFTER: '1' })
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('api')
  await connected()

  await splitRight(page)
  await expect.poll(sshLog).toHaveLength(2)
  await expect.poll(() => paneLines(1)).toContain('SSH failed')
  const lines = await paneLines(1)
  expect(lines).toContain('ssh: connect to host me@devbox port 22: Connection refused')
  await page.waitForTimeout(500)
  await expect(panes()).toHaveCount(2)
  await expectRunning()

  await panes().nth(1).getByRole('button', { name: 'Close pane' }).click()
  await expect(panes()).toHaveCount(1)
  await expectRunning()
})

// `board` inside SSH cards (#25): each SSH session's socket is forwarded with `ssh -R`, which the
// fake ssh serves with a real socket at the remote path relaying to main's session socket. Each command's stdout
// and stderr go to files in this test's temp root and its exit code is echoed on the screen.

let boardCommands = 0

/**
 * Runs `command` in the open card's focused terminal and returns its exit code (read from the
 * screen through `lines`, the main pane's by default), stdout and stderr.
 */
async function remoteRun(
  command: string,
  lines: () => Promise<string[]> = bufferLines
): Promise<{ code: number; stdout: string; stderr: string }> {
  const tag = `c${++boardCommands}`
  const out = join(root, `${tag}.out`)
  const err = join(root, `${tag}.err`)
  await run(`${command} >${out} 2>${err}; echo "${tag} rc=$?"`)
  const pattern = new RegExp(`^${tag} rc=(\\d+)`)
  let code = -1
  await expect
    .poll(
      async () => {
        const line = (await lines()).find((l) => pattern.test(l))
        code = line ? Number(pattern.exec(line)![1]) : -1
        return code
      },
      { timeout: 15_000 }
    )
    .toBeGreaterThanOrEqual(0)
  return { code, stdout: readFileSync(out, 'utf8'), stderr: readFileSync(err, 'utf8') }
}

const ok = { code: 0, stdout: '', stderr: '' }
const refused = (error: string): { code: number; stdout: string; stderr: string } => ({
  code: 1,
  stdout: '',
  stderr: `${error}\n`
})

/** The card `title` on the board reads `Running` with the agent status `status` (#31 D11). */
async function expectAgentStatus(tile: Locator, status: string): Promise<void> {
  await expect(tile.getByTestId('card-status-label')).toHaveText('Running')
  await expect(tile.getByTestId('card-agent-status')).toHaveText(status)
}
const titlesIn = (name: string): Locator => column(name).getByTestId('card-title')

/** The `-R <remote>:<local>` of a fake ssh log line, or null without one. */
function forwardOf(line: string): { remote: string; local: string } | null {
  const match = /^-o ExitOnForwardFailure=no -R (\S+?):(\S+) -t -- /.exec(line)
  return match ? { remote: match[1], local: match[2] } : null
}

/** Whether anything, a dangling symlink included, is at `path`. */
function present(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

const sessionSockets = (): string[] => {
  try {
    return readdirSync(join(dataDir, 'board')).filter((name) => /^s-.*\.sock$/.test(name))
  } catch {
    return []
  }
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

test('#25 AC1: board works in an SSH card through a forwarded socket', async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('api')
  await connected()
  await expect.poll(sshLog).toHaveLength(1)
  expect(sshLog()[0]).toMatch(
    new RegExp(
      `^-o ExitOnForwardFailure=no -R /tmp/drovr-[0-9a-f]{32}\\.sock:${escaped(join(dataDir, 'board'))}/s-[0-9a-f]{16}\\.sock -t -- me@devbox `
    )
  )

  expect(await remoteRun('board status . hi')).toEqual(ok)
  await checkOnBoard(page, 'api', (tile) => expectAgentStatus(tile, 'hi'))
  expect(await remoteRun('board move . Done')).toEqual(ok)
  expect(await output('echo "$DROVR_CARD_ID"', 'id')).toBe(await cardId('api'))
  expect(await remoteRun('"$DROVR_BIN/board" help')).toEqual({
    code: 0,
    stdout: BOARD_USAGE,
    stderr: ''
  })
  await back()
  await expect(titlesIn('Done')).toHaveText(['api'])
  await expectAgentStatus(card('api'), 'hi')
})

test('#25 AC2, AC3: the same errors as a local card, and only its own card', async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('web')
  await connected()
  await back()
  await createCard('api')
  await connected()

  expect(await remoteRun('board move . Nope')).toEqual(
    refused('board: no column "Nope"; columns are: Backlog, In Progress, Review, Done')
  )
  expect(await remoteRun('board move')).toEqual({ code: 2, stdout: '', stderr: BOARD_USAGE })
  expect(await remoteRun('board status web hey')).toEqual(ok)

  const web = await cardId('web')
  expect(await remoteRun(`DROVR_CARD_ID=${web} board status . x`)).toEqual(
    refused('board: invalid request')
  )
  await back()
  await expectAgentStatus(card('web'), 'hey')
  await page.waitForTimeout(300)
  await expectAgentStatus(card('web'), 'hey')
  await expect(tileStatus('api')).toHaveText('Running')
})

test('#25 AC4: an extra pane of an SSH card has board through its own forward', async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('api')
  await connected()
  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  await expect.poll(sshLog).toHaveLength(2)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')
  await run('echo "up:$(echo pane)"')
  await expect.poll(() => paneLines(1)).toContain('up:pane')

  expect(await remoteRun('board status . pane', () => paneLines(1))).toEqual(ok)
  await back()
  await expectAgentStatus(card('api'), 'pane')
  const [main, pane] = sshLog().map(forwardOf)
  expect(main).not.toBeNull()
  expect(pane).not.toBeNull()
  expect(pane!.remote).not.toBe(main!.remote)
  expect(pane!.local).not.toBe(main!.local)
})

test('#25 AC5: exit removes the remote socket, the remote directory and the local socket', async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('api')
  await connected()
  await expect.poll(sshLog).toHaveLength(1)
  const forward = forwardOf(sshLog()[0])!
  const bin = await output('echo "$DROVR_BIN"', 'bin')
  expect(bin).toMatch(new RegExp(`^${escaped(join(fake.home, 'tmp'))}/drovr\\.[A-Za-z0-9]{8}$`))
  expect(present(forward.remote)).toBe(true)
  expect(present(bin)).toBe(true)
  expect(present(forward.local)).toBe(true)

  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(tileStatus('api')).toHaveText('Stopped')
  await expect.poll(() => present(forward.local)).toBe(false)
  expect(present(forward.remote)).toBe(false)
  expect(present(bin)).toBe(false)
})

test('#25 AC5: no session socket is left after quit, and a leftover is removed at launch', async () => {
  const boardDir = join(dataDir, 'board')
  mkdirSync(boardDir, { recursive: true, mode: 0o700 })
  writeFileSync(join(boardDir, 's-old.sock'), '')
  await launch()
  await expect.poll(sessionSockets).toEqual([])
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('api')
  await connected()
  await back()
  await createCard('web')
  await connected()
  expect(sessionSockets()).toHaveLength(2)

  await app!.close()
  app = undefined
  expect(sessionSockets()).toEqual([])
})

test('#25 AC6: a host refusing the forward still runs the card; board cannot reach Drovr', async () => {
  await launch({ FAKE_SSH_NO_FORWARD: '1' })
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('api')
  await connected()
  await expect
    .poll(async () =>
      // Not anchored: the probe typed while ssh connects can echo on the same row.
      (await bufferLines()).some((l) =>
        /Warning: remote port forwarding failed for listen path \/tmp\/drovr-[0-9a-f]{32}\.sock/.test(
          l
        )
      )
    )
    .toBe(true)
  expect(await remoteRun('board status . hi')).toEqual(
    refused("board: can't reach Drovr from this host")
  )
  await expectRunning()
})

/** `api`'s activity pill on the board reads `text`, or is absent for null (#31 D13). */
async function expectPill(text: string | null): Promise<void> {
  await checkOnBoard(page, 'api', async (tile) => {
    await expect(tile.getByTestId('card-status-label')).toHaveText('Running')
    if (text === null) await expect(tile.getByTestId('card-activity')).toHaveCount(0)
    else await expect(tile.getByTestId('card-activity')).toHaveText(text)
  })
}

test('#31 AC11: board activity works in an SSH card and its extra pane, cleared on exit', async () => {
  await launch()
  await createSsh('me@devbox', REMOTE_DIR, 'remote')
  await createCard('api')
  await connected()

  expect(await remoteRun('board activity . working')).toEqual(ok)
  await expectPill('Working')
  expect(await remoteRun('board activity . waiting')).toEqual(ok)
  await expectPill('Waiting for you')
  expect(await remoteRun('board activity . question')).toEqual(ok)
  await expectPill('Needs your answer')
  expect(await remoteRun('board activity . none')).toEqual(ok)
  await expectPill(null)
  expect(await remoteRun('board activity . busy')).toEqual({
    code: 2,
    stdout: '',
    stderr: BOARD_USAGE
  })

  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  await expect.poll(sshLog).toHaveLength(2)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')
  await run('echo "up:$(echo pane)"')
  await expect.poll(() => paneLines(1)).toContain('up:pane')
  expect(await remoteRun('board activity . question', () => paneLines(1))).toEqual(ok)
  await expectPill('Needs your answer')
  expect(await remoteRun('board activity . busy', () => paneLines(1))).toEqual({
    code: 2,
    stdout: '',
    stderr: BOARD_USAGE
  })
  expect(await remoteRun('board activity . working', () => paneLines(1))).toEqual(ok)
  await expectPill('Working')

  // `exit` in the main pane: Stopped with no pill; reopened, it connects again with none.
  await panes().nth(0).getByTestId('terminal').click()
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'true')
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('api').getByTestId('card-status')).toHaveText('Stopped')
  await expect(card('api').getByTestId('card-activity')).toHaveCount(0)
  await openCard('api')
  await connected()
  await back()
  await expect(tileStatus('api')).toHaveText('Running')
  await expect(card('api').getByTestId('card-activity')).toHaveCount(0)
})
