import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/** Launches an instance with its own home under the test's root (D15); reuse `dataDir` to restart. */
async function launch(home: string, dataDir = newDataDir()): Promise<Instance> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
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
  await page.getByTestId('card-back').click()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
}

/** Opens the workspace dialog for the row at `index` (row actions show on hover). */
async function editWorkspace(page: Page, index: number): Promise<void> {
  const row = page.locator('.workspace-row').nth(index)
  await row.hover()
  await row.getByTestId('workspace-edit').click()
}

const settings = (page: Page): Locator => page.getByTestId('settings-dialog')

/** Types `folder` into Settings → Sync folder and presses Enter, leaving Settings open. */
async function setSyncFolder(page: Page, folder: string): Promise<void> {
  if ((await settings(page).count()) === 0) await page.getByTestId('settings-open').click()
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
  await settings(a.page).getByTestId('settings-theme-dark').check()
  await closeSettings(a.page)
  await expect(a.page.getByTestId('sync-status')).toHaveText(SYNCED)
  await quit(a)

  a = await launch(a.home, a.dataDir)
  await expect(a.page.getByTestId('sync-status')).toHaveText(SYNCED)
  await a.page.getByTestId('settings-open').click()
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
  await a.page.getByTestId('settings-open').click()
  await expect(settings(a.page).getByTestId('settings-sync-folder')).toHaveValue('')
  await expect(settings(a.page).getByTestId('settings-sync-off')).toHaveCount(0)
  await expect(settings(a.page).getByTestId('settings-theme-dark')).toBeChecked()
  await expect(settings(a.page).getByTestId('settings-font-size')).toHaveValue('16')
  await expect(settings(a.page).getByTestId('settings-font-family')).toHaveValue('Courier New')
})
