import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, boardCard, expectCardOpen } from './card-view'
import { fakeSshHome, type FakeSshHome } from './fake-ssh'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Open pull request from a worktree card (#38). Each test makes `repo` on `main`, whose `origin`
// has the GitHub URL `https://github.com/acme/widget.git` and the local bare `remote.git` as its
// push URL (`remote.origin.pushurl`), and the worktree card `Card 1` on `card-1` with one commit
// of its own. `shell.openExternal` records its URLs instead of opening a browser.

let app: ElectronApplication | undefined
let page: Page
let root: string
let repo: string
let remote: string
let worktree: string
let fake: FakeSshHome

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const commit = (cwd: string, file: string, text: string, message: string): void => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', message)
}

function makeRepos(): void {
  remote = join(root, 'remote.git')
  repo = join(root, 'repo')
  git(root, 'init', '-q', '--bare', '-b', 'main', remote)
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  commit(repo, 'a.txt', 'one\n', 'first')
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git')
  git(repo, 'config', 'remote.origin.pushurl', remote)
  git(repo, 'push', '-q', 'origin', 'main')
}

/** Adds a workspace from the New workspace dialog, its cards plain prompts. */
async function addWorkspace(name: string, directory: string, host?: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  if (host !== undefined) {
    await page.getByTestId('workspace-location-ssh').check()
    await page.getByTestId('workspace-host').fill(host)
  }
  await page.getByTestId('workspace-directory').fill(directory)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Creates card `title`, with its own worktree on `branch` when given, and goes back. */
async function newCard(title: string, branch?: string): Promise<void> {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  if (branch !== undefined) {
    await page.getByTestId('new-card-worktree').check()
    await page.getByTestId('new-card-branch').fill(branch)
  }
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await backToBoard(page)
}

/** Replaces `shell.openExternal` in main with a recorder, so no browser opens. */
async function recordOpenedLinks(): Promise<void> {
  await app!.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { openedLinks?: string[] }).openedLinks = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
}

const openedLinks = (): Promise<string[]> =>
  app!.evaluate(() => [...((globalThis as { openedLinks?: string[] }).openedLinks ?? [])])

const card1 = (): Locator => boardCard(page, 'Card 1')
const action = (): Locator => card1().getByTestId('card-action')

/** Opens `Card 1`'s ⋯ menu; its Open pull request item. */
async function pullRequestItem(card: Locator = card1()): Promise<Locator> {
  await card.getByTestId('card-menu').click()
  return card.getByTestId('card-menu-pull-request')
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-pr-'))
  makeRepos()
  fake = fakeSshHome(root)
  ;({ app, page } = await launchApp({ env: fake.env }))
  await recordOpenedLinks()
  await addWorkspace('repo', repo)
  await newCard('Card 1', 'card-1')
  worktree = git(repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
    .find((path) => path !== repo)!
  commit(worktree, 'b.txt', 'card\n', 'card work')
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

test('Open pull request pushes the branch as its upstream and opens the compare page', async () => {
  // The remote holds the push for a second, so `Pushing…` can be seen.
  const hook = join(remote, 'hooks', 'pre-receive')
  writeFileSync(hook, '#!/bin/sh\nsleep 1\n')
  chmodSync(hook, 0o755)

  const item = await pullRequestItem()
  await expect(item).toHaveText('Open pull request')
  await item.click()
  await expect(action()).toHaveText('Pushing…')
  await expect(action()).toHaveText('Pushed · opened in the browser', { timeout: 10_000 })
  expect(git(remote, 'rev-parse', 'card-1')).toBe(git(worktree, 'rev-parse', 'HEAD'))
  expect(git(worktree, 'rev-parse', '--abbrev-ref', 'card-1@{upstream}')).toBe('origin/card-1')
  expect(await openedLinks()).toEqual(['https://github.com/acme/widget/compare/card-1?expand=1'])
  // The card stays where it was, on the board.
  await expect(page.getByTestId('board')).toBeVisible()
})

test('a remote not on GitHub is pushed, and the card says to open the PR there', async () => {
  git(repo, 'remote', 'set-url', 'origin', 'https://gitlab.com/acme/widget.git')
  await (await pullRequestItem()).click()
  await expect(action()).toContainText('Not a GitHub remote: open the pull request on its site')
  expect(git(remote, 'rev-parse', 'card-1')).toBe(git(worktree, 'rev-parse', 'HEAD'))
  await action().getByRole('button', { name: 'Dismiss' }).click()
  await expect(action()).toHaveCount(0)
  expect(await openedLinks()).toEqual([])
})

test("a refused push shows git's rejection, opens nothing and forces nothing", async () => {
  const other = join(root, 'other')
  git(root, 'clone', '-q', remote, other)
  git(other, 'config', 'user.email', 'test@example.com')
  git(other, 'config', 'user.name', 'Test')
  git(other, 'switch', '-q', '-c', 'card-1')
  commit(other, 'x.txt', 'theirs\n', 'theirs')
  git(other, 'push', '-q', 'origin', 'card-1')
  const theirs = git(other, 'rev-parse', 'HEAD')

  await (await pullRequestItem()).click()
  await expect(action()).toContainText('rejected', { timeout: 10_000 })
  await expect(action().getByRole('button', { name: 'Dismiss' })).toBeVisible()
  expect(git(remote, 'rev-parse', 'card-1')).toBe(theirs)
  expect(await openedLinks()).toEqual([])
})

test('the live branch is pushed, and a detached HEAD disables the item', async () => {
  // The branch menu switches the open card's worktree to a new branch.
  await card1().getByTestId('card-open').click()
  await expectCardOpen(page, 'Card 1')
  await page.getByTestId('titlebar').getByTestId('card-branch').click()
  await page.getByTestId('branch-menu').getByTestId('branch-new').click()
  await page.getByTestId('branch-menu').getByTestId('branch-new-name').fill('topic/x')
  await page.getByTestId('branch-menu').getByTestId('branch-new-name').press('Enter')
  await expect(page.getByTestId('titlebar').getByTestId('card-branch')).toHaveText('topic/x')
  await backToBoard(page)

  await (await pullRequestItem()).click()
  await expect(action()).toHaveText('Pushed · opened in the browser', { timeout: 10_000 })
  expect(git(remote, 'rev-parse', 'topic/x')).toBe(git(worktree, 'rev-parse', 'HEAD'))
  expect(await openedLinks()).toEqual(['https://github.com/acme/widget/compare/topic/x?expand=1'])

  git(worktree, 'switch', '-q', '--detach')
  // The live branch is read again when the window gets the focus.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const item = await pullRequestItem()
  await expect(item).toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 })
  await expect(item).toHaveAttribute('title', 'Not on a branch')
  await expect(item).toBeDisabled()
  // Clicked anyway, it runs nothing: the menu stays open and nothing more is opened.
  await item.click({ force: true })
  await expect(item).toBeVisible()
  expect(await openedLinks()).toHaveLength(1)
})

test('a plain card and an SSH card have no Open pull request', async () => {
  await newCard('Plain')
  await boardCard(page, 'Plain').getByTestId('card-menu').click()
  await expect(boardCard(page, 'Plain').getByTestId('card-menu-delete')).toBeVisible()
  await expect(boardCard(page, 'Plain').getByTestId('card-menu-pull-request')).toHaveCount(0)
  await page.keyboard.press('Escape')

  await addWorkspace('remote', '/srv/repo', 'unreachable')
  await newCard('Remote')
  await boardCard(page, 'Remote').getByTestId('card-menu').click()
  await expect(boardCard(page, 'Remote').getByTestId('card-menu-delete')).toBeVisible()
  await expect(boardCard(page, 'Remote').getByTestId('card-menu-pull-request')).toHaveCount(0)
})
