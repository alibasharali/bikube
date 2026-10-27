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
import { backToBoard, expectCardOpen } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'
import { showShells } from './shells-tab'

// Cards with their own git worktree. Each test launches with its own data directory, so its
// worktrees live in that directory's `worktrees` folder.

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string
let repo: string

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-worktrees-'))
  repo = join(root, 'repo')
  mkdirSync(repo)
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(repo, '.gitignore'), 'local.conf\n')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  writeFileSync(join(repo, 'local.conf'), 'port=4000\n')
  ;({ app, page, dataDir } = await launchApp())
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(repo)
  await page.getByTestId('workspace-name').fill('repo')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

/** The worktree folder `folder` in this data directory (one repository folder inside). */
function worktreePath(folder: string): string {
  const worktrees = join(dataDir, 'worktrees')
  const [repoFolder] = readdirSync(worktrees)
  return join(worktrees, repoFolder!, folder)
}

const card = (title: string): Locator =>
  page.getByTestId('card').filter({ has: page.getByTestId('card-title').getByText(title) })

/** The open card's terminal buffer, one trimmed string per line. */
function lines(): Promise<string[]> {
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

async function run(command: string): Promise<void> {
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** Creates card `title` with its own worktree, the branch as suggested; returns the branch. */
async function worktreeCard(title: string): Promise<string> {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-worktree').check()
  const branch = await page.getByTestId('new-card-branch').inputValue()
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  return branch
}

test('a card with its own worktree runs on a new branch, with ignored files copied', async () => {
  const branch = await worktreeCard('Fix the login bug')
  expect(branch).toBe('bikube/fix-the-login-bug')
  await expect(page.getByTestId('titlebar').getByTestId('card-branch')).toHaveText(branch)
  await expect(page.getByTestId('titlebar').getByTestId('card-branch')).toHaveAttribute(
    'data-worktree',
    'true'
  )

  await run('echo "at=$(git branch --show-current) conf=$(cat local.conf)"')
  await expect.poll(async () => (await lines()).includes(`at=${branch} conf=port=4000`)).toBe(true)
  // The worktree is in this data directory's worktrees folder, one folder per repository.
  expect(existsSync(worktreePath('fix-the-login-bug'))).toBe(true)
  // The repository itself stays on main, with nothing new in it.
  expect(git('branch', '--show-current')).toBe('main')
  expect(git('status', '--porcelain')).toBe('')

  await backToBoard(page)
  await expect(card('Fix the login bug').getByTestId('card-branch')).toHaveText(branch)
})

test('the branch follows the title until edited, and a taken or bad one is refused', async () => {
  git('branch', 'bikube/taken')
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('Taken')
  await expect(page.getByTestId('new-card-worktree')).toBeVisible()
  await page.getByTestId('new-card-worktree').check()
  const branch = page.getByTestId('new-card-branch')
  // An existing branch name is skipped.
  await expect(branch).toHaveValue('bikube/taken-2')
  await branch.fill('bad name')
  await branch.press('Enter')
  await expect(page.getByTestId('new-card-error-branch')).toHaveText('Not a valid branch name')
  await branch.fill('bikube/taken')
  await branch.press('Enter')
  await expect(page.getByTestId('new-card-error-branch')).toHaveText('Branch already exists')
  await expect(page.getByTestId('card')).toHaveCount(0)
})

test('#69: a description over the cap is refused before any worktree is made', async () => {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('Too long')
  await page.getByTestId('new-card-worktree').check()
  await page.getByTestId('new-card-description').fill('x'.repeat(100_001))
  await expect(page.getByTestId('new-card-description-count')).toHaveText('100,001 / 100,000')
  await page.getByTestId('new-card-create').click()
  await expect(page.getByTestId('new-card-description-error')).toHaveText(
    'Description is longer than 100,000 characters'
  )
  await expect(page.getByTestId('new-card-dialog')).toBeVisible()
  await expect(page.getByTestId('card')).toHaveCount(0)
  expect(git('branch', '--list', 'bikube/too-long')).toBe('')
  const worktrees = join(dataDir, 'worktrees')
  expect(existsSync(worktrees) ? readdirSync(worktrees) : []).toEqual([])
})

test('deleting a worktree card keeps or removes the worktree, never its branch', async () => {
  const branch = await worktreeCard('Keep me')
  const path = worktreePath('keep-me')
  await backToBoard(page)

  // Keep: the card goes, the worktree and branch stay.
  await card('Keep me').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  await expect(page.getByTestId('delete-keep-worktree')).toBeFocused()
  await page.getByTestId('delete-keep-worktree').click()
  await expect(card('Keep me')).toHaveCount(0)
  expect(existsSync(path)).toBe(true)

  // Remove, with uncommitted changes warned about: the worktree goes, the branch stays.
  await worktreeCard('Remove me')
  const removed = worktreePath('remove-me')
  await run('echo change > new-file.txt')
  // The file itself, not the screen: a wrapped command line can show any word.
  await expect.poll(() => existsSync(join(removed, 'new-file.txt'))).toBe(true)
  await backToBoard(page)
  await card('Remove me').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  await expect(page.getByTestId('delete-worktree-dirty')).toBeVisible()
  await page.getByTestId('delete-with-worktree').click()
  await expect.poll(() => existsSync(removed)).toBe(false)
  expect(git('branch', '--list', 'bikube/remove-me')).toContain('bikube/remove-me')
  expect(git('branch', '--list', branch)).toContain(branch)
  expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('# repo\n')
})

test('no worktree option outside a git repository', async () => {
  const plain = join(root, 'plain')
  mkdirSync(plain)
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(plain)
  await page.getByTestId('workspace-name').fill('plain')
  await page.getByTestId('workspace-submit').click()
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await expect(page.getByTestId('new-card-input')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByTestId('new-card-worktree')).toHaveCount(0)
})

test('clicking the Own worktree label checks it and keeps the form open', async () => {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await expect(page.getByTestId('new-card-worktree')).toBeVisible()
  // The title is still empty: leaving the form would cancel it.
  await page.getByText('Own worktree').click()
  await expect(page.getByTestId('new-card-form')).toBeVisible()
  await expect(page.getByTestId('new-card-worktree')).toBeChecked()
  // A label's click focuses its checkbox, inside the form.
  await expect(page.getByTestId('new-card-worktree')).toBeFocused()
  await page.getByText('Own worktree').click()
  await expect(page.getByTestId('new-card-worktree')).not.toBeChecked()
  await expect(page.getByTestId('new-card-form')).toBeVisible()
})

test("the sidebar and title bar show the workspace's branch, and follow a switch", async () => {
  const sidebar = page.getByTestId('workspace-item').filter({ hasText: 'repo' })
  await expect(sidebar.getByTestId('workspace-branch')).toHaveText('main')
  await expect(page.getByTestId('titlebar').getByTestId('card-branch')).toHaveText('main')
  await expect(page.getByTestId('titlebar').getByTestId('card-branch')).not.toHaveAttribute(
    'data-worktree'
  )
  git('switch', '-q', '-c', 'feature/other')
  // Read again every few seconds while shown.
  await expect(sidebar.getByTestId('workspace-branch')).toHaveText('feature/other', {
    timeout: 10_000
  })
  await expect(page.getByTestId('titlebar').getByTestId('card-branch')).toHaveText('feature/other')
})

test('a stopped plain card moves into its own worktree and runs there from its next start', async () => {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('Add search')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'Add search')
  await backToBoard(page)

  // Not offered while it runs.
  await card('Add search').getByTestId('card-menu').click()
  await expect(page.getByTestId('card-menu-move-worktree')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await card('Add search').getByTestId('card-stop').click()
  await page.getByTestId('confirm-close').click()
  await expect(card('Add search').getByTestId('card-status-label')).toHaveText('Stopped')

  await card('Add search').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-move-worktree').click()
  const dialog = page.getByTestId('move-worktree-dialog')
  await expect(dialog.getByTestId('move-worktree-branch')).toHaveValue('bikube/add-search')
  await expect(dialog.getByTestId('move-worktree-hint')).toContainText('A new branch from main')
  await dialog.getByTestId('move-worktree-submit').click()
  await expect(dialog).toHaveCount(0)
  await expect(card('Add search').getByTestId('card-branch')).toHaveText('bikube/add-search')
  expect(existsSync(worktreePath('add-search'))).toBe(true)

  // Once it has one, the item is gone; its next start runs in the worktree.
  await card('Add search').getByTestId('card-menu').click()
  await expect(page.getByTestId('card-menu-move-worktree')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await card('Add search').getByTestId('card-open').click()
  await expectCardOpen(page, 'Add search')
  await run('echo "at=$(git branch --show-current) conf=$(cat local.conf)"')
  await expect
    .poll(async () => (await lines()).includes('at=bikube/add-search conf=port=4000'))
    .toBe(true)
  expect(git('branch', '--show-current')).toBe('main')
})

test("a shell runs in a worktree card's worktree from Run in this worktree, back in the workspace folder from Run in", async () => {
  await showShells(page)
  await page.getByTestId('shell-add').click()
  const dialog = page.getByTestId('shell-dialog')
  await dialog.getByTestId('shell-name').fill('Where')
  await dialog.getByTestId('shell-command').fill('echo "at=$(git branch --show-current)"')
  await dialog.getByTestId('shell-submit').click()
  await expect(dialog).toHaveCount(0)
  const where = page.locator('[data-testid="shell"][data-shell-name="Where"]')
  // No worktree card: the dropdown lists both, the folder checked and this worktree disabled.
  await where.getByTestId('shell-menu').click()
  await expect(page.getByTestId('shell-menu-run-in')).toHaveCount(0)
  await page.keyboard.press('Escape')
  const runMenu = where.getByTestId('shell-run-menu')
  const folder = page.getByTestId('shell-run-workspace')
  const here = page.getByTestId('shell-run-here')
  await runMenu.click()
  await expect(folder).toHaveAttribute('aria-checked', 'true')
  await expect(here).toBeDisabled()
  await page.keyboard.press('Escape')
  // Stopped, no line says where it runs.
  await expect(where.getByTestId('shell-where')).toHaveCount(0)

  // Beside a worktree card, Run in this worktree makes the button run it there.
  const branch = await worktreeCard('Add search')
  const start = where.getByTestId('shell-start')
  await expect(start).not.toHaveAttribute('data-worktree')
  await runMenu.click()
  await here.click()
  await expect(start).toHaveAttribute('data-worktree', 'true')
  await expect(where).toHaveAttribute('data-running', 'false')
  await runMenu.click()
  await expect(folder).toHaveAttribute('aria-checked', 'false')
  await expect(here).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await start.click()
  await expect(where).toHaveAttribute('data-running', 'true')
  await expectCardOpen(page, 'Add search')
  // Running, the line says where.
  const runsIn = where.getByTestId('shell-where-text')
  await expect(runsIn).toHaveText(branch)
  await where.getByTestId('shell-open').click()
  await expectCardOpen(page, 'Where')
  await expect.poll(lines).toContain(`at=${branch}`)
  // Saved shortly after the change.
  await expect
    .poll(() => readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
    .toContain('"runIn"')

  // On the board, Run in moves it back: it restarts in the workspace folder.
  await backToBoard(page)
  await expect(runsIn).toHaveText(branch)
  await where.getByTestId('shell-menu').click()
  const runIn = page.getByTestId('shell-menu-run-in')
  await expect(runIn).toHaveText(['Workspace folder', `Add search · ${branch}`])
  await expect(runIn.nth(1)).toHaveAttribute('aria-checked', 'true')
  await runIn.first().click()
  await expect(runsIn).toHaveText('/repo')
  await where.getByTestId('shell-open').click()
  await expectCardOpen(page, 'Where')
  await expect.poll(lines).toContain('at=main')
  await backToBoard(page)

  // Moved there again, a deleted worktree card leaves it in the workspace folder.
  await where.getByTestId('shell-menu').click()
  await page.getByTestId('shell-menu-run-in').nth(1).click()
  await expect(runsIn).toHaveText(branch)
  await card('Add search').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  await page.getByTestId('delete-keep-worktree').click()
  await expect(card('Add search')).toHaveCount(0)
  await expect(runsIn).toHaveText('/repo')
})

/** Stops the running card `title` from the board, confirming the Close. */
async function stopOnBoard(title: string): Promise<void> {
  await card(title).getByTestId('card-stop').click()
  await page.getByTestId('confirm-close').click()
  await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
}

test('Remove worktree keeps the card, which runs in the workspace folder from its next start', async () => {
  const branch = await worktreeCard('Done work')
  const path = worktreePath('done-work')
  await run('echo change > new-file.txt')
  await expect.poll(() => existsSync(join(path, 'new-file.txt'))).toBe(true)
  await backToBoard(page)

  // Not offered while it runs.
  await card('Done work').getByTestId('card-menu').click()
  await expect(page.getByTestId('card-menu-remove-worktree')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await stopOnBoard('Done work')

  // Cancel changes nothing; uncommitted changes are warned about.
  await card('Done work').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-remove-worktree').click()
  const dialog = page.getByTestId('remove-worktree-dialog')
  await expect(dialog.getByTestId('remove-worktree-dirty')).toBeVisible()
  await dialog.getByTestId('remove-worktree-cancel').click()
  await expect(dialog).toHaveCount(0)
  expect(existsSync(path)).toBe(true)

  await card('Done work').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-remove-worktree').click()
  await dialog.getByTestId('remove-worktree-submit').click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => existsSync(path)).toBe(false)
  expect(git('branch', '--list', branch)).toContain(branch)
  await expect(card('Done work')).toHaveCount(1)
  await expect(card('Done work').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(card('Done work').locator('[data-worktree]')).toHaveCount(0)
  await card('Done work').getByTestId('card-menu').click()
  await expect(page.getByTestId('card-menu-remove-worktree')).toHaveCount(0)
  await page.keyboard.press('Escape')

  await card('Done work').getByTestId('card-open').click()
  await expectCardOpen(page, 'Done work')
  await run('echo "at=$(git branch --show-current) in=$(basename "$PWD")"')
  await expect.poll(async () => (await lines()).includes('at=main in=repo')).toBe(true)
})

test('a worktree card whose folder is gone offers to run in the workspace folder', async () => {
  await worktreeCard('Gone')
  const path = worktreePath('gone')
  await backToBoard(page)
  await stopOnBoard('Gone')
  rmSync(path, { recursive: true, force: true })

  await card('Gone').getByTestId('card-open').click()
  const dialog = page.getByTestId('remove-worktree-dialog')
  await expect(dialog).toContainText('is gone')
  await dialog.getByTestId('remove-worktree-submit').click()
  await expect(dialog).toHaveCount(0)
  await expectCardOpen(page, 'Gone')
  await run('echo "at=$(git branch --show-current) in=$(basename "$PWD")"')
  await expect.poll(async () => (await lines()).includes('at=main in=repo')).toBe(true)
  // git's entry for the missing folder is pruned.
  expect(git('worktree', 'list')).not.toContain(path)
})
