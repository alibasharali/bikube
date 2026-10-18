import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, boardCard, closeCard, expectCardOpen } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Worktree setup (#39): the workspace's command typed in each new worktree card before its
// startup command. S1: the workspace field, its one-line check, restart and sync. S2: the
// card's pending setup, the setup line before the startup command, `board setup`, the hint. S3:
// the Setting up and Setup failed pills, Retry setup and Skip setup.

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

  // A setup ending in ; & or | would never report back: refused too.
  await setupField(page).fill('npm ci;')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-setup')).toHaveText(
    "Command can't end with ; & or |"
  )
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

// S2: worktree cards in a throwaway repository, whose startup command prints AGENT-STARTED.

const AGENT = 'AGENT-STARTED'

/** A git repository with one commit, on main. */
function makeRepo(): string {
  const repo = makeDir('repo')
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repo })
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  return repo
}

/** A workspace on `dir` whose cards run `echo AGENT-STARTED`, with Worktree setup `setup`. */
async function createSetupWorkspace(page: Page, dir: string, setup: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-command').fill(`echo ${AGENT}`)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill('repo')
  await setupField(page).fill(setup)
  await saveDialog(page)
}

/** Creates card `title` in the first column, with its own worktree when `worktree`. */
async function newCard(page: Page, title: string, worktree: boolean): Promise<void> {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  if (worktree) await page.getByTestId('new-card-worktree').check()
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

/** The worktree folder of the only worktree card in `dataDir`. */
function onlyWorktree(dataDir: string): string {
  const worktrees = join(dataDir, 'worktrees')
  const [repoFolder] = readdirSync(worktrees)
  const [folder] = readdirSync(join(worktrees, repoFolder!))
  return join(worktrees, repoFolder!, folder!)
}

/** The open card's terminal buffer, one trimmed string per line. */
function lines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: {
            buffer: {
              active: {
                length: number
                getLine(i: number): { translateToString(trim: boolean): string } | undefined
              }
            }
          }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const out: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      out.push(buffer.getLine(i)?.translateToString(true).trim() ?? '')
    }
    return out
  })
}

const screenText = async (page: Page): Promise<string> => (await lines(page)).join('\n')

/** The cards' pending setups in the saved state file, by title. */
function savedSetups(dataDir: string): Record<string, string | undefined> {
  const saved = JSON.parse(readFileSync(join(dataDir, 'drovr-state.json'), 'utf8')) as {
    state: { workspaces: { cards: { title: string; setup?: string }[] }[] }
  }
  return Object.fromEntries(saved.state.workspaces[0]!.cards.map((c) => [c.title, c.setup]))
}

/** Closes the open card (its shortcut, confirmed) and waits for it to stop on the board. */
async function closeOpenCard(page: Page, title: string): Promise<void> {
  await closeCard(page)
  await page.getByTestId('confirm-close').click()
  await backToBoard(page)
  await expect(boardCard(page, title).getByTestId('card-status-label')).toHaveText('Stopped')
}

async function openOnBoard(page: Page, title: string): Promise<void> {
  await boardCard(page, title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

test('AC3, AC8: the setup runs first, then the startup command; once only, across Close and a restart', async () => {
  const dataDir = newDataDir()
  const repo = makeRepo()
  const first = await launch(dataDir)
  let page = first.page
  await createSetupWorkspace(page, repo, 'echo SETUP-RAN > setup.txt')
  await newCard(page, 'fix', true)

  await expect.poll(() => lines(page), { timeout: 15_000 }).toContain(AGENT)
  const shown = await lines(page)
  const typed = shown.findIndex((l) => l.includes('echo SETUP-RAN > setup.txt'))
  expect(typed).toBeGreaterThanOrEqual(0)
  expect(typed).toBeLessThan(shown.indexOf(AGENT))
  expect(readFileSync(join(onlyWorktree(dataDir), 'setup.txt'), 'utf8')).toBe('SETUP-RAN\n')
  // It succeeded: the card has no pending setup any more, saved.
  await expect.poll(() => savedSetups(dataDir)).toEqual({ fix: undefined })

  // AC8: closed and opened again, only the startup command is typed.
  await closeOpenCard(page, 'fix')
  await openOnBoard(page, 'fix')
  await expect.poll(() => lines(page)).toContain(AGENT)
  expect(await screenText(page)).not.toContain('SETUP-RAN')

  // And after a restart.
  await quit(first.app)
  ;({ page } = await launch(dataDir))
  await openOnBoard(page, 'fix')
  await expect.poll(() => lines(page)).toContain(AGENT)
  expect(await screenText(page)).not.toContain('SETUP-RAN')
})

test('AC9: a setup that failed runs again after a restart, and the startup command never runs', async () => {
  const dataDir = newDataDir()
  const repo = makeRepo()
  const first = await launch(dataDir)
  let page = first.page
  await createSetupWorkspace(page, repo, 'false')
  await newCard(page, 'broken', true)
  await expect.poll(() => screenText(page)).toContain('setup . failed')
  // The shell is at a prompt again: the setup answered, and nothing else was typed.
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('echo still-$((20+1))')
  await page.keyboard.press('Enter')
  await expect.poll(() => lines(page)).toContain('still-21')
  expect(await lines(page)).not.toContain(AGENT)
  expect(savedSetups(dataDir)).toEqual({ broken: 'false' })

  await quit(first.app)
  ;({ page } = await launch(dataDir))
  await openOnBoard(page, 'broken')
  await expect.poll(() => screenText(page)).toContain('setup . failed')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('echo again-$((20+2))')
  await page.keyboard.press('Enter')
  await expect.poll(() => lines(page)).toContain('again-22')
  expect(await lines(page)).not.toContain(AGENT)
})

test('AC10: no setup line for a card without Own worktree or the Default shell; an empty setup types only the startup', async () => {
  const dataDir = newDataDir()
  const repo = makeRepo()
  const { page } = await launch(dataDir)
  await createSetupWorkspace(page, repo, 'echo SETUP-RAN')

  await newCard(page, 'plain', false)
  await expect.poll(() => lines(page)).toContain(AGENT)
  expect(await screenText(page)).not.toContain('SETUP-RAN')
  await backToBoard(page)

  await page.getByTestId('shell').filter({ hasText: 'Default' }).getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('echo shell-$((30+3))')
  await page.keyboard.press('Enter')
  await expect.poll(() => lines(page)).toContain('shell-33')
  expect(await screenText(page)).not.toContain('SETUP-RAN')
  await backToBoard(page)

  await editWorkspace(page, 0)
  await setupField(page).fill('')
  await saveDialog(page)
  await newCard(page, 'worktree', true)
  await expect.poll(() => lines(page)).toContain(AGENT)
  expect(await screenText(page)).not.toContain('setup . ok')
  expect(savedSetups(dataDir)).toEqual({ plain: undefined, worktree: undefined })
})

test('AC11: board setup in a card with no pending setup says so and exits 1; help does not list it', async () => {
  const dir = makeDir('api')
  const { page } = await launch(newDataDir())
  await createSetupWorkspace(page, dir, '')
  await newCard(page, 'api', false)
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('board setup . ok 2>err.txt; echo "rc=$?"; board help >help.txt')
  await page.keyboard.press('Enter')
  await expect.poll(() => lines(page), { timeout: 15_000 }).toContain('rc=1')
  expect(readFileSync(join(dir, 'err.txt'), 'utf8')).toBe('board: api has no setup running\n')
  await expect.poll(() => existsSync(join(dir, 'help.txt'))).toBe(true)
  await expect.poll(() => readFileSync(join(dir, 'help.txt'), 'utf8')).toContain('board move')
  expect(readFileSync(join(dir, 'help.txt'), 'utf8')).not.toContain('setup')
})

test('AC13: with Own worktree checked, the hint names the workspace setup', async () => {
  const repo = makeRepo()
  const { page } = await launch(newDataDir())
  await createSetupWorkspace(page, repo, 'npm ci')
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-worktree').check()
  await expect(page.getByTestId('new-card-worktree-hint')).toContainText('Runs npm ci first')
})

// S3: the setup's pill on the board card, and Retry setup and Skip setup in its menu.

const setupPill = (page: Page, title: string): Locator =>
  boardCard(page, title).getByTestId('card-setup-pill')

/** Types `text` and Enter into the open card's terminal. */
async function typeInCard(page: Page, text: string): Promise<void> {
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

/** Picks `item` (a test id) in card `title`'s menu on the board. */
async function pickInMenu(page: Page, title: string, item: string): Promise<void> {
  await boardCard(page, title).getByTestId('card-menu').click()
  await page.getByTestId(item).click()
}

test('AC4: the board card shows Setting up while the setup runs, then nothing once the agent starts', async () => {
  const repo = makeRepo()
  const { page } = await launch(newDataDir())
  await createSetupWorkspace(page, repo, 'sleep 3')
  await newCard(page, 'slow', true)
  await backToBoard(page)
  await expect(setupPill(page, 'slow')).toHaveText('Setting up', { timeout: 1000 })
  await expect(setupPill(page, 'slow')).toHaveAttribute('data-state', 'running')
  // The activity pill's place: no other pill beside it.
  await expect(boardCard(page, 'slow').getByTestId('card-activity')).toHaveCount(0)
  await expect(setupPill(page, 'slow')).toHaveCount(0, { timeout: 10_000 })
  await openOnBoard(page, 'slow')
  await expect.poll(() => lines(page)).toContain(AGENT)
})

test('AC5: a failed setup shows Setup failed, the agent never starts and the card stays Running', async () => {
  const repo = makeRepo()
  const { page } = await launch(newDataDir())
  await createSetupWorkspace(page, repo, 'false')
  await newCard(page, 'broken', true)
  await backToBoard(page)
  const card = boardCard(page, 'broken')
  await expect(setupPill(page, 'broken')).toHaveText('Setup failed')
  await expect(setupPill(page, 'broken')).toHaveAttribute('data-state', 'failed')
  await expect(card.getByTestId('card-status-label')).toHaveText('Running')
  // Its shell is at a prompt.
  await openOnBoard(page, 'broken')
  await typeInCard(page, 'echo alive-$((40+2))')
  await expect.poll(() => lines(page)).toContain('alive-42')
  expect(await lines(page)).not.toContain(AGENT)
  // Not offered while the setup runs or once it succeeded: only after a failure (D6).
  await backToBoard(page)
  await card.getByTestId('card-menu').click()
  await expect(page.getByTestId('card-menu-retry-setup')).toBeVisible()
  await expect(page.getByTestId('card-menu-skip-setup')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('AC6: Retry setup types the setup again; once it succeeds the pill goes and the agent starts', async () => {
  const dataDir = newDataDir()
  const repo = makeRepo()
  const { page } = await launch(dataDir)
  await createSetupWorkspace(page, repo, 'test -f ok.flag')
  await newCard(page, 'retry', true)
  // The worktree's long path wraps the typed line, so the board's pill tells it failed.
  await backToBoard(page)
  await expect(setupPill(page, 'retry')).toHaveText('Setup failed')
  await openOnBoard(page, 'retry')
  await typeInCard(page, 'touch ok.flag')
  await expect.poll(() => existsSync(join(onlyWorktree(dataDir), 'ok.flag'))).toBe(true)
  await backToBoard(page)
  await expect(setupPill(page, 'retry')).toHaveText('Setup failed')

  await pickInMenu(page, 'retry', 'card-menu-retry-setup')
  await expect(setupPill(page, 'retry')).toHaveCount(0)
  await openOnBoard(page, 'retry')
  await expect.poll(() => lines(page)).toContain(AGENT)
  await expect.poll(() => savedSetups(dataDir)).toEqual({ retry: undefined })
  // Once it succeeded, the menu offers neither.
  await backToBoard(page)
  await boardCard(page, 'retry').getByTestId('card-menu').click()
  await expect(page.getByTestId('card-menu-delete')).toBeVisible()
  await expect(page.getByTestId('card-menu-retry-setup')).toHaveCount(0)
  await expect(page.getByTestId('card-menu-skip-setup')).toHaveCount(0)
})

test('AC7: Skip setup starts the agent and clears the setup, so a reopen types only the startup command', async () => {
  const dataDir = newDataDir()
  const repo = makeRepo()
  const { page } = await launch(dataDir)
  await createSetupWorkspace(page, repo, 'false')
  await newCard(page, 'skip', true)
  await backToBoard(page)
  await expect(setupPill(page, 'skip')).toHaveText('Setup failed')

  await pickInMenu(page, 'skip', 'card-menu-skip-setup')
  await expect(setupPill(page, 'skip')).toHaveCount(0)
  await expect.poll(() => savedSetups(dataDir)).toEqual({ skip: undefined })
  await openOnBoard(page, 'skip')
  await expect.poll(() => lines(page)).toContain(AGENT)

  await closeOpenCard(page, 'skip')
  await openOnBoard(page, 'skip')
  await expect.poll(() => lines(page)).toContain(AGENT)
  // Joined without breaks, so a typed line the terminal wrapped still reads as one.
  expect((await lines(page)).join('')).not.toContain('setup')
})
