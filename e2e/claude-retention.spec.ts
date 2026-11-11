import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, boardCard, expectCardOpen } from './card-view'
import { fakeSshHome, removeRemoteForwards, type FakeSshHome } from './fake-ssh'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Claude Code's conversation retention (#80 S1): opening a local Claude Code card while
// `~/.claude/settings.json` keeps conversations less than 3650 days shows a banner over the card
// view (D5) whose buttons raise the setting (D4), hide it for the run or turn the offer off (D6).
// The home is a fake one (`BIKUBE_HOME_DIR`) with the fake `claude` and `ssh` on its login PATH.

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
