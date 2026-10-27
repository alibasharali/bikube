import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOARD_USAGE, SSH_BOARD_USAGE } from '../src/core/board-args'
import { backToBoard, boardCard, closeCard, expectCardOpen } from './card-view'
import { fakeSshHome, removeRemoteForwards, type FakeSshHome } from './fake-ssh'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// A card's Claude Code usage (#50): `board usage . <transcript>` typed in a plain card reads a
// fixture transcript written to the workspace folder and shows the card's usage line on the
// board. Each command's stdout and stderr go to files and its exit code is echoed on the screen.

let app: ElectronApplication | undefined
let page: Page
let root: string
let dataDir: string
let fake: FakeSshHome | undefined

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikube-usage-'))
  dataDir = newDataDir()
  fake = undefined
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  if (fake) removeRemoteForwards(fake.sshLog)
  rmSync(root, { recursive: true, force: true })
})

async function launch(env?: Record<string, string>): Promise<void> {
  ;({ app, page } = await launchApp({ dataDir, env }))
}

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

async function createWorkspace(dir: string, name: string, host?: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  if (host) {
    await page.getByTestId('workspace-location-ssh').check()
    await page.getByTestId('workspace-host').fill(host)
  }
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

const card = (title: string): Locator => boardCard(page, title)
const usageOf = (title: string): Locator => card(title).getByTestId('card-usage')

const terminalFocused = (): Promise<boolean> =>
  page.evaluate(
    () => document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
  )

/** Creates a card through `+ New card`; its full-size view opens with the terminal focused. */
async function newCard(title: string): Promise<void> {
  await column('Backlog').getByTestId('new-card').click()
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

/** The open card's terminal buffer, one trimmed string per line, wrapped lines joined. */
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

async function run(command: string): Promise<void> {
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

let commands = 0

/** Runs `command` in the open card; returns its exit code (read from the screen), stdout, stderr. */
async function board(command: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const tag = `c${++commands}`
  const out = join(root, `${tag}.out`)
  const err = join(root, `${tag}.err`)
  await run(`${command} >${out} 2>${err}; echo "${tag} rc=$?"`)
  const pattern = new RegExp(`^${tag} rc=(\\d+)`)
  let code = -1
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
  return { code, stdout: readFileSync(out, 'utf8'), stderr: readFileSync(err, 'utf8') }
}

const ok = { code: 0, stdout: '', stderr: '' }

interface Entry {
  model: string
  input: number
  output: number
  cacheWrite?: number
  cacheRead?: number
}

/** Writes a transcript of `entries` as Claude Code's assistant lines to `<dir>/<name>`. */
function transcript(dir: string, name: string, entries: Entry[]): void {
  const lines = entries.map((e, i) =>
    JSON.stringify({
      type: 'assistant',
      requestId: `req-${i}`,
      message: {
        id: `msg-${i}`,
        model: e.model,
        usage: {
          input_tokens: e.input,
          output_tokens: e.output,
          cache_creation_input_tokens: e.cacheWrite ?? 0,
          cache_read_input_tokens: e.cacheRead ?? 0
        }
      }
    })
  )
  writeFileSync(join(dir, name), lines.map((l) => `${l}\n`).join(''))
}

/** AC1's transcript: two claude-sonnet-4-5 entries. */
function ac1Transcript(dir: string): void {
  transcript(dir, 't.jsonl', [
    { model: 'claude-sonnet-4-5', input: 1000, output: 500, cacheWrite: 2000 },
    { model: 'claude-sonnet-4-5', input: 10, output: 200, cacheRead: 3000 }
  ])
}

const AC1_TOOLTIP = [
  'Context 3,010 of 200,000 tokens (2%)',
  'Input 1,010',
  'Output 700',
  'Cache write 2,000',
  'Cache read 3,000',
  'Model claude-sonnet-4-5'
].join('\n')

test('AC1, AC3: the board card shows the reported usage and its breakdown', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('api')
  ac1Transcript(alpha)
  transcript(alpha, 'gpt.jsonl', [{ model: 'gpt-x', input: 1000, output: 1000 }])

  expect(await board('board usage . t.jsonl')).toEqual(ok)
  await backToBoard(page)
  await expect(usageOf('api')).toHaveText('2% context')
  await expect(usageOf('api')).toHaveAttribute('title', AC1_TOOLTIP)

  await openCard('api')
  expect(await board('board usage . gpt.jsonl')).toEqual(ok)
  await backToBoard(page)
  await expect(usageOf('api')).toHaveText('1% context')
  const tooltip = await usageOf('api').getAttribute('title')
  expect(tooltip).toContain('Model gpt-x')
  expect(tooltip).not.toContain('$')
  // No cost estimate anywhere, the title bar included.
  await expect(page.getByTestId('titlebar')).not.toContainText('$')
})

test('AC4: a report replaces the line, Close keeps it, an empty transcript clears it, delete forgets it', async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('api')
  ac1Transcript(alpha)
  transcript(alpha, 'opus.jsonl', [{ model: 'claude-opus-4-5', input: 0, output: 1_000_000 }])
  writeFileSync(join(alpha, 'empty.jsonl'), '')

  expect(await board('board usage . t.jsonl')).toEqual(ok)
  expect(await board('board usage . opus.jsonl')).toEqual(ok)
  await backToBoard(page)
  await expect(usageOf('api')).toHaveText('0% context')

  // Closed, the card keeps its usage (#50 D7).
  await openCard('api')
  await closeCard(page)
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(usageOf('api')).toHaveText('0% context')

  // Opened again it starts, still showing it, until an empty transcript clears it.
  await openCard('api')
  await backToBoard(page)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(usageOf('api')).toHaveText('0% context')
  await openCard('api')
  expect(await board('board usage . empty.jsonl')).toEqual(ok)
  await backToBoard(page)
  await expect(usageOf('api')).toHaveCount(0)

  // A deleted card's usage doesn't pass to a new card with its title.
  await openCard('api')
  expect(await board('board usage . t.jsonl')).toEqual(ok)
  await backToBoard(page)
  await expect(usageOf('api')).toHaveText('2% context')
  await card('api').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  await page.getByTestId('confirm-delete').click()
  await expect(card('api')).toHaveCount(0)
  await newCard('api')
  await backToBoard(page)
  await expect(card('api')).toHaveCount(1)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(usageOf('api')).toHaveCount(0)
})

test("AC5: an unreadable transcript, a missing one and help; usage isn't in help", async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('api')

  expect(await board('board usage . /nope.jsonl')).toEqual({
    code: 1,
    stdout: '',
    stderr: "board: can't read /nope.jsonl\n"
  })
  expect(await board('board usage .')).toEqual({ code: 2, stdout: '', stderr: BOARD_USAGE })
  const help = await board('board help')
  expect(help).toEqual({ code: 0, stdout: BOARD_USAGE, stderr: '' })
  expect(help.stdout).not.toContain('board usage')
  await backToBoard(page)
  await expect(usageOf('api')).toHaveCount(0)
})

test("AC8: a card's usage and last status are kept across a Close and a restart, never synced", async () => {
  await launch()
  const alpha = makeDir('alpha')
  await createWorkspace(alpha, 'alpha')
  await newCard('api')
  ac1Transcript(alpha)
  expect(await board('board usage . t.jsonl')).toEqual(ok)
  expect(await board("board status . 'Tests green'")).toEqual(ok)
  await closeCard(page)
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('board')).toBeVisible()
  // Stopped: its last status shows dimmed, under the label, with its usage.
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(card('api').getByTestId('card-last-status')).toHaveText('Tests green')
  await expect(usageOf('api')).toHaveText('2% context')

  await app?.close()
  await launch()
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Stopped')
  await expect(card('api').getByTestId('card-last-status')).toHaveText('Tests green')
  await expect(usageOf('api')).toHaveText('2% context')
  const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
  const api = saved.state.workspaces[0].cards[0]
  expect(api.lastStatus).toBe('Tests green')
  expect(api.lastUsage).toMatchObject({ context: expect.any(Number), tokens: expect.any(Number) })
})

test("AC9: an SSH card's board doesn't know usage, and the card shows none", async () => {
  fake = fakeSshHome(root)
  await launch(fake.env)
  mkdirSync('/tmp/bikube-remote', { recursive: true })
  await createWorkspace('/tmp/bikube-remote', 'remote', 'me@devbox')
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('api')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'api')
  // An SSH card keeps no keystrokes typed before its session arrives: probe until one gets through.
  await expect(async () => {
    await run('echo ready:$((40+2))')
    await expect.poll(bufferLines, { timeout: 2000 }).toContain('ready:42')
  }).toPass({ timeout: 20_000 })
  ac1Transcript(root)

  expect(await board(`board usage . ${join(root, 't.jsonl')}`)).toEqual({
    code: 2,
    stdout: '',
    stderr: SSH_BOARD_USAGE
  })
  await backToBoard(page)
  await expect(card('api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(usageOf('api')).toHaveCount(0)
})
