import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeLogLines, fakeClaudeHome, SETTINGS_ARGS } from './fake-claude'
import { agentLogLines, fakeAgentsHome } from './fake-agents'
import { backToBoard, belowSeparator, expectCardOpen, expectStatusOnBoard } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Agent resume presets (#21, Pi #65): Codex, Gemini CLI, OpenCode and Pi in every startup command
// select, the plain command on a card's first start and `<resume> || <plain>` after, kept across a
// restart. Electron runs with SHELL=/bin/bash and HOME set to a temp directory whose .bash_profile
// puts fake `claude`, `codex`, `gemini`, `opencode` and `pi` first on PATH (spec: AC intro).

let app: ElectronApplication | undefined
let page: Page
let root: string
let home: string
let agentLog: string
let claudeLog: string
let env: Record<string, string>
let dataDir: string

type Choice = 'Claude Code' | 'Codex' | 'Gemini CLI' | 'OpenCode' | 'Pi' | 'Custom…'

const PRESETS = [
  { title: 'cx', label: 'Codex', tag: 'Codex', plain: 'codex', resume: 'codex resume --last' },
  {
    title: 'gm',
    label: 'Gemini CLI',
    tag: 'Gemini',
    plain: 'gemini',
    resume: 'gemini --resume latest'
  },
  {
    title: 'oc',
    label: 'OpenCode',
    tag: 'OpenCode',
    plain: 'opencode',
    resume: 'opencode --continue'
  },
  { title: 'pi card', label: 'Pi', tag: 'Pi', plain: 'pi', resume: 'pi --continue' }
] as const

function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-presets-'))
  const fake = fakeAgentsHome(root)
  home = fake.home
  agentLog = fake.agentLog
  claudeLog = fake.log
  env = fake.env
  dataDir = newDataDir()
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

async function launch(): Promise<void> {
  ;({ app, page } = await launchApp({ dataDir, env }))
}

/** Quits the app (pending state is flushed) and launches it on the same data. */
async function restart(): Promise<void> {
  await app?.close()
  await launch()
}

const logLines = (): string[] => agentLogLines(agentLog)

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

function selected(select: Locator): Locator {
  return select.locator('option:checked')
}

/** Creates a card through `+ New card` with the given startup choice; its view opens. */
async function newCard(title: string, startup?: Choice): Promise<void> {
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  if (startup) await page.getByTestId('new-card-startup').selectOption({ label: startup })
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

async function openCard(title: string): Promise<void> {
  await card(title).getByTestId('card-open').click()
  await expectCardOpen(page, title)
}

async function back(): Promise<void> {
  await backToBoard(page)
  await expect(page.getByTestId('board')).toBeVisible()
}

/** The open card's terminal buffer, one trimmed string per line, wrapped lines joined back. */
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

const typed = async (line: string): Promise<boolean> =>
  (await bufferLines()).some((l) => l.endsWith(line))

const terminalFocused = (): Promise<boolean> =>
  page.evaluate(
    () => document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
  )

async function run(command: string): Promise<void> {
  await expect.poll(terminalFocused).toBe(true)
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** Quits the open card's fake agent with Enter and exits its shell: it is Stopped. */
async function stopAgent(title: string, dir: string): Promise<void> {
  await page.keyboard.press('Enter')
  await run('pwd')
  await expect.poll(bufferLines).toContain(dir)
  await run('exit')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
}

/** Exits the open card's plain shell: it is Stopped. */
async function exitShell(title: string): Promise<void> {
  await run('exit')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
}

/** Opens the card's `Startup command…` dialog from its menu. */
async function openStartupDialog(title: string): Promise<Locator> {
  await card(title).getByTestId('card-menu').click()
  await page.getByTestId('card-menu-startup').click()
  const dialog = page.getByTestId('startup-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

/** Sets the card's startup command; Custom… is the do-nothing `:` (a plain prompt). */
async function setStartup(title: string, startup: Choice): Promise<void> {
  const dialog = await openStartupDialog(title)
  await dialog.getByTestId('startup-dialog-startup').selectOption({ label: startup })
  if (startup === 'Custom…') await dialog.getByTestId('startup-dialog-command').fill(':')
  await dialog.getByTestId('startup-dialog-save').click()
  await expect(dialog).toHaveCount(0)
}

async function editWorkspace(index: number): Promise<void> {
  const row = page.locator('.workspace-row').nth(index)
  await row.hover()
  await row.getByTestId('workspace-edit').click()
  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
}

/** Creates `cx`, `gm`, `oc` and `pi card` with the four presets in a new workspace `alpha` (AC1). */
async function presetCards(dir: string): Promise<void> {
  await createWorkspace(dir, 'alpha')
  for (const { title, label, plain } of PRESETS) {
    await newCard(title, label)
    await expect.poll(bufferLines).toContain(`fake-${plain}`)
    await back()
  }
}

test('AC1: the select lists the presets; their cards show tags and run the plain command', async () => {
  await launch()
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  await column('Backlog').getByTestId('new-card').click()
  await expect(page.getByTestId('new-card-startup').locator('option')).toHaveText([
    'Claude Code',
    'Codex',
    'Gemini CLI',
    'OpenCode',
    'Pi',
    'Custom…'
  ])
  await page.getByTestId('new-card-input').press('Escape')

  for (const { title, label, plain } of PRESETS) {
    await newCard(title, label)
    await expect.poll(bufferLines).toContain(`fake-${plain}`)
    await back()
    await expect(card(title).getByTestId('card-status-label')).toHaveText('Running')
  }
  for (const { title, label, tag } of PRESETS) {
    await expect(card(title).getByTestId('card-tag')).toHaveText(tag)
    await expect(card(title).getByTestId('card-tag')).toHaveAttribute('title', label)
  }
  expect(logLines()).toEqual(['codex', 'gemini', 'opencode', 'pi'])
  expect(claudeLogLines(claudeLog)).toEqual([])
})

test('AC2/AC3: reopening a stopped preset card resumes, starting fresh when nothing resumes', async () => {
  await launch()
  const dir = makeDir('alpha')
  await presetCards(dir)

  for (const { title, plain, resume } of PRESETS) {
    await openCard(title)
    await stopAgent(title, dir)
    await openCard(title)
    await expect.poll(() => typed(`${resume} || ${plain}`)).toBe(true)
    await expect.poll(bufferLines).toContain(`fake-${resume}`)
    expect(logLines().at(-1)).toBe(resume)
    await expectStatusOnBoard(page, title, 'Running')
    await stopAgent(title, dir)
  }

  appendFileSync(join(home, '.bash_profile'), 'export FAKE_AGENT_RESUME_FAILS=1\n')
  await openCard('cx')
  await expect.poll(() => logLines().slice(-2)).toEqual(['codex resume --last', 'codex'])
  await expect.poll(bufferLines).toContain('fake-codex')
  // The fresh codex is still running: nothing after its output, no prompt yet.
  await page.waitForTimeout(500)
  const lines = (await bufferLines()).filter((l) => l !== '')
  expect(lines.at(-1)).toBe('fake-codex')
  await back()
  await expect(card('cx').getByTestId('card-status-label')).toHaveText('Running')

  // #65 AC2: Pi the same way.
  await openCard('pi card')
  await expect.poll(() => logLines().slice(-2)).toEqual(['pi --continue', 'pi'])
  await expect.poll(bufferLines).toContain('fake-pi')
  await back()
  await expect(card('pi card').getByTestId('card-status-label')).toHaveText('Running')
})

test('AC4: switching a card away from a preset and back keeps it started', async () => {
  await launch()
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  await newCard('sh')
  await back()
  await expect(card('sh').getByTestId('card-status-label')).toHaveText('Running')

  await setStartup('sh', 'Codex')
  await expect(card('sh').getByTestId('card-tag')).toHaveText('Codex')
  expect(logLines()).toEqual([])
  await openCard('sh')
  await exitShell('sh')
  await openCard('sh')
  await expect.poll(logLines).toEqual(['codex'])
  await stopAgent('sh', dir)

  // Away to a plain prompt (Custom `:`) and back.
  await setStartup('sh', 'Custom…')
  await openCard('sh')
  await run('pwd')
  // Below the output kept from the Codex run (#46 D5).
  await expect.poll(async () => belowSeparator(await bufferLines())).toContain(dir)
  expect(belowSeparator(await bufferLines()).join('\n')).not.toContain('codex')
  await exitShell('sh')

  await setStartup('sh', 'Codex')
  await openCard('sh')
  await expect.poll(() => typed('codex resume --last || codex')).toBe(true)
  await expect.poll(logLines).toEqual(['codex', 'codex resume --last'])
})

test('AC5: a preset shows the same-directory hint in the card and workspace dialogs', async () => {
  await launch()
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('sh')
  await back()

  const dialog = await openStartupDialog('sh')
  const select = dialog.getByTestId('startup-dialog-startup')
  const hint = dialog.getByTestId('startup-dialog-startup-hint')
  await expect(hint).toHaveCount(0)
  await select.selectOption({ label: 'Gemini CLI' })
  await expect(hint).toHaveText("Resumes the latest Gemini CLI session in the card's directory.")
  await select.selectOption({ label: 'Claude Code' })
  await expect(hint).toHaveCount(0)
  await select.selectOption({ label: 'Custom…' })
  await expect(hint).toHaveCount(0)
  await dialog.getByTestId('startup-dialog-cancel').click()
  await expect(dialog).toHaveCount(0)

  await editWorkspace(0)
  const workspaceHint = page.getByTestId('workspace-startup-hint')
  await expect(workspaceHint).toHaveCount(0)
  await page.getByTestId('workspace-startup').selectOption({ label: 'OpenCode' })
  await expect(workspaceHint).toHaveText(
    "Resumes the latest OpenCode session in the card's directory."
  )
})

test('AC6: a preset as the workspace default presets new cards only', async () => {
  await launch()
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('sh')
  await back()
  await newCard('agent', 'Claude Code')
  await back()

  await editWorkspace(0)
  await page.getByTestId('workspace-startup').selectOption({ label: 'Codex' })
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  await column('Backlog').getByTestId('new-card').click()
  await expect(selected(page.getByTestId('new-card-startup'))).toHaveText('Codex')
  await page.getByTestId('new-card-input').press('Escape')
  await expect(card('sh').getByTestId('card-tag')).toHaveText('Custom')
  await expect(card('agent').getByTestId('card-tag')).toHaveText('Claude')

  await editWorkspace(0)
  await expect(selected(page.getByTestId('workspace-startup'))).toHaveText('Codex')
})

test('AC7: a started preset card resumes after a restart and is saved with startedAgents', async () => {
  await launch()
  const dir = makeDir('alpha')
  await createWorkspace(dir, 'alpha')
  await newCard('cx', 'Codex')
  await expect.poll(logLines).toEqual(['codex'])
  await back()

  await restart()

  const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
  const cx = saved.state.workspaces[0].cards.find((c: { title: string }) => c.title === 'cx')
  expect(cx.startup).toEqual({ kind: 'codex' })
  expect(cx.startedAgents).toEqual(['codex'])
  await expect(card('cx').getByTestId('card-status-label')).toHaveText('Stopped')
  await openCard('cx')
  await expect.poll(() => typed('codex resume --last || codex')).toBe(true)
  await expect.poll(logLines).toEqual(['codex', 'codex resume --last'])
})

test('AC7: a state file from before #21 loads every card, and Claude Code resumes', async () => {
  const dir = makeDir('alpha')
  const u = '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11'
  const card0 = { columnId: 'c-backlog', directory: dir, agentSessionId: u }
  const old = {
    version: 1,
    state: {
      activeId: 'w-alpha',
      workspaces: [
        {
          id: 'w-alpha',
          name: 'alpha',
          directory: dir,
          columns: [
            { id: 'c-backlog', name: 'Backlog' },
            { id: 'c-done', name: 'Done' }
          ],
          cards: [
            { ...card0, id: 'k-sh', title: 'sh', startup: { kind: 'shell' }, claudeStarted: false },
            {
              ...card0,
              id: 'k-agent',
              title: 'agent',
              startup: { kind: 'claude' },
              claudeStarted: true
            },
            {
              ...card0,
              id: 'k-custom',
              title: 'custom',
              startup: { kind: 'custom', command: 'echo bikube-old' },
              claudeStarted: false
            }
          ],
          nextCardNumber: 1,
          defaultStartup: { kind: 'shell' }
        }
      ]
    }
  }
  writeFileSync(join(dataDir, 'bikube-state.json'), JSON.stringify(old))
  await launch()

  for (const title of ['sh', 'agent', 'custom']) {
    await expect(card(title).getByTestId('card-status-label')).toHaveText('Stopped')
  }
  await expect(card('agent').getByTestId('card-tag')).toHaveText('Claude')
  await expect(card('custom').getByTestId('card-tag')).toHaveText('Custom')
  await openCard('agent')
  await expect.poll(bufferLines).toContain(`fake-claude ${SETTINGS_ARGS} --resume ${u}`)
  expect(claudeLogLines(claudeLog)).toEqual([`${SETTINGS_ARGS} --resume ${u}`])
  expect(logLines()).toEqual([])
})

test('an agent whose CLI the login shell lacks is disabled in the selects, except for SSH', async () => {
  // Only the fake `claude` on the login PATH: Codex, Gemini CLI, OpenCode and Pi aren't installed.
  const claudeOnly = fakeClaudeHome(join(root, 'claude-only'))
  ;({ app, page } = await launchApp({ dataDir, env: claudeOnly.env }))
  await createWorkspace(makeDir('alpha'), 'alpha')
  const options = (select: Locator): Promise<string[]> =>
    select
      .locator('option')
      .evaluateAll((els) =>
        els.map(
          (el) => `${el.textContent}${(el as HTMLOptionElement).disabled ? ' [disabled]' : ''}`
        )
      )
  const expected = [
    'Claude Code',
    'Codex (not installed) [disabled]',
    'Gemini CLI (not installed) [disabled]',
    'OpenCode (not installed) [disabled]',
    'Pi (not installed) [disabled]',
    'Custom…'
  ]
  await column('Backlog').getByTestId('new-card').click()
  // The login shell answers within a few seconds.
  await expect
    .poll(() => options(page.getByTestId('new-card-startup')), { timeout: 15_000 })
    .toEqual(expected)
  await page.keyboard.press('Escape')

  await page.getByTestId('workspace-add').click()
  await expect.poll(() => options(page.getByTestId('workspace-startup'))).toEqual(expected)
  // An SSH workspace's agents run on its host: none is shown as not installed.
  await page.getByTestId('workspace-location-ssh').check()
  await expect
    .poll(() => options(page.getByTestId('workspace-startup')))
    .toEqual(['Claude Code', 'Codex', 'Gemini CLI', 'OpenCode', 'Pi', 'Custom…'])
})

test('#65 AC3: Pi shows its hint and, as the workspace default, presets new cards only', async () => {
  await launch()
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('sh')
  await back()

  await editWorkspace(0)
  await page.getByTestId('workspace-startup').selectOption({ label: 'Pi' })
  await expect(page.getByTestId('workspace-startup-hint')).toHaveText(
    "Resumes the latest Pi session in the card's directory."
  )
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  await column('Backlog').getByTestId('new-card').click()
  await expect(selected(page.getByTestId('new-card-startup'))).toHaveText('Pi')
  await page.getByTestId('new-card-input').press('Escape')
  await expect(card('sh').getByTestId('card-tag')).toHaveText('Custom')
})

test('#65 AC4: a started Pi card continues after a restart and is saved with startedAgents', async () => {
  await launch()
  await createWorkspace(makeDir('alpha'), 'alpha')
  await newCard('pi card', 'Pi')
  await expect.poll(logLines).toEqual(['pi'])
  await back()

  await restart()

  const saved = JSON.parse(readFileSync(join(dataDir, 'bikube-state.json'), 'utf8'))
  const pi = saved.state.workspaces[0].cards.find((c: { title: string }) => c.title === 'pi card')
  expect(pi.startup).toEqual({ kind: 'pi' })
  expect(pi.startedAgents).toEqual(['pi'])
  await expect(card('pi card').getByTestId('card-status-label')).toHaveText('Stopped')
  await openCard('pi card')
  await expect.poll(() => typed('pi --continue || pi')).toBe(true)
  await expect.poll(logLines).toEqual(['pi', 'pi --continue'])
})
