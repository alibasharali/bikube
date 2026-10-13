import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOARD_USAGE } from '../src/core/board-args'
import { launchApp, newDataDir, removeDataDirs } from './launch'

// The `board` command (#9): typed into a card's terminal, it reaches the app over
// `<userData>/board.sock`. Each command's stdout and stderr go to files in the workspace
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
  await expect(page.getByTestId('card-view-title')).toHaveText(title)
  await expect.poll(terminalFocused).toBe(true)
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expect(page.getByTestId('card-view-title')).toHaveText(title)
  await expect.poll(terminalFocused).toBe(true)
}

async function back(): Promise<void> {
  await page.getByTestId('card-back').click()
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
  const pattern = new RegExp(`^${tag} rc=(\\d+)$`)
  let code = -1
  await expect
    .poll(async () => {
      const line = (await bufferLines()).find((l) => pattern.test(l))
      code = line ? Number(pattern.exec(line)![1]) : -1
      return code
    })
    .toBeGreaterThanOrEqual(0)
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
  await expect(page.getByTestId('card-view-title')).toHaveText('api')

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

  expect(await board(alpha, 'board move web "Needs me"')).toEqual(ok)
  await back()
  await expect(titlesIn('Needs me')).toHaveText(['web'])
  await expect(titlesIn('Backlog')).toHaveText(['api'])

  await openCard('api')
  expect(await board(alpha, 'board move "$(cat web-id)" Running')).toEqual(ok)
  await back()
  await expect(titlesIn('Running')).toHaveText(['web'])
  await expect(titlesIn('Needs me')).toHaveCount(0)
  await expect(titlesIn('Backlog')).toHaveText(['api'])
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

  expect(await board(alpha, 'board move . Review')).toEqual(
    refused('board: no column "Review"; columns are: Backlog, Running, Needs me, Done')
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
  const socketPath = join(dataDir, 'board.sock')
  writeFileSync(socketPath, 'stale')
  await launch()
  await expect.poll(() => statSync(socketPath).isSocket()).toBe(true)
  expect(statSync(socketPath).mode & 0o777).toBe(0o600)

  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'api')
  expect(await board(alpha, 'test "$DROVR_SOCKET" = ' + socketPath)).toEqual(ok)
  expect(await board(alpha, 'ls -l "$DROVR_SOCKET"')).toMatchObject({
    code: 0,
    stdout: expect.stringMatching(/^srw------- /)
  })
  expect(await board(alpha, 'board move . Running')).toEqual(ok)

  await app!.close()
  app = undefined
  expect(existsSync(socketPath)).toBe(false)
})

/** Writes `data` to the app's socket; resolves with what it answers before closing. */
function rawExchange(data: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(join(dataDir, 'board.sock'))
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
  await expect.poll(() => existsSync(join(dataDir, 'board.sock'))).toBe(true)

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

const viewStatus = (): Locator => page.getByTestId('card-view').getByTestId('card-status')
const viewStatusLine = (): Locator => page.getByTestId('card-view').getByTestId('card-status-line')

test('AC5: board status shows on the status line, cleaned and cut, until cleared', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'api')

  expect(await board(alpha, 'board status . "running tests"')).toEqual(ok)
  await expect(viewStatus()).toHaveText('Running · running tests')

  // More output doesn't replace it.
  await run("printf 'more-output\\n'")
  await expect.poll(async () => (await bufferLines()).includes('more-output')).toBe(true)
  await page.waitForTimeout(600)
  await expect(viewStatus()).toHaveText('Running · running tests')
  await back()
  await expect(card('api').getByTestId('card-status')).toHaveText('Running · running tests')

  await openCard('api')
  expect(await board(alpha, `board status . "$(printf 'a\\033[31mb')"`)).toEqual(ok)
  await expect(viewStatusLine()).toHaveText('ab')

  const long = 'abcdefghij'.repeat(30)
  expect(await board(alpha, `board status . ${long}`)).toEqual(ok)
  await expect(viewStatusLine()).toHaveText(long.slice(0, 200))

  await run(`board status . "" && printf 'drovr-marker'; sleep 30`)
  await expect(viewStatusLine()).toHaveText('drovr-marker')
  await back()
  await expect(card('api').getByTestId('card-status')).toHaveText('Running · drovr-marker')
})

test("AC6: stopping clears the status; a card that isn't running can't get one", async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('Backlog', 'old')
  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('old').getByTestId('card-status-label')).toHaveText('Stopped')

  await newCard('Backlog', 'api')
  expect(await board(alpha, 'board status . "running tests"')).toEqual(ok)
  await expect(viewStatus()).toHaveText('Running · running tests')

  await run('exit')
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('api').getByTestId('card-status')).toHaveText('Stopped')
  await expect(card('api').getByTestId('card-status-line')).toHaveCount(0)

  await openCard('api')
  await expect(page.getByTestId('card-view').getByTestId('card-status-label')).toHaveText('Running')
  expect(await board(alpha, 'board status old hi')).toEqual(refused('board: "old" is not running'))
  await run("printf 'drovr-marker'; sleep 30")
  await expect(viewStatus()).toHaveText('Running · drovr-marker')
  await back()
  await expect(card('api').getByTestId('card-status')).toHaveText('Running · drovr-marker')
  await expect(card('old').getByTestId('card-status')).toHaveText('Stopped')
})
