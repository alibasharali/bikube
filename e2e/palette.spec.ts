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

for (const how of ['a click outside', 'the shortcut again'] as const) {
  test(`D8: closing the palette with ${how} gives the terminal its keyboard back`, async () => {
    await createWorkspace('Alpha')
    await newCard('api')
    await expect.poll(terminalFocused).toBe(true)

    await openPalette()
    if (how === 'a click outside') await page.mouse.click(5, 5)
    else await page.keyboard.press(PALETTE)
    await expect(palette()).toHaveCount(0)
    await expect.poll(terminalFocused).toBe(true)

    await run('echo ok')
    await expect.poll(async () => (await bufferLines()).includes('ok')).toBe(true)
    await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  })
}

test('D1: the palette opens from the empty state, offering New workspace and Open Settings', async () => {
  await expect(page.getByTestId('empty-state')).toBeVisible()
  await openPalette()
  const actions = await titles(section('actions'))
  expect(actions).toContain('New workspace')
  expect(actions).toContain('Open Settings')
  await expect(section('cards')).toHaveCount(0)
})

test('D8: while the palette is open, Mod+digit and other shortcuts do nothing', async () => {
  await createWorkspace('Alpha')
  await createWorkspace('Beta')
  await selectWorkspace('Alpha')

  await openPalette()
  await page.keyboard.press(darwin ? 'Meta+2' : 'Control+2')
  await page.keyboard.press(darwin ? 'Meta+,' : 'Control+,')
  await expect(palette()).toBeVisible()
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect(page.locator('[data-testid=workspace-item][aria-current=true]')).toHaveText(/Alpha/)
  await expect(page.getByTestId('board-title')).toHaveText('Alpha')

  // The same keys act once the palette is closed, so the test above proves the palette stopped them.
  await page.keyboard.press('Escape')
  await expect(palette()).toHaveCount(0)
  await page.keyboard.press(darwin ? 'Meta+2' : 'Control+2')
  await expect(page.getByTestId('board-title')).toHaveText('Beta')
  await page.keyboard.press(darwin ? 'Meta+,' : 'Control+,')
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
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
  await expect(sections.nth(2)).toHaveAttribute('data-section', 'actions')
  await expect(sections).toHaveCount(3)
  await expect(section('cards').getByText('Cards', { exact: true })).toBeVisible()
  await expect(section('shells').getByText('Shells', { exact: true })).toBeVisible()
  await expect(section('actions').getByText('Actions', { exact: true })).toBeVisible()

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
  // The board's actions, in D6's order, Toggle panel first (#57 D4).
  expect(await titles(section('actions'))).toEqual([
    'Toggle panel',
    'New card',
    'Open Default shell',
    'New workspace',
    'Open Settings',
    'Theme: Dark',
    'Theme: Light',
    'Switch to workspace Beta'
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
  // `one`, `two` and the Default shell: the workspace's name matches no action.
  await page.keyboard.type('alpha')
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
  await search().fill('alpha one')
  await expect(rows()).toHaveCount(1)
  await expect(rows().nth(0)).toHaveAttribute('aria-selected', 'true')
  await search().fill('alpha')
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

/** The text of an action row's shortcut, as shown on its right. */
const actionShortcut = (label: string): Locator => row(label).getByTestId('palette-row-shortcut')

/** The shortcut Settings' Shortcuts section shows for `action`, read with Settings opened. */
async function settingsShortcut(action: string): Promise<string> {
  const settings = page.getByTestId('settings-dialog')
  await page.getByTestId('settings-open').click()
  await settings.getByTestId('settings-section-shortcuts').click()
  const text = (await settings.getByTestId(`settings-shortcut-${action}`).textContent()) ?? ''
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  return text
}

const CARD_VIEW_ACTIONS = [
  'Back to board',
  'Split right',
  'Split down',
  'Close pane',
  'Close card',
  'Toggle panel',
  'Find'
]

test('AC7: with a running card open, the card view actions and its moves are listed, with their shortcuts', async () => {
  await createWorkspace('Alpha')
  const shortcuts = {
    back: await settingsShortcut('back'),
    splitRight: await settingsShortcut('splitRight'),
    find: await settingsShortcut('find')
  }
  await newCard('api')

  await openPalette()
  const actions = await titles(section('actions'))
  expect(actions.slice(0, 9)).toEqual([
    'Back to board',
    'Split right',
    'Split down',
    'Close card',
    'Toggle panel',
    'Find',
    'Move card to In Progress',
    'Move card to Review',
    'Move card to Done'
  ])
  expect(actions).not.toContain('Close pane')
  expect(actions).not.toContain('Move card to Backlog')
  await expect(actionShortcut('Back to board')).toHaveText(shortcuts.back)
  await expect(actionShortcut('Split right')).toHaveText(shortcuts.splitRight)
  await expect(actionShortcut('Find')).toHaveText(shortcuts.find)
  await page.keyboard.press('Escape')

  // On the board none of them is listed but Toggle panel, which works there too (#57 D4).
  await backToBoard(page)
  await openPalette()
  const boardActions = await titles(section('actions'))
  expect(boardActions[0]).toBe('Toggle panel')
  for (const label of CARD_VIEW_ACTIONS) {
    if (label !== 'Toggle panel') expect(boardActions).not.toContain(label)
  }
  expect(boardActions.some((label) => label.startsWith('Move card to'))).toBe(false)
})

/** Opens the palette, types `label` and runs its action row with Enter. */
async function runAction(label: string): Promise<void> {
  await openPalette()
  await page.keyboard.type(label)
  await expect(rows().first().getByTestId('palette-row-title')).toHaveText(label)
  await page.keyboard.press('Enter')
  await expect(palette()).toHaveCount(0)
}

/** Whether keyboard focus is in an extra pane's terminal (not the main one). */
const extraPaneFocused = (): Promise<boolean> =>
  page.evaluate(() => {
    const pane = document.activeElement?.closest('[data-testid=pane]')
    const panes = Array.from(
      document.querySelectorAll('[data-testid=card-view] [data-testid=pane]')
    )
    return pane != null && panes.indexOf(pane) > 0
  })

test('AC8: card view actions run from the palette as their shortcuts do', async () => {
  await createWorkspace('Alpha')
  await newCard('api')

  // Split right: 2 panes, the new one focused; Close pane is offered for it.
  await runAction('Split right')
  await expect(page.getByTestId('pane')).toHaveCount(2)
  await expect.poll(extraPaneFocused).toBe(true)
  await openPalette()
  expect(await titles(section('actions'))).toContain('Close pane')
  await page.keyboard.press('Escape')
  await runAction('Close pane')
  await expect(page.getByTestId('pane')).toHaveCount(1)
  await expect.poll(terminalFocused).toBe(true)

  // Find opens the find bar on the focused pane, its field focused.
  await runAction('Find')
  await expect(page.getByTestId('find-bar')).toBeVisible()
  await expect(page.getByTestId('find-input')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('find-bar')).toHaveCount(0)

  // Toggle panel hides the side panel and shows it again.
  await expect(page.getByTestId('side-panel')).toBeVisible()
  await runAction('Toggle panel')
  await expect(page.getByTestId('side-panel')).toHaveCount(0)
  await runAction('Toggle panel')
  await expect(page.getByTestId('side-panel')).toBeVisible()

  // Move card: the card stays open, and is in Review on the board.
  await runAction('Move card to Review')
  await expectCardOpen(page, 'api')
  await expect.poll(terminalFocused).toBe(true)
  await backToBoard(page)
  await expect(column('Review').getByTestId('card-title')).toHaveText(['api'])
  await expect(column('Backlog').getByTestId('card')).toHaveCount(0)

  // Close card opens the Close confirmation.
  await boardCard('api').getByTestId('card-open').click()
  await expectCardOpen(page, 'api')
  await runAction('Close card')
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()

  // Back to board goes back to the board.
  await page.getByTestId('confirm-cancel').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await runAction('Back to board')
  await expect(page.getByTestId('board')).toBeVisible()
})

test('#48 AC6: with a split card open the palette lists Zoom pane with its shortcut, and it zooms', async () => {
  await createWorkspace('Alpha')
  const shortcut = await settingsShortcut('zoomPane')
  await newCard('api')
  await openPalette()
  expect(await titles(section('actions'))).not.toContain('Zoom pane')
  await page.keyboard.press('Escape')

  await runAction('Split right')
  await expect(page.getByTestId('pane')).toHaveCount(2)
  await openPalette()
  expect(await titles(section('actions'))).toContain('Zoom pane')
  await expect(actionShortcut('Zoom pane')).toHaveText(shortcut)
  await page.keyboard.press('Escape')

  await runAction('Zoom pane')
  await expect(page.getByTestId('pane-zoom')).toHaveText('Zoomed · 2 panes')
  await expect(page.getByTestId('pane').first()).toBeHidden()
  await expect.poll(extraPaneFocused).toBe(true)
  await runAction('Zoom pane')
  await expect(page.getByTestId('pane-zoom')).toHaveCount(0)
  await expect(page.getByTestId('pane').first()).toBeVisible()
})

test('AC10: New card goes to the board with the first column’s New card form open and focused', async () => {
  await createWorkspace('Alpha')
  await newCard('api')

  await runAction('New card')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(column('Backlog').getByTestId('new-card-form')).toBeVisible()
  await expect(column('Backlog').getByTestId('new-card-input')).toBeFocused()
  await expect(page.getByTestId('new-card-form')).toHaveCount(1)

  // The form takes a title like its button's: Enter creates and opens the card.
  await page.keyboard.type('next')
  await page.keyboard.press('Enter')
  await expectCardOpen(page, 'next')

  // Going back later doesn't open the form again; from the board, New card opens it.
  await backToBoard(page)
  await expect(page.getByTestId('new-card-form')).toHaveCount(0)
  await runAction('New card')
  await expect(column('Backlog').getByTestId('new-card-input')).toBeFocused()
})
