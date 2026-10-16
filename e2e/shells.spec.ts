import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// A workspace's shells: the Default shell and named shells with a startup command, above the board.

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string
let dir: string

const darwin = process.platform === 'darwin'
const OPEN_SHELL = darwin ? 'Meta+T' : 'Control+Shift+T'

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-shells-'))
  dir = join(root, 'alpha')
  mkdirSync(dir)
  ;({ app, page, dataDir } = await launchApp())
  await createWorkspace()
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

async function createWorkspace(): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

const shell = (name: string): Locator =>
  page.locator(`[data-testid="shell"][data-shell-name="${name}"]`)

/** The open terminal's buffer, one trimmed string per line. */
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

async function newShell(name: string, command: string, autostart = false): Promise<void> {
  await page.getByTestId('shell-add').click()
  await page.getByTestId('shell-name').fill(name)
  await page.getByTestId('shell-command').fill(command)
  if (autostart) await page.getByTestId('shell-autostart').check()
  await page.getByTestId('shell-submit').click()
  await expect(page.getByTestId('shell-dialog')).toHaveCount(0)
}

async function shellMenu(name: string, action: string): Promise<void> {
  await shell(name).getByTestId('shell-menu').click()
  await page.getByTestId(`shell-menu-${action}`).click()
}

const running = (name: string): Promise<string | null> =>
  shell(name).getByTestId('shell-open').getAttribute('data-running')

test('the Default shell opens a plain shell in the workspace folder, also by its shortcut', async () => {
  await expect(page.getByTestId('shell')).toHaveCount(1)
  await shell('Default').getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await expect(page.getByTestId('titlebar-shell-tag')).toHaveText('Shell')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('echo "in=$PWD"')
  await page.keyboard.press('Enter')
  await expect.poll(lines).toContain(`in=${dir}`)
  await backToBoard(page)
  // Running: the board's own cards are untouched, and the shortcut brings it back.
  await expect(page.getByTestId('card')).toHaveCount(0)
  await expect.poll(() => running('Default')).toBe('true')
  await page.keyboard.press(OPEN_SHELL)
  await expectCardOpen(page, 'Default')
  await expect.poll(lines).toContain(`in=${dir}`)
})

test('a named shell types its command each time it starts; restart, close, edit and delete', async () => {
  await newShell('Dev server', 'echo serving-$((40+2))')
  await expect(shell('Dev server')).toContainText('echo serving-$((40+2))')
  await shell('Dev server').getByTestId('shell-open').click()
  await expectCardOpen(page, 'Dev server')
  await expect.poll(lines).toContain('serving-42')
  await backToBoard(page)

  // Close stops it; opening it again starts it and types the command again.
  await shellMenu('Dev server', 'close')
  await expect.poll(() => running('Dev server')).toBe('false')
  await shell('Dev server').getByTestId('shell-open').click()
  await expect.poll(async () => (await lines()).filter((l) => l === 'serving-42').length).toBe(1)
  await backToBoard(page)

  // Restart runs the command in a fresh shell.
  await shellMenu('Dev server', 'restart')
  await expect.poll(() => running('Dev server')).toBe('true')

  // Edit renames it and changes its command; saved.
  await shellMenu('Dev server', 'edit')
  await page.getByTestId('shell-name').fill('Web')
  await page.getByTestId('shell-command').fill('echo web')
  await page.getByTestId('shell-submit').click()
  await expect(shell('Web')).toContainText('echo web')
  const saved = (): string => readFileSync(join(dataDir, 'drovr-state.json'), 'utf8')
  await expect.poll(saved).toContain('"name":"Web","command":"echo web"')

  // Delete asks while it runs, then it's gone.
  await shellMenu('Web', 'delete')
  await page.getByTestId('confirm-delete').click()
  await expect(shell('Web')).toHaveCount(0)
  await expect(page.getByTestId('shell')).toHaveCount(1)
})

test('a shell must have a name and a one-line command; the Default one has no edit or delete', async () => {
  await page.getByTestId('shell-add').click()
  await page.getByTestId('shell-submit').click()
  await expect(page.getByTestId('shell-error-name')).toHaveText('Name is required')
  await page.getByTestId('shell-cancel').click()
  await shell('Default').getByTestId('shell-menu').click()
  await expect(page.getByTestId('shell-menu-edit')).toHaveCount(0)
  await expect(page.getByTestId('shell-menu-delete')).toHaveCount(0)
})

test('a shell set to start with the workspace starts when the app opens it, and shells are kept', async () => {
  await newShell('Watcher', 'echo watching', true)
  await expect(shell('Watcher')).toBeVisible()
  await app!.close()
  ;({ app, page } = await launchApp({ dataDir }))
  await expect(shell('Watcher')).toBeVisible()
  await expect.poll(() => running('Watcher')).toBe('true')
  await expect.poll(() => running('Default')).toBe('false')
})

test('the title bar shows the workspace folder, and the board has no header of its own', async () => {
  await expect(page.getByTestId('board-location')).toBeVisible()
  await expect(page.getByTestId('board-location')).toHaveAttribute('title', new RegExp(`^${dir}`))
  await expect(page.locator('.board-header')).toHaveCount(0)
  // New workspaces get the task columns.
  await expect(page.getByRole('heading', { name: 'In Progress' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible()
  // The Shell choice is gone from new cards.
  await page.getByTestId('column').first().getByTestId('new-card').click()
  const options = await page.getByTestId('new-card-startup').locator('option').allTextContents()
  expect(options).not.toContain('Shell')
  expect(options[0]).toBe('Claude Code')
})
