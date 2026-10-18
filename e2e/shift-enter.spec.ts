import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expectCardOpen, splitRight } from './card-view'
import { fakeClaudeHome } from './fake-claude'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Shift+Enter (not specced: the terminal polish pass). It sends ESC CR, which Claude Code takes
// as a new line, only in a Claude Code card's main pane while Claude Code runs there (focus
// reporting on); everywhere else it is xterm's plain CR, since ESC CR misfires in bash.

/** ESC right before the newline in `od -c`'s output; a focus report (`033 [ I`) is not it. */
const ESC_CR = /033\s+\\n/

let app: ElectronApplication
let page: Page
let root: string

// Like Claude Code: focus reporting on while it runs, off when it exits. `od -c` shows the bytes.
const FAKE_CLAUDE = `#!/bin/bash
printf '\\033[?1004h'
echo claude-ready
od -c
printf '\\033[?1004l'
echo claude-done
`

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-shift-enter-'))
  const fake = fakeClaudeHome(root)
  writeFileSync(join(fake.home, 'bin', 'claude'), FAKE_CLAUDE)
  chmodSync(join(fake.home, 'bin', 'claude'), 0o755)
  ;({ app, page } = await launchApp({ env: fake.env }))
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

/** Adds a workspace on `root`, with Claude Code cards (the default) unless `plain`. */
async function addWorkspace(plain: boolean): Promise<void> {
  await page.getByTestId('workspace-add').click()
  if (plain) await plainCards(page)
  await page.getByTestId('workspace-directory').fill(root)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

async function newCard(title: string): Promise<void> {
  await page.getByTestId('column').first().getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill(title)
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, title)
}

/** The focused pane's buffer as text. */
function focusedText(): Promise<string> {
  return page.evaluate(() => {
    const host = document.activeElement?.closest('[data-testid=terminal]') as
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
    if (!buffer) return ''
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++)
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
    return lines.join('\n')
  })
}

/** Waits for the line `marker` in the focused pane, then gives what it shows after it. */
async function after(marker: string): Promise<() => Promise<string>> {
  await expect.poll(async () => (await focusedText()).split('\n')).toContain(marker)
  return async () => {
    const text = await focusedText()
    return text.slice(text.lastIndexOf(`\n${marker}\n`))
  }
}

/** Runs `od -c` at the focused shell, once it reads the tty, then presses Shift+Enter and EOF. */
async function shiftEnterAtShell(marker: string, setup = ''): Promise<() => Promise<string>> {
  await page.keyboard.type(`${setup}echo ${marker}; od -c`)
  await page.keyboard.press('Enter')
  const output = await after(marker)
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Control+D')
  return output
}

test("Shift+Enter is ESC CR while Claude Code runs in its card's main pane, Enter once it exits", async () => {
  await addWorkspace(false)
  await newCard('agent')
  const claude = await after('claude-ready')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Control+D')
  await expect.poll(claude).toMatch(ESC_CR)

  await after('claude-done')
  const shell = await shiftEnterAtShell('shell-ready')
  await expect.poll(shell).toMatch(/\\n/)
  expect(await shell()).not.toMatch(ESC_CR)
})

test("Shift+Enter is Enter in a Claude Code card's extra pane, focus reporting or not", async () => {
  await addWorkspace(false)
  await newCard('agent')
  await after('claude-ready')
  await splitRight(page)
  const pane = await shiftEnterAtShell('pane-ready', String.raw`printf '\033[?1004h'; `)
  await expect.poll(pane).toMatch(/\\n/)
  expect(await pane()).not.toMatch(ESC_CR)
})

test('Shift+Enter is Enter in a card that does not start Claude Code', async () => {
  await addWorkspace(true)
  await newCard('plain')
  await expect.poll(focusedText, { timeout: 15_000 }).toMatch(/\S/)
  const shell = await shiftEnterAtShell('plain-ready', String.raw`printf '\033[?1004h'; `)
  await expect.poll(shell).toMatch(/\\n/)
  expect(await shell()).not.toMatch(ESC_CR)
})
