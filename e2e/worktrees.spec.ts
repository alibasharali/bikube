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
  root = mkdtempSync(join(tmpdir(), 'drovr-worktrees-'))
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
  expect(branch).toBe('drovr/fix-the-login-bug')
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
  git('branch', 'drovr/taken')
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('Taken')
  await expect(page.getByTestId('new-card-worktree')).toBeVisible()
  await page.getByTestId('new-card-worktree').check()
  const branch = page.getByTestId('new-card-branch')
  // An existing branch name is skipped.
  await expect(branch).toHaveValue('drovr/taken-2')
  await branch.fill('bad name')
  await branch.press('Enter')
  await expect(page.getByTestId('new-card-error-branch')).toHaveText('Not a valid branch name')
  await branch.fill('drovr/taken')
  await branch.press('Enter')
  await expect(page.getByTestId('new-card-error-branch')).toHaveText('Branch already exists')
  await expect(page.getByTestId('card')).toHaveCount(0)
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
  expect(git('branch', '--list', 'drovr/remove-me')).toContain('drovr/remove-me')
  expect(git('branch', '--list', branch)).toContain(branch)
  expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('# repo\n')
})

test('no worktree option outside a git repository', async () => {
  const plain = join(root, 'plain')
  mkdirSync(plain)
  await page.getByTestId('workspace-add').click()
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
