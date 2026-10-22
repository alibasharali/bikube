import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, closeCard, expectCardOpen } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Terminal output flow control (#16): a stalled renderer doesn't build a backlog, a paused card
// still stops and deletes, and ordinary output is unchanged.

let app: ElectronApplication
let page: Page
let root: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-flow-'))
  ;({ app, page } = await launchApp())
  const dir = join(root, 'alpha')
  mkdirSync(dir)
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

const status = (title: string): Locator => card(title).getByTestId('card-status-label')

/** Creates a card in `In Progress` through `+ New card`; its full-size view opens. */
async function newCard(title: string): Promise<void> {
  await column('In Progress').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

async function back(): Promise<void> {
  await backToBoard(page)
  await expect(page.getByTestId('board')).toBeVisible()
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

/** Types a command into the focused terminal and presses Enter. */
async function run(command: string): Promise<void> {
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The open card's shell pid, read back from a file the shell writes. */
async function shellPid(): Promise<number> {
  const file = join(root, `pid-${Math.random().toString(36).slice(2)}`)
  await run(`echo $$ > '${file}'`)
  await expect.poll(() => existsSync(file) && readFileSync(file, 'utf8').trim() !== '').toBe(true)
  return Number(readFileSync(file, 'utf8').trim())
}

/** Busy-loops the renderer's main thread for `ms`, so nothing it receives is parsed meanwhile. */
function blockRenderer(ms: number): Promise<void> {
  return page.evaluate((duration) => {
    const end = performance.now() + duration
    while (performance.now() < end) {
      // blocked
    }
  }, ms)
}

/** Waits until the open card's screen shows lines matching `pattern` (output is streaming). */
async function streaming(pattern: RegExp): Promise<void> {
  await expect
    .poll(async () => (await bufferLines()).filter((l) => pattern.test(l)).length, {
      timeout: 10_000
    })
    .toBeGreaterThan(10)
}

const NUMBERED = /^(\d+)\s+bikube-flow$/

test("AC4: a stalled renderer doesn't build a backlog and no output is dropped", async () => {
  await newCard('api')
  await run('yes bikube-flow | cat -n')
  await streaming(NUMBERED)

  await blockRenderer(3_000)

  await page.keyboard.press('Control+C')
  await page.keyboard.type('echo flow-done')
  const enter = Date.now()
  await page.keyboard.press('Enter')
  await expect.poll(bufferLines, { timeout: 3_000 }).toContain('flow-done')
  expect(Date.now() - enter).toBeLessThanOrEqual(3_000)

  // Every numbered line still on the screen follows the one before it by exactly 1.
  const numbers = (await bufferLines())
    .map((l) => NUMBERED.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
  expect(numbers.length).toBeGreaterThan(10)
  const gaps = numbers.slice(1).filter((n, i) => n !== numbers[i] + 1)
  expect(gaps).toEqual([])
})

test('AC5: a paused card still stops when Closed, and still ends when deleted', async () => {
  await newCard('web')
  const webPid = await shellPid()
  await run('yes')
  await back()

  await newCard('api')
  const apiPid = await shellPid()
  await run('yes bikube-flow')
  await streaming(/^bikube-flow$/)
  await blockRenderer(2_000)

  await closeCard(page)
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(status('api')).toHaveText('Stopped', { timeout: 3_000 })
  await expect.poll(() => alive(apiPid), { timeout: 3_000 }).toBe(false)

  await expect(status('web')).toHaveText('Running')
  expect(alive(webPid)).toBe(true)
  await card('web').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  await page.getByTestId('confirm-delete').click()
  await expect(card('web')).toHaveCount(0)
  await expect.poll(() => alive(webPid), { timeout: 3_000 }).toBe(false)
})

test('AC6: ordinary output is unchanged', async () => {
  await newCard('api')
  // `sleep` keeps 200000 the last line: a prompt after it would become the board's last line.
  await run('seq 1 200000; sleep 30')
  await expect
    .poll(async () => (await bufferLines()).filter((l) => l !== '').at(-1), { timeout: 15_000 })
    .toBe('200000')
  const lines = (await bufferLines()).filter((l) => l !== '')
  expect(lines.at(-2)).toBe('199999')

  await back()
  await expect(status('api')).toHaveText('Running')
  await expect(card('api').getByTestId('card-status-line')).toHaveText('200000')
})
