import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, boardCard, expectCardOpen } from './card-view'
import { fakeSshHome, type FakeSshHome } from './fake-ssh'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Open pull request from a worktree card (#38). Each test makes `repo` on `main`, whose `origin`
// has the GitHub URL `https://github.com/acme/widget.git` and the local bare `remote.git` as its
// push URL (`remote.origin.pushurl`), and the worktree card `Card 1` on `card-1` with one commit
// of its own. `shell.openExternal` records its URLs instead of opening a browser. The login shell
// (`bash -l`, whose profile puts the fake HOME's `bin` first on PATH) finds a fake `gh` there,
// printing the JSON `gh.json` holds, else `no pull requests found` with exit 1, so it answers
// before any `gh` installed on the machine. AC8's "no gh" half removes the fake and leaves only
// that `bin` on the login PATH, so no `gh` is found on any machine.

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

const ghJson = (): string => join(root, 'gh.json')
const ghLog = (): string => join(root, 'gh.log')

/** The fake `gh` in the fake HOME's `bin`, logging its directory and arguments per run. */
function fakeGh(): void {
  const gh = join(fake.home, 'bin', 'gh')
  writeFileSync(
    gh,
    `#!/bin/sh\n{ pwd; printf '%s\\n' "$@"; } >> '${ghLog()}'\n` +
      `[ -f '${ghJson()}' ] || { echo 'no pull requests found for branch "x"' >&2; exit 1; }\n` +
      `cat '${ghJson()}'\n`
  )
  chmodSync(gh, 0o755)
}

/** What the fake `gh` answers from now on: PR 12 in `state`, with `checks` as its rollup. */
function answerPullRequest(state: string, checks: unknown[] = []): void {
  writeFileSync(
    ghJson(),
    JSON.stringify({
      number: 12,
      state,
      url: 'https://github.com/acme/widget/pull/12',
      statusCheckRollup: checks
    })
  )
}

const FAILING_RUN = {
  __typename: 'CheckRun',
  name: 'build',
  status: 'COMPLETED',
  conclusion: 'FAILURE'
}

/** The window gets the focus, as when the user comes back to it. */
async function focusWindow(): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

/** Shows the board again: the card view and back, so the board's cards are shown anew. */
async function showBoardAgain(): Promise<void> {
  await card1().getByTestId('card-open').click()
  await expectCardOpen(page, 'Card 1')
  await backToBoard(page)
}

const card1 = (): Locator => boardCard(page, 'Card 1')
const action = (): Locator => card1().getByTestId('card-action')
const chip = (): Locator => card1().getByTestId('card-pr')

/** Opens `Card 1`'s ⋯ menu; its Open pull request item. */
async function pullRequestItem(card: Locator = card1()): Promise<Locator> {
  await card.getByTestId('card-menu').click()
  return card.getByTestId('card-menu-pull-request')
}

/** Opens `Card 1`'s ⋯ menu; its Merge into item. */
async function mergeItem(): Promise<Locator> {
  await card1().getByTestId('card-menu').click()
  return card1().getByTestId('card-menu-merge')
}

/** Picks `Merge into main` and confirms it. */
async function confirmMerge(): Promise<void> {
  const item = await mergeItem()
  await expect(item).toHaveText('Merge into main')
  await item.click()
  await page.getByTestId('confirm-dialog').getByTestId('confirm-merge').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-pr-'))
  makeRepos()
  fake = fakeSshHome(root)
  fakeGh()
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
  // Merge into is disabled in the same menu, for the same reason.
  const merge = card1().getByTestId('card-menu-merge')
  await expect(merge).toHaveAttribute('aria-disabled', 'true')
  await expect(merge).toHaveAttribute('title', 'Not on a branch')
})

test('#38 AC6: the PR chip shows the open PR and its CI, then that it was merged', async () => {
  answerPullRequest('OPEN', [FAILING_RUN])
  await showBoardAgain()
  await expect(chip()).toHaveText('#12', { timeout: 2000 })
  await expect(chip()).toHaveAttribute('data-ci', 'failing')
  await expect(chip()).toHaveAttribute('title', 'Pull request #12: failing')
  // gh ran in the card's worktree for its branch, the branch a positional argument.
  const log = readFileSync(ghLog(), 'utf8').trimEnd().split('\n')
  expect(log.slice(-7)).toEqual([
    worktree,
    'pr',
    'view',
    '--json',
    'number,state,url,statusCheckRollup',
    '--',
    'card-1'
  ])

  answerPullRequest('MERGED')
  await focusWindow()
  await expect(chip()).toHaveText('#12 merged', { timeout: 2000 })
  await expect(chip()).not.toHaveAttribute('data-ci')
  await expect(chip()).toHaveAttribute('title', 'Pull request #12: merged')
})

test('#38 AC7: clicking the chip opens the PR in the browser, not the card', async () => {
  answerPullRequest('OPEN', [FAILING_RUN])
  await showBoardAgain()
  await chip().click()
  await expect.poll(openedLinks).toEqual(['https://github.com/acme/widget/pull/12'])
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
})

test('#38 AC8: without gh, or without a PR for the branch, no chip and no error', async () => {
  // gh exits 1 with `no pull requests found` (the fake without gh.json).
  await focusWindow()
  await expect(await pullRequestItem()).toHaveText('Open pull request')
  await page.keyboard.press('Escape')
  await expect(chip()).toHaveCount(0)
  await expect(action()).toHaveCount(0)

  // A PR shows; then gh is gone from the login shell's PATH and the chip goes with it.
  answerPullRequest('OPEN')
  await focusWindow()
  await expect(chip()).toHaveText('#12', { timeout: 2000 })
  await expect(chip()).not.toHaveAttribute('data-ci')
  rmSync(join(fake.home, 'bin', 'gh'))
  writeFileSync(join(fake.home, '.bash_profile'), 'export PATH="$HOME/bin"\n')
  await focusWindow()
  await expect(chip()).toHaveCount(0, { timeout: 2000 })
  await expect(action()).toHaveCount(0)
  await expect(await pullRequestItem()).toHaveText('Open pull request')
})

test('#38 AC9: with an open PR, the item pushes and opens that PR', async () => {
  answerPullRequest('OPEN', [FAILING_RUN])
  await showBoardAgain()
  await expect(chip()).toHaveText('#12', { timeout: 2000 })
  const item = await pullRequestItem()
  await expect(item).toHaveText('Push and open pull request #12')
  await item.click()
  await expect(action()).toHaveText('Pushed · opened in the browser', { timeout: 10_000 })
  expect(git(remote, 'rev-parse', 'card-1')).toBe(git(worktree, 'rev-parse', 'HEAD'))
  expect(await openedLinks()).toEqual(['https://github.com/acme/widget/pull/12'])

  // Merged: the item opens the compare page again.
  answerPullRequest('MERGED')
  await focusWindow()
  await expect(chip()).toHaveText('#12 merged', { timeout: 2000 })
  const again = await pullRequestItem()
  await expect(again).toHaveText('Open pull request')
  await again.click()
  await expect
    .poll(openedLinks, { timeout: 10_000 })
    .toEqual([
      'https://github.com/acme/widget/pull/12',
      'https://github.com/acme/widget/compare/card-1?expand=1'
    ])
})

test('a plain card and an SSH card have no Open pull request', async () => {
  await newCard('Plain')
  await boardCard(page, 'Plain').getByTestId('card-menu').click()
  await expect(boardCard(page, 'Plain').getByTestId('card-menu-delete')).toBeVisible()
  await expect(boardCard(page, 'Plain').getByTestId('card-menu-pull-request')).toHaveCount(0)
  await expect(boardCard(page, 'Plain').getByTestId('card-menu-merge')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(boardCard(page, 'Plain').getByTestId('card-pr')).toHaveCount(0)

  await addWorkspace('remote', '/srv/repo', 'unreachable')
  await newCard('Remote')
  await boardCard(page, 'Remote').getByTestId('card-menu').click()
  await expect(boardCard(page, 'Remote').getByTestId('card-menu-delete')).toBeVisible()
  await expect(boardCard(page, 'Remote').getByTestId('card-menu-pull-request')).toHaveCount(0)
  await expect(boardCard(page, 'Remote').getByTestId('card-menu-merge')).toHaveCount(0)
  await expect(boardCard(page, 'Remote').getByTestId('card-pr')).toHaveCount(0)
})

test('#38 AC11: Merge fast-forwards the workspace branch, the card still running', async () => {
  await confirmMerge()
  await expect(action()).toHaveText('Merged card-1 into main', { timeout: 10_000 })
  expect(git(repo, 'log', '-1', '--format=%s', 'main')).toBe('card work')
  expect(git(repo, 'rev-parse', 'main')).toBe(git(worktree, 'rev-parse', 'HEAD'))
  await expect(card1().getByTestId('card-stop')).toBeVisible()
  await expect(page.getByTestId('board')).toBeVisible()

  await confirmMerge()
  await expect(action()).toHaveText('Already up to date', { timeout: 10_000 })
})

test('#38 AC12: a workspace folder with uncommitted changes refuses the merge', async () => {
  const main = git(repo, 'rev-parse', 'main')
  writeFileSync(join(repo, 'a.txt'), 'changed\n')
  await confirmMerge()
  await expect(action()).toContainText(
    'The workspace folder has uncommitted changes: commit or stash them first',
    { timeout: 10_000 }
  )
  expect(git(repo, 'rev-parse', 'main')).toBe(main)

  // An untracked file alone doesn't block it.
  git(repo, 'checkout', '--', 'a.txt')
  writeFileSync(join(repo, 'loose.txt'), 'untracked\n')
  await action().getByRole('button', { name: 'Dismiss' }).click()
  await confirmMerge()
  await expect(action()).toHaveText('Merged card-1 into main', { timeout: 10_000 })
})

test('#38 AC13: a conflicting merge is aborted, the workspace folder as it was', async () => {
  commit(worktree, 'a.txt', 'card\n', 'card a')
  commit(repo, 'a.txt', 'main\n', 'main a')
  const main = git(repo, 'rev-parse', 'main')
  await confirmMerge()
  await expect(action()).toContainText('Merge conflict in a.txt: nothing was merged', {
    timeout: 10_000
  })
  expect(git(repo, 'status', '--porcelain')).toBe('')
  expect(git(repo, 'rev-parse', 'main')).toBe(main)
})

test('#38 AC14: the confirmation names the merge and warns of uncommitted work', async () => {
  writeFileSync(join(worktree, 'draft.txt'), 'not committed\n')
  const main = git(repo, 'rev-parse', 'main')
  await (await mergeItem()).click()
  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog.getByRole('heading')).toHaveText('Merge branch')
  await expect(dialog).toContainText(`Merge card-1 into main in ${repo}?`)
  await expect(dialog).toContainText(
    "The card's uncommitted changes are not included: only its commits are merged."
  )
  await dialog.getByTestId('confirm-cancel').click()
  await expect(dialog).toHaveCount(0)
  await expect(action()).toHaveCount(0)
  expect(git(repo, 'rev-parse', 'main')).toBe(main)

  // Committed, the line is gone.
  git(worktree, 'add', 'draft.txt')
  git(worktree, 'commit', '-q', '-m', 'draft')
  await (await mergeItem()).click()
  await expect(dialog).toContainText(`Merge card-1 into main in ${repo}?`)
  await expect(dialog).not.toContainText('uncommitted')
  await dialog.getByTestId('confirm-cancel').click()

  // A detached workspace folder disables the item.
  git(repo, 'switch', '-q', '--detach')
  await focusWindow()
  const item = await mergeItem()
  await expect(item).toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 })
  await expect(item).toHaveAttribute('title', 'The workspace folder is not on a branch')
  await expect(item).toHaveText('Merge into …')
  await item.click({ force: true })
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
})
