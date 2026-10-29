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
import { FIRST_PROMPT } from '../src/core/startup-command'
import { MAX_REQUEST_LINE_BYTES } from '../src/core/board-protocol'
import { backToBoard, checkOnBoard, expectCardOpen, splitRight } from './card-view'
import { agentLogLines, fakeAgentsHome } from './fake-agents'
import { claudeLogLines } from './fake-claude'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The `board` command (#9): typed into a card's terminal, it reaches the app over
// `<userData>/board/board.sock`. Each command's stdout and stderr go to files in the workspace
// directory and its exit code is echoed, so the test reads all three exactly.

let app: ElectronApplication | undefined
let page: Page
let root: string
let dataDir: string

const NOT_IN_A_CARD = 'board: not running inside a Bikube card'

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikube-board-'))
  dataDir = newDataDir()
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

async function launch(env?: Record<string, string>): Promise<void> {
  ;({ app, page } = await launchApp({ dataDir, ...(env && { env }) }))
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
  // The first `board` of a run starts Bikube's executable as Node from a cold disk cache, which
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

/** Has the open card's shell write its `BIKUBE_CARD_ID` to `<dir>/<file>`; returns the id. */
async function writeCardId(dir: string, file: string): Promise<string> {
  const path = join(dir, file)
  await run(`echo "$BIKUBE_CARD_ID" > ${file}`)
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
  expect(await board(alpha, 'env -u BIKUBE_CARD_ID board move . Done')).toEqual(
    refused(NOT_IN_A_CARD)
  )
  expect(await board(alpha, 'BIKUBE_CARD_ID="$(cat old-id)" board move . Done')).toEqual(
    refused(NOT_IN_A_CARD)
  )
  expect(await board(alpha, 'BIKUBE_CARD_ID="$(cat gone-id)" board move . Done')).toEqual(
    refused(NOT_IN_A_CARD)
  )
  expect(await board(alpha, `BIKUBE_SOCKET=${join(root, 'none.sock')} board move . Done`)).toEqual(
    refused('board: Bikube is not running')
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
  expect(await board(alpha, 'test "$BIKUBE_SOCKET" = ' + socketPath)).toEqual(ok)
  expect(await board(alpha, 'ls -ld "$(dirname "$BIKUBE_SOCKET")"')).toMatchObject({
    code: 0,
    stdout: expect.stringMatching(/^drwx------ /)
  })
  expect(await board(alpha, 'ls -l "$BIKUBE_SOCKET"')).toMatchObject({
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

  for (const line of ['hello\n', '{"v":2}\n', `${'x'.repeat(MAX_REQUEST_LINE_BYTES + 1024)}\n`]) {
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

  await run(`board status . "" && printf 'bikube-marker'; sleep 30`)
  await back()
  await expect(card('api').getByTestId('card-status-line')).toHaveText('bikube-marker')
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
  // Running is the green dot before the title (its words for screen readers only); the agent
  // status takes the status row, beside the stop button (D10), and the last line comes below.
  const icon = card('api').getByTestId('card-status-icon')
  await expect(icon).toHaveAttribute('data-status', 'running')
  const title = await box(card('api').getByTestId('card-title'))
  const [i, a, o] = [await box(icon), await box(agent), await box(line)]
  expect(i.x + i.width).toBeLessThanOrEqual(title.x + 1)
  expect(a.y).toBeGreaterThanOrEqual(title.y + title.height - 1)
  expect(o.y).toBeGreaterThanOrEqual(a.y + a.height - 1)
  const font = (el: Element): string => getComputedStyle(el).fontFamily
  expect(await line.evaluate(font)).toMatch(/monospace/)
  expect(await agent.evaluate(font)).not.toMatch(/monospace/)
  const stop = await box(card('api').getByTestId('card-stop'))
  expect(stop.x).toBeGreaterThanOrEqual(a.x + a.width - 1)
  const middle = stop.y + stop.height / 2
  expect(middle).toBeGreaterThan(a.y)
  expect(middle).toBeLessThan(a.y + a.height)

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

test('board list shows the columns and cards, create adds a card it prints the id of, rename renames', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Done', 'shipped')
  await back()
  await newCard('Backlog', 'api')
  const apiId = await writeCardId(alpha, 'api-id')

  const created = await board(alpha, `board create 'in progress' 'Fix login (NOT-12)'`)
  expect(created.code).toBe(0)
  expect(created.stderr).toBe('')
  // `<id> <workspace name>` (#69 D8).
  const [newId, createdIn] = created.stdout.trim().split(' ')
  expect(newId).not.toBe('')
  expect(createdIn).toBe('alpha')
  expect(await board(alpha, `board rename shipped 'Shipped it'`)).toEqual(ok)

  const listed = await board(alpha, 'board list --json')
  expect(listed.code).toBe(0)
  const listing = JSON.parse(listed.stdout)
  expect(listing.workspace.name).toBe('alpha')
  const cards = Object.fromEntries(
    listing.columns.map((c: { name: string; cards: { id: string; title: string }[] }) => [
      c.name,
      c.cards.map((card) => ({ id: card.id, title: card.title }))
    ])
  )
  expect(cards['Backlog']).toEqual([{ id: apiId, title: 'api' }])
  expect(cards['In Progress']).toEqual([{ id: newId, title: 'Fix login (NOT-12)' }])
  expect(cards['Done']).toEqual([{ id: expect.any(String), title: 'Shipped it' }])

  const text = await board(alpha, 'board list')
  expect(text.code).toBe(0)
  expect(text.stdout).toContain(`  api  [${apiId}]  running, this card\n`)
  expect(text.stdout).toContain(`  Fix login (NOT-12)  [${newId}]  stopped\n`)

  expect(await board(alpha, `board create Later x`)).toEqual(
    refused('board: no column "Later"; columns are: Backlog, In Progress, Review, Done')
  )

  // On the board: the new card is there, not started.
  await back()
  await expect(titlesIn('In Progress')).toHaveText(['Fix login (NOT-12)'])
  await expect(card('Fix login (NOT-12)').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(titlesIn('Done')).toHaveText(['Shipped it'])
})

test("#69 AC4/AC14: board description prints the card's description and describe replaces it", async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('api')
  await page.getByTestId('new-card-description').fill('Hello 69')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'api')
  await expect.poll(terminalFocused).toBe(true)

  expect(await board(alpha, 'board description .')).toEqual({
    code: 0,
    stdout: 'Hello 69\n',
    stderr: ''
  })
  expect(await board(alpha, "printf 'New text' | board describe . -")).toEqual(ok)
  writeFileSync(join(alpha, 'long.md'), 'a'.repeat(100_001))
  expect(await board(alpha, 'board describe . long.md')).toEqual(
    refused('board: Description is longer than 100,000 characters')
  )
  await back()
  await expect(card('api').getByTestId('card-description')).toHaveAttribute('title', 'New text')

  // AC14: 100,000 characters, multi-byte, stored whole and printed back unchanged.
  await openCard('api')
  const big = '🎉é'.repeat(50_000)
  writeFileSync(join(alpha, 'big.md'), big)
  expect(await board(alpha, 'board describe . big.md')).toEqual(ok)
  const printed = await board(alpha, 'board description .')
  expect(printed.code).toBe(0)
  expect(printed.stdout === `${big}\n`).toBe(true)

  // An empty file removes it; then it prints nothing.
  expect(await board(alpha, "printf '' | board describe . -")).toEqual(ok)
  expect(await board(alpha, 'board description .')).toEqual(ok)
  await back()
  await expect(card('api').getByTestId('card-description')).toHaveCount(0)
})

test("#69 AC5/AC7: board workspaces lists them; an id reaches another workspace's card, a title only with --workspace", async () => {
  await launch()
  const alpha = makeDir('alpha')
  const beta = makeDir('beta')
  await createWorkspace(alpha, 'Alpha')
  await createWorkspace(beta, 'Beta')
  await selectWorkspace('Alpha')
  await newCard('Backlog', 'api')

  // AC5: both, in sidebar order, the calling card's marked.
  const json = await board(alpha, 'board workspaces --json')
  expect(json.code).toBe(0)
  const listed = JSON.parse(json.stdout)
  expect(listed).toEqual([
    { id: expect.any(String), name: 'Alpha', location: 'local', directory: alpha, current: true },
    { id: expect.any(String), name: 'Beta', location: 'local', directory: beta }
  ])
  const [a, b] = listed as { id: string }[]
  expect(await board(alpha, 'board workspaces')).toEqual({
    code: 0,
    stdout: `${a.id}  Alpha  local  ${alpha}  *\n${b.id}  Beta  local  ${beta}\n`,
    stderr: ''
  })

  const created = await board(alpha, "board create --workspace beta Backlog 'Port X'")
  expect(created.code).toBe(0)
  const [id, name] = created.stdout.trim().split(' ')
  expect(name).toBe('Beta')
  // Opened once in Beta, so `board status` finds it running.
  await back()
  await selectWorkspace('Beta')
  await openCard('Port X')
  await back()
  await selectWorkspace('Alpha')
  await openCard('api')

  // AC7: by its id, from Alpha.
  expect(await board(alpha, `board rename ${id} 'Port Y'`)).toEqual(ok)
  expect(await board(alpha, `board move ${id} 'in progress'`)).toEqual(ok)
  expect(await board(alpha, `board status ${id} queued`)).toEqual(ok)
  expect(await board(alpha, `printf 'Do Y' | board describe ${id} -`)).toEqual(ok)
  expect(await board(alpha, `board description ${id}`)).toEqual({
    code: 0,
    stdout: 'Do Y\n',
    stderr: ''
  })
  // A title only in this workspace, or the one --workspace names.
  expect(await board(alpha, "board rename 'Port Y' Z")).toEqual(
    refused('board: no card "Port Y" in this workspace')
  )
  expect(await board(alpha, "board rename --workspace Beta 'Port Y' Z")).toEqual(ok)
  const list = await board(alpha, 'board list --workspace Beta')
  expect(list.code).toBe(0)
  expect(list.stdout.split('\n')[0]).toBe(`Beta (${beta})`)
  expect(list.stdout).toContain(`In Progress (1)\n  Z  [${id}]  running · description\n`)
  expect(await board(alpha, 'board list --workspace nope')).toEqual(
    refused('board: no workspace named nope')
  )

  await back()
  await selectWorkspace('Beta')
  await expect(titlesIn('In Progress')).toHaveText(['Z'])
  await expect(card('Z').getByTestId('card-agent-status')).toHaveText('queued')
  await expect(card('Z').getByTestId('card-description')).toHaveAttribute('title', 'Do Y')

  // Two workspaces named Beta, which only a file can hold (the dialog refuses a taken name): the
  // name is ambiguous.
  await createWorkspace(makeDir('gamma'), 'Gamma')
  await app!.close()
  const statePath = join(dataDir, 'bikube-state.json')
  const saved = JSON.parse(readFileSync(statePath, 'utf8'))
  saved.state.workspaces[2].name = 'beta'
  writeFileSync(statePath, JSON.stringify(saved))
  await launch()
  await selectWorkspace('Alpha')
  await openCard('api')
  expect(await board(alpha, 'board list --workspace Beta')).toEqual(
    refused('board: 2 workspaces are named Beta; use its id')
  )
})

/**
 * Ends the open card's fake agent (it waits for one line), once `logged` says it started, and
 * waits for the shell's prompt to take commands again.
 */
async function endFakeAgent(logged: () => boolean): Promise<void> {
  await expect.poll(logged, { timeout: 15_000 }).toBe(true)
  await page.keyboard.press('Enter')
  const tag = `agent-ended-${++commands}`
  await run(`echo ${tag}-$((1+1))`)
  await expect.poll(async () => (await bufferLines()).includes(`${tag}-2`)).toBe(true)
}

/** Creates a card through `+ New card` with the agent `agent` (its select's label). */
async function newAgentCard(columnName: string, title: string, agent: string): Promise<void> {
  await column(columnName).getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-startup').selectOption({ label: agent })
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
  await expect.poll(terminalFocused).toBe(true)
}

test("#69 AC6/AC8: a card created in another workspace gets the description, the calling card's agent and a New pill until opened", async () => {
  const fake = fakeAgentsHome(root)
  await launch(fake.env)
  const alpha = makeDir('alpha')
  const beta = makeDir('beta')
  await createWorkspace(alpha, 'Alpha')
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-startup').selectOption({ label: 'OpenCode' })
  await page.getByTestId('workspace-directory').fill(beta)
  await page.getByTestId('workspace-name').fill('Beta')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await selectWorkspace('Alpha')

  // AC6: from a Claude Code card.
  await newAgentCard('Backlog', 'lead', 'Claude Code')
  await endFakeAgent(() => claudeLogLines(fake.log).length === 1)
  const created = await board(
    alpha,
    "printf '# Port\\nDo X' | board create --workspace beta --description-file - Backlog 'Port X'"
  )
  expect(created.code).toBe(0)
  expect(created.stderr).toBe('')
  expect(created.stdout).toMatch(/^\S+ Beta\n$/)

  // AC8: from a Codex card, a Custom command card, and with --agent.
  await back()
  await newAgentCard('Backlog', 'coder', 'Codex')
  await endFakeAgent(() => agentLogLines(fake.agentLog).length === 1)
  expect((await board(alpha, 'board create --workspace Beta Backlog T1')).code).toBe(0)
  expect((await board(alpha, 'board create --workspace Beta --agent gemini Backlog T3')).code).toBe(
    0
  )
  await back()
  await newCard('Backlog', 'plain')
  expect((await board(alpha, 'board create --workspace Beta Backlog T2')).code).toBe(0)
  // In its own workspace a card gets no New pill.
  expect((await board(alpha, 'board create Backlog here')).code).toBe(0)

  await back()
  await expect(card('here').getByTestId('card-new')).toHaveCount(0)
  await selectWorkspace('Beta')
  await expect(titlesIn('Backlog')).toHaveText(['Port X', 'T1', 'T3', 'T2'])
  const kinds = { 'Port X': 'claude', T1: 'codex', T2: 'opencode', T3: 'gemini' }
  for (const [title, kind] of Object.entries(kinds)) {
    await expect(card(title).getByTestId('card-tag')).toHaveAttribute('data-kind', kind)
    await expect(card(title).getByTestId('card-new')).toHaveText('New')
    await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
  }
  await expect(card('Port X').getByTestId('card-description')).toHaveAttribute(
    'title',
    '# Port\nDo X'
  )

  // Opening it clears the pill and starts Claude Code with the first prompt (D2).
  await openCard('Port X')
  await expect
    .poll(() => claudeLogLines(fake.log).at(-1))
    .toMatch(
      new RegExp(`--session-id \\S+ ${FIRST_PROMPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    )
  await back()
  await expect(card('Port X').getByTestId('card-new')).toHaveCount(0)
  await expect(card('T1').getByTestId('card-new')).toHaveText('New')
  await expect
    .poll(() => {
      const state = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
      const cards = state.state.workspaces[1].cards as { title: string; unopened?: boolean }[]
      return cards.map((c) => [c.title, c.unopened ?? false])
    })
    .toEqual([
      ['Port X', false],
      ['T1', true],
      ['T3', true],
      ['T2', true]
    ])
})

test("the Default shell runs board: it lists, creates and moves named cards, and `.` isn't a card", async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'api')
  await back()

  // New shell opens the workspace's Default shell, in the workspace folder.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+T' : 'Control+Shift+T')
  await expect(page.getByTestId('card-view')).toBeVisible()
  await expect.poll(terminalFocused).toBe(true)

  const listed = await board(alpha, 'board list --json')
  expect(listed.code).toBe(0)
  expect(JSON.parse(listed.stdout).workspace.name).toBe('alpha')

  const created = await board(alpha, `board create backlog 'From the shell'`)
  expect(created.code).toBe(0)
  expect(created.stdout.trim().split(' ')[1]).toBe('alpha')
  expect(await board(alpha, 'board move api done')).toEqual(ok)
  expect(await board(alpha, 'board status . hello')).toEqual(
    refused('board: this is a shell, not a card; name a card by its id or title')
  )

  await back()
  await expect(titlesIn('Backlog')).toHaveText(['From the shell'])
  await expect(titlesIn('Done')).toHaveText(['api'])
})
