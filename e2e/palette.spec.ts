import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen, expectStatusOnBoard } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The command palette (#40): opening and closing it, card and shell rows, matching, keyboard
// selection, jumping to a card in any workspace, and rebinding its shortcut.

const darwin = process.platform === 'darwin'
/** The palette's default shortcut (D1) as a Playwright press. */
const PALETTE = darwin ? 'Meta+K' : 'Control+Shift+P'

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-palette-'))
  ;({ app, page, dataDir } = await launchApp())
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

async function createWorkspace(name: string, dir = makeDir(name)): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

async function selectWorkspace(name: string): Promise<void> {
  await page.getByTestId('workspace-item').filter({ hasText: name }).click()
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

const column = (name: string): Locator =>
  page.getByTestId('column').filter({ has: page.getByRole('heading', { name, exact: true }) })

const boardCard = (title: string): Locator =>
  page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })

/** Creates a card through `+ New card`; it opens at full size, running. */
async function newCard(title: string, columnName = 'Backlog'): Promise<void> {
  await column(columnName).getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

/** Types a command into the focused terminal and presses Enter. */
async function run(command: string): Promise<void> {
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** Creates a card and exits its shell: back on the board, the card is Stopped. */
async function stoppedCard(title: string): Promise<void> {
  await newCard(title)
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(boardCard(title).getByTestId('card-status-label')).toHaveText('Stopped')
}

const palette = (): Locator => page.getByRole('dialog', { name: 'Command palette' })
const search = (): Locator => palette().getByTestId('palette-input')
const section = (key: string): Locator =>
  palette().locator(`[data-testid=palette-section][data-section=${key}]`)
const rows = (scope: Locator = palette()): Locator => scope.getByTestId('palette-row')
const titles = (scope?: Locator): Promise<string[]> =>
  rows(scope).getByTestId('palette-row-title').allTextContents()
const row = (title: string): Locator =>
  rows().filter({ has: page.getByTestId('palette-row-title').getByText(title, { exact: true }) })

async function openPalette(): Promise<void> {
  await page.keyboard.press(PALETTE)
  await expect(palette()).toBeVisible()
  await expect(search()).toBeFocused()
}

/** The open card's terminal buffer, one trimmed string per line. */
function bufferLines(): Promise<string[]> {
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
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true).trim() ?? '')
    }
    return lines
  })
}

const terminalFocused = (): Promise<boolean> =>
  page.evaluate(
    () => document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
  )

test('AC1: the shortcut opens the palette focused and empty, Escape or the shortcut closes it, not over Settings', async () => {
  await createWorkspace('Alpha')

  await openPalette()
  await expect(search()).toHaveValue('')
  await expect(search()).toHaveAttribute('placeholder', 'Search cards, shells and actions')
  await page.keyboard.press('Escape')
  await expect(palette()).toHaveCount(0)

  // The shortcut toggles it; nothing typed is kept for the next open (D10).
  await openPalette()
  await page.keyboard.type('abc')
  await page.keyboard.press(PALETTE)
  await expect(palette()).toHaveCount(0)
  await openPalette()
  await expect(search()).toHaveValue('')

  // A click outside closes it too (D8).
  await page.mouse.click(5, 5)
  await expect(palette()).toHaveCount(0)

  // With Settings open the shortcut opens nothing.
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await page.keyboard.press(PALETTE)
  await expect(palette()).toHaveCount(0)
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
})

test('AC2: from a focused terminal, the shell receives nothing of the palette and keeps its keyboard', async () => {
  await createWorkspace('Alpha')
  await newCard('api')
  await expect.poll(terminalFocused).toBe(true)

  await openPalette()
  await page.keyboard.type('xyz')
  await page.keyboard.press('Escape')
  await expect(palette()).toHaveCount(0)
  await expect.poll(terminalFocused).toBe(true)

  await run('echo ok')
  await expect.poll(async () => (await bufferLines()).includes('ok')).toBe(true)
  const lines = await bufferLines()
  expect(lines.some((line) => line.includes('xyz'))).toBe(false)
  const typed = lines.find((line) => line.endsWith('echo ok'))
  expect(typed).toBeDefined()
  expect(typed).not.toMatch(/P\s*echo ok$/)
  // The card was never asked to close.
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
})

test('AC3: picking a Stopped card in another workspace makes it active and opens the card running', async () => {
  await createWorkspace('Alpha')
  await newCard('build')
  await backToBoard(page)
  await createWorkspace('Beta')
  await stoppedCard('deploy api')
  await selectWorkspace('Alpha')

  await openPalette()
  await page.keyboard.type('dep')
  await expect(rows(section('cards'))).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0)

  await expectCardOpen(page, 'deploy api')
  await expect(page.locator('[data-testid=workspace-item][aria-current=true]')).toHaveText(/Beta/)
  await expectStatusOnBoard(page, 'deploy api', 'Running')
})

test('AC4: with an empty query, cards then shells, the active workspace first, each with its workspace and status', async () => {
  await createWorkspace('Alpha')
  await stoppedCard('one')
  await stoppedCard('two')
  await createWorkspace('Beta')
  await stoppedCard('three')
  await selectWorkspace('Alpha')

  await openPalette()
  const sections = palette().getByTestId('palette-section')
  await expect(sections.first()).toHaveAttribute('data-section', 'cards')
  await expect(sections.nth(1)).toHaveAttribute('data-section', 'shells')
  await expect(section('cards').getByText('Cards', { exact: true })).toBeVisible()
  await expect(section('shells').getByText('Shells', { exact: true })).toBeVisible()

  expect(await titles(section('cards'))).toEqual(['one', 'two', 'three'])
  await expect(rows(section('cards')).getByTestId('palette-row-meta')).toHaveText([
    'Alpha · Stopped',
    'Alpha · Stopped',
    'Beta · Stopped'
  ])
  expect(await titles(section('shells'))).toEqual(['Default shell', 'Default shell'])
  await expect(rows(section('shells')).getByTestId('palette-row-meta')).toHaveText([
    'Alpha · Stopped',
    'Beta · Stopped'
  ])
})

test('AC5: fuzzy and multi-term matching, and No matches', async () => {
  await createWorkspace('Alpha')
  await stoppedCard('fix login bug')
  await stoppedCard('refactor billing')

  await openPalette()
  await page.keyboard.type('flb')
  expect(await titles(section('cards'))).toEqual(['fix login bug'])

  await search().fill('alpha bill')
  await expect(rows(section('cards'))).toHaveCount(1)
  expect(await titles(section('cards'))).toEqual(['refactor billing'])

  await search().fill('qqq')
  await expect(palette().getByTestId('palette-empty')).toHaveText('No matches')
  await expect(rows()).toHaveCount(0)
})

test('AC6: a worktree card matches its branch; a card matches its activity, which follows live', async () => {
  const repo = makeDir('repo')
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  await createWorkspace('repo', repo)

  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('search index')
  await page.getByTestId('new-card-worktree').check()
  await expect(page.getByTestId('new-card-branch')).toHaveValue('drovr/search-index')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'search index')
  await backToBoard(page)

  await newCard('agent')
  await run('board activity . question')

  await openPalette()
  await page.keyboard.type('search-index')
  await expect(row('search index')).toHaveCount(1)
  await expect(row('search index').getByTestId('palette-row-meta')).toHaveText(
    'repo · drovr/search-index · Running'
  )

  await search().fill('needs')
  await expect(row('agent')).toHaveCount(1)
  await expect(row('agent').getByTestId('palette-row-meta')).toHaveText(
    'repo · Running · Needs your answer'
  )

  // The activity follows live while the palette is open (D3).
  await page.keyboard.press('Escape')
  await run('(sleep 3; board activity . working) &')
  await openPalette()
  await expect(row('agent').getByTestId('palette-row-meta')).toHaveText(
    'repo · Running · Needs your answer'
  )
  await expect(row('agent').getByTestId('palette-row-meta')).toHaveText(
    'repo · Running · Working',
    { timeout: 10_000 }
  )
})

test('AC11: Up and Down wrap, the mouse selects on hover, Enter runs the selected row', async () => {
  await createWorkspace('Alpha')
  await stoppedCard('one')
  await stoppedCard('two')

  await openPalette()
  // `one`, `two` and the Default shell.
  await expect(rows()).toHaveCount(3)
  await expect(rows().nth(0)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(rows().nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect(rows().nth(0)).toHaveAttribute('aria-selected', 'false')
  await page.keyboard.press('ArrowDown')
  await expect(rows().nth(0)).toHaveAttribute('aria-selected', 'true')

  // Hovering selects; a new query selects the first row again.
  await rows().nth(1).hover()
  await expect(rows().nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.type('one')
  await expect(rows()).toHaveCount(1)
  await expect(rows().nth(0)).toHaveAttribute('aria-selected', 'true')
  await search().fill('')
  await expect(rows().nth(0)).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0)
  await expectCardOpen(page, 'one')
  await expectStatusOnBoard(page, 'one', 'Running')

  // Picking the card already open just closes the palette; a click runs a row.
  await openPalette()
  await row('one').click()
  await expect(palette()).toHaveCount(0)
  await expectCardOpen(page, 'one')
  await openPalette()
  await row('Default shell').click()
  await expect(palette()).toHaveCount(0)
  await expect(page.getByTestId('card-view')).toBeVisible()
  await expect(page.getByTestId('card-view')).not.toHaveAttribute('aria-label', 'one')
})

test('AC12: a recorded shortcut opens the palette instead of the default, saved, and Reset brings it back', async () => {
  await createWorkspace('Alpha')
  const settings = page.getByTestId('settings-dialog')
  const field = settings.getByTestId('settings-shortcut-palette')
  const file = join(dataDir, 'drovr-settings.json')
  const saved = (): string => (existsSync(file) ? readFileSync(file, 'utf8') : '')

  await page.getByTestId('settings-open').click()
  await settings.getByTestId('settings-section-shortcuts').click()
  await expect(settings.getByRole('group', { name: 'Shortcuts' })).toContainText('Command palette')
  await expect(field).toHaveText(darwin ? 'Cmd+K' : 'Ctrl+Shift+P')
  await field.click()
  await page.keyboard.press('Control+Alt+K')
  await expect(field).toHaveText('Ctrl+Alt+K')
  await expect.poll(saved).toContain('"palette":"Ctrl+Alt+K"')
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)

  await page.keyboard.press('Control+Alt+K')
  await expect(palette()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette()).toHaveCount(0)
  await page.keyboard.press(PALETTE)
  await expect(palette()).toHaveCount(0)

  await page.getByTestId('settings-open').click()
  await settings.getByTestId('settings-section-shortcuts').click()
  await settings.getByTestId('settings-shortcut-reset-palette').click()
  await expect(field).toHaveText(darwin ? 'Cmd+K' : 'Ctrl+Shift+P')
  await expect.poll(saved).not.toContain('palette')
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await openPalette()
})
