import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expectCardOpen, splitRight } from './card-view'
import { fakeClaudeHome } from './fake-claude'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'
import { showShells } from './shells-tab'

// Shift+Enter (the terminal polish pass, #58). It sends ESC CR, which Claude Code takes as a new
// line, while focus reporting is on in a Claude Code card's main pane or in any pane that saw
// Claude Code's probe (OSC 7501) since focus reporting was last turned off: a workspace's shells,
// extra panes. Everywhere else it is xterm's plain CR, since ESC CR misfires in bash.

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

// Claude Code as any pane sees it (#58 D1): focus reporting on and the probe, then off (as one of
// several modes) when it exits.
const PROBE = `printf '\\033[?1004h\\033]7501;?\\007'
echo probe-ready
od -c
printf '\\033[?1004;1000l'
echo probe-done
`

// Claude Code without its probe, as it turns focus reporting on again after Ctrl+Z and `fg`: only
// the foreground program's name tells, so this runs under a copy of bash named `claude` (a symlink
// takes its target's name; macOS kills a copied system binary until it is signed again, ad hoc).
const NO_PROBE = `printf '\\033[?1004h'
echo native-ready
od -c
printf '\\033[?1004l'
echo native-done
`

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-shift-enter-'))
  const fake = fakeClaudeHome(root)
  writeFileSync(join(fake.home, 'bin', 'claude'), FAKE_CLAUDE)
  chmodSync(join(fake.home, 'bin', 'claude'), 0o755)
  writeFileSync(join(root, 'probe.sh'), PROBE)
  writeFileSync(join(root, 'no-probe.sh'), NO_PROBE)
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

test("Shift+Enter is ESC CR in a Claude Code card's extra pane that saw Claude Code's probe", async () => {
  await addWorkspace(false)
  await newCard('agent')
  await after('claude-ready')
  await splitRight(page)
  const pane = await shiftEnterAtShell(
    'pane-ready',
    String.raw`printf '\033[?1004h\033]7501;?\007'; `
  )
  await expect.poll(pane).toMatch(ESC_CR)
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

test("Shift+Enter is ESC CR in a workspace's shell while Claude Code runs there, Enter once it exits", async () => {
  await addWorkspace(true)
  await showShells(page)
  await page
    .locator('[data-testid="shell"][data-shell-name="Default"]')
    .getByTestId('shell-open')
    .click()
  await expectCardOpen(page, 'Default')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await expect.poll(focusedText, { timeout: 15_000 }).toMatch(/\S/)
  await page.keyboard.type('sh probe.sh')
  await page.keyboard.press('Enter')
  const program = await after('probe-ready')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Control+D')
  await expect.poll(program).toMatch(ESC_CR)

  // Focus reporting off ended it: turned on again without the probe, Shift+Enter is a plain CR.
  await after('probe-done')
  const shell = await shiftEnterAtShell('shell-ready', String.raw`printf '\033[?1004h'; `)
  await expect.poll(shell).toMatch(/\\n/)
  expect(await shell()).not.toMatch(ESC_CR)
})

test("Shift+Enter is ESC CR in a workspace's shell while a program named claude has focus reporting on, without the probe", async () => {
  await addWorkspace(true)
  await showShells(page)
  await page
    .locator('[data-testid="shell"][data-shell-name="Default"]')
    .getByTestId('shell-open')
    .click()
  await expectCardOpen(page, 'Default')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await expect.poll(focusedText, { timeout: 15_000 }).toMatch(/\S/)
  const claude = join(root, 'native', 'claude')
  mkdirSync(join(root, 'native'))
  copyFileSync('/bin/bash', claude)
  if (process.platform === 'darwin') execFileSync('codesign', ['--force', '--sign', '-', claude])
  await page.keyboard.type('native/claude no-probe.sh')
  await page.keyboard.press('Enter')
  const program = await after('native-ready')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Control+D')
  await expect.poll(program).toMatch(ESC_CR)

  // The same script under the shell's own bash: focus reporting on, but not Claude Code.
  await after('native-done')
  await page.keyboard.type('bash no-probe.sh')
  await page.keyboard.press('Enter')
  await expect
    .poll(async () => (await focusedText()).split('\n').filter((l) => l === 'native-ready'))
    .toHaveLength(2)
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Control+D')
  const plain = async (): Promise<string> => {
    const text = await focusedText()
    return text.slice(text.lastIndexOf('\nnative-ready\n'))
  }
  await expect.poll(plain).toMatch(/\\n/)
  expect(await plain()).not.toMatch(ESC_CR)
})
