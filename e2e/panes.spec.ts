import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeLogLines, fakeClaudeHome, SETTINGS_ARGS } from './fake-claude'
import {
  backToBoard,
  closeCard,
  expectCardOpen,
  expectStatusOnBoard,
  SHORTCUTS,
  splitDown,
  splitRight,
  zoomPane
} from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Split panes inside a card (#11): the full-size view splits into panes, each a live shell in
// the card's directory; extra panes close from their own button or when their shell exits.

/** The spec's workspace directory: `pwd` in a pane prints it. */
const ALPHA = '/tmp/bk-alpha'

let app: ElectronApplication
let page: Page
let root: string
let dataDir: string

test.beforeEach(async () => {
  mkdirSync(ALPHA, { recursive: true })
  root = mkdtempSync(join(tmpdir(), 'bikube-panes-'))
  ;({ app, page, dataDir } = await launchApp())
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

async function createWorkspace(dir: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

function column(name: string): Locator {
  return page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
}

function card(title: string): Locator {
  return page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText(title, { exact: true }) })
}

/** Creates a card through `+ New card`; its view opens. */
async function newCard(columnName: string, title: string): Promise<void> {
  await column(columnName).getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

/** The panes of the open card, in tree order. */
const panes = (): Locator => page.getByTestId('card-view').getByTestId('pane')

/** Pane `index`'s terminal buffer, one trimmed string per line (wrapped lines joined). */
function bufferLines(index: number): Promise<string[]> {
  return panes()
    .nth(index)
    .evaluate((pane) => {
      type Line = { isWrapped: boolean; translateToString(trim: boolean): string }
      const host = pane.querySelector('[data-testid=terminal]') as
        | (HTMLElement & {
            __xterm?: {
              buffer: { active: { length: number; getLine(i: number): Line | undefined } }
            }
          })
        | null
      const buffer = host?.__xterm?.buffer.active
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

/** Which pane (index in tree order) holds keyboard focus; -1 when none. */
const focusedPaneIndex = (): Promise<number> =>
  page.evaluate(() => {
    const pane = document.activeElement?.closest('[data-testid=card-view] [data-testid=pane]')
    return pane
      ? [...document.querySelectorAll('[data-testid=card-view] [data-testid=pane]')].indexOf(pane)
      : -1
  })

/** Types a command into pane `index`, which must have keyboard focus, and presses Enter. */
async function run(index: number, command: string): Promise<void> {
  await expect.poll(focusedPaneIndex).toBe(index)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** Waits until pane `index` shows a line equal to `text`. */
async function expectLine(index: number, text: string): Promise<void> {
  await expect.poll(() => bufferLines(index)).toContain(text)
}

async function box(
  locator: Locator
): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('not visible')
  return b
}

/** Workspace `alpha` in /tmp/bk-alpha with card `api` open, its shell ready. */
async function openApi(): Promise<void> {
  await createWorkspace(ALPHA, 'alpha')
  await newCard('In Progress', 'api')
  await run(0, 'echo main-$((40+2))')
  await expectLine(0, 'main-42')
}

test('AC1: Split right shows two focused-right halves, the new one a shell in the card directory', async () => {
  await openApi()
  await splitRight(page)

  await expect(panes()).toHaveCount(2)
  const area = await box(page.getByTestId('card-terminal'))
  const [left, right] = [await box(panes().nth(0)), await box(panes().nth(1))]
  for (const pane of [left, right]) {
    expect(Math.abs(pane.width - area.width / 2)).toBeLessThanOrEqual(10)
    expect(Math.abs(pane.height - area.height)).toBeLessThanOrEqual(10)
    expect(Math.abs(pane.y - area.y)).toBeLessThanOrEqual(10)
  }
  expect(right.x).toBeGreaterThan(left.x + left.width - 10)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'false')

  await run(1, 'pwd')
  await expectLine(1, ALPHA)
  expect(await bufferLines(0)).toContain('main-42')
})

test('AC4: clicking the main pane focuses it and typing goes there only', async () => {
  await openApi()
  await splitRight(page)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')
  await run(1, 'echo right-ready')
  await expectLine(1, 'right-ready')
  const rightBefore = (await bufferLines(1)).filter(Boolean)

  await panes().nth(0).click()
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'true')
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'false')
  await run(0, 'echo hi')
  await expectLine(0, 'hi')
  expect((await bufferLines(1)).filter(Boolean)).toEqual(rightBefore)
})

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Pane `index`'s shell pid, read back from a file the shell writes. */
async function shellPid(index: number): Promise<number> {
  const file = join(root, `pid-${Math.random().toString(36).slice(2)}`)
  await run(index, `echo $$ > '${file}'`)
  await expect.poll(() => existsSync(file) && readFileSync(file, 'utf8').trim() !== '').toBe(true)
  return Number(readFileSync(file, 'utf8').trim())
}

test('AC5: Close pane and exit remove extra panes; the main pane has no close', async () => {
  await openApi()
  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  await splitDown(page)
  await expect(panes()).toHaveCount(3)
  await expect(panes().nth(2)).toHaveAttribute('data-focused', 'true')
  const pid = await shellPid(2)
  await expect(panes().nth(0).getByRole('button', { name: 'Close pane' })).toHaveCount(0)

  await panes().nth(2).getByRole('button', { name: 'Close pane' }).click()
  await expect(panes()).toHaveCount(2)
  const area = await box(page.getByTestId('card-terminal'))
  for (const index of [0, 1]) {
    const pane = await box(panes().nth(index))
    expect(Math.abs(pane.width - area.width / 2)).toBeLessThanOrEqual(10)
    expect(Math.abs(pane.height - area.height)).toBeLessThanOrEqual(10)
  }
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'true')
  await expect.poll(() => alive(pid)).toBe(false)

  await panes().nth(1).click()
  await run(1, 'exit')
  await expect(panes()).toHaveCount(1)
  const only = await box(panes().nth(0))
  expect(Math.abs(only.width - area.width)).toBeLessThanOrEqual(10)
  expect(Math.abs(only.height - area.height)).toBeLessThanOrEqual(10)
  await expect(panes().nth(0).getByRole('button', { name: 'Close pane' })).toHaveCount(0)
  await backToBoard(page)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
})

test('AC5: closing a pane that is not focused leaves the focus where it was', async () => {
  await openApi()
  await splitRight(page)
  await splitDown(page)
  await expect(panes()).toHaveCount(3)
  await panes().nth(1).click()
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')

  await panes().nth(2).getByRole('button', { name: 'Close pane' }).click()
  await expect(panes()).toHaveCount(2)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'false')
  const mainBefore = (await bufferLines(0)).filter(Boolean)
  await run(1, 'echo still-here')
  await expectLine(1, 'still-here')
  expect((await bufferLines(0)).filter(Boolean)).toEqual(mainBefore)
})

test('#31 AC5: an extra pane shows its × only under the pointer; clicking it closes the pane', async () => {
  await openApi()
  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  const close = panes().nth(1).getByRole('button', { name: 'Close pane' })
  await expect(panes().nth(0).getByRole('button', { name: 'Close pane' })).toHaveCount(0)

  await panes().nth(0).hover()
  await expect(close).toHaveCSS('opacity', '0')
  await panes().nth(1).hover()
  await expect(close).toHaveCSS('opacity', '1')
  await panes().nth(0).hover()
  await expect(close).toHaveCSS('opacity', '0')
  await expect(panes().nth(0).getByRole('button', { name: 'Close pane' })).toHaveCount(0)

  await panes().nth(1).hover()
  await close.click()
  await expect(panes()).toHaveCount(1)
  await expect(panes().nth(0).getByRole('button', { name: 'Close pane' })).toHaveCount(0)
})

/** Pane `index`'s buffer as one string without whitespace. */
const screenText = async (index: number): Promise<string> =>
  (await bufferLines(index)).join('').replace(/\s+/g, '')

const SPLIT_RIGHT = process.platform === 'darwin' ? 'Meta+D' : 'Control+Shift+D'
const SPLIT_DOWN = process.platform === 'darwin' ? 'Meta+Shift+D' : 'Control+Shift+E'

/**
 * Pane `index`'s screen gained no input from a shortcut: its text is unchanged (ignoring line
 * breaks, which a narrower pane rewraps), and a command typed next runs as typed (a stray `D`
 * would garble it, a Ctrl+D would end the shell).
 */
async function expectNoInput(index: number, before: string, marker: string): Promise<void> {
  await page.waitForTimeout(500)
  expect(await screenText(index)).toBe(before)
  await run(index, `echo ${marker}-$((1+2))`)
  await expectLine(index, `${marker}-3`)
}

test('AC2: Split down nests, the shortcut splits without reaching the shell, 4 is the limit', async () => {
  await openApi()
  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')

  await splitDown(page)
  await expect(panes()).toHaveCount(3)
  const area = await box(page.getByTestId('card-terminal'))
  const [main, top, bottom] = [
    await box(panes().nth(0)),
    await box(panes().nth(1)),
    await box(panes().nth(2))
  ]
  expect(Math.abs(main.height - area.height)).toBeLessThanOrEqual(10)
  expect(Math.abs(main.width - area.width / 2)).toBeLessThanOrEqual(10)
  for (const pane of [top, bottom]) {
    expect(Math.abs(pane.width - area.width / 2)).toBeLessThanOrEqual(10)
    expect(Math.abs(pane.height - area.height / 2)).toBeLessThanOrEqual(10)
    expect(pane.x).toBeGreaterThan(main.x + main.width - 10)
  }
  expect(bottom.y).toBeGreaterThan(top.y + top.height - 10)
  await expect(panes().nth(2)).toHaveAttribute('data-focused', 'true')

  await run(2, 'echo bottom-ready')
  await expectLine(2, 'bottom-ready')
  const bottomBefore = await screenText(2)
  await page.keyboard.press(SPLIT_RIGHT)
  await expect(panes()).toHaveCount(4)
  await expect(panes().nth(3)).toHaveAttribute('data-focused', 'true')
  await expect.poll(focusedPaneIndex).toBe(3)
  await panes().nth(2).click()
  await expectNoInput(2, bottomBefore, 'bottom')

  await run(2, 'echo limit-ready')
  await expectLine(2, 'limit-ready')
  const limitBefore = await screenText(2)
  await page.keyboard.press(SPLIT_RIGHT)
  await page.keyboard.press(SPLIT_DOWN)
  await expect(panes()).toHaveCount(4)
  await expect(panes().nth(2)).toHaveAttribute('data-focused', 'true')
  await expectNoInput(2, limitBefore, 'limit')
})

test('AC5: a pane whose shell exits under an open dialog leaves the keyboard with the dialog', async () => {
  await openApi()
  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')

  await run(1, 'sleep 1; exit')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma')
  const settings = page.getByTestId('settings-dialog')
  await expect(settings).toBeVisible()
  await expect(panes()).toHaveCount(1)
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'true')

  // The main pane is focused in the layout, but keyboard focus stays in the dialog.
  const inDialog = (): Promise<boolean> =>
    page.evaluate(() => !!document.activeElement?.closest('[data-testid=settings-dialog]'))
  await page.waitForTimeout(300)
  expect(await inDialog()).toBe(true)
  // The baseline is taken once the main pane has re-fitted to full width: its prompt rewraps then.
  let mainBefore = await screenText(0)
  await expect
    .poll(
      async () => {
        const now = await screenText(0)
        const stable = now === mainBefore
        mainBefore = now
        return stable
      },
      { intervals: [300] }
    )
    .toBe(true)
  await page.keyboard.type('q')
  await page.waitForTimeout(300)
  expect(await screenText(0)).toBe(mainBefore)
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
})

test('AC2: a held split shortcut (auto-repeat) splits once', async () => {
  await openApi()
  const swallowed = await page.evaluate((darwin) => {
    const key = (repeat: boolean): boolean => {
      const event = new KeyboardEvent('keydown', {
        key: 'D',
        code: 'KeyD',
        shiftKey: !darwin,
        ctrlKey: !darwin,
        metaKey: darwin,
        repeat,
        bubbles: true,
        cancelable: true
      })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    return [key(false), key(true), key(true), key(true)]
  }, process.platform === 'darwin')
  // Every repeat is still swallowed, but only the first keydown splits.
  expect(swallowed).toEqual([true, true, true, true])
  await expect(panes()).toHaveCount(2)
  await page.waitForTimeout(300)
  await expect(panes()).toHaveCount(2)
})

test('AC3: an extra pane of a Claude Code card is a plain shell', async () => {
  // Relaunch with the fake `claude` of #5's smoke tests on the login PATH.
  await app.close()
  const fake = fakeClaudeHome(root)
  ;({ app, page } = await launchApp({ env: fake.env }))
  await createWorkspace(ALPHA, 'alpha')
  await column('In Progress').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('agent')
  await page.getByTestId('new-card-startup').selectOption({ label: 'Claude Code' })
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'agent')
  await expect.poll(() => claudeLogLines(fake.log)).toHaveLength(1)
  await expect
    .poll(async () =>
      (await bufferLines(0)).some((l) => l.startsWith(`fake-claude ${SETTINGS_ARGS} --session-id`))
    )
    .toBe(true)

  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  await run(1, 'echo extra-$((1+1))')
  await expectLine(1, 'extra-2')
  expect(claudeLogLines(fake.log)).toHaveLength(1)
})

/** Pane `index`'s xterm font size and columns. */
const paneLook = (index: number): Promise<{ fontSize: number; cols: number }> =>
  panes()
    .nth(index)
    .evaluate((pane) => {
      const host = pane.querySelector('[data-testid=terminal]') as HTMLElement & {
        __xterm: { cols: number; options: { fontSize: number } }
      }
      return { fontSize: host.__xterm.options.fontSize, cols: host.__xterm.cols }
    })

test('AC11: font size reaches every pane, each refitted to its own columns', async () => {
  await openApi()
  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  const before = [await paneLook(0), await paneLook(1)]
  expect(before.map((l) => l.fontSize)).toEqual([13, 13])

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma')
  const settings = page.getByTestId('settings-dialog')
  await settings.getByTestId('settings-section-terminal').click()
  await settings.getByLabel('Font size').fill('18')
  // A dialog owns the keyboard: the split shortcuts do nothing while it is open (D4).
  await page.keyboard.press(SPLIT_RIGHT)
  await page.keyboard.press(SPLIT_DOWN)
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await expect(panes()).toHaveCount(2)

  for (const index of [0, 1]) {
    await expect.poll(async () => (await paneLook(index)).fontSize).toBe(18)
    await expect.poll(async () => (await paneLook(index)).cols).toBeLessThan(before[index].cols)
  }
  for (const index of [0, 1]) {
    const { cols } = await paneLook(index)
    await panes().nth(index).click()
    await run(index, 'echo cols-$(tput cols)')
    await expectLine(index, `cols-${cols}`)
  }
})

/** The shell pids of the first `count` panes, in tree order; clicks each pane to read it. */
async function panePids(count: number): Promise<number[]> {
  const pids: number[] = []
  for (let index = 0; index < count; index++) {
    await panes().nth(index).click()
    pids.push(await shellPid(index))
  }
  return pids
}

/** `api` with `count` panes: main | (extra over extra), the newest focused. */
async function apiWithPanes(count: 2 | 3): Promise<void> {
  await openApi()
  await splitRight(page)
  await expect(panes()).toHaveCount(2)
  if (count === 3) {
    await splitDown(page)
    await expect(panes()).toHaveCount(3)
  }
}

async function back(): Promise<void> {
  await backToBoard(page)
  await expect(page.getByTestId('board')).toBeVisible()
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

test('AC6: Back keeps the panes, their output and focus; the board shows the main pane only', async () => {
  await apiWithPanes(2)
  const pids = await panePids(2)
  await panes().nth(0).click()
  await run(0, "printf 'main-line'; sleep 600")
  await expectLine(0, 'main-line')
  await panes().nth(1).click()
  await run(1, "printf 'extra-line'; sleep 600")
  await expectLine(1, 'extra-line')

  await back()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('api').getByTestId('card-status-line')).toHaveText('main-line')
  // Output in the extra pane never reaches the board, however long it waits (D8).
  await page.waitForTimeout(600)
  await expect(card('api').getByTestId('card-status-line')).toHaveText('main-line')

  await openCard('api')
  await expect(panes()).toHaveCount(2)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'false')
  await expect.poll(focusedPaneIndex).toBe(1)
  expect(await bufferLines(0)).toContain('main-line')
  expect(await bufferLines(1)).toContain('extra-line')
  expect(pids.map(alive)).toEqual([true, true])
})

test('AC7: the main shell exiting ends every pane; reopening shows only the main pane', async () => {
  await apiWithPanes(3)
  const [, ...extras] = await panePids(3)
  await panes().nth(0).click()
  await run(0, 'exit')

  await expect(page.getByTestId('board')).toBeVisible()
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  for (const pid of extras) await expect.poll(() => alive(pid)).toBe(false)

  await openCard('api')
  await expectStatusOnBoard(page, 'api', 'Running')
  await expect(panes()).toHaveCount(1)
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'true')
})

test('AC7: Close from the full-size view ends every pane', async () => {
  await apiWithPanes(2)
  const pids = await panePids(2)
  await closeCard(page)
  await page.getByTestId('confirm-close').click()

  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  for (const pid of pids) await expect.poll(() => alive(pid)).toBe(false)
})

test('AC8: deleting the workspace counts the card once and ends all its panes', async () => {
  await apiWithPanes(3)
  const pids = await panePids(3)
  await back()

  const row = page.locator('.workspace-row').first()
  await row.hover()
  await row.getByTestId('workspace-delete').click()
  await expect(page.getByTestId('confirm-dialog')).toContainText(
    'Delete "alpha"? This removes its board. 1 terminal is still running and will be stopped.'
  )
  await page.getByTestId('confirm-delete').click()
  await expect(page.getByTestId('empty-state')).toBeVisible()
  for (const pid of pids) await expect.poll(() => alive(pid)).toBe(false)
})

test('AC8: deleting a running card with 2 panes from its menu ends both shells', async () => {
  await apiWithPanes(2)
  const pids = await panePids(2)
  await back()

  await card('api').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  await expect(page.getByTestId('confirm-dialog')).toContainText(
    'Delete "api"? Its terminal is still running and will be stopped.'
  )
  await page.getByTestId('confirm-delete').click()
  await expect(card('api')).toHaveCount(0)
  for (const pid of pids) await expect.poll(() => alive(pid)).toBe(false)
})

let boardRuns = 0

/** Runs a `board` command in pane `index` and returns its exit code, read from the screen. */
async function board(index: number, command: string): Promise<number> {
  const tag = `b${++boardRuns}`
  await run(index, `${command} >/dev/null 2>&1; echo "${tag} rc=$?"`)
  const pattern = new RegExp(`^${tag} rc=(\\d+)$`)
  let code = -1
  // The first `board` of a run can be slow to start (see e2e/board-cli.spec.ts).
  await expect
    .poll(
      async () => {
        const line = (await bufferLines(index)).find((l) => pattern.test(l))
        code = line ? Number(pattern.exec(line)![1]) : -1
        return code
      },
      { timeout: 15_000 }
    )
    .toBeGreaterThanOrEqual(0)
  return code
}

test('AC9: board works from an extra pane, and from the main pane after the extra one closes', async () => {
  await apiWithPanes(2)
  expect(await board(1, 'board status . building')).toBe(0)
  await back()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('api').getByTestId('card-agent-status')).toHaveText('building')

  await openCard('api')
  expect(await board(1, 'board move . Done')).toBe(0)
  await back()
  await expect(column('Done').getByTestId('card-title').last()).toHaveText('api')

  await openCard('api')
  await panes().nth(1).getByRole('button', { name: 'Close pane' }).click()
  await expect(panes()).toHaveCount(1)
  expect(await board(0, 'board status . again')).toBe(0)
  await back()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('api').getByTestId('card-agent-status')).toHaveText('again')
})

/** Every key in a parsed JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)])
  }
  return []
}

test('AC10: panes are not kept across a restart', async () => {
  await apiWithPanes(3)
  await app.close()
  ;({ app, page } = await launchApp({ dataDir }))

  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  await openCard('api')
  await expectStatusOnBoard(page, 'api', 'Running')
  await expect(panes()).toHaveCount(1)

  const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
  expect(saved.version).toBe(1)
  expect(keysOf(saved).filter((key) => /pane|layout|split|focus/i.test(key))).toEqual([])
})

const CLOSE_PANE = process.platform === 'darwin' ? 'Meta+W' : 'Control+Shift+W'
const CLOSE_CARD = process.platform === 'darwin' ? 'Meta+Shift+W' : 'Control+Shift+Q'

test('#31 AC3: the shortcuts split, close the focused extra pane, and ask before closing from the main pane', async () => {
  await openApi()
  await page.keyboard.press(SPLIT_RIGHT)
  await expect(panes()).toHaveCount(2)
  await page.keyboard.press(SPLIT_DOWN)
  await expect(panes()).toHaveCount(3)
  await expect(panes().nth(2)).toHaveAttribute('data-focused', 'true')
  const pid = await shellPid(2)

  await page.keyboard.press(CLOSE_PANE)
  await expect(panes()).toHaveCount(2)
  await expect.poll(() => alive(pid)).toBe(false)
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  // The focus goes to another pane, which can be typed into at once.
  await expect.poll(focusedPaneIndex).not.toBe(-1)

  await panes().nth(0).click()
  await expect(panes().nth(0)).toHaveAttribute('data-focused', 'true')
  const mainBefore = await screenText(0)
  await page.keyboard.press(CLOSE_PANE)
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
  await page.getByTestId('confirm-cancel').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect(panes()).toHaveCount(2)
  await expectNoInput(0, mainBefore, 'main')
  await expectStatusOnBoard(page, 'api', 'Running')
  await expect(panes()).toHaveCount(2)
})

test('#31 AC4: the Close card shortcut asks, then stops the card with every pane', async () => {
  await apiWithPanes(2)
  const pids = await panePids(2)
  await page.keyboard.press(CLOSE_CARD)
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
  await page.getByTestId('confirm-close').click()

  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  for (const pid of pids) await expect.poll(() => alive(pid)).toBe(false)
})

// Zoom a pane (#48): the focused pane fills the view, the others keep running, hidden.

/** The zoom chip on the shown pane (#48 D5). */
const zoomChip = (): Locator => page.getByTestId('card-view').getByTestId('pane-zoom')

test('#48 AC1: Zoom pane shows only the focused pane, wider, and again restores the layout', async () => {
  await apiWithPanes(3)
  await expect(panes().nth(2)).toHaveAttribute('data-focused', 'true')
  await expect.poll(focusedPaneIndex).toBe(2)
  const boxes = [await box(panes().nth(0)), await box(panes().nth(1)), await box(panes().nth(2))]
  const { cols } = await paneLook(2)
  await expect(zoomChip()).toHaveCount(0)
  // A line typed half-way: a stray Enter from the shortcut would run it early, printing `xy`.
  await page.keyboard.type("printf 'x%sy\\n' ")

  await zoomPane(page)
  await expect(panes().nth(0)).toBeHidden()
  await expect(panes().nth(1)).toBeHidden()
  await expect(panes().nth(2)).toBeVisible()
  const area = await box(page.getByTestId('card-terminal'))
  const zoomed = await box(panes().nth(2))
  expect(Math.abs(zoomed.width - area.width)).toBeLessThanOrEqual(4)
  expect(Math.abs(zoomed.height - area.height)).toBeLessThanOrEqual(4)
  await expect.poll(async () => (await paneLook(2)).cols).toBeGreaterThan(cols)
  await expect(zoomChip()).toHaveText('Zoomed · 3 panes')
  await expect(zoomChip()).toHaveAttribute('title', 'Show all panes')
  await expect.poll(focusedPaneIndex).toBe(2)
  await page.keyboard.type('mid')
  await page.keyboard.press('Enter')
  await expectLine(2, 'xmidy')
  expect(await bufferLines(2)).not.toContain('xy')

  await zoomPane(page)
  await expect(panes()).toHaveCount(3)
  for (const index of [0, 1, 2]) {
    await expect(panes().nth(index)).toBeVisible()
    const after = await box(panes().nth(index))
    expect(Math.abs(after.x - boxes[index].x)).toBeLessThanOrEqual(2)
    expect(Math.abs(after.y - boxes[index].y)).toBeLessThanOrEqual(2)
    expect(Math.abs(after.width - boxes[index].width)).toBeLessThanOrEqual(2)
    expect(Math.abs(after.height - boxes[index].height)).toBeLessThanOrEqual(2)
  }
  await expect(panes().nth(2)).toHaveAttribute('data-focused', 'true')
  await expect(zoomChip()).toHaveCount(0)
  await expect.poll(focusedPaneIndex).toBe(2)
  await expect.poll(async () => (await paneLook(2)).cols).toBe(cols)
})

/** The `tick-<n>` numbers pane `index` shows, in order. */
const ticks = async (index: number): Promise<number[]> =>
  (await bufferLines(index)).flatMap((line) => {
    const tick = /^tick-(\d+)$/.exec(line)
    return tick ? [Number(tick[1])] : []
  })

test('#48 AC2: a hidden pane keeps running; its output shows when the zoom ends', async () => {
  await apiWithPanes(3)
  await panes().nth(1).click()
  await run(1, 'for i in $(seq 1 600); do echo tick-$i; sleep 0.2; done')
  await expect.poll(async () => (await ticks(1)).length).toBeGreaterThan(1)
  await panes().nth(2).click()
  await expect.poll(focusedPaneIndex).toBe(2)

  await zoomPane(page)
  await expect(panes().nth(1)).toBeHidden()
  const before = Math.max(...(await ticks(1)))
  await page.waitForTimeout(1500)
  await zoomPane(page)

  await expect(panes().nth(1)).toBeVisible()
  await expect.poll(async () => Math.max(...(await ticks(1)))).toBeGreaterThanOrEqual(before + 5)
  const shown = await ticks(1)
  expect(shown).toEqual(Array.from({ length: shown.length }, (_, i) => i + 1))
})

test('#48 AC3: the chip, a split, Close pane and the main shell exiting end the zoom', async () => {
  await apiWithPanes(3)
  // The chip shows all panes and gives the keyboard back to the shown pane's terminal.
  await zoomPane(page)
  await expect(zoomChip()).toBeVisible()
  await zoomChip().click()
  await expect(zoomChip()).toHaveCount(0)
  for (const index of [0, 1, 2]) await expect(panes().nth(index)).toBeVisible()
  await expect(panes().nth(2)).toHaveAttribute('data-focused', 'true')
  await expect.poll(focusedPaneIndex).toBe(2)

  // Splitting right ends the zoom and adds a fourth pane, focused, right of the zoomed one.
  await zoomPane(page)
  await expect(panes().nth(0)).toBeHidden()
  await splitRight(page)
  await expect(panes()).toHaveCount(4)
  await expect(zoomChip()).toHaveCount(0)
  for (const index of [0, 1, 2, 3]) await expect(panes().nth(index)).toBeVisible()
  await expect(panes().nth(3)).toHaveAttribute('data-focused', 'true')
  const [zoomedOne, added] = [await box(panes().nth(2)), await box(panes().nth(3))]
  expect(added.x).toBeGreaterThan(zoomedOne.x + zoomedOne.width - 10)
  expect(Math.abs(added.y - zoomedOne.y)).toBeLessThanOrEqual(10)
  await run(3, 'echo fourth-ready')
  await expectLine(3, 'fourth-ready')
  await page.keyboard.press(SHORTCUTS.closePane)
  await expect(panes()).toHaveCount(3)

  // Closing the zoomed extra pane with Close pane shows the remaining 2 panes.
  await panes().nth(2).click()
  await zoomPane(page)
  await expect(zoomChip()).toHaveText('Zoomed · 3 panes')
  await page.keyboard.press(SHORTCUTS.closePane)
  await expect(panes()).toHaveCount(2)
  await expect(zoomChip()).toHaveCount(0)
  for (const index of [0, 1]) await expect(panes().nth(index)).toBeVisible()

  // The main pane's shell exiting resets the view: a stopped card, no chip when reopened.
  await panes().nth(0).click()
  await zoomPane(page)
  await expect(zoomChip()).toHaveText('Zoomed · 2 panes')
  await run(0, 'exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  await openCard('api')
  await expect(panes()).toHaveCount(1)
  await expect(zoomChip()).toHaveCount(0)
})

test('#48 AC4: one pane never zooms, and the palette offers no Zoom pane', async () => {
  await openApi()
  const area = await box(page.getByTestId('card-terminal'))
  const before = await box(panes().nth(0))
  await zoomPane(page)
  await page.waitForTimeout(300)
  await expect(zoomChip()).toHaveCount(0)
  await expect(page.getByTestId('card-terminal')).toHaveAttribute('data-zoomed', 'false')
  expect(await box(panes().nth(0))).toEqual(before)
  expect(before.width).toBeLessThanOrEqual(area.width)

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+Shift+P')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await expect(
    palette.getByTestId('palette-row-title').getByText('Find', { exact: true })
  ).toHaveCount(1)
  await expect(
    palette.getByTestId('palette-row-title').getByText('Zoom pane', { exact: true })
  ).toHaveCount(0)
})

test('#48 AC5: a zoomed card is still zoomed on the same pane after Back', async () => {
  await apiWithPanes(3)
  await panes().nth(1).click()
  await zoomPane(page)
  await expect(panes().nth(0)).toBeHidden()

  await back()
  await openCard('api')
  await expect(zoomChip()).toHaveText('Zoomed · 3 panes')
  await expect(panes().nth(1)).toBeVisible()
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')
  await expect(panes().nth(0)).toBeHidden()
  await expect(panes().nth(2)).toBeHidden()
  await expect.poll(focusedPaneIndex).toBe(1)
})
