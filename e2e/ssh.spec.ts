import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, newDataDir, removeDataDirs } from './launch'

// SSH workspaces (#12): the dialog's Location choice and Host field, the sidebar tooltip, and the
// host in the saved-state file. Each test has its own data directory and "restarts" by closing
// the app and launching it again on the same one. `/tmp/drovr-remote` is an existing directory.

const REMOTE_DIR = '/tmp/drovr-remote'

let app: ElectronApplication | undefined
let page: Page
let dataDir: string

test.beforeAll(() => {
  mkdirSync(REMOTE_DIR, { recursive: true })
})

test.beforeEach(() => {
  dataDir = newDataDir()
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

async function launch(): Promise<void> {
  ;({ app, page } = await launchApp({ dataDir }))
}

async function restart(): Promise<void> {
  await app?.close()
  await launch()
}

const stateFile = (): string => join(dataDir, 'drovr-state.json')

const dialog = (): Locator => page.getByTestId('workspace-dialog')

async function openCreateDialog(): Promise<void> {
  await page.getByTestId('workspace-add').click()
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
  await expect(page.getByTestId('card-view-title')).toHaveText(title)
  await page.getByTestId('card-back').click()
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
    startup: { kind: 'shell' },
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
