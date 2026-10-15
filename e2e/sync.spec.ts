import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync
} from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addFakeAgents, agentLogLines } from './fake-agents'
import { claudeLogLines, REMOTE_SETTINGS_ARGS, SETTINGS_ARGS } from './fake-claude'
import { fakeSshHome, removeRemoteForwards } from './fake-ssh'
import { backToBoard, expectCardOpen } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'

// Sync between machines (#13). Every instance has its own data directory and its own home
// (`DROVR_HOME_DIR`, D15); a test's instances share one temp sync folder.

const apps: ElectronApplication[] = []
let root: string

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drovr-sync-'))
})

test.afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => {})
  removeDataDirs()
  // The SSH tests' fake hosts `a` and `b` (#25): their sessions' remote socket paths in /tmp.
  for (const host of ['a', 'b']) removeRemoteForwards(join(root, host, 'ssh.log'))
  rmSync(root, { recursive: true, force: true })
})

function makeDir(...parts: string[]): string {
  const dir = join(root, ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

interface Instance {
  app: ElectronApplication
  page: Page
  dataDir: string
  home: string
}

/**
 * Launches an instance with its own home under the test's root (D15); reuse `dataDir` to restart.
 * `base` is the environment to start from (this process's when omitted).
 */
async function launch(
  home: string,
  dataDir = newDataDir(),
  base: Record<string, string | undefined> = process.env
): Promise<Instance> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) if (value !== undefined) env[key] = value
  env['DROVR_HOME_DIR'] = home
  const launched = await launchApp({ dataDir, env })
  apps.push(launched.app)
  return { ...launched, home }
}

async function quit(instance: Instance): Promise<void> {
  await instance.app.close()
  apps.splice(apps.indexOf(instance.app), 1)
}

async function createWorkspace(page: Page, dir: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Creates card `Terminal N` in Backlog and goes back to the board. */
async function createCard(page: Page): Promise<void> {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').press('Enter')
  await expect(page.getByTestId('card-view')).toBeVisible()
  await backToBoard(page)
  await expect(page.getByTestId('card-view')).toHaveCount(0)
}

/** Opens the workspace dialog for the row at `index` (row actions show on hover). */
async function editWorkspace(page: Page, index: number): Promise<void> {
  const row = page.locator('.workspace-row').nth(index)
  await row.hover()
  await row.getByTestId('workspace-edit').click()
}

const settings = (page: Page): Locator => page.getByTestId('settings-dialog')

/** Opens Settings when it isn't open, on section `section` (`sync`, `appearance`…). */
async function settingsSection(page: Page, section: string): Promise<void> {
  if ((await settings(page).count()) === 0) await page.getByTestId('settings-open').click()
  await settings(page).getByTestId(`settings-section-${section}`).click()
}

/** Types `folder` into Settings → Sync folder and presses Enter, leaving Settings open. */
async function setSyncFolder(page: Page, folder: string): Promise<void> {
  await settingsSection(page, 'sync')
  await settings(page).getByTestId('settings-sync-folder').fill(folder)
  await settings(page).getByTestId('settings-sync-folder').press('Enter')
}

async function closeSettings(page: Page): Promise<void> {
  await settings(page).getByTestId('settings-done').click()
  await expect(settings(page)).toHaveCount(0)
}

interface SyncFile {
  version: number
  savedAt: string
  board: {
    workspaces: {
      id: string
      name: string
      directory: string
      host?: string
      columns: { id: string; name: string }[]
      cards: { title: string; columnId: string; directory: string }[]
    }[]
  }
}

const syncFilePath = (folder: string): string => join(folder, 'drovr-board.json')

function readSyncFile(folder: string): SyncFile | null {
  const path = syncFilePath(folder)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SyncFile
  } catch {
    return null
  }
}

const workspaceNames = (page: Page): Promise<string[]> =>
  page.getByTestId('workspace-item').locator('.workspace-name').allInnerTexts()

const SYNCED = /^Synced \d\d:\d\d$/

test('AC1: turning sync on with an empty folder writes the board and shows Synced', async () => {
  const a = await launch(makeDir('ha'))
  const folder = makeDir('F')
  await createWorkspace(a.page, makeDir('ha', 'api'), 'api')
  await createCard(a.page)
  await expect(a.page.getByTestId('sync-status')).toHaveCount(0)

  await setSyncFolder(a.page, folder)
  await expect.poll(() => readSyncFile(folder), { timeout: 2000 }).not.toBeNull()
  const file = readSyncFile(folder)!
  expect(file.version).toBe(1)
  expect(Number.isNaN(Date.parse(file.savedAt))).toBe(false)
  expect(file).not.toHaveProperty('activeId')
  expect(file.board).not.toHaveProperty('activeId')
  expect(file.board.workspaces).toHaveLength(1)
  const [api] = file.board.workspaces
  expect(api.name).toBe('api')
  expect(api.columns.map((c) => c.name)).toEqual(['Backlog', 'Running', 'Needs me', 'Done'])
  expect(api.cards.map((c) => c.title)).toEqual(['Terminal 1'])
  expect(api.cards[0].columnId).toBe(api.columns[0].id)

  await expect(settings(a.page).getByTestId('settings-sync-status')).toHaveText(SYNCED)
  await closeSettings(a.page)
  await expect(a.page.getByTestId('sync-status')).toHaveText(SYNCED)
})

test("AC3: turning sync on joins the folder's board with this machine's, keeping the active workspace", async () => {
  const folder = makeDir('F')
  const a = await launch(makeDir('ha'))
  await createWorkspace(a.page, makeDir('ha', 'api'), 'api')
  await setSyncFolder(a.page, folder)
  await expect
    .poll(() => readSyncFile(folder)?.board.workspaces.map((w) => w.name))
    .toEqual(['api'])

  const b = await launch(makeDir('hb'))
  await createWorkspace(b.page, makeDir('hb', 'web'), 'web')
  await setSyncFolder(b.page, folder)
  await closeSettings(b.page)
  await expect.poll(() => workspaceNames(b.page)).toEqual(['api', 'web'])
  await expect(
    b.page.locator('[data-testid=workspace-item][aria-current=true] .workspace-name')
  ).toHaveText('web')
  await expect(b.page.getByTestId('sync-status')).toHaveText(SYNCED)
  await expect
    .poll(() => readSyncFile(folder)?.board.workspaces.map((w) => w.name), { timeout: 2000 })
    .toEqual(['api', 'web'])
  await expect.poll(() => workspaceNames(a.page), { timeout: 5000 }).toEqual(['api', 'web'])
  // The joined board is B's saved board too.
  await quit(b)
  const saved = JSON.parse(readFileSync(join(b.dataDir, 'drovr-state.json'), 'utf8')) as {
    state: { workspaces: { name: string; directory: string }[]; activeId: string }
  }
  expect(saved.state.workspaces.map((w) => [w.name, w.directory])).toEqual([
    ['api', join(b.home, 'api')],
    ['web', join(b.home, 'web')]
  ])
})

test('AC5: local directories under home are written as ~ and read under the other home; SSH ones unchanged', async () => {
  const folder = makeDir('F')
  const a = await launch(makeDir('ha'))
  await setSyncFolder(a.page, folder)
  await closeSettings(a.page)
  await createWorkspace(a.page, makeDir('ha', 'proj'), 'proj')
  await a.page.getByTestId('workspace-add').click()
  await a.page.getByTestId('workspace-location-ssh').click()
  await a.page.getByTestId('workspace-host').fill('devbox')
  await a.page.getByTestId('workspace-directory').fill('~/srv')
  await a.page.getByTestId('workspace-name').fill('srv')
  await a.page.getByTestId('workspace-submit').click()
  await expect(a.page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect
    .poll(() =>
      readSyncFile(folder)?.board.workspaces.map((w) => [w.name, w.directory, w.host ?? null])
    )
    .toEqual([
      ['proj', '~/proj', null],
      ['srv', '~/srv', 'devbox']
    ])

  // B joins: its workspace dialog shows the directory under its own home.
  const b = await launch(makeDir('hb'))
  await setSyncFolder(b.page, folder)
  await closeSettings(b.page)
  await expect.poll(() => workspaceNames(b.page)).toEqual(['proj', 'srv'])
  await editWorkspace(b.page, 0)
  await expect(b.page.getByTestId('workspace-directory')).toHaveValue(join(b.home, 'proj'))
  await b.page.keyboard.press('Escape')
  await editWorkspace(b.page, 1)
  await expect(b.page.getByTestId('workspace-host')).toHaveValue('devbox')
  await expect(b.page.getByTestId('workspace-directory')).toHaveValue('~/srv')
})

test('AC11: a bad folder shows Folder not found and keeps sync; Turn off stops writing', async () => {
  const folder = makeDir('F')
  const a = await launch(makeDir('ha'))
  await createWorkspace(a.page, makeDir('ha', 'api'), 'api')
  await setSyncFolder(a.page, folder)
  await expect(settings(a.page).getByTestId('settings-sync-status')).toHaveText(SYNCED)

  await setSyncFolder(a.page, '/no/such/dir')
  await expect(settings(a.page).getByTestId('settings-error-sync-folder')).toHaveText(
    'Folder not found'
  )
  await expect(settings(a.page).getByTestId('settings-sync-status')).toHaveText(SYNCED)
  await expect(a.page.getByTestId('sync-status')).toHaveText(SYNCED)

  await settings(a.page).getByTestId('settings-sync-off').click()
  await expect(settings(a.page).getByTestId('settings-sync-folder')).toHaveValue('')
  await expect(settings(a.page).getByTestId('settings-sync-off')).toHaveCount(0)
  await expect(settings(a.page).getByTestId('settings-sync-status')).toHaveCount(0)
  await expect(settings(a.page).getByTestId('settings-error-sync-folder')).toHaveCount(0)
  await closeSettings(a.page)
  await expect(a.page.getByTestId('sync-status')).toHaveCount(0)

  const before = readFileSync(syncFilePath(folder), 'utf8')
  await createCard(a.page)
  await createWorkspace(a.page, makeDir('ha', 'web'), 'web')
  await a.page.waitForTimeout(1500)
  expect(readFileSync(syncFilePath(folder), 'utf8')).toBe(before)
})

test('AC12: the sync folder is kept per machine across a restart, never in the sync file', async () => {
  const folder = makeDir('F')
  let a = await launch(makeDir('ha'))
  await createWorkspace(a.page, makeDir('ha', 'api'), 'api')
  await setSyncFolder(a.page, folder)
  await settingsSection(a.page, 'appearance')
  await settings(a.page).getByTestId('settings-theme-dark').check()
  await closeSettings(a.page)
  await expect(a.page.getByTestId('sync-status')).toHaveText(SYNCED)
  await quit(a)

  a = await launch(a.home, a.dataDir)
  await expect(a.page.getByTestId('sync-status')).toHaveText(SYNCED)
  await settingsSection(a.page, 'sync')
  await expect(settings(a.page).getByTestId('settings-sync-folder')).toHaveValue(folder)
  await expect(settings(a.page).getByTestId('settings-sync-status')).toHaveText(SYNCED)

  const settingsFile = JSON.parse(readFileSync(join(a.dataDir, 'drovr-settings.json'), 'utf8')) as {
    settings: Record<string, unknown>
  }
  expect(settingsFile.settings.syncFolder).toBe(folder)
  expect(settingsFile.settings.theme).toBe('dark')
  const syncText = readFileSync(syncFilePath(folder), 'utf8')
  for (const key of ['syncFolder', 'theme', 'fontSize', 'fontFamily', 'activeId']) {
    expect(syncText).not.toContain(`"${key}"`)
  }
})

test('AC12: a settings file from #10 without syncFolder loads with sync off and keeps theme and font', async () => {
  const dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'drovr-settings.json'),
    '{"version":1,"settings":{"theme":"dark","fontSize":16,"fontFamily":"Courier New"}}'
  )
  const a = await launch(makeDir('ha'), dataDir)
  await expect(a.page.getByTestId('sidebar')).toBeVisible()
  await expect(a.page.getByTestId('sync-status')).toHaveCount(0)
  await settingsSection(a.page, 'sync')
  await expect(settings(a.page).getByTestId('settings-sync-folder')).toHaveValue('')
  await expect(settings(a.page).getByTestId('settings-sync-off')).toHaveCount(0)
  await settingsSection(a.page, 'appearance')
  await expect(settings(a.page).getByTestId('settings-theme-dark')).toBeChecked()
  await expect(settings(a.page).getByTestId('settings-font-size')).toHaveValue('16')
  await expect(settings(a.page).getByTestId('settings-font-family')).toHaveValue('Courier New')
})

// Reading changes live (S2): two instances synced to one folder.

const card = (page: Page, title: string): Locator =>
  page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })

const column = (page: Page, name: string): Locator =>
  page.getByTestId('column').filter({ has: page.getByRole('heading', { name, exact: true }) })

const cardTitles = (scope: Locator): Promise<string[]> =>
  scope.getByTestId('card-title').allInnerTexts()

const activeWorkspace = (page: Page): Locator =>
  page.locator('[data-testid=workspace-item][aria-current=true] .workspace-name')

/** Creates card `title` in Backlog (its view opens and it starts), then goes back to the board. */
async function newCard(
  page: Page,
  title: string,
  startup?: 'Claude Code' | 'Codex'
): Promise<void> {
  await column(page, 'Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  if (startup) await page.getByTestId('new-card-startup').selectOption({ label: startup })
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await backToBoard(page)
  await expect(page.getByTestId('board')).toBeVisible()
}

async function renameCard(page: Page, from: string, to: string): Promise<void> {
  await card(page, from).getByTestId('card-menu').click()
  await page.getByTestId('card-menu-rename').click()
  await page.getByTestId('card-rename-input').fill(to)
  await page.getByTestId('card-rename-input').press('Enter')
  await expect(card(page, to)).toHaveCount(1)
}

/** Deletes a card from its menu, confirming when it is running. */
async function deleteCard(page: Page, title: string): Promise<void> {
  await card(page, title).getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  const confirm = page.getByTestId('confirm-delete')
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(card(page, title)).toHaveCount(0)
}

async function selectWorkspace(page: Page, name: string): Promise<void> {
  await page.getByTestId('workspace-item').filter({ hasText: name }).click()
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

/** A and B, each with its own home and data directory, both synced to `folder` with `api`. */
async function twoSynced(folder: string): Promise<{ a: Instance; b: Instance }> {
  makeDir('hb', 'api')
  const a = await launch(makeDir('ha'))
  await createWorkspace(a.page, makeDir('ha', 'api'), 'api')
  await setSyncFolder(a.page, folder)
  await closeSettings(a.page)
  const b = await launch(makeDir('hb'))
  await setSyncFolder(b.page, folder)
  await closeSettings(b.page)
  await expect.poll(() => workspaceNames(b.page)).toEqual(['api'])
  return { a, b }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('AC2: a rename and move on A reach B live, Stopped, with no process started on B', async () => {
  const folder = makeDir('F')
  const { a, b } = await twoSynced(folder)
  await newCard(a.page, 'Terminal 1')
  await expect(card(b.page, 'Terminal 1')).toHaveCount(1)

  await renameCard(a.page, 'Terminal 1', 'server')
  await card(a.page, 'server').getByTestId('card-menu').click()
  await a.page.getByTestId('card-menu-move-to').getByText('Running', { exact: true }).click()
  await expect(card(a.page, 'server')).toHaveCount(1)

  await expect
    .poll(() => cardTitles(column(b.page, 'Running')), { timeout: 5000 })
    .toEqual(['server'])
  await expect(card(b.page, 'Terminal 1')).toHaveCount(0)
  await expect(card(b.page, 'server').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(card(b.page, 'server').getByTestId('card-status-line')).toHaveCount(0)
})

test('AC4: deletions win, but a card running on B stays and is written back to A', async () => {
  const folder = makeDir('F')
  const { a, b } = await twoSynced(folder)
  await newCard(a.page, 'one')
  await newCard(a.page, 'two')
  await expect.poll(() => cardTitles(column(b.page, 'Backlog'))).toEqual(['one', 'two'])

  // Start `two` on B and read its shell's pid.
  await card(b.page, 'two').getByTestId('card-open').click()
  await expectCardOpen(b.page, 'two')
  const pidFile = join(root, 'pid-two')
  await expect
    .poll(() =>
      b.page.evaluate(
        () =>
          document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
      )
    )
    .toBe(true)
  await b.page.keyboard.type(`echo $$ > '${pidFile}'`)
  await b.page.keyboard.press('Enter')
  await expect
    .poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '')
    .toBe(true)
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  await backToBoard(b.page)
  await expect(card(b.page, 'two').getByTestId('card-status-label')).toHaveText('Running')

  await deleteCard(a.page, 'one')
  await deleteCard(a.page, 'two')

  await expect.poll(() => cardTitles(column(b.page, 'Backlog')), { timeout: 5000 }).toEqual(['two'])
  await expect(card(b.page, 'two').getByTestId('card-status-label')).toHaveText('Running')
  expect(alive(pid)).toBe(true)
  // B wrote the board back with `two`, and A shows it again, Stopped there.
  await expect.poll(() => cardTitles(column(a.page, 'Backlog')), { timeout: 5000 }).toEqual(['two'])
  await expect(card(a.page, 'two').getByTestId('card-status-label')).toHaveText('Stopped')
  await a.page.waitForTimeout(500)
  expect(alive(pid)).toBe(true)
  await expect(card(b.page, 'two').getByTestId('card-status-label')).toHaveText('Running')
})

test('#31 AC18: a card deleted by sync while its workspace is away is forgotten there', async () => {
  const folder = makeDir('F')
  const { a, b } = await twoSynced(folder)
  makeDir('hb', 'beta')
  await createWorkspace(a.page, makeDir('ha', 'beta'), 'beta')
  await selectWorkspace(a.page, 'api')
  await newCard(a.page, 'one')
  await expect.poll(() => workspaceNames(b.page)).toEqual(['api', 'beta'])
  await selectWorkspace(b.page, 'api')
  await expect(card(b.page, 'one')).toHaveCount(1)

  // B opens `one` and leaves it open; a running card on B outlives a deletion on A (#13 D8), so
  // its shell ends first.
  await card(b.page, 'one').getByTestId('card-open').click()
  await expectCardOpen(b.page, 'one')
  await expect
    .poll(() =>
      b.page.evaluate(
        () =>
          document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
      )
    )
    .toBe(true)
  await b.page.keyboard.type('sleep 1; exit')
  await b.page.keyboard.press('Enter')
  await selectWorkspace(b.page, 'beta')
  await b.page.waitForTimeout(2000)

  await deleteCard(a.page, 'one')
  await expect
    .poll(() => readSyncFile(folder)?.board.workspaces.find((w) => w.name === 'api')?.cards.length)
    .toBe(0)
  await b.page.waitForTimeout(1000)
  await selectWorkspace(b.page, 'api')
  await expect(b.page.getByTestId('card-view')).toHaveCount(0)
  await expect(b.page.getByTestId('board')).toBeVisible()
  await expect(card(b.page, 'one')).toHaveCount(0)
})

test('AC5: a workspace created on A reaches B live under its own home; SSH unchanged', async () => {
  const folder = makeDir('F')
  const { a, b } = await twoSynced(folder)
  await createWorkspace(a.page, makeDir('ha', 'proj'), 'proj')
  await a.page.getByTestId('workspace-add').click()
  await a.page.getByTestId('workspace-location-ssh').click()
  await a.page.getByTestId('workspace-host').fill('devbox')
  await a.page.getByTestId('workspace-directory').fill('~/srv')
  await a.page.getByTestId('workspace-name').fill('srv')
  await a.page.getByTestId('workspace-submit').click()
  await expect(a.page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect
    .poll(() => readSyncFile(folder)?.board.workspaces.map((w) => [w.name, w.directory]))
    .toEqual([
      ['api', '~/api'],
      ['proj', '~/proj'],
      ['srv', '~/srv']
    ])

  await expect.poll(() => workspaceNames(b.page), { timeout: 5000 }).toEqual(['api', 'proj', 'srv'])
  await editWorkspace(b.page, 1)
  await expect(b.page.getByTestId('workspace-directory')).toHaveValue(join(b.home, 'proj'))
  await b.page.keyboard.press('Escape')
  await editWorkspace(b.page, 2)
  await expect(b.page.getByTestId('workspace-host')).toHaveValue('devbox')
  await expect(b.page.getByTestId('workspace-directory')).toHaveValue('~/srv')
})

test("AC6: B starts A's local Claude Code card with --session-id and its SSH one with --resume", async () => {
  const remote = '/tmp/drovr-remote'
  mkdirSync(remote, { recursive: true })
  const folder = makeDir('F')
  const fakeA = fakeSshHome(makeDir('a'))
  const fakeB = fakeSshHome(makeDir('b'))
  mkdirSync(join(fakeA.home, 'api'))
  mkdirSync(join(fakeB.home, 'api'))
  const a = await launch(fakeA.home, newDataDir(), fakeA.env)
  await createWorkspace(a.page, join(fakeA.home, 'api'), 'api')
  await setSyncFolder(a.page, folder)
  await closeSettings(a.page)
  const b = await launch(fakeB.home, newDataDir(), fakeB.env)
  await setSyncFolder(b.page, folder)
  await closeSettings(b.page)
  await expect.poll(() => workspaceNames(b.page)).toEqual(['api'])

  await newCard(a.page, 'local', 'Claude Code')
  await a.page.getByTestId('workspace-add').click()
  await a.page.getByTestId('workspace-location-ssh').click()
  await a.page.getByTestId('workspace-host').fill('me@devbox')
  await a.page.getByTestId('workspace-directory').fill(remote)
  await a.page.getByTestId('workspace-name').fill('remote')
  await a.page.getByTestId('workspace-submit').click()
  await expect(a.page.getByTestId('workspace-dialog')).toHaveCount(0)
  await newCard(a.page, 'ssh', 'Claude Code')
  await expect.poll(() => claudeLogLines(fakeA.log), { timeout: 15_000 }).toHaveLength(2)

  // A's file: the SSH card started, the local one written as not started (D6).
  type FileCard = { title: string; agentSessionId: string; claudeStarted: boolean }
  const fileCards = (): FileCard[] =>
    (readSyncFile(folder)?.board.workspaces ?? []).flatMap((w) => w.cards as unknown as FileCard[])
  await expect
    .poll(() => fileCards().map((c) => [c.title, c.claudeStarted]))
    .toEqual([
      ['local', false],
      ['ssh', true]
    ])
  const id = (title: string): string => fileCards().find((c) => c.title === title)!.agentSessionId

  await expect.poll(() => workspaceNames(b.page), { timeout: 5000 }).toEqual(['api', 'remote'])
  await selectWorkspace(b.page, 'api')
  await card(b.page, 'local').getByTestId('card-open').click()
  await expect
    .poll(() => claudeLogLines(fakeB.log), { timeout: 15_000 })
    .toEqual([`${SETTINGS_ARGS} --session-id ${id('local')}`])
  await backToBoard(b.page)
  await selectWorkspace(b.page, 'remote')
  await card(b.page, 'ssh').getByTestId('card-open').click()
  await expect
    .poll(() => claudeLogLines(fakeB.log), { timeout: 15_000 })
    .toEqual([
      `${SETTINGS_ARGS} --session-id ${id('local')}`,
      expect.stringMatching(new RegExp(`^${REMOTE_SETTINGS_ARGS} --resume ${id('ssh')}$`))
    ])
})

/** The open card's terminal buffer on `page`, one trimmed string per line, wrapped lines joined. */
function bufferLines(page: Page): Promise<string[]> {
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

const typed = async (page: Page, line: string): Promise<boolean> =>
  (await bufferLines(page)).some((l) => l.endsWith(line))

test("#21 AC9: B starts A's local Codex card fresh and resumes its SSH one", async () => {
  const remote = '/tmp/drovr-remote'
  mkdirSync(remote, { recursive: true })
  const folder = makeDir('F')
  const fakeA = fakeSshHome(makeDir('a'))
  const fakeB = fakeSshHome(makeDir('b'))
  const logA = join(root, 'a', 'agents.log')
  const logB = join(root, 'b', 'agents.log')
  addFakeAgents(fakeA.home, logA)
  addFakeAgents(fakeB.home, logB)
  mkdirSync(join(fakeA.home, 'api'))
  mkdirSync(join(fakeB.home, 'api'))
  const a = await launch(fakeA.home, newDataDir(), fakeA.env)
  await createWorkspace(a.page, join(fakeA.home, 'api'), 'api')
  await setSyncFolder(a.page, folder)
  await closeSettings(a.page)
  const b = await launch(fakeB.home, newDataDir(), fakeB.env)
  await setSyncFolder(b.page, folder)
  await closeSettings(b.page)
  await expect.poll(() => workspaceNames(b.page)).toEqual(['api'])

  await newCard(a.page, 'local', 'Codex')
  await a.page.getByTestId('workspace-add').click()
  await a.page.getByTestId('workspace-location-ssh').click()
  await a.page.getByTestId('workspace-host').fill('me@devbox')
  await a.page.getByTestId('workspace-directory').fill(remote)
  await a.page.getByTestId('workspace-name').fill('remote')
  await a.page.getByTestId('workspace-submit').click()
  await expect(a.page.getByTestId('workspace-dialog')).toHaveCount(0)
  await newCard(a.page, 'ssh', 'Codex')
  await expect.poll(() => agentLogLines(logA), { timeout: 15_000 }).toEqual(['codex', 'codex'])

  // A's file: the SSH card started, the local one written with startedAgents empty (D7).
  type FileCard = { title: string; startedAgents: string[] }
  const fileCards = (): FileCard[] =>
    (readSyncFile(folder)?.board.workspaces ?? []).flatMap((w) => w.cards as unknown as FileCard[])
  await expect
    .poll(() => fileCards().map((c) => [c.title, c.startedAgents]))
    .toEqual([
      ['local', []],
      ['ssh', ['codex']]
    ])

  await expect.poll(() => workspaceNames(b.page), { timeout: 5000 }).toEqual(['api', 'remote'])
  await selectWorkspace(b.page, 'api')
  await card(b.page, 'local').getByTestId('card-open').click()
  await expect.poll(() => agentLogLines(logB), { timeout: 15_000 }).toEqual(['codex'])
  await expect.poll(() => bufferLines(b.page)).toContain('fake-codex')
  expect((await bufferLines(b.page)).join('\n')).not.toContain('resume')
  await backToBoard(b.page)
  await selectWorkspace(b.page, 'remote')
  await card(b.page, 'ssh').getByTestId('card-open').click()
  await expect
    .poll(() => agentLogLines(logB), { timeout: 15_000 })
    .toEqual(['codex', 'codex resume --last'])
  await expect.poll(() => typed(b.page, 'codex resume --last || codex')).toBe(true)
  expect(agentLogLines(logA)).toEqual(['codex', 'codex'])
})

test("AC7: the active workspace stays per machine; B's goes to the first when A deletes it", async () => {
  const folder = makeDir('F')
  const { a, b } = await twoSynced(folder)
  makeDir('hb', 'web')
  await createWorkspace(a.page, makeDir('ha', 'web'), 'web')
  await expect.poll(() => workspaceNames(b.page), { timeout: 5000 }).toEqual(['api', 'web'])
  await selectWorkspace(a.page, 'api')
  await selectWorkspace(b.page, 'web')

  await editWorkspace(a.page, 0)
  await a.page.getByTestId('workspace-name').fill('api2')
  await a.page.getByTestId('workspace-submit').click()
  await expect(a.page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect.poll(() => workspaceNames(b.page), { timeout: 5000 }).toEqual(['api2', 'web'])
  await expect(activeWorkspace(b.page)).toHaveText('web')

  const row = a.page.locator('.workspace-row').nth(1)
  await row.hover()
  await row.getByTestId('workspace-delete').click()
  await a.page.getByTestId('confirm-delete').click()
  await expect.poll(() => workspaceNames(b.page), { timeout: 5000 }).toEqual(['api2'])
  await expect(activeWorkspace(b.page)).toHaveText('api2')
  await expect(activeWorkspace(a.page)).toHaveText('api2')
})

test("AC8: launch reads the folder, so B's first board shows A's rename made while B was closed", async () => {
  const folder = makeDir('F')
  const { a, b } = await twoSynced(folder)
  await newCard(a.page, 'x')
  await expect(card(b.page, 'x')).toHaveCount(1)
  await quit(b)

  await renameCard(a.page, 'x', 'y')
  await expect
    .poll(() => readSyncFile(folder)?.board.workspaces[0].cards.map((c) => c.title))
    .toEqual(['y'])

  const b2 = await launch(b.home, b.dataDir)
  // No polling: the first render already shows the folder's board.
  expect(await cardTitles(b2.page.getByTestId('board'))).toEqual(['y'])
})

test('AC13: one change is written once and never echoed between the machines', async () => {
  const folder = makeDir('F')
  const { a, b } = await twoSynced(folder)
  await newCard(a.page, 'one')
  await expect(card(b.page, 'one')).toHaveCount(1)
  // Let both settle, then count every write of the file from here on.
  await a.page.waitForTimeout(1000)
  const writes = new Set<string>()
  const watcher = watch(folder, (_, name) => {
    if (name !== 'drovr-board.json') return
    const savedAt = readSyncFile(folder)?.savedAt
    if (savedAt) writes.add(savedAt)
  })
  try {
    await renameCard(a.page, 'one', 'uno')
    await expect(card(b.page, 'uno')).toHaveCount(1, { timeout: 5000 })
    await a.page.waitForTimeout(5000)
    expect(writes.size).toBe(1)
  } finally {
    watcher.close()
  }
})

// Failures (S3, D12).

/** A synced to `folder` with workspace `api`, Settings closed. */
async function oneSynced(folder: string): Promise<Instance> {
  const a = await launch(makeDir('ha'))
  await createWorkspace(a.page, makeDir('ha', 'api'), 'api')
  await setSyncFolder(a.page, folder)
  await closeSettings(a.page)
  await expect(a.page.getByTestId('sync-status')).toHaveText(SYNCED)
  return a
}

const cardsInFile = (folder: string): string[] | undefined =>
  readSyncFile(folder)?.board.workspaces[0]?.cards.map((c) => c.title)

test('AC9: a removed folder shows unavailable, changes persist across a restart, and it is written again once back', async () => {
  const folder = makeDir('F')
  let a = await oneSynced(folder)

  rmSync(folder, { recursive: true, force: true })
  await expect(a.page.getByTestId('sync-status')).toHaveText('Sync folder unavailable', {
    timeout: 5000
  })
  await newCard(a.page, 'offline')
  await expect(a.page.getByTestId('sync-status')).toHaveText('Sync folder unavailable')

  await quit(a)
  a = await launch(a.home, a.dataDir)
  await expect(card(a.page, 'offline')).toHaveCount(1)
  await expect(a.page.getByTestId('sync-status')).toHaveText('Sync folder unavailable')

  mkdirSync(folder)
  await expect.poll(() => cardsInFile(folder), { timeout: 5000 }).toEqual(['offline'])
  await expect(a.page.getByTestId('sync-status')).toHaveText(SYNCED)
  // Watched again: a later change reaches the file.
  await newCard(a.page, 'back')
  await expect.poll(() => cardsInFile(folder), { timeout: 2000 }).toEqual(['offline', 'back'])
})

test('AC10: an unreadable file shows unreadable, the board stays, and the file is never overwritten', async () => {
  const folder = makeDir('F')
  const a = await oneSynced(folder)
  await newCard(a.page, 'one')
  await expect.poll(() => cardsInFile(folder), { timeout: 2000 }).toEqual(['one'])

  writeFileSync(syncFilePath(folder), 'not json')
  await expect(a.page.getByTestId('sync-status')).toHaveText('Sync file unreadable', {
    timeout: 5000
  })
  expect(await cardTitles(a.page.getByTestId('board'))).toEqual(['one'])

  await newCard(a.page, 'two')
  expect(await cardTitles(a.page.getByTestId('board'))).toEqual(['one', 'two'])
  await a.page.waitForTimeout(2000)
  expect(readFileSync(syncFilePath(folder), 'utf8')).toBe('not json')
  await expect(a.page.getByTestId('sync-status')).toHaveText('Sync file unreadable')
})

// Async I/O for the sync folder (#26).

test('#26 AC6: a change made just before quit is in the file once the app has exited', async () => {
  test.skip(process.platform === 'darwin', 'closing the last window quits only off macOS')
  const folder = makeDir('F')
  const a = await oneSynced(folder)
  await editWorkspace(a.page, 0)
  await a.page.getByTestId('workspace-name').fill('renamed')
  const child = a.app.process()
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  // The window is closed (quitting the app) by the page itself as soon as the rename is stored
  // (and so saved: the dialog closes after the store's save), well within `SYNC_WRITE_DELAY_MS`,
  // so only quit's flush can write the change. No card runs, so only the sync folder holds this
  // quit (D5).
  await a.page
    .evaluate(() => {
      const closeOnceStored = new MutationObserver(() => {
        if (document.querySelector('[data-testid="workspace-dialog"]') !== null) return
        closeOnceStored.disconnect()
        window.close()
      })
      closeOnceStored.observe(document.body, { childList: true, subtree: true })
      document.querySelector<HTMLButtonElement>('[data-testid="workspace-submit"]')!.click()
    })
    .catch(() => {})
  await exited
  apps.splice(apps.indexOf(a.app), 1)
  expect(readSyncFile(folder)?.board.workspaces.map((w) => w.name)).toEqual(['renamed'])
  // The flush finished, so the process ended on its own, not by D5's SIGKILL.
  expect(child.signalCode).toBeNull()
})

/** 2 × `QUIT_WAIT_MS` (the kill's 2 s grace period + 1 s, #18 D2) plus 5 s (#26 AC6). */
const STALLED_QUIT_BOUND_MS = 2 * 3_000 + 5_000

test('#26 AC6: with the sync file stalled, the app still ends within two quit holds', async () => {
  const folder = makeDir('F')
  const a = await oneSynced(folder)
  await quit(a)
  // A FIFO left unfed: the launch read never returns.
  rmSync(syncFilePath(folder))
  execFileSync('mkfifo', [syncFilePath(folder)])
  const b = await launch(a.home, a.dataDir)
  await expect(b.page.getByTestId('sync-status')).toHaveCount(0)

  const child = b.app.process()
  const ended = new Promise<number>((resolve) => child.once('exit', () => resolve(Date.now())))
  const quitAt = Date.now()
  await b.app.evaluate(({ app }) => app.quit()).catch(() => {})
  expect((await ended) - quitAt).toBeLessThan(STALLED_QUIT_BOUND_MS)
  // D5: main ended itself, as libuv would wait forever for the stalled read's thread.
  expect(child.signalCode).toBe('SIGKILL')
  apps.splice(apps.indexOf(b.app), 1)
})

test("#26 AC1: a stalled sync file freezes nothing, and this machine's changed board wins once it is read", async () => {
  const folder = makeDir('F')
  const a = await oneSynced(folder)
  const valid = JSON.parse(readFileSync(syncFilePath(folder), 'utf8')) as SyncFile
  await quit(a)
  // A FIFO with no writer: reading it never returns until something writes into it. `feed` is
  // the same FIFO under another name, so the file can be made a regular one before it is fed.
  rmSync(syncFilePath(folder))
  execFileSync('mkfifo', [syncFilePath(folder)])
  const feed = join(root, 'feed')
  linkSync(syncFilePath(folder), feed)

  const b = await launch(a.home, a.dataDir)
  try {
    expect(await workspaceNames(b.page)).toEqual(['api'])
    // D4: the status stays `off` (no status line) until the launch read finishes.
    await expect(b.page.getByTestId('sync-status')).toHaveCount(0)
    await column(b.page, 'Backlog').getByTestId('new-card').click()
    await b.page.getByTestId('new-card-input').press('Enter')
    await expect(b.page.getByTestId('card-view')).toBeVisible()
    await b.page.keyboard.type('echo ok-$((40+2))')
    await b.page.keyboard.press('Enter')
    await expect.poll(() => bufferLines(b.page), { timeout: 5000 }).toContain('ok-42')

    // Focusing the window asks for another read, which waits behind the stalled one.
    await b.app.evaluate(({ app, BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows()
      window?.focus()
      app.emit('browser-window-focus', {}, window)
    })
    await b.page.keyboard.type('echo ok-$((40+3))')
    await b.page.keyboard.press('Enter')
    await expect.poll(() => bufferLines(b.page), { timeout: 5000 }).toContain('ok-43')
    await backToBoard(b.page)
    expect(await workspaceNames(b.page)).toEqual(['api'])
    await expect(b.page.getByTestId('sync-status')).toHaveCount(0)

    // Another machine's board, with the workspace renamed `remote`.
    valid.savedAt = new Date().toISOString()
    valid.board.workspaces[0].name = 'remote'
    const text = JSON.stringify(valid)
    const next = join(root, 'next.json')
    writeFileSync(next, text)
    renameSync(next, syncFilePath(folder))
    await writeFile(feed, text)
    // D4: this machine's board changed since launch (its new card), so it wins and is written.
    await expect(b.page.getByTestId('sync-status')).toHaveText(SYNCED, { timeout: 5000 })
    await expect
      .poll(() => readSyncFile(folder)?.board.workspaces.map((w) => w.name), { timeout: 5000 })
      .toEqual(['api'])
    expect(cardsInFile(folder)).toEqual(['Terminal 1'])
    expect(await workspaceNames(b.page)).toEqual(['api'])
    expect(await cardTitles(column(b.page, 'Backlog'))).toEqual(['Terminal 1'])
  } finally {
    // A read still stalled would keep the app from exiting (libuv waits for its thread): opening
    // the FIFO read-write never blocks and, once closed, ends any stalled read with EOF.
    closeSync(openSync(feed, 'r+'))
  }
})
