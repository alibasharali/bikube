import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeProjectFolder } from '../src/core/claude-stats'
import { FIRST_PROMPT } from '../src/core/startup-command'
import { backToBoard, boardCard, closeCard, expectCardOpen } from './card-view'
import { addFakeAgents } from './fake-agents'
import { claudeLogLines, SETTINGS_ARGS } from './fake-claude'
import { fakeSshHome, removeRemoteForwards, type FakeSshHome } from './fake-ssh'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Claude Code's conversation retention (#80 S1): opening a local Claude Code card while
// `~/.claude/settings.json` keeps conversations less than 3650 days shows a banner over the card
// view (D5) whose buttons raise the setting (D4), hide it for the run or turn the offer off (D6).
// The home is a fake one (`BIKUBE_HOME_DIR`) with the fake `claude` and `ssh` on its login PATH.
// S3: a local Claude Code card's transcript is backed up into `<userData>/transcripts` after each
// `board usage` and when its main pane stops (D8–D10). S4: opening a card that resumes Claude Code
// puts its transcript back from the backup when Claude Code deleted it (D11), or asks when neither
// is here (D12).

const REMOTE_DIR = '/tmp/bikube-remote'
const NOTICE =
  "Claude Code deletes conversations after 30 days, so this card can't resume after that."

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string
let repo: string
let fake: FakeSshHome
let settingsFile: string

test.beforeEach(() => {
  dataDir = newDataDir()
  root = mkdtempSync(join(tmpdir(), 'bikube-retention-'))
  repo = join(root, 'repo')
  mkdirSync(repo)
  mkdirSync(REMOTE_DIR, { recursive: true })
  fake = fakeSshHome(root)
  settingsFile = join(fake.home, '.claude', 'settings.json')
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  removeRemoteForwards(fake.sshLog)
  rmSync(root, { recursive: true, force: true })
})

/** Writes the fake home's `.claude/settings.json`. */
function putSettings(text: string): void {
  mkdirSync(join(fake.home, '.claude'), { recursive: true })
  writeFileSync(settingsFile, text)
}

async function launch(): Promise<void> {
  ;({ app, page } = await launchApp({
    dataDir,
    env: { ...fake.env, BIKUBE_HOME_DIR: fake.home }
  }))
}

async function restart(): Promise<void> {
  await app?.close()
  await launch()
}

async function createWorkspace(directory: string, name: string, host?: string): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  if (host) {
    await page.getByTestId('workspace-location-ssh').check()
    await page.getByTestId('workspace-host').fill(host)
  }
  await page.getByTestId('workspace-directory').fill(directory)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Creates card `title` in Backlog, Claude Code or the workspace's plain default; its view opens. */
async function newCard(title: string, claude = true): Promise<void> {
  await page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    .getByTestId('new-card')
    .click()
  await page.getByTestId('new-card-input').fill(title)
  if (claude) {
    await page.getByTestId('new-card-startup').selectOption({ label: 'Claude Code' })
  }
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

async function openCard(title: string): Promise<void> {
  await boardCard(page, title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

const banner = (on: Page = page): Locator => on.getByTestId('retention-banner')

/** The open card's terminal text, wrapped rows joined. */
function terminalText(on: Page = page): Promise<string> {
  return on.evaluate(() => {
    type Line = { isWrapped: boolean; translateToString(trim: boolean): string }
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: { buffer: { active: { length: number; getLine(i: number): Line | undefined } } }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return ''
    let text = ''
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      text += (line?.isWrapped ? '' : '\n') + (line?.translateToString(true) ?? '')
    }
    return text
  })
}

/** Waits for the fake `claude` to have started in the open card. */
async function claudeStarted(): Promise<void> {
  await expect.poll(terminalText, { timeout: 15_000 }).toContain('fake-claude')
}

/**
 * No banner, once the setting was read: the card's own read went to main before this one, so its
 * answer is in by the time this one's is.
 */
async function expectNoBanner(): Promise<void> {
  await page.evaluate(() => window.bikube.claudeRetention.read())
  await expect(banner()).toHaveCount(0)
}

/** The saved `bikube-settings.json`'s settings; none before it is first written. */
function savedSettings(): Record<string, unknown> {
  const file = join(dataDir, 'bikube-settings.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).settings : {}
}

test('#80 AC1, AC2: the notice shows over a new Claude Code card, the terminal keeps its keys, and Keep for 10 years sets 3650', async () => {
  putSettings('{"model":"opus"}')
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('first')
  await expect(banner().getByTestId('retention-banner-text')).toHaveText(NOTICE)
  await expect(banner().getByRole('button')).toHaveText([
    "Don't ask again",
    'Not now',
    'Keep for 10 years'
  ])
  // Not a dialog: the terminal still takes typed keys (the fake claude reads its stdin, echoed).
  await claudeStarted()
  await page.keyboard.type('typed-while-banner')
  await expect.poll(terminalText).toContain('typed-while-banner')

  await banner().getByRole('button', { name: 'Keep for 10 years' }).click()
  await expect(banner()).toHaveCount(0)
  expect(readFileSync(settingsFile, 'utf8')).toBe(
    '{\n  "model": "opus",\n  "cleanupPeriodDays": 3650\n}\n'
  )
  // The keyboard goes back to the terminal.
  await page.keyboard.type('after-keep')
  await expect.poll(terminalText).toContain('after-keep')

  await backToBoard(page)
  await newCard('second')
  await claudeStarted()
  await expectNoBanner()
})

test('#80 AC2: with no .claude folder, Keep for 10 years creates settings.json with only the setting', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('first')
  await expect(banner().getByTestId('retention-banner-text')).toHaveText(NOTICE)
  await banner().getByRole('button', { name: 'Keep for 10 years' }).click()
  await expect(banner()).toHaveCount(0)
  expect(readFileSync(settingsFile, 'utf8')).toBe('{\n  "cleanupPeriodDays": 3650\n}\n')
})

test('#80 AC1: in a narrow card view the notice wraps; its buttons stay inside it and nothing scrolls sideways', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('narrow')
  await expect(banner().getByTestId('retention-banner-text')).toHaveText(NOTICE)
  // 768 with the sidebar and side panel at their defaults, then 320 with both collapsed.
  for (const width of [768, 320]) {
    if (width === 320) {
      await page.getByTestId('sidebar-toggle').click()
      await page.getByTestId('titlebar-panel').click()
    }
    await app!.evaluate(
      ({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]?.setSize(w, 720),
      width
    )
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
    await expect
      .poll(async () => {
        const view = await page.getByTestId('card-view').boundingBox()
        const buttons = await Promise.all(
          (await banner().getByRole('button').all()).map((b) => b.boundingBox())
        )
        return (
          view !== null &&
          buttons.length === 3 &&
          buttons.every(
            (b) => b !== null && b.x >= view.x - 0.5 && b.x + b.width <= view.x + view.width + 0.5
          )
        )
      })
      .toBe(true)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    expect(await banner().evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  // Keep for 10 years is clickable there, not covered by the side panel.
  await banner().getByRole('button', { name: 'Keep for 10 years' }).click()
  await expect(banner()).toHaveCount(0)
})

test('#80 AC1: the notice shows in a card window too, with the days the file sets', async () => {
  putSettings('{"cleanupPeriodDays":60}')
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('first')
  await expect(banner()).toBeVisible()
  await backToBoard(page)
  const opened = app!.waitForEvent('window')
  await boardCard(page, 'first').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-open-window').click()
  const window = await opened
  await expect(window.getByTestId('card-view')).toHaveAttribute('aria-label', 'first')
  await expect(banner(window).getByTestId('retention-banner-text')).toHaveText(
    "Claude Code deletes conversations after 60 days, so this card can't resume after that."
  )
  await banner(window).getByRole('button', { name: 'Not now' }).click()
  await expect(banner(window)).toHaveCount(0)
})

test('#80 AC3: Not now hides it for this run, on every card; a restart shows it again', async () => {
  putSettings('{"model":"opus"}')
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('first')
  await expect(banner()).toBeVisible()
  await banner().getByRole('button', { name: 'Not now' }).click()
  await expect(banner()).toHaveCount(0)
  await backToBoard(page)
  await newCard('second')
  await claudeStarted()
  await expectNoBanner()
  expect(readFileSync(settingsFile, 'utf8')).toBe('{"model":"opus"}')

  await restart()
  await openCard('first')
  await expect(banner().getByTestId('retention-banner-text')).toHaveText(NOTICE)
})

test("#80 AC3: Don't ask again saves the preference off; Settings' switch brings the notice back", async () => {
  putSettings('{"model":"opus"}')
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('first')
  await expect(banner()).toBeVisible()
  await banner().getByRole('button', { name: "Don't ask again" }).click()
  await expect(banner()).toHaveCount(0)
  await expect.poll(() => savedSettings().offerClaudeRetention).toBe(false)

  await restart()
  await openCard('first')
  await claudeStarted()
  await expectNoBanner()
  await backToBoard(page)

  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-section-agents').click()
  const offer = page.getByTestId('settings-offer-claude-retention')
  await expect(offer).not.toBeChecked()
  await expect(
    page.getByRole('switch', { name: 'Offer to keep Claude Code conversations' })
  ).toBeVisible()
  await offer.click()
  await expect(offer).toBeChecked()
  await page.getByTestId('settings-done').click()
  await expect.poll(() => 'offerClaudeRetention' in savedSettings()).toBe(false)
  await openCard('first')
  await expect(banner().getByTestId('retention-banner-text')).toHaveText(NOTICE)
})

test('#80 AC4: 5000 days and a plain card show no notice', async () => {
  putSettings('{"cleanupPeriodDays":5000}')
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('long')
  await claudeStarted()
  await expectNoBanner()
  await backToBoard(page)
  await newCard('plain', false)
  await expectNoBanner()
  expect(readFileSync(settingsFile, 'utf8')).toBe('{"cleanupPeriodDays":5000}')
})

test('#80 AC4: an SSH Claude Code card shows no notice', async () => {
  await launch()
  await createWorkspace(REMOTE_DIR, 'remote', 'devbox')
  await newCard('remote agent')
  await claudeStarted()
  // The setting reads low, but an SSH card isn't offered it.
  expect(await page.evaluate(() => window.bikube.claudeRetention.read())).toEqual({
    state: 'low',
    days: 30
  })
  await expect(banner()).toHaveCount(0)
  expect(existsSync(settingsFile)).toBe(false)
})

test('#80 AC4: invalid JSON shows no notice', async () => {
  putSettings('{ nope')
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('first')
  await claudeStarted()
  await expectNoBanner()
  expect(readFileSync(settingsFile, 'utf8')).toBe('{ nope')
})

test('#80 AC4: a settings.json that is a link shows no notice and stays unchanged', async () => {
  const target = join(root, 'dotfiles-settings.json')
  writeFileSync(target, '{"cleanupPeriodDays":30}')
  mkdirSync(join(fake.home, '.claude'), { recursive: true })
  symlinkSync(target, settingsFile)
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('first')
  await claudeStarted()
  await expectNoBanner()
  expect(readFileSync(target, 'utf8')).toBe('{"cleanupPeriodDays":30}')
})

test('#80 AC5: a file made invalid after the notice showed is left alone, with the error line', async () => {
  putSettings('{"model":"opus"}')
  await launch()
  await createWorkspace(repo, 'repo')
  await newCard('first')
  await expect(banner()).toBeVisible()
  putSettings('{ nope')
  await banner().getByRole('button', { name: 'Keep for 10 years' }).click()
  await expect(banner().getByTestId('retention-banner-error')).toHaveText(
    "Couldn't save: settings.json is not valid JSON"
  )
  await expect(banner().getByTestId('retention-banner-text')).toHaveText(NOTICE)
  expect(readFileSync(settingsFile, 'utf8')).toBe('{ nope')
})

type SavedCard = { id: string; title: string; agentSessionId: string; claudeStarted: boolean }

/** Card `title`'s id and session id, from the saved state file, in any workspace. */
async function cardOf(title: string): Promise<SavedCard> {
  let card: SavedCard | undefined
  await expect
    .poll(() => {
      try {
        const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
        const cards: SavedCard[] = saved.state.workspaces.flatMap(
          (w: { cards: SavedCard[] }) => w.cards
        )
        card = cards.find((c) => c.title === title)
      } catch {
        card = undefined
      }
      return card !== undefined
    })
    .toBe(true)
  return card!
}

/** Claude Code's transcript of `sessionId` for the repo, in the fake home. */
const transcriptOf = (sessionId: string): string =>
  join(fake.home, '.claude', 'projects', encodeProjectFolder(repo), `${sessionId}.jsonl`)

/** The card's backup folder, `<userData>/transcripts/<sha256 of the card id>`. */
const backupFolder = (cardId: string): string =>
  join(dataDir, 'transcripts', createHash('sha256').update(cardId).digest('hex'))

const contents = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const modeOf = (path: string): number => statSync(path).mode & 0o777

/** Types `line` at the open card's prompt and waits until it has run. */
async function run(line: string): Promise<void> {
  const marker = join(root, `ran-${randomUUID()}`)
  await page.keyboard.type(`${line}; touch ${marker}`)
  await page.keyboard.press('Enter')
  await expect.poll(() => existsSync(marker), { timeout: 15_000 }).toBe(true)
}

/**
 * Creates the Claude Code card `title` and sends the fake `claude` a message: it writes its
 * one-line transcript (D13), reports its session and exits to the card's shell prompt.
 */
async function startedClaudeCard(title: string): Promise<{ id: string; agentSessionId: string }> {
  await newCard(title)
  await claudeStarted()
  const card = await cardOf(title)
  await page.keyboard.type('hello')
  await page.keyboard.press('Enter')
  await expect.poll(() => existsSync(transcriptOf(card.agentSessionId))).toBe(true)
  // The fake writes the transcript before `board session` reports it: wait for the report too, or
  // the card hasn't started Claude Code yet as far as the board knows.
  await expect.poll(async () => (await cardOf(card.title)).claudeStarted).toBe(true)
  return card
}

test('#80 AC7: board usage backs up the transcript and its folder, and again once it grew', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  const card = await startedClaudeCard('agent')
  const transcript = transcriptOf(card.agentSessionId)
  // The fake claude's transcript (D13).
  expect(contents(transcript)).toBe('{"type":"summary","summary":"fake claude"}\n')
  const subagents = join(transcript.slice(0, -'.jsonl'.length), 'subagents')
  mkdirSync(subagents, { recursive: true })
  writeFileSync(join(subagents, 'agent-a.jsonl'), '{"sub":1}\n')

  const folder = backupFolder(card.id)
  const copy = join(folder, `${card.agentSessionId}.jsonl`)
  await run(`board usage . ${transcript}`)
  await expect.poll(() => contents(copy)).toBe(contents(transcript))
  expect(modeOf(join(dataDir, 'transcripts'))).toBe(0o700)
  expect(modeOf(folder)).toBe(0o700)
  expect(modeOf(copy)).toBe(0o600)
  expect(contents(join(folder, card.agentSessionId, 'subagents', 'agent-a.jsonl'))).toBe(
    '{"sub":1}\n'
  )

  appendFileSync(transcript, '{"type":"user"}\n')
  await run(`board usage . ${transcript}`)
  await expect.poll(() => contents(copy)).toBe(contents(transcript))
  expect(contents(copy).split('\n')).toHaveLength(3)
})

test('#80 AC8, AC11: closing the card backs up the last line; deleting it removes the backup', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  const card = await startedClaudeCard('agent')
  const transcript = transcriptOf(card.agentSessionId)
  const copy = join(backupFolder(card.id), `${card.agentSessionId}.jsonl`)
  await run(`board usage . ${transcript}`)
  await expect.poll(() => contents(copy)).toBe(contents(transcript))

  appendFileSync(transcript, '{"type":"assistant","last":true}\n')
  await closeCard(page)
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect.poll(() => contents(copy)).toContain('"last":true')

  await backToBoard(page)
  await boardCard(page, 'agent').getByTestId('card-menu').click()
  await page.getByTestId('card-menu-delete').click()
  await expect(boardCard(page, 'agent')).toHaveCount(0)
  await expect.poll(() => existsSync(backupFolder(card.id))).toBe(false)
})

test('#80 D9: quitting backs up a running card before its shell is stopped', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  const card = await startedClaudeCard('agent')
  const transcript = transcriptOf(card.agentSessionId)
  const copy = join(backupFolder(card.id), `${card.agentSessionId}.jsonl`)
  appendFileSync(transcript, '{"type":"assistant","atQuit":true}\n')
  await app!.close()
  app = undefined
  expect(contents(copy)).toBe(contents(transcript))
})

test('#80 AC11: a new session keeps only its files; a card not on the board loses its backup at launch; no state or sync file mentions them', async () => {
  const syncDir = join(root, 'sync')
  mkdirSync(syncDir)
  writeFileSync(
    join(dataDir, 'bikube-settings.json'),
    JSON.stringify({ version: 1, settings: { syncFolder: syncDir } })
  )
  await launch()
  await createWorkspace(repo, 'repo')
  const card = await startedClaudeCard('agent')
  const folder = backupFolder(card.id)
  await run(`board usage . ${transcriptOf(card.agentSessionId)}`)
  await expect.poll(() => existsSync(join(folder, `${card.agentSessionId}.jsonl`))).toBe(true)

  // `board session .` gives the card a new conversation; its next backup replaces the old one's.
  const next = randomUUID()
  writeFileSync(transcriptOf(next), '{"next":1}\n')
  await run(`board session . ${next}`)
  await expect.poll(async () => (await cardOf('agent')).agentSessionId).toBe(next)
  await run(`board usage . ${transcriptOf(next)}`)
  await expect.poll(() => readdirSync(folder)).toEqual([`${next}.jsonl`])

  const stray = backupFolder('not-on-the-board')
  mkdirSync(stray, { recursive: true })
  writeFileSync(join(stray, `${next}.jsonl`), '{}\n')
  await restart()
  await expect.poll(() => existsSync(stray)).toBe(false)
  expect(readdirSync(folder)).toEqual([`${next}.jsonl`])

  expect(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8')).not.toContain('transcripts')
  await expect.poll(() => existsSync(join(syncDir, 'bikube-board.json'))).toBe(true)
  expect(readFileSync(join(syncDir, 'bikube-board.json'), 'utf8')).not.toContain('transcripts')
})

const GONE = "This card's Claude Code conversation isn't on this machine."

/** The fake claude's log lines. */
const logLines = (): string[] => claudeLogLines(fake.log)

/** Closes the open running card: it is Stopped on the board. */
async function stopCard(title: string): Promise<void> {
  await closeCard(page)
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(boardCard(page, title).getByTestId('card-status-label')).toHaveText('Stopped')
}

test('#80 AC9: a deleted transcript is put back from the backup before claude resumes it', async () => {
  await launch()
  await createWorkspace(repo, 'repo')
  const card = await startedClaudeCard('agent')
  const transcript = transcriptOf(card.agentSessionId)
  const sessionFolder = transcript.slice(0, -'.jsonl'.length)
  mkdirSync(join(sessionFolder, 'subagents'), { recursive: true })
  writeFileSync(join(sessionFolder, 'subagents', 'agent-a.jsonl'), '{"sub":1}\n')
  appendFileSync(transcript, '{"type":"assistant","kept":true}\n')
  const kept = contents(transcript)
  await stopCard('agent')
  const copy = join(backupFolder(card.id), `${card.agentSessionId}.jsonl`)
  await expect.poll(() => contents(copy)).toBe(kept)

  // Claude Code's cleanup deleted the conversation.
  rmSync(transcript)
  rmSync(sessionFolder, { recursive: true })
  const before = logLines().length
  await openCard('agent')
  await expect.poll(logLines).toHaveLength(before + 1)
  // Back with the backup's two lines when claude was asked to resume it (the fake writes one).
  expect(contents(transcript)).toBe(kept)
  expect(contents(join(sessionFolder, 'subagents', 'agent-a.jsonl'))).toBe('{"sub":1}\n')
  expect(logLines().at(-1)).toBe(`${SETTINGS_ARGS} --resume ${card.agentSessionId}`)
  await expect(page.getByTestId('conversation-gone')).toHaveCount(0)
  await backToBoard(page)
  await expect(boardCard(page, 'agent').getByTestId('card-status-label')).toHaveText('Running')
})

test('#80 AC10: with neither a transcript nor a backup the card asks; Back leaves it Stopped, Start a new conversation starts it fresh', async () => {
  // Kept long, so the panel names the set value (D5's `<n>`), and no banner shows.
  putSettings('{"cleanupPeriodDays":5000}')
  await launch()
  await createWorkspace(repo, 'repo')
  await page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    .getByTestId('new-card')
    .click()
  await page.getByTestId('new-card-input').fill('agent')
  await page.getByTestId('new-card-description').fill('# Goal\nFix the login bug')
  await page.getByTestId('new-card-startup').selectOption({ label: 'Claude Code' })
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'agent')
  await claudeStarted()
  const card = await cardOf('agent')
  await page.keyboard.type('hello')
  await page.keyboard.press('Enter')
  await expect.poll(() => existsSync(transcriptOf(card.agentSessionId))).toBe(true)
  // The fake writes the transcript before `board session` reports it: wait for the report too, or
  // the card hasn't started Claude Code yet as far as the board knows.
  await expect.poll(async () => (await cardOf(card.title)).claudeStarted).toBe(true)
  await stopCard('agent')
  // The copy made at the stop, complete, before both are removed.
  await expect
    .poll(() => contents(join(backupFolder(card.id), `${card.agentSessionId}.jsonl`)))
    .toBe(contents(transcriptOf(card.agentSessionId)))
  rmSync(join(fake.home, '.claude', 'projects'), { recursive: true })
  rmSync(backupFolder(card.id), { recursive: true })
  const before = logLines().length

  await openCard('agent')
  const gone = page.getByTestId('conversation-gone')
  await expect(gone).toContainText(GONE)
  await expect(gone).toContainText(
    'Claude Code deletes conversations after 5000 days, or it ran on another machine.'
  )
  await expect(page.getByTestId('card-view').getByTestId('terminal')).toHaveCount(0)
  await page.getByTestId('conversation-gone-back').click()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(boardCard(page, 'agent').getByTestId('card-status-label')).toHaveText('Stopped')

  // Opening it again checks again.
  await openCard('agent')
  await expect(gone).toContainText(GONE)
  expect(logLines()).toHaveLength(before)
  await page.getByTestId('conversation-gone-start').click()
  await expect.poll(logLines).toHaveLength(before + 1)
  expect(logLines().at(-1)).toBe(
    `${SETTINGS_ARGS} --session-id ${card.agentSessionId} ${FIRST_PROMPT}`
  )
  await claudeStarted()
  await expect(gone).toHaveCount(0)
})

test('#80 AC12: SSH, Codex and plain cards are never backed up or asked; a new Claude Code card starts at once', async () => {
  addFakeAgents(fake.home, join(root, 'agents.log'))
  await launch()
  await createWorkspace(repo, 'repo')
  // A Claude Code card that never started Claude Code runs at once, with no check.
  await newCard('fresh')
  await claudeStarted()
  await expect(page.getByTestId('conversation-check')).toHaveCount(0)
  await backToBoard(page)

  await newCard('plain', false)
  await stopCard('plain')
  await page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    .getByTestId('new-card')
    .click()
  await page.getByTestId('new-card-input').fill('cx')
  await page.getByTestId('new-card-startup').selectOption({ label: 'Codex' })
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'cx')
  await expect.poll(terminalText, { timeout: 15_000 }).toContain('fake-codex')
  await stopCard('cx')

  await createWorkspace(REMOTE_DIR, 'remote', 'devbox')
  await newCard('remote agent')
  await claudeStarted()
  await page.keyboard.type('hello')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await cardOf('remote agent')).claudeStarted).toBe(true)
  const remote = await cardOf('remote agent')
  // Its conversation is nowhere here, and it still resumes as before.
  rmSync(join(fake.home, '.claude', 'projects'), { recursive: true, force: true })
  await stopCard('remote agent')
  await openCard('remote agent')
  await expect
    .poll(() => logLines().at(-1))
    .toMatch(new RegExp(`--resume ${remote.agentSessionId}$`))
  await expect(page.getByTestId('conversation-gone')).toHaveCount(0)
  await backToBoard(page)

  await page.getByTestId('workspace-item').filter({ hasText: 'repo' }).click()
  for (const title of ['plain', 'cx']) {
    await openCard(title)
    await expect(page.getByTestId('conversation-gone')).toHaveCount(0)
    await expect.poll(terminalText, { timeout: 15_000 }).not.toBe('')
    await backToBoard(page)
  }
  const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
  const ids: string[] = saved.state.workspaces.flatMap(
    (w: { cards: { id: string; title: string }[] }) =>
      w.cards.filter((c) => c.title !== 'fresh').map((c) => c.id)
  )
  for (const id of ids) expect(existsSync(backupFolder(id))).toBe(false)
})
