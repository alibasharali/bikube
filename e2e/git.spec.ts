import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen, expectStatusOnBoard } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The title bar's branch menu (#33). Each test makes `repo`, a clone of the local bare
// `remote.git` (its `origin`), on `main` with a local `feature`; the remote also has `remote-only`.

let app: ElectronApplication | undefined
let page: Page
let root: string
let repo: string

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const commit = (cwd: string, file: string, text: string, message: string): void => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', message)
}

function makeRepos(): void {
  const remote = join(root, 'remote.git')
  const seed = join(root, 'seed')
  git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  mkdirSync(seed)
  git(seed, 'init', '-q', '-b', 'main')
  git(seed, 'config', 'user.email', 'test@example.com')
  git(seed, 'config', 'user.name', 'Test')
  commit(seed, 'a.txt', 'one\n', 'first')
  git(seed, 'branch', 'feature')
  git(seed, 'branch', 'remote-only')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', '-q', 'origin', 'main', 'feature', 'remote-only')
  git(root, 'clone', '-q', remote, repo)
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'branch', '-q', 'feature', 'origin/feature')
}

/** Adds the local workspace `name` on `directory` and shows its board. */
async function addWorkspace(name: string, directory: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(directory)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-git-'))
  repo = join(root, 'repo')
  makeRepos()
  ;({ app, page } = await launchApp())
  await addWorkspace('repo', repo)
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

/** The title bar's branch chip, the branch menu's button. */
const chip = (): Locator => page.getByTestId('titlebar').getByTestId('card-branch')
const menu = (): Locator => page.getByTestId('branch-menu')
/** The menu's branches in section `name` (`Local` or a remote), in order. */
const section = (name: string): Locator =>
  menu().getByRole('group', { name }).getByTestId('branch-item')

test('the chip opens the menu: local branches, then each remote, and the actions', async () => {
  await expect(chip()).toHaveText('main')
  await chip().click()
  await expect(menu()).toBeVisible()
  await expect(section('Local')).toHaveText(['main', 'feature'])
  await expect(section('Local').first()).toHaveAttribute('aria-current', 'true')
  await expect(section('Local').nth(1)).not.toHaveAttribute('aria-current')
  await expect(section('origin')).toHaveText(['feature', 'main', 'remote-only'])
  for (const action of ['New branch', 'Fetch', 'Pull', 'Push']) {
    await expect(menu().getByRole('menuitem', { name: action })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
  await expect(chip()).toBeFocused()
})

test('clicking a local branch switches to it and closes the menu', async () => {
  await chip().click()
  await section('Local').getByText('feature', { exact: true }).click()
  await expect(menu()).toHaveCount(0)
  await expect(chip()).toHaveText('feature', { timeout: 1000 })
  expect(git(repo, 'branch', '--show-current')).toBe('feature')
})

test("a remote's branch is tracked by a new local branch, or switches to the existing one", async () => {
  await chip().click()
  await section('origin').getByText('remote-only', { exact: true }).click()
  await expect(chip()).toHaveText('remote-only')
  expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/remote-only')

  await chip().click()
  await expect(section('Local')).toHaveText(['remote-only', 'feature', 'main'])
  await section('origin').getByText('feature', { exact: true }).click()
  await expect(chip()).toHaveText('feature')
  expect(git(repo, 'branch', '--format=%(refname:short)')).toBe('feature\nmain\nremote-only')
})

test('New branch creates a branch at HEAD and switches to it; a taken or invalid name runs nothing', async () => {
  const head = git(repo, 'rev-parse', 'HEAD')
  await chip().click()
  await menu().getByTestId('branch-new').click()
  const name = menu().getByTestId('branch-new-name')
  const problem = menu().getByTestId('branch-new-problem')
  await expect(name).toBeFocused()

  await name.fill('feature')
  await name.press('Enter')
  await expect(problem).toHaveText('Branch already exists')
  await expect(name).toBeFocused()
  await name.fill('a..b')
  await name.press('Enter')
  await expect(problem).toHaveText('Not a valid branch name')
  expect(git(repo, 'branch', '--show-current')).toBe('main')
  expect(git(repo, 'branch', '--format=%(refname:short)')).toBe('feature\nmain')

  // Esc returns to the list, not out of the menu.
  await name.press('Escape')
  await expect(menu()).toBeVisible()
  await expect(name).toHaveCount(0)
  await expect(section('Local')).toHaveText(['main', 'feature'])

  await menu().getByTestId('branch-new').click()
  await name.fill('topic/x')
  await name.press('Enter')
  await expect(menu()).toHaveCount(0)
  await expect(chip()).toHaveText('topic/x', { timeout: 1000 })
  expect(git(repo, 'branch', '--show-current')).toBe('topic/x')
  expect(git(repo, 'rev-parse', 'topic/x')).toBe(head)
})

test("a refused switch keeps the menu open with git's message and changes nothing", async () => {
  git(repo, 'switch', '-q', 'feature')
  commit(repo, 'a.txt', 'feature\n', 'on feature')
  git(repo, 'switch', '-q', 'main')
  writeFileSync(join(repo, 'a.txt'), 'mine\n')
  await chip().click()
  await section('Local').getByText('feature', { exact: true }).click()
  await expect(menu().getByTestId('branch-error')).toContainText('would be overwritten')
  await expect(menu()).toBeVisible()
  await expect(chip()).toHaveText('main')
  expect(git(repo, 'branch', '--show-current')).toBe('main')
  expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('mine\n')
})

test('no chip in an SSH workspace or outside a repository; a detached HEAD has no Pull or Push', async () => {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-location-ssh').check()
  await page.getByTestId('workspace-host').fill('me@devbox')
  await page.getByTestId('workspace-directory').fill(repo)
  await page.getByTestId('workspace-name').fill('remote')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('board-title')).toHaveText('remote')
  await expect(page.getByTestId('board-location')).toBeVisible()
  await expect(chip()).toHaveCount(0)

  const plain = join(root, 'plain')
  mkdirSync(plain)
  await addWorkspace('plain', plain)
  await expect(page.getByTestId('board-title')).toHaveText('plain')
  await expect(page.getByTestId('board-location')).toBeVisible()
  await expect(chip()).toHaveCount(0)

  git(repo, 'switch', '-q', '--detach')
  await page.getByTestId('workspace-item').filter({ hasText: 'repo' }).click()
  await expect(chip()).toHaveText('detached')
  await chip().click()
  await expect(section('Local')).toHaveText(['feature', 'main'])
  await expect(menu().locator('[aria-current]')).toHaveCount(0)
  await expect(menu().getByTestId('branch-fetch')).toBeEnabled()
  await expect(menu().getByTestId('branch-pull')).toBeDisabled()
  await expect(menu().getByTestId('branch-push')).toBeDisabled()
  await expect(menu().getByTestId('branch-sync')).toHaveCount(0)
})

test("with a worktree card open, the menu switches the card's worktree, and the chip follows", async () => {
  git(repo, 'branch', 'card-2')
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('Card one')
  await page.getByTestId('new-card-worktree').check()
  await page.getByTestId('new-card-branch').fill('card-1')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'Card one')
  await expect(chip()).toHaveText('card-1')
  await expect(chip()).toHaveAttribute('data-worktree', 'true')
  const worktree = git(repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    // git prints real paths: on macOS the temp folder is /private/var behind /var.
    .find((path) => path !== realpathSync(repo))!

  await chip().click()
  await expect(section('Local').first()).toHaveText('card-1')
  await section('Local').getByText('card-2', { exact: true }).click()
  await expect(chip()).toHaveText('card-2')
  expect(git(worktree, 'branch', '--show-current')).toBe('card-2')
  expect(git(repo, 'branch', '--show-current')).toBe('main')
  // The board's card keeps the branch it was made on (D3).
  await backToBoard(page)
  await expect(chip()).toHaveText('main')
  await expect(page.getByTestId('card').getByTestId('card-branch')).toHaveText('card-1')
})

/** The open card's terminal buffer as text. */
function terminalText(): Promise<string> {
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
    if (!buffer) return ''
    const out: string[] = []
    for (let i = 0; i < buffer.length; i++)
      out.push(buffer.getLine(i)?.translateToString(true) ?? '')
    return out.join('\n')
  })
}

test('switching from the menu leaves a running card running, its output kept', async () => {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('Runner')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'Runner')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('echo bikube-mark""er')
  await page.keyboard.press('Enter')
  await expect.poll(terminalText).toMatch(/^bikube-marker$/m)

  await chip().click()
  await section('Local').getByText('feature', { exact: true }).click()
  await expect(chip()).toHaveText('feature')
  expect(git(repo, 'branch', '--show-current')).toBe('feature')
  await expect.poll(terminalText).toMatch(/^bikube-marker$/m)
  await expectStatusOnBoard(page, 'Runner', 'Running')
  await expect.poll(terminalText).toMatch(/^bikube-marker$/m)
})

test("switching workspace with the menu open drops the old workspace's menu", async () => {
  const other = join(root, 'other')
  mkdirSync(other)
  git(other, 'init', '-q', '-b', 'trunk')
  git(other, 'config', 'user.email', 'test@example.com')
  git(other, 'config', 'user.name', 'Test')
  commit(other, 'b.txt', 'two\n', 'first')
  await addWorkspace('other', other)
  await page.getByTestId('workspace-item').filter({ hasText: 'repo' }).click()
  await expect(chip()).toHaveText('main')
  await chip().click()
  await expect(section('Local')).toHaveText(['main', 'feature'])

  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+2`)
  await expect(page.getByTestId('board-title')).toHaveText('other')
  await expect(chip()).toHaveText('trunk')
  await expect(menu()).toHaveCount(0)
})

/** A second clone of `remote.git`, as another machine pushing to it. */
function otherClone(): string {
  const other = mkdtempSync(join(root, 'other-'))
  rmSync(other, { recursive: true })
  git(root, 'clone', '-q', join(root, 'remote.git'), other)
  git(other, 'config', 'user.email', 'test@example.com')
  git(other, 'config', 'user.name', 'Test')
  return other
}

/** Another machine's commit on `main`, pushed to `remote.git`. */
function theirCommit(): string {
  const other = otherClone()
  commit(other, 'theirs.txt', `${other}\n`, 'theirs')
  git(other, 'push', '-q', 'origin', 'main')
  return git(other, 'rev-parse', 'HEAD')
}

const note = (): Locator => menu().getByTestId('branch-note')
const error = (): Locator => menu().getByTestId('branch-error')
const header = (): Locator => menu().getByTestId('branch-sync')

test('Fetch fetches every remote, dropping branches deleted there', async () => {
  const other = otherClone()
  git(other, 'push', '-q', 'origin', 'main:new-one')
  git(other, 'push', '-q', 'origin', '--delete', 'remote-only')
  await chip().click()
  await expect(section('origin')).toHaveText(['feature', 'main', 'remote-only'])
  await menu().getByTestId('branch-fetch').click()
  await expect(note()).toHaveText('Fetched')
  await expect(menu()).toBeVisible()
  await expect(section('origin')).toHaveText(['feature', 'main', 'new-one'])
})

test('the header shows ahead and behind as of the last fetch, or No upstream', async () => {
  theirCommit()
  commit(repo, 'c.txt', 'one\n', 'mine 1')
  commit(repo, 'd.txt', 'two\n', 'mine 2')
  await chip().click()
  await expect(header()).toHaveText('↑2 ↓0')
  await menu().getByTestId('branch-fetch').click()
  await expect(note()).toHaveText('Fetched')
  await expect(header()).toHaveText('↑2 ↓1')
  await page.keyboard.press('Escape')

  git(repo, 'switch', '-q', '-c', 'solo')
  await expect(chip()).toHaveText('solo')
  await chip().click()
  await expect(header()).toHaveText('No upstream')
})

test('Pull fast-forwards a branch behind its upstream, and refuses a diverged one', async () => {
  const theirs = theirCommit()
  await chip().click()
  await menu().getByTestId('branch-pull').click()
  await expect(note()).toHaveText('Pulled')
  await expect(header()).toHaveText('↑0 ↓0')
  expect(git(repo, 'rev-parse', 'HEAD')).toBe(theirs)
  await page.keyboard.press('Escape')

  theirCommit()
  commit(repo, 'c.txt', 'mine\n', 'mine')
  const head = git(repo, 'rev-parse', 'HEAD')
  await chip().click()
  await menu().getByTestId('branch-fetch').click()
  await expect(header()).toHaveText('↑1 ↓1')
  await menu().getByTestId('branch-pull').click()
  await expect(error()).toContainText('Not possible to fast-forward')
  await expect(note()).toHaveCount(0)
  expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
})

test("Pull without an upstream tracks the remote's branch of the same name, then pulls", async () => {
  git(repo, 'branch', '--unset-upstream')
  const theirs = theirCommit()
  await chip().click()
  await expect(header()).toHaveText('No upstream')
  await menu().getByTestId('branch-fetch').click()
  await expect(note()).toHaveText('Fetched')
  await menu().getByTestId('branch-pull').click()
  await expect(note()).toHaveText('Pulled · now tracking origin/main')
  await expect(header()).toHaveText('↑0 ↓0')
  expect(git(repo, 'rev-parse', 'HEAD')).toBe(theirs)
  expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/main')
})

test('a repository with no remote reads No remote, and Fetch and Pull say so', async () => {
  git(repo, 'remote', 'remove', 'origin')
  await chip().click()
  await expect(header()).toHaveText('No remote')
  await menu().getByTestId('branch-fetch').click()
  await expect(error()).toHaveText('This repository has no remote')
  await expect(note()).toHaveCount(0)
  await menu().getByTestId('branch-pull').click()
  await expect(error()).toHaveText('This repository has no remote')
})

test("Push pushes a new branch to origin as its upstream; a rejection is git's, never forced", async () => {
  await chip().click()
  await menu().getByTestId('branch-new').click()
  await menu().getByTestId('branch-new-name').fill('topic/x')
  await menu().getByTestId('branch-new-name').press('Enter')
  await expect(chip()).toHaveText('topic/x')
  await chip().click()
  await expect(header()).toHaveText('No upstream')
  await menu().getByTestId('branch-push').click()
  await expect(note()).toHaveText('Pushed')
  await expect(header()).toHaveText('↑0 ↓0')
  expect(git(join(root, 'remote.git'), 'rev-parse', 'topic/x')).toBe(git(repo, 'rev-parse', 'HEAD'))
  await page.keyboard.press('Escape')

  git(repo, 'switch', '-q', 'main')
  const theirs = theirCommit()
  commit(repo, 'c.txt', 'mine\n', 'mine')
  await expect(chip()).toHaveText('main')
  await chip().click()
  await menu().getByTestId('branch-push').click()
  await expect(error()).toContainText('rejected')
  expect(git(join(root, 'remote.git'), 'rev-parse', 'main')).toBe(theirs)
})

/** A local HTTP server as `origin`'s URL: `answer` decides each request's response. */
async function httpOrigin(answer: (response: ServerResponse) => void): Promise<Server> {
  const server = createServer((_request, response) => answer(response))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  git(repo, 'remote', 'set-url', 'origin', `http://127.0.0.1:${port}/repo.git`)
  git(repo, 'config', 'remote.origin.proxy', '')
  return server
}

test('a remote that wants a password fails at once with how to set up credentials', async () => {
  const server = await httpOrigin((response) => {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="bikube"' })
    response.end()
  })
  try {
    await chip().click()
    await menu().getByTestId('branch-fetch').click()
    await expect(error()).toHaveText(
      /Set up an SSH key or a git credential helper for this remote\.$/,
      { timeout: 10_000 }
    )
    await expect(menu().getByTestId('branch-busy')).toHaveCount(0)
  } finally {
    server.close()
  }
})

test('while Fetch runs, the menu shows Fetching… and every action waits', async () => {
  const held: ServerResponse[] = []
  const server = await httpOrigin((response) => held.push(response))
  try {
    await chip().click()
    await menu().getByTestId('branch-fetch').click()
    await expect(menu().getByTestId('branch-busy')).toHaveText('Fetching…')
    await expect.poll(() => held.length).toBeGreaterThan(0)
    const items = menu().getByRole('menuitem')
    await expect(items).toHaveCount(2 + 3 + 4)
    for (const item of await items.all()) await expect(item).toBeDisabled()

    for (const response of held.splice(0)) response.writeHead(404).end()
    await expect(menu().getByTestId('branch-busy')).toHaveCount(0)
    await expect(error()).toBeVisible()
    await expect(menu().getByTestId('branch-fetch')).toBeEnabled()
  } finally {
    for (const response of held) response.destroy()
    server.close()
  }
})

test('a running command outlives its chip: a new chip shows it busy, then its result', async () => {
  const held: ServerResponse[] = []
  const server = await httpOrigin((response) => held.push(response))
  try {
    await chip().click()
    await menu().getByTestId('branch-fetch').click()
    await expect(menu().getByTestId('branch-busy')).toHaveText('Fetching…')
    await expect.poll(() => held.length).toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await expect(menu()).toHaveCount(0)

    // Opening a card shows the chip anew (the same folder): still Fetching…, nothing to start.
    await page.getByTestId('column').first().getByTestId('new-card').click()
    await page.getByTestId('new-card-input').fill('Plain')
    await page.getByTestId('new-card-input').press('Enter')
    await expectCardOpen(page, 'Plain')
    await chip().click()
    await expect(menu().getByTestId('branch-busy')).toHaveText('Fetching…')
    for (const action of ['branch-new', 'branch-fetch', 'branch-pull', 'branch-push']) {
      await expect(menu().getByTestId(action)).toBeDisabled()
    }

    // It ends while the menu is closed and the chip changes again: the next menu shows its
    // result once, and the one after that is clean.
    await page.keyboard.press('Escape')
    await backToBoard(page)
    await expect(chip()).toHaveAttribute('aria-busy', 'true')
    for (const response of held.splice(0)) response.writeHead(404).end()
    await expect(chip()).not.toHaveAttribute('aria-busy', 'true')
    await chip().click()
    await expect(error()).toBeVisible()
    await expect(menu().getByTestId('branch-fetch')).toBeEnabled()
    await page.keyboard.press('Escape')
    await chip().click()
    await expect(menu().getByTestId('branch-fetch')).toBeEnabled()
    await expect(error()).toHaveCount(0)
  } finally {
    for (const response of held) response.destroy()
    server.close()
  }
})

test('a folder that is no longer a repository says so, every action disabled', async () => {
  // The folder stops being a repository between the chip's last read and the menu's: main
  // answers the menu's read as it does outside a repository.
  await app!.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('git:branches')
    ipcMain.handle('git:branches', () => null)
  })
  await chip().click()
  await expect(menu().getByTestId('branch-not-repository')).toHaveText('Not a git repository')
  await expect(menu().getByText('Reading branches…')).toHaveCount(0)
  await expect(menu().getByTestId('branch-item')).toHaveCount(0)
  for (const action of ['branch-new', 'branch-fetch', 'branch-pull', 'branch-push']) {
    await expect(menu().getByTestId(action)).toBeDisabled()
  }
})

test('a worktree card whose directory is gone shows no chip, not its saved branch', async () => {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('Card one')
  await page.getByTestId('new-card-worktree').check()
  await page.getByTestId('new-card-branch').fill('card-1')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'Card one')
  await expect(chip()).toHaveText('card-1')
  const worktree = git(repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .find((path) => path !== repo)!
  rmSync(worktree, { recursive: true, force: true })
  await expect(chip()).toHaveCount(0, { timeout: 10_000 })
})

test('branches sit in folders by their `/` segments; many loose ones show the first and View all', async () => {
  for (const name of ['ali/feature/a', 'ali/feature/b', 'ali/bug/x', 'feat/one']) {
    git(repo, 'branch', name)
  }
  for (let n = 1; n <= 8; n++) git(repo, 'branch', `topic-${n}`)
  await chip().click()
  const local = menu().getByRole('group', { name: 'Local' })
  const rows = local.locator('[data-testid=branch-item], [data-testid=branch-folder]')

  // The first 8 loose branches (git's order, the lone `feat/one` as itself), View all, then
  // every folder.
  await expect(rows).toHaveText([
    'main',
    'feat/one',
    'feature',
    'topic-1',
    'topic-2',
    'topic-3',
    'topic-4',
    'topic-5',
    'ali3'
  ])
  await expect(local.getByTestId('branch-view-all')).toHaveText('View all (11)')
  await local.getByTestId('branch-view-all').click()
  await expect(local.getByTestId('branch-view-all')).toHaveCount(0)
  await expect(rows).toHaveCount(12)
  await expect(rows.nth(8)).toBeFocused()
  await expect(rows.nth(8)).toHaveText('topic-6')

  // The folder `ali` holds 3 branches; open, `ali/feature` (2) and `bug/x`, a lone branch.
  const ali = local.locator('[data-testid=branch-folder][data-path="ali"]')
  await expect(ali).toHaveAttribute('aria-expanded', 'false')
  await expect(ali).toContainText('3')
  await ali.click()
  const feature = local.locator('[data-testid=branch-folder][data-path="ali/feature"]')
  await expect(local.locator('[data-branch="ali/bug/x"]')).toHaveText('bug/x')
  await feature.press('ArrowRight')
  await expect(feature).toHaveAttribute('aria-expanded', 'true')
  await local.locator('[data-branch="ali/feature/b"]').click()
  await expect(menu()).toHaveCount(0)
  await expect(chip()).toHaveText('ali/feature/b')
  expect(git(repo, 'branch', '--show-current')).toBe('ali/feature/b')

  // Opened again, the folders holding the current branch are open, and it is marked there.
  await chip().click()
  await expect(local.locator('[data-testid=branch-folder][data-path="ali"]')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  await expect(local.locator('[data-branch="ali/feature/b"]')).toHaveAttribute(
    'aria-current',
    'true'
  )
})
