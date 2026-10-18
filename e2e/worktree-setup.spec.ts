import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Worktree setup (#39): the workspace's command typed in each new worktree card before its
// startup command. S1: the workspace field, its one-line check, restart and sync.

const apps: ElectronApplication[] = []
let root: string

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drovr-setup-'))
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
}

/** Launches an instance on `dataDir` (reuse it to restart) with its own home (`DROVR_HOME_DIR`). */
async function launch(dataDir: string, home = makeDir('home')): Promise<Instance> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  env['DROVR_HOME_DIR'] = home
  const launched = await launchApp({ dataDir, env })
  apps.push(launched.app)
  return launched
}

async function quit(app: ElectronApplication): Promise<void> {
  await app.close()
  apps.splice(apps.indexOf(app), 1)
}

async function createWorkspace(page: Page, dir: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Opens the workspace dialog for the row at `index` (row actions show on hover). */
async function editWorkspace(page: Page, index: number): Promise<void> {
  const row = page.locator('.workspace-row').nth(index)
  await row.hover()
  await row.getByTestId('workspace-edit').click()
  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
}

async function saveDialog(page: Page): Promise<void> {
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

const setupField = (page: Page): Locator => page.getByTestId('workspace-worktree-setup')

test('AC1: Worktree setup is saved, shown on reopen and after a restart; SSH shows no field', async () => {
  const dataDir = newDataDir()
  const first = await launch(dataDir)
  let page = first.page
  await createWorkspace(page, makeDir('api'), 'api')

  await editWorkspace(page, 0)
  await expect(setupField(page)).toHaveValue('')
  await setupField(page).fill('npm ci')
  await saveDialog(page)
  await editWorkspace(page, 0)
  await expect(setupField(page)).toHaveValue('npm ci')
  // Choosing SSH hides the field; back on This computer it still holds the value.
  await page.getByTestId('workspace-location-ssh').click()
  await expect(setupField(page)).toHaveCount(0)
  await page.getByTestId('workspace-location-local').click()
  await expect(setupField(page)).toHaveValue('npm ci')
  await page.getByTestId('workspace-cancel').click()

  await quit(first.app)
  ;({ page } = await launch(dataDir))
  await editWorkspace(page, 0)
  await expect(setupField(page)).toHaveValue('npm ci')
  await page.getByTestId('workspace-cancel').click()
  const saved = JSON.parse(readFileSync(join(dataDir, 'drovr-state.json'), 'utf8')) as {
    state: { workspaces: { worktreeSetup: string }[] }
  }
  expect(saved.state.workspaces[0]!.worktreeSetup).toBe('npm ci')

  // An SSH workspace's dialog has no Worktree setup, when created or edited.
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-location-ssh').click()
  await expect(setupField(page)).toHaveCount(0)
  await page.getByTestId('workspace-host').fill('devbox')
  await page.getByTestId('workspace-directory').fill('~/api')
  await page.getByTestId('workspace-name').fill('remote')
  await saveDialog(page)
  await editWorkspace(page, 1)
  await expect(page.getByTestId('workspace-host')).toHaveValue('devbox')
  await expect(setupField(page)).toHaveCount(0)
})

test('AC2: pasting two lines into Worktree setup says it must be one line and saves nothing', async () => {
  const { app, page } = await launch(newDataDir())
  await createWorkspace(page, makeDir('api'), 'api')
  await editWorkspace(page, 0)
  await app.evaluate(({ clipboard }) => clipboard.writeText('a\nb'))
  await setupField(page).focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-setup')).toHaveText('Command must be one line')
  await page.getByTestId('workspace-cancel').click()
  await editWorkspace(page, 0)
  await expect(setupField(page)).toHaveValue('')
})

test('AC12: Worktree setup set on one instance shows in the other instance’s dialog', async () => {
  const folder = makeDir('F')
  const a = await launch(newDataDir(), makeDir('ha'))
  await createWorkspace(a.page, makeDir('ha', 'api'), 'api')
  makeDir('hb', 'api')
  const b = await launch(newDataDir(), makeDir('hb'))
  for (const { page } of [a, b]) {
    await page.getByTestId('settings-open').click()
    const settings = page.getByTestId('settings-dialog')
    await settings.getByTestId('settings-section-sync').click()
    await settings.getByTestId('settings-sync-folder').fill(folder)
    await settings.getByTestId('settings-sync-folder').press('Enter')
    await expect(page.getByTestId('sync-status')).toHaveText(/^Synced \d\d:\d\d$/)
    await settings.getByTestId('settings-done').click()
  }
  await expect(b.page.locator('.workspace-row')).toHaveCount(1)

  await editWorkspace(a.page, 0)
  await setupField(a.page).fill('npm ci')
  await saveDialog(a.page)
  await expect
    .poll(
      async () => {
        await editWorkspace(b.page, 0)
        const value = await setupField(b.page).inputValue()
        await b.page.getByTestId('workspace-cancel').click()
        return value
      },
      { timeout: 10000 }
    )
    .toBe('npm ci')
})
