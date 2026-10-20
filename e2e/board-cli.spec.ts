import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOARD_USAGE } from '../src/core/board-args'
import { backToBoard, checkOnBoard, expectCardOpen, splitRight } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The `board` command (#9): typed into a card's terminal, it reaches the app over
// `<userData>/board/board.sock`. Each command's stdout and stderr go to files in the workspace
// directory and its exit code is echoed, so the test reads all three exactly.

let app: ElectronApplication | undefined
let page: Page
let root: string
let dataDir: string

const NOT_IN_A_CARD = 'board: not running inside a Drovr card'

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'drovr-board-'))
  dataDir = newDataDir()
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

async function launch(): Promise<void> {
  ;({ app, page } = await launchApp({ dataDir }))
}

async function createWorkspace(dir: string, name: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

async function selectWorkspace(name: string): Promise<void> {
  await page.getByTestId('workspace-item').filter({ hasText: name }).click()
  await expect(page.getByTestId('board-title')).toHaveText(name)
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

const titlesIn = (name: string): Locator => column(name).getByTestId('card-title')

const terminalFocused = (): Promise<boolean> =>
  page.evaluate(
    () => document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
  )

/** Creates a card through `+ New card`; its full-size view opens with the terminal focused. */
async function newCard(columnName: string, title: string): Promise<void> {
  await column(columnName).getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await expect.poll(terminalFocused).toBe(true)
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
  await expect.poll(terminalFocused).toBe(true)
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

/** Types a command into the focused terminal and presses Enter. */
async function run(command: string): Promise<void> {
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

let commands = 0

/**
 * Runs `command` in the open card's shell (its directory is `dir`) and returns its exit code
 * (read from `echo $?` on the screen), stdout and stderr.
 */
async function board(
  dir: string,
  command: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  const tag = `c${++commands}`
  await run(`${command} >${tag}.out 2>${tag}.err; echo "${tag} rc=$?"`)
  // Not anchored at the end: a command typed before readline is ready can leave stray echo
  // after the rc on the same row once readline redraws (seen on CI: `c1 rc=0ove . done ...`).
  const pattern = new RegExp(`^${tag} rc=(\\d+)`)
  let code = -1
  // The first `board` of a run starts Drovr's executable as Node from a cold disk cache, which
  // can take over 5 s on a CI runner (the run's first test timed out there); later ones are fast.
  await expect
    .poll(
      async () => {
        const line = (await bufferLines()).find((l) => pattern.test(l))
        code = line ? Number(pattern.exec(line)![1]) : -1
        return code
      },
      { timeout: 15_000 }
    )
    .toBeGreaterThanOrEqual(0)
    .catch(async (error: Error) => {
      // Show what the terminal holds, so a CI-only timeout can be diagnosed from the log.
      const screen = (await bufferLines()).filter((l) => l.trim() !== '').join('\n')
      throw new Error(`${error.message}\n--- terminal ---\n${screen}`)
    })
  return {
    code,
    stdout: readFileSync(join(dir, `${tag}.out`), 'utf8'),
    stderr: readFileSync(join(dir, `${tag}.err`), 'utf8')
  }
}

/** Has the open card's shell write its `DROVR_CARD_ID` to `<dir>/<file>`; returns the id. */
async function writeCardId(dir: string, file: string): Promise<string> {
  const path = join(dir, file)
  await run(`echo "$DROVR_CARD_ID" > ${file}`)
  await expect.poll(() => existsSync(path) && readFileSync(path, 'utf8').trim() !== '').toBe(true)
  return readFileSync(path, 'utf8').trim()
}

const ok = { code: 0, stdout: '', stderr: '' }
const refused = (error: string): { code: number; stdout: string; stderr: string } => ({
  code: 1,
  stdout: '',
  stderr: `${error}\n`
})

test('AC1: board move . done moves the calling card to the bottom of Done, and it is saved', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Done', 'shipped')
  await back()
  await newCard('Backlog', 'api')

  expect(await board(alpha, 'board move . done')).toEqual(ok)
  // A card open at full size stays open (#9 D7).
  await expectCardOpen(page, 'api')

  await back()
  await expect(titlesIn('Done')).toHaveText(['shipped', 'api'])
  await expect(titlesIn('Backlog')).toHaveCount(0)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')

  await app!.close()
  await launch()
  await expect(titlesIn('Done')).toHaveText(['shipped', 'api'])
})

test('AC2: a card moves a sibling by title, then by id, and stays where it is', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'web')
  await writeCardId(alpha, 'web-id')
  await back()
  await newCard('Backlog', 'api')

  expect(await board(alpha, 'board move web Review')).toEqual(ok)
  await back()
  await expect(titlesIn('Review')).toHaveText(['web'])
  await expect(titlesIn('Backlog')).toHaveText(['api'])

  await openCard('api')
  expect(await board(alpha, 'board move "$(cat web-id)" "In Progress"')).toEqual(ok)
  await back()
  await expect(titlesIn('In Progress')).toHaveText(['web'])
  await expect(titlesIn('Review')).toHaveCount(0)
  await expect(titlesIn('Backlog')).toHaveText(['api'])
})

test('AC2: a card moves itself while another workspace is shown', async () => {
  await launch()
  const alpha = makeDir('alpha')
  const beta = makeDir('beta')
  await createWorkspace(alpha, 'alpha')
  await createWorkspace(beta, 'beta')
  await selectWorkspace('beta')
  await newCard('Backlog', 'later')
  const marker = join(beta, 'later.rc')
  await run('sleep 2; board move . Done; echo $? > later.rc')
  await back()
  await selectWorkspace('alpha')
  // The user is on alpha before the move fires.
  expect(existsSync(marker)).toBe(false)

  await expect
    .poll(() => (existsSync(marker) ? readFileSync(marker, 'utf8').trim() : ''), {
      timeout: 10_000
    })
    .toBe('0')
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await selectWorkspace('beta')
  await expect(titlesIn('Done')).toHaveText(['later'])
  await expect(titlesIn('Backlog')).toHaveCount(0)
})

test('AC3: an unknown column, an unknown card and an ambiguous title are refused', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'dup')
  await back()
  await newCard('Backlog', 'dup')
  await back()
  await newCard('Backlog', 'api')

  expect(await board(alpha, 'board move . QA')).toEqual(
    refused('board: no column "QA"; columns are: Backlog, In Progress, Review, Done')
  )
  expect(await board(alpha, 'board move ghost Done')).toEqual(
    refused('board: no card "ghost" in this workspace')
  )
  expect(await board(alpha, 'board move dup Done')).toEqual(
    refused('board: 2 cards are titled "dup"; use the card id')
  )

  await back()
  await expect(titlesIn('Backlog')).toHaveText(['dup', 'dup', 'api'])
  await expect(titlesIn('Done')).toHaveCount(0)
})

test("AC4: a card in another workspace can't be reached", async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await createWorkspace(makeDir('beta'), 'beta')
  await selectWorkspace('beta')
  await newCard('Backlog', 'other')
  await back()
  await selectWorkspace('alpha')
  await newCard('Backlog', 'api')

  expect(await board(alpha, 'board move other Done')).toEqual(
    refused('board: no card "other" in this workspace')
  )

  await back()
  await selectWorkspace('beta')
  await expect(titlesIn('Backlog')).toHaveText(['other'])
  await expect(titlesIn('Done')).toHaveCount(0)
})

test('AC7: board prints usage to stdout; a wrong shape prints it to stderr and exits 2', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'api')

  expect(await board(alpha, 'board')).toEqual({ code: 0, stdout: BOARD_USAGE, stderr: '' })
  expect(await board(alpha, 'board move .')).toEqual({ code: 2, stdout: '', stderr: BOARD_USAGE })
  expect(await board(alpha, 'board frob')).toEqual({ code: 2, stdout: '', stderr: BOARD_USAGE })
})

test('AC8: outside a live card, or with no app listening, board is refused', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'old')
  await writeCardId(alpha, 'old-id')
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('old').getByTestId('card-status-label')).toHaveText('Stopped')

  await newCard('Backlog', 'gone')
  await writeCardId(alpha, 'gone-id')
  await back()
  await card('gone').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  await page.getByTestId('confirm-delete').click()
  await expect(card('gone')).toHaveCount(0)

  await newCard('Backlog', 'api')
  expect(await board(alpha, 'env -u DROVR_CARD_ID board move . Done')).toEqual(
    refused(NOT_IN_A_CARD)
  )
  expect(await board(alpha, 'DROVR_CARD_ID="$(cat old-id)" board move . Done')).toEqual(
    refused(NOT_IN_A_CARD)
  )
  expect(await board(alpha, 'DROVR_CARD_ID="$(cat gone-id)" board move . Done')).toEqual(
    refused(NOT_IN_A_CARD)
  )
  expect(await board(alpha, `DROVR_SOCKET=${join(root, 'none.sock')} board move . Done`)).toEqual(
    refused('board: Drovr is not running')
  )

  await back()
  await expect(titlesIn('Backlog')).toHaveText(['old', 'api'])
  await expect(titlesIn('Done')).toHaveCount(0)
})

test('AC9: the socket is user-only, replaces a stale file, and is gone after quit', async () => {
  const boardDir = join(dataDir, 'board')
  const socketPath = join(boardDir, 'board.sock')
  mkdirSync(boardDir, { recursive: true, mode: 0o700 })
  writeFileSync(socketPath, 'stale')
  await launch()
  await expect.poll(() => statSync(socketPath).isSocket()).toBe(true)
  expect(lstatSync(boardDir).isDirectory()).toBe(true)
  expect(lstatSync(boardDir).mode & 0o777).toBe(0o700)
  expect(statSync(socketPath).mode & 0o777).toBe(0o600)

  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'api')
  expect(await board(alpha, 'test "$DROVR_SOCKET" = ' + socketPath)).toEqual(ok)
  expect(await board(alpha, 'ls -ld "$(dirname "$DROVR_SOCKET")"')).toMatchObject({
    code: 0,
    stdout: expect.stringMatching(/^drwx------ /)
  })
  expect(await board(alpha, 'ls -l "$DROVR_SOCKET"')).toMatchObject({
    code: 0,
    stdout: expect.stringMatching(/^srw------- /)
  })
  expect(await board(alpha, 'board move . Review')).toEqual(ok)

  await app!.close()
  app = undefined
  expect(existsSync(socketPath)).toBe(false)
})

/** Writes `data` to the app's socket; resolves with what it answers before closing. */
function rawExchange(data: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(join(dataDir, 'board', 'board.sock'))
    let received = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => (received += chunk))
    socket.on('error', (error: NodeJS.ErrnoException) =>
      error.code === 'ECONNRESET' || error.code === 'EPIPE' ? resolve(received) : reject(error)
    )
    socket.on('close', () => resolve(received))
    socket.write(data)
  })
}

test('AC10: bad requests get an error and a closed connection; board keeps working', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'api')
  await expect.poll(() => existsSync(join(dataDir, 'board', 'board.sock'))).toBe(true)

  for (const line of ['hello\n', '{"v":2}\n', `${'x'.repeat(9 * 1024)}\n`]) {
    const reply = await rawExchange(line)
    expect(reply).toMatch(/^\{"ok":false,"error":"board: [^"]+"\}\n$/)
  }
  await back()
  await expect(titlesIn('Backlog')).toHaveText(['api'])

  await openCard('api')
  expect(await board(alpha, 'board move . Done')).toEqual(ok)
  await back()
  await expect(titlesIn('Done')).toHaveText(['api'])
})

/**
 * The open card shows no status (#31 D1): reads `api`'s lines on the board (`card-status-label`,
 * `card-agent-status`, `card-status-line`, #31 D11), each test id with its text, then opens
 * `api` again.
 */
async function expectOnBoard(...lines: [testId: string, text: string][]): Promise<void> {
  await back()
  for (const [testId, text] of lines) {
    await expect(card('api').getByTestId(testId)).toHaveText(text)
  }
  await openCard('api')
}

const runningTests: [string, string][] = [
  ['card-status-label', 'Running'],
  ['card-agent-status', 'running tests']
]

test('AC5: board status shows on the status line, cleaned and cut, until cleared', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'api')

  expect(await board(alpha, 'board status . "running tests"')).toEqual(ok)
  await expectOnBoard(...runningTests)

  // More output doesn't replace it.
  await run("printf 'more-output\\n'")
  await expect.poll(async () => (await bufferLines()).includes('more-output')).toBe(true)
  await page.waitForTimeout(600)
  await back()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('api').getByTestId('card-agent-status')).toHaveText('running tests')

  await openCard('api')
  expect(await board(alpha, `board status . "$(printf 'a\\033[31mb')"`)).toEqual(ok)
  await expectOnBoard(['card-agent-status', 'ab'])

  const long = 'abcdefghij'.repeat(30)
  expect(await board(alpha, `board status . ${long}`)).toEqual(ok)
  await expectOnBoard(['card-agent-status', long.slice(0, 200)])

  await run(`board status . "" && printf 'drovr-marker'; sleep 30`)
  await back()
  await expect(card('api').getByTestId('card-status-line')).toHaveText('drovr-marker')
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('api').getByTestId('card-agent-status')).toHaveCount(0)
})

test('#31 AC10: the card shows its label, agent status and last output line on separate lines', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'api')
  const label = card('api').getByTestId('card-status-label')
  const agent = card('api').getByTestId('card-agent-status')
  const line = card('api').getByTestId('card-status-line')
  const box = async (
    l: Locator
  ): Promise<{ x: number; y: number; width: number; height: number }> => (await l.boundingBox())!

  /** Runs `board status . <status>`, then prints `hello` and waits, so it stays the last line. */
  const statusThenHello = async (status: string): Promise<void> => {
    await run(`board status . ${status}; echo hello; sleep 30`)
    await expect.poll(async () => (await bufferLines()).includes('hello')).toBe(true)
    await back()
  }

  await statusThenHello('"running tests"')
  await expect(label).toHaveText('Running')
  await expect(agent).toHaveText('running tests')
  await expect(line).toHaveText('hello')
  const [l, a, o] = [await box(label), await box(agent), await box(line)]
  expect(a.y).toBeGreaterThanOrEqual(l.y + l.height - 1)
  expect(o.y).toBeGreaterThanOrEqual(a.y + a.height - 1)
  const font = (el: Element): string => getComputedStyle(el).fontFamily
  expect(await line.evaluate(font)).toMatch(/monospace/)
  expect(await agent.evaluate(font)).not.toMatch(/monospace/)
  // The stop button (D10) sits at the right of the status row.
  const stop = await box(card('api').getByTestId('card-stop'))
  expect(stop.x).toBeGreaterThan(l.x + l.width)
  const middle = stop.y + stop.height / 2
  expect(middle).toBeGreaterThan(l.y)
  expect(middle).toBeLessThan(l.y + l.height)

  // A long status shows on at most 2 lines, its full text in the tooltip.
  await openCard('api')
  await page.keyboard.press('Control+C')
  const long = 'abcdefghij'.repeat(15)
  await statusThenHello(`"${long}"`)
  await expect(agent).toHaveAttribute('title', long)
  await expect(line).toHaveText('hello')
  const lineHeight = await agent.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
  const height = (await box(agent)).height
  expect(height).toBeGreaterThan(lineHeight * 1.5)
  expect(height).toBeLessThanOrEqual(lineHeight * 2 + 1)
  expect(await agent.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

  // Clearing it leaves the label and the last output line.
  await openCard('api')
  await page.keyboard.press('Control+C')
  await statusThenHello('""')
  await expect(label).toHaveText('Running')
  await expect(line).toHaveText('hello')
  await expect(agent).toHaveCount(0)

  // Columns are 300 px wide (their content box, as the 272 px they replace).
  expect(await column('Backlog').evaluate((el) => getComputedStyle(el).width)).toBe('300px')
})

/**
 * Runs `command` in whichever pane of the open card has keyboard focus (its directory is `dir`):
 * stdout, stderr and the exit code go to files, so no pane's screen needs reading.
 */
async function boardInFocusedPane(
  dir: string,
  command: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  const tag = `p${++commands}`
  const rc = join(dir, `${tag}.rc`)
  await run(
    `${command} >${tag}.out 2>${tag}.err; echo $? >${tag}.rc.tmp; mv ${tag}.rc.tmp ${tag}.rc`
  )
  await expect.poll(() => existsSync(rc), { timeout: 15_000 }).toBe(true)
  return {
    code: Number(readFileSync(rc, 'utf8').trim()),
    stdout: readFileSync(join(dir, `${tag}.out`), 'utf8'),
    stderr: readFileSync(join(dir, `${tag}.err`), 'utf8')
  }
}

/** `api`'s activity pill on the board reads `text`, or is absent for null (#31 D13). */
async function expectPill(text: string | null): Promise<void> {
  await checkOnBoard(page, 'api', async (api) => {
    await expect(api.getByTestId('card-status-label')).toHaveText('Running')
    if (text === null) await expect(api.getByTestId('card-activity')).toHaveCount(0)
    else await expect(api.getByTestId('card-activity')).toHaveText(text)
  })
}

test('#31 AC11: board activity shows a pill until none, from the main and an extra pane, cleared on exit', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'api')

  expect(await board(alpha, 'board activity . working')).toEqual(ok)
  await expectPill('Working')
  // Waiting for you while the card is open: seen at once, so it clears.
  expect(await board(alpha, 'board activity . waiting')).toEqual(ok)
  await expectPill(null)
  expect(await board(alpha, 'board activity . question')).toEqual(ok)
  await expectPill('Needs your answer')
  expect(await board(alpha, 'board activity . none')).toEqual(ok)
  await expectPill(null)
  expect(await board(alpha, 'board activity . busy')).toEqual({
    code: 2,
    stdout: '',
    stderr: BOARD_USAGE
  })
  await expectPill(null)

  // From an extra pane (#11): the same card.
  await splitRight(page)
  const panes = page.getByTestId('card-view').getByTestId('pane')
  await expect(panes).toHaveCount(2)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const pane = document.activeElement?.closest('[data-testid=card-view] [data-testid=pane]')
        return [...document.querySelectorAll('[data-testid=card-view] [data-testid=pane]')].indexOf(
          pane as Element
        )
      })
    )
    .toBe(1)
  expect(await boardInFocusedPane(alpha, 'board activity . question')).toEqual(ok)
  await expectPill('Needs your answer')
  expect(await boardInFocusedPane(alpha, 'board activity . busy')).toEqual({
    code: 2,
    stdout: '',
    stderr: BOARD_USAGE
  })
  expect(await boardInFocusedPane(alpha, 'board activity . working')).toEqual(ok)
  await expectPill('Working')

  // `exit` in the main pane: Stopped, no pill; reopening starts it again with none.
  await panes.nth(0).getByTestId('terminal').click()
  await expect.poll(terminalFocused).toBe(true)
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('api').getByTestId('card-status')).toHaveText('Stopped')
  await expect(card('api').getByTestId('card-activity')).toHaveCount(0)

  await openCard('api')
  await back()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(card('api').getByTestId('card-activity')).toHaveCount(0)
  await openCard('api')
  expect(await board(alpha, 'board activity old working')).toEqual(
    refused('board: no card "old" in this workspace')
  )
})
