import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, closeCard, expectCardOpen } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Cards waiting for the user (#41): each workspace's row in the sidebar counts its cards and
// shells whose activity is Waiting for you or Needs your answer, set with `board activity`, and
// Next waiting card (Cmd+J on macOS, Ctrl+Shift+J elsewhere) opens the one that waited longest.

const darwin = process.platform === 'darwin'
const NEXT = darwin ? 'Meta+J' : 'Control+Shift+J'

let app: ElectronApplication | undefined
let page: Page
let root: string
let dataDir: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-waiting-'))
  dataDir = newDataDir()
  ;({ app, page } = await launchApp({ dataDir }))
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

async function createWorkspace(name: string): Promise<void> {
  const dir = join(root, name)
  mkdirSync(dir)
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

async function selectWorkspace(name: 'Alpha' | 'Beta'): Promise<void> {
  await row(name).getByTestId('workspace-item').click()
  await expect(page.getByTestId('board-title')).toHaveText(name)
}

/** The sidebar row of `Alpha` or `Beta`, by place: a collapsed row shows no name. */
const row = (name: 'Alpha' | 'Beta'): Locator =>
  page.locator('[data-workspace-id]').nth(name === 'Alpha' ? 0 : 1)

/** Card `title` in workspace `name`'s sidebar tree, and its activity mark. */
const terminalRow = (name: 'Alpha' | 'Beta', title: string): Locator =>
  row(name)
    .getByTestId('workspace-terminal')
    .filter({ has: page.getByTestId('workspace-terminal-title').getByText(title, { exact: true }) })
const mark = (name: 'Alpha' | 'Beta', title: string): Locator =>
  terminalRow(name, title).getByTestId('workspace-terminal-activity')

function boardCard(title: string): Locator {
  return page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })
}

/** Creates a running card in Backlog and goes back to the board. */
async function newCard(title: string): Promise<void> {
  await page.getByTestId('new-card').first().click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await backToBoard(page)
}

async function openCard(title: string): Promise<void> {
  await boardCard(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.closest('[data-testid=card-view] [data-testid=pane]') != null
      )
    )
    .toBe(true)
}

/**
 * Opens card `title`, types `board activity . <activity>` in it and waits for its pill. Waiting
 * for you clears once the card is seen, so it is set a second later, back on the board.
 */
async function setActivity(title: string, activity: string, pillText: string): Promise<void> {
  await openCard(title)
  const delay = activity === 'waiting' ? 'sleep 1; ' : ''
  await page.keyboard.type(`${delay}board activity . ${activity}`)
  await page.keyboard.press('Enter')
  await backToBoard(page)
  // The first `board` of a run starts Bikube's executable as Node from a cold disk cache.
  await expect(boardCard(title).getByTestId('card-activity')).toHaveText(pillText, {
    timeout: 15_000
  })
}

/** Alpha (active) and Beta, each with two running plain cards; Beta's wait and need an answer. */
async function twoWaitingInBeta(): Promise<void> {
  await createWorkspace('Alpha')
  await newCard('a1')
  await newCard('a2')
  await createWorkspace('Beta')
  await newCard('b1')
  await newCard('b2')
  await setActivity('b1', 'waiting', 'Waiting for you')
  await setActivity('b2', 'question', 'Needs your answer')
  await selectWorkspace('Alpha')
}

test('AC1: each waiting card is marked in its workspace’s tree, live', async () => {
  await twoWaitingInBeta()
  await expect(mark('Beta', 'b1')).toHaveAttribute('data-activity', 'waiting')
  await expect(mark('Beta', 'b1')).toHaveAttribute('title', 'Waiting for you')
  await expect(mark('Beta', 'b2')).toHaveAttribute('data-activity', 'question')
  await expect(mark('Beta', 'b2')).toHaveAttribute('title', 'Needs your answer')
  // Alpha's cards run with nothing to report: the green dot.
  await expect(row('Alpha').getByTestId('workspace-terminal-activity')).toHaveCount(2)
  for (const title of ['a1', 'a2']) {
    await expect(mark('Alpha', title)).toHaveAttribute('data-activity', 'running')
  }
  // Expanded, the workspace row itself counts nothing: the cards show it.
  await expect(row('Beta').getByTestId('workspace-item')).toHaveAccessibleName('Beta')

  await selectWorkspace('Beta')
  await setActivity('b2', 'working', 'Working')
  await expect(mark('Beta', 'b2')).toHaveAttribute('data-activity', 'working')

  await openCard('b1')
  await closeCard(page)
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(terminalRow('Beta', 'b1')).toHaveCount(0)
})

test('AC2: the collapsed sidebar shows the count as a dot on the badge', async () => {
  await twoWaitingInBeta()

  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
  const dot = row('Beta').getByTestId('workspace-waiting-dot')
  await expect(dot).toHaveText('2')
  await expect(dot).toHaveAttribute('title', '2 waiting for you')
  await expect(dot).toBeVisible()
  await expect(row('Beta').getByTestId('workspace-item')).toHaveAccessibleName(
    'Beta, 2 waiting for you'
  )
  await expect(row('Alpha').getByTestId('workspace-waiting-dot')).toHaveCount(0)

  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'false')
  await expect(row('Beta').getByTestId('workspace-waiting-dot')).toHaveCount(0)
  await expect(mark('Beta', 'b1')).toHaveAttribute('data-activity', 'waiting')
})

/** The active workspace's sidebar row reads `name`. */
async function expectActive(name: 'Alpha' | 'Beta'): Promise<void> {
  await expect(page.locator('[data-testid=workspace-item][aria-current=true]')).toHaveText(
    new RegExp(name)
  )
}

/** Card `title` is open at full size in workspace `name`. */
async function expectOpenIn(name: 'Alpha' | 'Beta', title: string): Promise<void> {
  await expectCardOpen(page, title)
  await expectActive(name)
}

/** Lets a press that should do nothing have its chance to act. */
const settle = (): Promise<void> => page.waitForTimeout(500)

/** The open card's terminal, wrapped rows joined, one trimmed string per line. */
function bufferLines(): Promise<string[]> {
  return page.evaluate(() => {
    type Line = { isWrapped: boolean; translateToString(trim: boolean): string }
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: { buffer: { active: { length: number; getLine(i: number): Line | undefined } } }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const lines: string[] = []
    let current = ''
    for (let i = 0; i < buffer.length; i++) {
      const next = buffer.getLine(i + 1)
      current += buffer.getLine(i)?.translateToString(!next?.isWrapped) ?? ''
      if (!next?.isWrapped) {
        lines.push(current.trim())
        current = ''
      }
    }
    return lines
  })
}

/** Alpha with card a1, Beta with `one` waiting before `two` needs an answer; Alpha's board shown. */
async function oneThenTwoInBeta(): Promise<void> {
  await createWorkspace('Alpha')
  await newCard('a1')
  await createWorkspace('Beta')
  await newCard('one')
  await newCard('two')
  await setActivity('one', 'waiting', 'Waiting for you')
  await setActivity('two', 'question', 'Needs your answer')
  await selectWorkspace('Alpha')
}

test('AC3: the shortcut opens the longest-waiting card in any workspace, then the next', async () => {
  await oneThenTwoInBeta()
  await page.keyboard.press(NEXT)
  await expectOpenIn('Beta', 'one')
  await page.keyboard.press(NEXT)
  await expectOpenIn('Beta', 'two')
  // `one` was seen, so it waits no more; `two` needs an answer still and stays open.
  await page.keyboard.press(NEXT)
  await settle()
  await expectOpenIn('Beta', 'two')
})

test('AC4: a change between waiting and question keeps the place; working and back moves it last', async () => {
  await oneThenTwoInBeta()
  await selectWorkspace('Beta')
  // From `two` (a question stays while open), so `one` changes without being opened and seen.
  await openCard('two')
  await page.keyboard.type('board activity one question')
  await page.keyboard.press('Enter')
  await backToBoard(page)
  await expect(boardCard('one').getByTestId('card-activity')).toHaveText('Needs your answer')
  await page.keyboard.press(NEXT)
  await expectOpenIn('Beta', 'one')

  await backToBoard(page)
  await setActivity('one', 'working', 'Working')
  await setActivity('one', 'waiting', 'Waiting for you')
  await page.keyboard.press(NEXT)
  await expectOpenIn('Beta', 'two')
})

test('AC5: with nothing waiting the shortcut does nothing; with only the open card, it stays', async () => {
  await createWorkspace('Alpha')
  await newCard('a1')
  await page.keyboard.press(NEXT)
  await settle()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expectActive('Alpha')

  await setActivity('a1', 'waiting', 'Waiting for you')
  await page.keyboard.press(NEXT)
  await expectOpenIn('Alpha', 'a1')
  await page.keyboard.press(NEXT)
  await settle()
  await expectOpenIn('Alpha', 'a1')
})

test('AC6: from a focused terminal the shell gets no keys; with Settings open nothing happens', async () => {
  await createWorkspace('Alpha')
  await newCard('a1')
  await newCard('a2')
  await setActivity('a2', 'waiting', 'Waiting for you')

  await openCard('a1')
  // xterm turns Ctrl+Shift+J and Cmd+J into no input, so the shell's output alone can't show a
  // leak: the press must not reach the terminal's keyboard (its helper textarea) at all.
  const listening = await page.evaluate(() => {
    const keyboard = document.querySelector(
      '[data-testid=card-view] [data-testid=terminal] .xterm-helper-textarea'
    )
    const w = window as unknown as { __leakedKeys: string[] }
    w.__leakedKeys = []
    keyboard?.addEventListener('keydown', (e) => {
      const { key } = e as KeyboardEvent
      if (!['Control', 'Shift', 'Meta'].includes(key)) w.__leakedKeys.push(key)
    })
    return keyboard !== null
  })
  expect(listening).toBe(true)
  const shown = async (): Promise<string[]> => (await bufferLines()).filter((line) => line !== '')
  await expect.poll(shown).not.toHaveLength(0)
  const before = await shown()
  await page.keyboard.press(NEXT)
  await expectOpenIn('Alpha', 'a2')
  expect(
    await page.evaluate(() => (window as unknown as { __leakedKeys: string[] }).__leakedKeys)
  ).toEqual([])

  await backToBoard(page)
  await openCard('a1')
  await settle()
  expect(await shown()).toEqual(before)
  await page.keyboard.type('echo ok')
  await page.keyboard.press('Enter')
  await expect.poll(bufferLines).toContain('ok')
  expect((await bufferLines()).filter((line) => line.endsWith('echo ok'))).toHaveLength(1)

  const settings = page.getByTestId('settings-dialog')
  await page.getByTestId('settings-open').click()
  await expect(settings).toBeVisible()
  await page.keyboard.press(NEXT)
  await settle()
  await expect(settings).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await expectOpenIn('Alpha', 'a1')
})

test('AC8: a recorded shortcut replaces the default, is saved, and Reset brings the default back', async () => {
  await createWorkspace('Alpha')
  await createWorkspace('Beta')
  await newCard('b1')
  await setActivity('b1', 'waiting', 'Waiting for you')
  await selectWorkspace('Alpha')

  const settings = page.getByTestId('settings-dialog')
  const field = settings.getByTestId('settings-shortcut-nextWaiting')
  const file = join(dataDir, 'bikube-settings.json')
  const saved = (): string => (existsSync(file) ? readFileSync(file, 'utf8') : '')
  await page.getByTestId('settings-open').click()
  await settings.getByTestId('settings-section-shortcuts').click()
  await expect(settings.getByRole('group', { name: 'Shortcuts' })).toContainText(
    'Next waiting card'
  )
  await expect(field).toHaveText(darwin ? 'Cmd+J' : 'Ctrl+Shift+J')
  await field.click()
  await page.keyboard.press('Control+Alt+J')
  await expect(field).toHaveText('Ctrl+Alt+J')
  await expect.poll(saved).toContain('"nextWaiting":"Ctrl+Alt+J"')
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)

  await page.keyboard.press(NEXT)
  await settle()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expectActive('Alpha')
  await page.keyboard.press('Control+Alt+J')
  await expectOpenIn('Beta', 'b1')

  await page.getByTestId('settings-open').click()
  await settings.getByTestId('settings-section-shortcuts').click()
  await settings.getByTestId('settings-shortcut-reset-nextWaiting').click()
  await expect(field).toHaveText(darwin ? 'Cmd+J' : 'Ctrl+Shift+J')
  await expect.poll(saved).not.toContain('nextWaiting')
})

const PALETTE = darwin ? 'Meta+K' : 'Control+Shift+P'
const palette = (): Locator => page.getByRole('dialog', { name: 'Command palette' })

/** The palette's Actions section's row titles, read with the palette opened. */
async function paletteActions(): Promise<string[]> {
  await page.keyboard.press(PALETTE)
  await expect(palette()).toBeVisible()
  return palette()
    .locator('[data-testid=palette-section][data-section=actions]')
    .getByTestId('palette-row-title')
    .allTextContents()
}

test('AC9: the palette lists Next waiting card while a card waits, with its shortcut, and runs it', async () => {
  await createWorkspace('Alpha')
  await createWorkspace('Beta')
  await newCard('b1')
  await selectWorkspace('Alpha')

  expect(await paletteActions()).not.toContain('Next waiting card')
  await page.keyboard.press('Escape')
  await expect(palette()).toHaveCount(0)

  const settings = page.getByTestId('settings-dialog')
  await page.getByTestId('settings-open').click()
  await settings.getByTestId('settings-section-shortcuts').click()
  const shortcut = (await settings.getByTestId('settings-shortcut-nextWaiting').textContent()) ?? ''
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)

  await selectWorkspace('Beta')
  await setActivity('b1', 'waiting', 'Waiting for you')
  await selectWorkspace('Alpha')

  const actions = await paletteActions()
  expect(actions.slice(actions.indexOf('New shell'), actions.indexOf('New workspace'))).toEqual([
    'New shell',
    'Next waiting card'
  ])
  const nextRow = palette()
    .getByTestId('palette-row')
    .filter({ has: page.getByTestId('palette-row-title').getByText('Next waiting card') })
  await expect(nextRow.getByTestId('palette-row-shortcut')).toHaveText(shortcut)
  await nextRow.click()
  await expect(palette()).toHaveCount(0)
  await expectOpenIn('Beta', 'b1')
})

test('Waiting for you is a notification: opening the card clears it; Needs your answer stays', async () => {
  await createWorkspace('Alpha')
  await newCard('a1')
  await newCard('a2')
  await setActivity('a1', 'waiting', 'Waiting for you')
  await setActivity('a2', 'question', 'Needs your answer')
  await expect(mark('Alpha', 'a1')).toHaveAttribute('data-activity', 'waiting')

  // Opened (even with nothing typed), a1 is seen: running again everywhere.
  await openCard('a1')
  await backToBoard(page)
  await expect(boardCard('a1').getByTestId('card-activity')).toHaveCount(0)
  await expect(mark('Alpha', 'a1')).toHaveAttribute('data-activity', 'running')
  await expect(boardCard('a2').getByTestId('card-activity')).toHaveText('Needs your answer')

  // Opened, a2's question stays until answered, and it alone is left to jump to.
  await openCard('a2')
  await backToBoard(page)
  await expect(boardCard('a2').getByTestId('card-activity')).toHaveText('Needs your answer')
  await page.keyboard.press(NEXT)
  await expectOpenIn('Alpha', 'a2')
})

test('Waiting for you set while the window is away stays until the window is focused again', async () => {
  await createWorkspace('Alpha')
  await newCard('a1')
  await openCard('a1')
  // Playwright reads every page as focused: the window looks away here, as another app would.
  await page.evaluate(() => (document.hasFocus = () => false))
  await page.keyboard.type('board activity . waiting')
  await page.keyboard.press('Enter')
  // The first `board` of a run starts Bikube's executable as Node from a cold disk cache.
  await expect(mark('Alpha', 'a1')).toHaveAttribute('data-activity', 'waiting', {
    timeout: 15_000
  })
  await settle()
  await expect(mark('Alpha', 'a1')).toHaveAttribute('data-activity', 'waiting')

  await page.evaluate(() => {
    document.hasFocus = () => true
    dispatchEvent(new FocusEvent('focus'))
  })
  await expect(mark('Alpha', 'a1')).toHaveAttribute('data-activity', 'running')
})
