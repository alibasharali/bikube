import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, checkOnBoard, closeCard, expectCardOpen, splitRight } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Kept output (#46): a card's main pane output saved when its shell stops, shown above a dim
// separator when it starts again; never for an extra pane or a shell; removed with the card.

let app: ElectronApplication
let page: Page
let dataDir: string
let root: string
let dir: string

const SEPARATOR = '── Previous output ·'

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-kept-'))
  dir = join(root, 'alpha')
  mkdirSync(dir)
  ;({ app, page, dataDir } = await launchApp())
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

const scrollbackDir = (): string => join(dataDir, 'scrollback')

/** The files in `<userData>/scrollback`; none when the folder isn't there. */
const keptFiles = (): string[] => (existsSync(scrollbackDir()) ? readdirSync(scrollbackDir()) : [])

function card(title: string): Locator {
  return page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })
}

/** The saved id of card `title`. */
function cardId(title: string): string {
  const saved = JSON.parse(readFileSync(join(dataDir, 'drovr-state.json'), 'utf8'))
  const cards = saved.state.workspaces.flatMap(
    (w: { cards: { id: string; title: string }[] }) => w.cards
  )
  return cards.find((c: { title: string }) => c.title === title).id
}

const fileOf = (id: string): string => createHash('sha256').update(id).digest('hex')

async function newCard(title: string): Promise<void> {
  const column = page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'In Progress', exact: true }) })
  await column.getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

/** Closes the open card through its shortcut and confirmation; it is Stopped on the board. */
async function closeOpenCard(title: string): Promise<void> {
  await closeCard(page)
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
}

/** Pane `index` of the open view's terminal buffer, one trimmed string per line (wrapped joined). */
function bufferLines(index = 0): Promise<string[]> {
  return page
    .getByTestId('card-view')
    .locator('[data-testid=terminal]')
    .nth(index)
    .evaluate((host) => {
      type Line = { isWrapped: boolean; translateToString(trim: boolean): string }
      const term = (
        host as HTMLElement & {
          __xterm?: { buffer: { active: { length: number; getLine(i: number): Line | undefined } } }
        }
      ).__xterm
      const buffer = term?.buffer.active
      if (!buffer) return []
      const rows: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        const next = buffer.getLine(i + 1)
        const text = line?.translateToString(!next?.isWrapped) ?? ''
        if (line?.isWrapped && rows.length > 0) rows[rows.length - 1] += text
        else rows.push(text)
      }
      return rows.map((r) => r.trim())
    })
}

/** Index of the last line equal to `text` (or starting with the separator); -1 when none. */
const lastIndex = (lines: string[], text: string): number =>
  lines.findLastIndex((l) => (text === SEPARATOR ? l.startsWith(SEPARATOR) : l === text))

const focusedPane = (): Promise<number> =>
  page.evaluate(() => {
    const pane = document.activeElement?.closest('[data-testid=card-view] [data-testid=pane]')
    return pane
      ? [...document.querySelectorAll('[data-testid=card-view] [data-testid=pane]')].indexOf(pane)
      : -1
  })

/** Types `command` into pane `index` (focused) and presses Enter. */
async function run(command: string, index = 0): Promise<void> {
  await expect.poll(focusedPane).toBe(index)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

test('AC1, AC4, AC10: a Closed card shows its output above the separator, accumulating', async () => {
  await newCard('api')
  await run('echo kept-46-close')
  await expect.poll(bufferLines).toContain('kept-46-close')
  await closeOpenCard('api')

  // AC10: the folder 0700, the card's file 0600, named by the sha256 of its id.
  await expect.poll(keptFiles).toEqual([fileOf(cardId('api'))])
  expect(statSync(scrollbackDir()).mode & 0o777).toBe(0o700)
  expect(statSync(join(scrollbackDir(), keptFiles()[0])).mode & 0o777).toBe(0o600)

  await openCard('api')
  await expect.poll(async () => lastIndex(await bufferLines(), SEPARATOR)).toBeGreaterThan(0)
  let lines = await bufferLines()
  expect(lastIndex(lines, 'kept-46-close')).toBeGreaterThanOrEqual(0)
  expect(lastIndex(lines, 'kept-46-close')).toBeLessThan(lastIndex(lines, SEPARATOR))
  expect(lines[lastIndex(lines, SEPARATOR)]).toMatch(/^── Previous output · .+ ──$/)
  await run('echo after')
  await expect.poll(async () => lastIndex(await bufferLines(), 'after')).toBeGreaterThan(0)
  lines = await bufferLines()
  expect(lastIndex(lines, 'after')).toBeGreaterThan(lastIndex(lines, SEPARATOR))

  // AC4: the next save holds the restored lines too.
  await run('echo second-run')
  await expect.poll(bufferLines).toContain('second-run')
  await closeOpenCard('api')
  await openCard('api')
  await expect
    .poll(async () => (await bufferLines()).filter((l) => l.startsWith(SEPARATOR)).length)
    .toBe(2)
  lines = await bufferLines()
  const newest = lastIndex(lines, SEPARATOR)
  expect(lastIndex(lines, 'kept-46-close')).toBeLessThan(lastIndex(lines, 'second-run'))
  expect(lastIndex(lines, 'second-run')).toBeLessThan(newest)
  expect(keptFiles()).toHaveLength(1)
})

test('AC3: output of a shell that exited by itself is above the separator', async () => {
  await newCard('api')
  await run('echo kept-46-exit; exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  await openCard('api')
  await expect.poll(async () => lastIndex(await bufferLines(), SEPARATOR)).toBeGreaterThan(0)
  const lines = await bufferLines()
  expect(lastIndex(lines, 'kept-46-exit')).toBeGreaterThanOrEqual(0)
  expect(lastIndex(lines, 'kept-46-exit')).toBeLessThan(lastIndex(lines, SEPARATOR))
})

test('D1: the separator starts below the last old line, wherever the old cursor was', async () => {
  await newCard('api')
  // Scrollback, a cleared screen, three lines and the cursor back up on the first (an agent's
  // input box above its footer): the blank rows below and the cursor's place are not kept.
  await run(String.raw`seq 1 60; printf '\033[H\033[2Jkept-a\nkept-b\nkept-c\033[2A'`)
  await expect.poll(bufferLines).toContain('kept-c')
  await closeOpenCard('api')

  await openCard('api')
  await expect.poll(async () => lastIndex(await bufferLines(), SEPARATOR)).toBeGreaterThan(0)
  const lines = await bufferLines()
  expect(lastIndex(lines, 'kept-b')).toBeGreaterThan(0)
  expect(lastIndex(lines, 'kept-c')).toBe(lastIndex(lines, 'kept-b') + 1)
  expect(lastIndex(lines, SEPARATOR)).toBe(lastIndex(lines, 'kept-c') + 1)
})

test('D5a, D9: the board reads only the new session, also after it clears the screen', async () => {
  await newCard('api')
  await run('echo kept-46-status')
  await expect.poll(bufferLines).toContain('kept-46-status')
  await closeOpenCard('api')

  await openCard('api')
  await expect.poll(async () => lastIndex(await bufferLines(), SEPARATOR)).toBeGreaterThan(0)
  // Neither the separator nor a restored line: empty, or the new prompt.
  await checkOnBoard(page, 'api', async (c) => {
    await expect(c.getByTestId('card-status-label')).toHaveText('Running')
    const line = c.getByTestId('card-status-line')
    if (await line.count()) {
      await expect(line).not.toContainText('Previous output')
      await expect(line).not.toContainText('kept-46-status')
    }
  })

  // A repaint from the top writes above the separator's old row: line by line (an agent's
  // `CSI H` then `CSI K` on each row) with the cursor back below that row in the same write,
  // and erasing the screen (`clear`, Ctrl+L) first.
  const rows = String.raw`\n\033[K`.repeat(15)
  await run(String.raw`printf '\033[Hrepaint\033[K${rows}'; sleep 30`)
  await expect.poll(bufferLines).toContain('repaint')
  await checkOnBoard(page, 'api', (c) =>
    expect(c.getByTestId('card-status-line')).toHaveText('repaint')
  )
  await page.keyboard.press('Control+c')
  await run(String.raw`printf '\033[H\033[2Jafter'; sleep 30`)
  await expect.poll(bufferLines).toContain('after')
  await checkOnBoard(page, 'api', (c) =>
    expect(c.getByTestId('card-status-line')).toHaveText('after')
  )
})

test('AC5: colours are kept, terminal modes are not', async () => {
  await newCard('api')
  // `\033`, not `\e`: dash's printf has no `\e`.
  await run(String.raw`printf '\033[31mred\033[0m\n'; printf '\033[?1000h'`)
  await expect.poll(bufferLines).toContain('red')
  const mouse = (): Promise<string> =>
    page
      .getByTestId('card-view')
      .locator('[data-testid=terminal]')
      .first()
      .evaluate(
        (host) =>
          (host as HTMLElement & { __xterm?: { modes: { mouseTrackingMode: string } } }).__xterm!
            .modes.mouseTrackingMode
      )
  await expect.poll(mouse).toBe('vt200')
  await closeOpenCard('api')

  await openCard('api')
  await expect.poll(async () => lastIndex(await bufferLines(), SEPARATOR)).toBeGreaterThan(0)
  const red = await page
    .getByTestId('card-view')
    .locator('[data-testid=terminal]')
    .first()
    .evaluate((host) => {
      type Cell = { getChars(): string; getFgColor(): number; isFgPalette(): boolean }
      type Line = { translateToString(trim: boolean): string; getCell(x: number): Cell | undefined }
      const buffer = (
        host as HTMLElement & {
          __xterm?: { buffer: { active: { length: number; getLine(i: number): Line | undefined } } }
        }
      ).__xterm!.buffer.active
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        if (line?.translateToString(true).trim() !== 'red') continue
        const cell = line.getCell(0)
        return { chars: cell?.getChars(), fg: cell?.getFgColor(), palette: cell?.isFgPalette() }
      }
      return null
    })
  expect(red).toEqual({ chars: 'r', fg: 1, palette: true })
  expect(await mouse()).toBe('none')
})

test('AC6: deleting a card removes its save', async () => {
  await newCard('api')
  await run('echo kept-46-delete')
  await expect.poll(bufferLines).toContain('kept-46-delete')
  await closeOpenCard('api')
  await expect.poll(keptFiles).toHaveLength(1)

  await card('api').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  await expect(card('api')).toHaveCount(0)
  await expect.poll(keptFiles).toEqual([])
})

test("AC9: an extra pane and the Default shell keep nothing; only the card's main pane", async () => {
  await newCard('api')
  await run('echo main-pane')
  await expect.poll(() => bufferLines(0)).toContain('main-pane')

  // An extra pane that exits, then a new one: no separator.
  await splitRight(page)
  await expect(page.getByTestId('card-view').getByTestId('pane')).toHaveCount(2)
  await run('echo extra-pane; exit', 1)
  await expect(page.getByTestId('card-view').getByTestId('pane')).toHaveCount(1)
  await splitRight(page)
  await expect(page.getByTestId('card-view').getByTestId('pane')).toHaveCount(2)
  await run('echo new-pane', 1)
  await expect.poll(() => bufferLines(1)).toContain('new-pane')
  let lines = await bufferLines(1)
  expect(lines.some((l) => l.startsWith(SEPARATOR))).toBe(false)
  expect(lines).not.toContain('extra-pane')
  await backToBoard(page)

  // The Default shell, restarted: no separator.
  const defaultShell = page.locator('[data-testid="shell"][data-shell-name="Default"]')
  await defaultShell.getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await run('echo default-shell')
  await expect.poll(() => bufferLines(0)).toContain('default-shell')
  await backToBoard(page)
  await defaultShell.getByTestId('shell-menu').click()
  await page.getByTestId('shell-menu-close').click()
  await expect(defaultShell.getByTestId('shell-open')).toHaveAttribute('data-running', 'false')
  await defaultShell.getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await run('echo default-again')
  await expect.poll(() => bufferLines(0)).toContain('default-again')
  lines = await bufferLines(0)
  expect(lines.some((l) => l.startsWith(SEPARATOR))).toBe(false)
  expect(lines).not.toContain('default-shell')
  await backToBoard(page)

  // Only the card was saved, once its main pane stopped.
  await openCard('api')
  await closeOpenCard('api')
  await expect.poll(keptFiles).toEqual([fileOf(cardId('api'))])
})

test('AC2, AC10: a running card at quit shows its output after a restart; none of it in the state or sync file', async () => {
  // A Sync folder, so the sync file holds the board (#13).
  const folder = join(root, 'sync')
  mkdirSync(folder)
  const syncFile = join(folder, 'drovr-board.json')
  const settings = page.getByTestId('settings-dialog')
  await page.getByTestId('settings-open').click()
  await settings.getByTestId('settings-section-sync').click()
  await settings.getByTestId('settings-sync-folder').fill(folder)
  await settings.getByTestId('settings-sync-folder').press('Enter')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toHaveCount(0)

  await newCard('api')
  await run('echo kept-46-quit')
  await expect.poll(bufferLines).toContain('kept-46-quit')
  const id = cardId('api')
  await expect
    .poll(() => (existsSync(syncFile) ? readFileSync(syncFile, 'utf8') : ''))
    .toContain('"api"')
  // Quit with the card running (its quit hold included), then launch on the same data.
  await app.close()
  expect(keptFiles()).toEqual([fileOf(id)])
  ;({ app, page } = await launchApp({ dataDir }))

  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  await openCard('api')
  await expect.poll(async () => lastIndex(await bufferLines(), SEPARATOR)).toBeGreaterThan(0)
  const lines = await bufferLines()
  expect(lastIndex(lines, 'kept-46-quit')).toBeGreaterThanOrEqual(0)
  expect(lastIndex(lines, 'kept-46-quit')).toBeLessThan(lastIndex(lines, SEPARATOR))

  // AC10: the board's files hold none of the kept output.
  for (const file of [join(dataDir, 'drovr-state.json'), syncFile]) {
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('"api"')
    expect(text).not.toContain('kept-46-quit')
    expect(text).not.toContain('scrollback')
    expect(text).not.toContain('Previous output')
  }
  expect(readdirSync(folder)).not.toContain('scrollback')
})

test('AC6: at launch, saves of cards not on the board and stray temporary files are removed', async () => {
  await newCard('api')
  await run('echo kept-46-prune')
  await expect.poll(bufferLines).toContain('kept-46-prune')
  await closeOpenCard('api')
  const kept = fileOf(cardId('api'))
  await expect.poll(keptFiles).toEqual([kept])
  await app.close()

  // A save of a card on no board, and temporary files a failed save left.
  const planted = [fileOf('card-not-on-the-board'), `${kept}.tmp`, `${fileOf('gone')}.tmp`]
  for (const name of planted) writeFileSync(join(scrollbackDir(), name), 'planted\r\n')
  ;({ app, page } = await launchApp({ dataDir }))
  await expect(page.getByTestId('board')).toBeVisible()
  await expect.poll(() => keptFiles().sort()).toEqual([kept])

  // The board's card keeps its save.
  await openCard('api')
  await expect.poll(async () => lastIndex(await bufferLines(), SEPARATOR)).toBeGreaterThan(0)
  const lines = await bufferLines()
  expect(lastIndex(lines, 'kept-46-prune')).toBeLessThan(lastIndex(lines, SEPARATOR))
})

test('AC7: turning Keep output off deletes every save, saves nothing more, and is kept', async () => {
  await newCard('api')
  await run('echo kept-46-switch')
  await expect.poll(bufferLines).toContain('kept-46-switch')
  await closeOpenCard('api')
  await expect.poll(keptFiles).toHaveLength(1)

  const settings = page.getByTestId('settings-dialog')
  const keepOutput = settings.getByTestId('settings-keep-output')
  await page.getByTestId('settings-open').click()
  await settings.getByTestId('settings-section-terminal').click()
  await expect(settings.getByText('Keep output after a card stops')).toBeVisible()
  await expect(keepOutput).toBeChecked()
  await keepOutput.uncheck()
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await expect.poll(keptFiles).toEqual([])
  const settingsFile = join(dataDir, 'drovr-settings.json')
  const keptSetting = (): unknown =>
    existsSync(settingsFile)
      ? JSON.parse(readFileSync(settingsFile, 'utf8')).settings.keepOutput
      : undefined
  await expect.poll(keptSetting).toBe(false)

  // Nothing restored, and the next Close saves nothing.
  await openCard('api')
  await run('echo off-run')
  await expect.poll(bufferLines).toContain('off-run')
  let lines = await bufferLines()
  expect(lines.some((l) => l.startsWith(SEPARATOR))).toBe(false)
  expect(lines).not.toContain('kept-46-switch')
  await closeOpenCard('api')
  expect(keptFiles()).toEqual([])
  await openCard('api')
  await run('echo off-again')
  await expect.poll(bufferLines).toContain('off-again')
  lines = await bufferLines()
  expect(lines.some((l) => l.startsWith(SEPARATOR))).toBe(false)
  expect(lines).not.toContain('off-run')
  expect(keptFiles()).toEqual([])

  // Kept across a restart.
  await app.close()
  expect(keptFiles()).toEqual([])
  expect(keptSetting()).toBe(false)
  ;({ app, page } = await launchApp({ dataDir }))
  await expect(page.getByTestId('board')).toBeVisible()
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-dialog').getByTestId('settings-section-terminal').click()
  await expect(page.getByTestId('settings-keep-output')).not.toBeChecked()
  expect(keptSetting()).toBe(false)
  expect(keptFiles()).toEqual([])
})
