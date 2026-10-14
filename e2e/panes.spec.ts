import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeLogLines, fakeClaudeHome } from './fake-claude'
import { launchApp, removeDataDirs } from './launch'

// Split panes inside a card (#11): the full-size view splits into panes, each a live shell in
// the card's directory; extra panes close from their own button or when their shell exits.

/** The spec's workspace directory: `pwd` in a pane prints it. */
const ALPHA = '/tmp/drovr-alpha'

let app: ElectronApplication
let page: Page
let root: string

test.beforeEach(async () => {
  mkdirSync(ALPHA, { recursive: true })
  root = mkdtempSync(join(tmpdir(), 'drovr-panes-'))
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

async function createWorkspace(dir: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
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
  await expect(page.getByTestId('card-view-title')).toHaveText(title)
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

/** Workspace `alpha` in /tmp/drovr-alpha with card `api` open, its shell ready. */
async function openApi(): Promise<void> {
  await createWorkspace(ALPHA, 'alpha')
  await newCard('Running', 'api')
  await run(0, 'echo main-$((40+2))')
  await expectLine(0, 'main-42')
}

test('AC1: Split right shows two focused-right halves, the new one a shell in the card directory', async () => {
  await openApi()
  await page.getByTestId('pane-split-right').click()

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
  await page.getByTestId('pane-split-right').click()
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
  await page.getByTestId('pane-split-right').click()
  await expect(panes()).toHaveCount(2)
  await page.getByTestId('pane-split-down').click()
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
  await expect(page.getByTestId('card-view').getByTestId('card-status-label')).toHaveText('Running')
  await page.getByTestId('card-back').click()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
})

test('AC5: closing a pane that is not focused leaves the focus where it was', async () => {
  await openApi()
  await page.getByTestId('pane-split-right').click()
  await page.getByTestId('pane-split-down').click()
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
  await page.getByTestId('pane-split-right').click()
  await expect(panes()).toHaveCount(2)
  await expect(panes().nth(1)).toHaveAttribute('data-focused', 'true')

  await page.getByTestId('pane-split-down').click()
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

  await expect(page.getByTestId('pane-split-right')).toBeDisabled()
  await expect(page.getByTestId('pane-split-down')).toBeDisabled()
  await run(2, 'echo limit-ready')
  await expectLine(2, 'limit-ready')
  const limitBefore = await screenText(2)
  await page.keyboard.press(SPLIT_RIGHT)
  await page.keyboard.press(SPLIT_DOWN)
  await expect(panes()).toHaveCount(4)
  await expect(panes().nth(2)).toHaveAttribute('data-focused', 'true')
  await expectNoInput(2, limitBefore, 'limit')
})

test('AC3: an extra pane of a Claude Code card is a plain shell', async () => {
  // Relaunch with the fake `claude` of #5's smoke tests on the login PATH.
  await app.close()
  const fake = fakeClaudeHome(root)
  ;({ app, page } = await launchApp({ env: fake.env }))
  await createWorkspace(ALPHA, 'alpha')
  await column('Running').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('agent')
  await page.getByTestId('new-card-startup').selectOption({ label: 'Claude Code' })
  await page.getByTestId('new-card-input').press('Enter')
  await expect(page.getByTestId('card-view-title')).toHaveText('agent')
  await expect.poll(() => claudeLogLines(fake.log)).toHaveLength(1)
  await expect
    .poll(async () => (await bufferLines(0)).some((l) => l.startsWith('fake-claude --session-id')))
    .toBe(true)

  await page.getByTestId('pane-split-right').click()
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
  await page.getByTestId('pane-split-right').click()
  await expect(panes()).toHaveCount(2)
  const before = [await paneLook(0), await paneLook(1)]
  expect(before.map((l) => l.fontSize)).toEqual([13, 13])

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma')
  const settings = page.getByTestId('settings-dialog')
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
