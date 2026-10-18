import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  root = mkdtempSync(join(tmpdir(), 'drovr-git-'))
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
  await expect(menu().getByTestId('branch-pull')).toBeDisabled()
  await expect(menu().getByTestId('branch-push')).toBeDisabled()
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
    .find((path) => path !== repo)!

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
  await page.keyboard.type('echo drovr-mark""er')
  await page.keyboard.press('Enter')
  await expect.poll(terminalText).toMatch(/^drovr-marker$/m)

  await chip().click()
  await section('Local').getByText('feature', { exact: true }).click()
  await expect(chip()).toHaveText('feature')
  expect(git(repo, 'branch', '--show-current')).toBe('feature')
  await expect.poll(terminalText).toMatch(/^drovr-marker$/m)
  await expectStatusOnBoard(page, 'Runner', 'Running')
  await expect.poll(terminalText).toMatch(/^drovr-marker$/m)
})
