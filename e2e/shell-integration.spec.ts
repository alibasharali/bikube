import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen, SHORTCUTS, splitRight } from './card-view'
import { clipboardWrites, recordClipboardWrites } from './clipboard-writes'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Shell integration (#45): the marks a shell sends around its prompts and commands (OSC 133,
// OSC 633, OSC 7), and what Drovr shows from them: a failed command's mark on its line (D6),
// prompt jumps (D5), and a notification when a long command ends out of sight (D7).

let app: ElectronApplication | undefined
let page: Page
let root: string
let dataDir: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-shell-integration-'))
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

/**
 * Launches with the Shell setting `shell`, and a workspace on `root` with plain cards; `env` is
 * added to the app's environment.
 */
async function launchWithShell(shell: string, env: Record<string, string> = {}): Promise<void> {
  dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'drovr-settings.json'),
    JSON.stringify({ version: 1, settings: { shell } })
  )
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) base[key] = value
  ;({ app, page } = await launchApp({ dataDir, env: { ...base, ...env } }))
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(root)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** The saved settings file. */
function readSettings(): unknown {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'drovr-settings.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Opens the workspace's Default shell and focuses its terminal. */
async function openDefaultShell(): Promise<void> {
  await page
    .locator('[data-testid="shell"][data-shell-name="Default"]')
    .getByTestId('shell-open')
    .click()
  await expectCardOpen(page, 'Default')
  await page.getByTestId('card-view').getByTestId('terminal').click()
}

/** The open terminal's buffer, one string per row, with whether it continues the row above. */
function bufferRows(): Promise<{ text: string; wrapped: boolean }[]> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: {
            buffer: {
              active: {
                length: number
                getLine(
                  i: number
                ): { isWrapped: boolean; translateToString(trim: boolean): string } | undefined
              }
            }
          }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const out: { text: string; wrapped: boolean }[] = []
    for (let i = 0; i < buffer.length; i++) {
      const row = buffer.getLine(i)
      out.push({ text: row?.translateToString(true) ?? '', wrapped: row?.isWrapped ?? false })
    }
    return out
  })
}

/** The open terminal's rows as text. */
async function rows(): Promise<string[]> {
  return (await bufferRows()).map((row) => row.text)
}

/** The whole line (wrapped rows joined) that ends on row `end`. */
async function lineEndingAt(end: number): Promise<string> {
  const all = await bufferRows()
  let start = end
  while (start > 0 && all[start]!.wrapped) start--
  return all
    .slice(start, end + 1)
    .map((row) => row.text)
    .join('')
}

/** Types `line` at the shell and runs it. */
async function run(line: string): Promise<void> {
  await page.keyboard.type(line)
  await page.keyboard.press('Enter')
}

/** A command marked as sh can't mark it: prompt start and end, output start, finished with `end`. */
const marked = (end: string): string =>
  String.raw`printf '\033]133;A\007$ \033]133;B\007'; printf '\033]133;C\007'; printf '\033]133;D;` +
  end +
  String.raw`\007'`

test('AC2: a failed command gets a mark on its line with its exit code; one that ended with 0 none', async () => {
  await launchWithShell('/bin/sh')
  await openDefaultShell()
  const failed = page.getByTestId('command-failed')
  const badge = page.getByTestId('command-failed-badge')

  await run(`${marked('0')}; echo ok-done`)
  // After the printed `$ `: the output, not the typed command.
  await expect.poll(async () => (await rows()).some((row) => /^\$ ok-done$/.test(row))).toBe(true)
  await expect(failed).toHaveCount(0)
  await expect(badge).toHaveCount(0)

  await run(marked('3'))
  await expect(badge).toHaveCount(1)
  await expect(badge).toHaveText('✗ 3')
  await expect(badge).toHaveAttribute('title', 'Exit code 3')
  await expect(failed).toHaveCount(1)
  await expect(failed).toHaveAttribute('title', 'Exit code 3')
  await expect(failed).toHaveAttribute('data-exit-code', '3')

  // On the command's line: the row of its B, right after the typed command (sh's own prompt
  // follows the printed `$ ` there), not the row it was typed on.
  const line = Number(await failed.getAttribute('data-line'))
  expect(await lineEndingAt(line - 1)).toContain(marked('3'))
  expect((await rows())[line]).toMatch(/^\$ /)
  expect(Number(await badge.getAttribute('data-line'))).toBe(line)
  // The bar on the left edge, the badge on the right one, on the same row.
  const screen = (await page.getByTestId('card-view').locator('.xterm-screen').boundingBox())!
  const bar = (await failed.boundingBox())!
  const tag = (await badge.boundingBox())!
  expect(bar.x).toBeLessThan(screen.x + 2)
  expect(tag.x + tag.width).toBeGreaterThan(screen.x + screen.width - 2)
  expect(Math.abs(tag.y - bar.y)).toBeLessThan(1)

  // A command ending with 0 after the failed one adds nothing.
  await run(`${marked('0')}; echo again-done`)
  await expect
    .poll(async () => (await rows()).some((row) => /^\$ again-done$/.test(row)))
    .toBe(true)
  await expect(badge).toHaveCount(1)
  await expect(failed).toHaveCount(1)
})

test('AC5: bash with Shell integration marks a failed command; with it off a new shell does not', async () => {
  await launchWithShell('/bin/bash')
  await openDefaultShell()
  const badge = page.getByTestId('command-failed-badge')

  await run('false')
  await expect(badge).toHaveCount(1)
  await expect(badge).toHaveText('✗ 1')
  // On the line `false` was typed on, the prompt's.
  const line = Number(await badge.getAttribute('data-line'))
  expect(await lineEndingAt(line)).toMatch(/false$/)
  await run('true')
  await run('echo first-"done"')
  await expect.poll(async () => (await rows()).includes('first-done')).toBe(true)
  await expect(badge).toHaveCount(1)

  // Off: saved, and only a shell started afterwards goes without.
  await backToBoard(page)
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-section-terminal').click()
  const toggle = page.getByTestId('settings-shell-integration')
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await page.getByTestId('settings-dialog').getByRole('button', { name: 'Done' }).click()
  await expect.poll(() => readSettings()).toMatchObject({ settings: { shellIntegration: false } })
  await page
    .locator('[data-testid="shell"][data-shell-name="Default"]')
    .getByTestId('shell-menu')
    .click()
  await page.getByTestId('shell-menu-restart').click()
  await openDefaultShell()
  await run('false; echo second-"done"')
  await expect.poll(async () => (await rows()).includes('second-done')).toBe(true)
  await run('echo "debug=[$(trap -p DEBUG)]"')
  await expect.poll(async () => (await rows()).includes('debug=[]')).toBe(true)
  await expect(badge).toHaveCount(0)
})

/** The open terminal's viewport: its top row, the bottom it scrolls to, and its row count. */
function viewport(): Promise<{ top: number; bottom: number; rows: number }> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: { rows: number; buffer: { active: { viewportY: number; baseY: number } } }
        })
      | null
    const term = host!.__xterm!
    return {
      top: term.buffer.active.viewportY,
      bottom: term.buffer.active.baseY,
      rows: term.rows
    }
  })
}

test('AC6: Previous prompt and Next prompt scroll a prompt to the top, the shell getting none of the keys', async () => {
  test.skip(process.platform === 'darwin', 'the AC names the Linux defaults')
  await launchWithShell('/bin/sh')
  await openDefaultShell()

  // 3 commands, each a marked prompt followed by 100 lines of output.
  await run(
    String.raw`for i in 1 2 3; do printf '\033]133;A\007$ p%s\033]133;B\007\n\033]133;C\007' $i; seq 1 100 | sed "s/^/out$i-/"; printf '\033]133;D;0\007'; done`
  )
  await expect.poll(async () => (await rows()).includes('out3-100')).toBe(true)
  const all = await rows()
  const prompt = (n: number): number => all.indexOf(`$ p${n}`)
  expect([1, 2, 3].map(prompt).every((row) => row >= 0)).toBe(true)
  const { bottom, rows: height } = await viewport()
  expect(height).toBeLessThan(100)
  await expect.poll(async () => (await viewport()).top).toBe(bottom)

  const PREVIOUS = 'Control+Shift+ArrowUp'
  const NEXT = 'Control+Shift+ArrowDown'
  await page.keyboard.press(PREVIOUS)
  await expect.poll(async () => (await viewport()).top).toBe(prompt(3))
  await page.keyboard.press(PREVIOUS)
  await expect.poll(async () => (await viewport()).top).toBe(prompt(2))
  await page.keyboard.press(NEXT)
  await expect.poll(async () => (await viewport()).top).toBe(prompt(3))
  await page.keyboard.press(NEXT)
  await expect.poll(async () => (await viewport()).top).toBe(bottom)
  // At the first prompt Previous does nothing, and the shell still gets nothing.
  for (let i = 0; i < 4; i++) await page.keyboard.press(PREVIOUS)
  await expect.poll(async () => (await viewport()).top).toBe(prompt(1))

  // None of the keys reached the shell: the line typed next runs as typed.
  await run('echo after-"jumps"')
  await expect.poll(async () => (await rows()).includes('after-jumps')).toBe(true)
  expect((await rows()).some((row) => row.includes('not found'))).toBe(false)

  // Not in the command palette (D5).
  await page.keyboard.press('Control+Shift+P')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await expect(palette).not.toContainText('Previous prompt')
  await expect(palette).not.toContainText('Next prompt')
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)

  // Recordable and Reset in Settings' Shortcuts section.
  const dialog = page.getByTestId('settings-dialog')
  const field = dialog.getByTestId('settings-shortcut-previousPrompt')
  await page.keyboard.press('Control+,')
  await dialog.getByTestId('settings-section-shortcuts').click()
  const group = dialog.getByRole('group', { name: 'Shortcuts' })
  await expect(group).toContainText('Previous prompt')
  await expect(group).toContainText('Next prompt')
  await expect(field).toHaveText('Ctrl+Shift+ArrowUp')
  await expect(dialog.getByTestId('settings-shortcut-nextPrompt')).toHaveText(
    'Ctrl+Shift+ArrowDown'
  )
  await field.click()
  await page.keyboard.press('Control+Shift+ArrowDown')
  await expect(dialog.getByTestId('settings-shortcut-error-previousPrompt')).toHaveText(
    'Already used by Next prompt'
  )
  await page.keyboard.press('Control+Alt+ArrowUp')
  await expect(field).toHaveText('Ctrl+Alt+ArrowUp')
  await expect
    .poll(() => readSettings())
    .toMatchObject({ settings: { shortcuts: { previousPrompt: 'Ctrl+Alt+ArrowUp' } } })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await page.getByTestId('card-view').getByTestId('terminal').click()
  await expect.poll(async () => (await viewport()).top).toBe((await viewport()).bottom)
  await page.keyboard.press('Control+Alt+ArrowUp')
  await expect.poll(async () => (await viewport()).top).toBe(prompt(3))

  await page.keyboard.press('Control+,')
  await dialog.getByTestId('settings-section-shortcuts').click()
  await dialog.getByTestId('settings-shortcut-reset-previousPrompt').click()
  await expect(field).toHaveText('Ctrl+Shift+ArrowUp')
  await expect.poll(() => JSON.stringify(readSettings())).not.toContain('previousPrompt')
})

/** Replaces the page's `Notification` with one recording each notification sent. */
async function stubNotifications(): Promise<void> {
  await page.evaluate(() => {
    const sent: { title: string; body: string; click: () => void }[] = []
    class Recorded {
      onclick: (() => void) | null = null
      constructor(title: string, options: { body: string }) {
        sent.push({ title, body: options.body, click: () => this.onclick?.() })
      }
    }
    Object.assign(window, { __sent: sent, Notification: Recorded })
  })
}

/** The notifications sent since `stubNotifications`, as title and body. */
function notifications(): Promise<{ title: string; body: string }[]> {
  return page.evaluate(() =>
    (window as unknown as { __sent: { title: string; body: string }[] }).__sent.map(
      ({ title, body }) => ({ title, body })
    )
  )
}

/** Pane `index`'s buffer in the open card or shell, one trimmed string per row. */
function paneRows(index: number): Promise<string[]> {
  return page.evaluate((index) => {
    const panes = document.querySelectorAll('[data-testid=card-view] [data-testid=pane]')
    const host = panes[index]?.querySelector('[data-testid=terminal]') as
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
    const out: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      out.push(buffer.getLine(i)?.translateToString(true) ?? '')
    }
    return out
  }, index)
}

/**
 * A command marked as running about 1 s, its `C` printed `delay` s after Enter, ending with exit
 * `code`, then `echo <done>` (quoted apart, so only its output matches).
 */
const longCommand = (delay: number, code: number, done: string): string =>
  String.raw`sleep ${delay}; printf '\033]133;C\007'; sleep 1; printf '\033]133;D;` +
  `${code}` +
  String.raw`\007'; echo ${done.slice(0, 2)}"${done.slice(2)}"`

test('AC7: a long command ending out of sight sends a notification; in the focused pane in view, or with Notifications off, none', async () => {
  // Commands of 0.5 s or more count (development build only), so the test needn't wait 10 s.
  await launchWithShell('/bin/sh', { DROVR_LONG_COMMAND_MS: '500' })
  await stubNotifications()
  await openDefaultShell()
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.focus())
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  const panes = page.getByTestId('card-view').getByTestId('pane')

  // Started in the extra pane, which loses the focus before it ends.
  await splitRight(page)
  await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true')
  await run(longCommand(1, 4, 'extra-done'))
  await panes.nth(0).click()
  await expect(panes.nth(0)).toHaveAttribute('data-focused', 'true')
  await expect.poll(async () => (await paneRows(1)).includes('extra-done')).toBe(true)
  await expect
    .poll(() => notifications())
    .toEqual([{ title: 'Default', body: 'Command failed (exit 4) · alpha' }])

  // Clicking it from the board opens the shell with that pane focused.
  await backToBoard(page)
  await page.evaluate(() =>
    (window as unknown as { __sent: { click: () => void }[] }).__sent[0]!.click()
  )
  await expectCardOpen(page, 'Default')
  await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true')

  // In the focused pane of the open shell, in the focused window: none.
  await panes.nth(0).click()
  await expect(panes.nth(0)).toHaveAttribute('data-focused', 'true')
  await run(longCommand(0, 4, 'main-done'))
  await expect.poll(async () => (await paneRows(0)).includes('main-done')).toBe(true)
  expect(await notifications()).toHaveLength(1)

  // With Notifications off: none, though the pane is out of sight.
  await page.keyboard.press('Control+,')
  const dialog = page.getByTestId('settings-dialog')
  await dialog.getByTestId('settings-section-agents').click()
  await dialog.getByTestId('settings-notifications').uncheck()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await panes.nth(1).click()
  await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true')
  await run(longCommand(1, 4, 'off-done'))
  await panes.nth(0).click()
  await expect(panes.nth(0)).toHaveAttribute('data-focused', 'true')
  await expect.poll(async () => (await paneRows(1)).includes('off-done')).toBe(true)
  expect(await notifications()).toHaveLength(1)
})

/** Pane `index`'s lines in the open card or shell, wrapped rows joined, each trimmed. */
function paneLines(index: number): Promise<string[]> {
  return page.evaluate((index) => {
    const panes = document.querySelectorAll('[data-testid=card-view] [data-testid=pane]')
    const host = panes[index]?.querySelector('[data-testid=terminal]') as
      | (HTMLElement & {
          __xterm?: {
            buffer: {
              active: {
                length: number
                getLine(
                  i: number
                ): { isWrapped: boolean; translateToString(trim: boolean): string } | undefined
              }
            }
          }
        })
      | null
    const buffer = host?.__xterm?.buffer.active
    if (!buffer) return []
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      const text = line?.translateToString(!buffer.getLine(i + 1)?.isWrapped) ?? ''
      if (line?.isWrapped && lines.length > 0) lines[lines.length - 1] += text
      else lines.push(text)
    }
    return lines.map((line) => line.trim())
  }, index)
}

/** Runs `echo at=<the shell's directory>` in the focused pane: its output reads `at=<dir>`. */
const printDirectory = (): Promise<void> => run('echo "a""t=$(pwd)"')

/** Splits right, prints the new pane's directory and closes it again, returning that directory. */
async function splitDirectory(): Promise<string> {
  const panes = page.getByTestId('card-view').getByTestId('pane')
  await splitRight(page)
  await expect(panes).toHaveCount(2)
  await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true')
  await printDirectory()
  let found = ''
  await expect
    .poll(async () => {
      found = (await paneLines(1)).find((line) => line.startsWith('at='))?.slice(3) ?? ''
      return found
    })
    .not.toBe('')
  await page.keyboard.press(SHORTCUTS.closePane)
  await expect(panes).toHaveCount(1)
  // The main pane's terminal has the keyboard again before the next typed line, or it is lost.
  await expect(panes.nth(0).locator('.xterm-helper-textarea')).toBeFocused()
  return found
}

test('AC8: a split starts in the directory the shell reported, unless it is gone or on another host', async () => {
  await launchWithShell('/bin/sh')
  await openDefaultShell()
  const own = [root, realpathSync(root)]

  // OSC 7 for /tmp, with this machine's host name.
  await run(String.raw`printf '\033]7;file://%s/tmp\007' "$(hostname)"; echo r"eported"`)
  await expect.poll(() => paneRows(0)).toContain('reported')
  expect(await splitDirectory()).toBe('/tmp')

  // A reported directory removed since: the shell's own directory, with no Couldn't start.
  const gone = join(root, 'gone')
  await run(String.raw`mkdir ${gone}; printf '\033]7;file://${gone}\007'; rmdir ${gone}`)
  await run('echo g"one"')
  await expect.poll(() => paneRows(0)).toContain('gone')
  expect(own).toContain(await splitDirectory())
  expect((await paneRows(0)).some((row) => row.includes("Couldn't start"))).toBe(false)

  // Another machine's /tmp: the shell's own directory.
  await run(String.raw`printf '\033]7;file://other-host.invalid/tmp\007'; echo o"ther"`)
  await expect.poll(() => paneRows(0)).toContain('other')
  expect(own).toContain(await splitDirectory())
})

test('AC8: with bash and Shell integration, a split after cd starts in that directory', async () => {
  await launchWithShell('/bin/bash')
  await openDefaultShell()
  await run('cd /tmp')
  // Its prompt reports the directory (OSC 7), before the next command's output.
  await run('echo c"d-done"')
  await expect.poll(async () => (await paneRows(0)).includes('cd-done')).toBe(true)
  expect(await splitDirectory()).toBe('/tmp')
})

// Copy command output (#60): the output of the command chosen by the viewport selected in the
// focused pane and copied, the shell getting none of the keys.

const darwin = process.platform === 'darwin'
/** Copy command output's default (#60 D5) as a Playwright press. */
const COPY_OUTPUT = darwin ? 'Meta+Shift+A' : 'Control+Shift+A'
const PREVIOUS_PROMPT = darwin ? 'Meta+ArrowUp' : 'Control+Shift+ArrowUp'

/**
 * A command marked as sh can't mark it, its output `body` (a printf format) between its `C` and
 * its `D;0`: the prompt `$ `, then the output from the same row.
 */
const markedOutput = (body: string): string =>
  String.raw`printf '\033]133;A\007$ \033]133;B\007\033]133;C\007` +
  body +
  String.raw`\033]133;D;0\007'`

/** Pane `index`'s selection in the open card or shell; '' for none. */
function paneSelection(index = 0): Promise<string> {
  return page.evaluate((index) => {
    const panes = document.querySelectorAll('[data-testid=card-view] [data-testid=pane]')
    const host = panes[index]?.querySelector('[data-testid=terminal]') as
      (HTMLElement & { __xterm?: { hasSelection(): boolean; getSelection(): string } }) | null
    const term = host?.__xterm
    return term?.hasSelection() ? term.getSelection() : ''
  }, index)
}

/** Runs `echo after-copy` (quoted apart) and waits for its output: no key reached the shell. */
async function shellGotNoKeys(): Promise<void> {
  await run('echo after-"copy"')
  await expect.poll(async () => (await rows()).includes('after-copy')).toBe(true)
  expect((await rows()).some((row) => row.includes('not found'))).toBe(false)
}

test("#60 AC2: Copy command output selects and copies the last command's output", async () => {
  await launchWithShell('/bin/sh')
  await openDefaultShell()
  await recordClipboardWrites(app!)
  await run(markedOutput(String.raw`one\ntwo\n`))
  await run(markedOutput(String.raw`three\n`))
  await expect.poll(async () => (await rows()).includes('$ three')).toBe(true)
  const { top } = await viewport()

  await page.keyboard.press(COPY_OUTPUT)
  await expect.poll(() => clipboardWrites(app!)).toEqual(['three'])
  expect(await paneSelection()).toBe('three')
  // The view does not scroll (D2).
  expect((await viewport()).top).toBe(top)

  // A selection like any other: Copy copies it again (D2).
  await page.keyboard.press(darwin ? 'Meta+C' : 'Control+Shift+C')
  await expect.poll(() => clipboardWrites(app!)).toEqual(['three', 'three'])
  await shellGotNoKeys()
})

test("#60 AC3: after Previous prompt, the output of the command at the viewport's top", async () => {
  await launchWithShell('/bin/sh')
  await openDefaultShell()
  await run(markedOutput(String.raw`one\ntwo\n`))
  // The second command's output: 100 lines, so the first one's prompt scrolls out of view.
  await run(
    String.raw`printf '\033]133;A\007$ \033]133;B\007\033]133;C\007'; seq 1 100 | sed 's/^/l/'; printf 'three\n\033]133;D;0\007'`
  )
  await expect.poll(async () => (await rows()).includes('three')).toBe(true)
  const first = (await rows()).indexOf('$ one')
  expect(first).toBeGreaterThanOrEqual(0)
  await expect.poll(async () => (await viewport()).top).toBe((await viewport()).bottom)

  await page.keyboard.press(PREVIOUS_PROMPT)
  await page.keyboard.press(PREVIOUS_PROMPT)
  await expect.poll(async () => (await viewport()).top).toBe(first)
  await recordClipboardWrites(app!)
  await page.keyboard.press(COPY_OUTPUT)
  await expect.poll(() => clipboardWrites(app!)).toEqual(['one\ntwo'])
  expect(await paneSelection()).toBe('one\ntwo')
  expect((await viewport()).top).toBe(first)
})

test('#60 AC4: with nothing to copy the clipboard and selection stay as they were', async () => {
  await launchWithShell('/bin/sh')
  await openDefaultShell()
  await run('echo no-"marks"')
  await expect.poll(async () => (await rows()).includes('no-marks')).toBe(true)
  await recordClipboardWrites(app!)

  await page.keyboard.press(COPY_OUTPUT)
  await page.waitForTimeout(300)
  expect(await clipboardWrites(app!)).toEqual([])
  expect(await paneSelection()).toBe('')

  // A marked command with empty output (its C and D together), then one printing empty lines.
  await run(markedOutput(''))
  await run(markedOutput(String.raw`\n\n`))
  await run('echo empty-"done"')
  await expect.poll(async () => (await rows()).includes('empty-done')).toBe(true)
  await page.keyboard.press(COPY_OUTPUT)
  await page.waitForTimeout(300)
  expect(await clipboardWrites(app!)).toEqual([])
  expect(await paneSelection()).toBe('')
  await shellGotNoKeys()
})

test("#60 AC5: in bash with Shell integration, a card's focused extra pane copies its command's output", async () => {
  await launchWithShell('/bin/bash')
  await page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    .getByTestId('new-card')
    .click()
  await page.getByTestId('new-card-input').fill('api')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'api')
  const panes = page.getByTestId('card-view').getByTestId('pane')
  await splitRight(page)
  await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true')
  await expect.poll(async () => (await paneRows(1)).some((row) => row.trim() !== '')).toBe(true)

  await run(String.raw`printf 'x\ny\n'`)
  await expect.poll(async () => (await paneRows(1)).includes('y')).toBe(true)
  await recordClipboardWrites(app!)
  await page.keyboard.press(COPY_OUTPUT)
  await expect.poll(() => clipboardWrites(app!)).toEqual(['x\ny'])
  expect(await paneSelection(1)).toBe('x\ny')
  expect(await paneSelection(0)).toBe('')
})

test("#60 AC7: with Find open, the selection is the command's output, not the match; with Copy on select it is copied once", async () => {
  await launchWithShell('/bin/sh')
  const dialog = page.getByTestId('settings-dialog')
  await page.getByTestId('settings-open').click()
  await dialog.getByTestId('settings-section-terminal').click()
  await dialog.getByTestId('settings-copy-on-select').check()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await openDefaultShell()
  await run(markedOutput(String.raw`\141lpha\nbeta\n`))
  await run(markedOutput(String.raw`\141lpha\ngamma\n`))
  await expect.poll(async () => (await rows()).includes('gamma')).toBe(true)
  await recordClipboardWrites(app!)

  await page.keyboard.press(darwin ? 'Meta+F' : 'Control+Shift+F')
  const input = page.getByTestId('find-input')
  await expect(input).toBeFocused()
  await input.fill('alpha')
  await expect(page.getByTestId('find-result')).toHaveText('2 of 2')
  // The first command's match active: the output copied next holds the other one.
  await input.press('Enter')
  await expect(page.getByTestId('find-result')).toHaveText('1 of 2')
  expect(await paneSelection()).toBe('alpha')

  await page.keyboard.press(COPY_OUTPUT)
  await expect.poll(() => clipboardWrites(app!)).toEqual(['alpha\ngamma'])
  expect(await paneSelection()).toBe('alpha\ngamma')
  // Find's highlights stay, and its next step selects its match again.
  await expect(
    page.locator('[data-testid=card-view] .xterm-find-result-decoration')
  ).not.toHaveCount(0)
  await expect(page.getByTestId('find-bar')).toBeVisible()
  // Upwards from the first match, not from the selected output: wrapping to the newest.
  await input.press('Enter')
  await expect(page.getByTestId('find-result')).toHaveText('2 of 2')
  expect(await paneSelection()).toBe('alpha')
  // Written once with Copy on select on (D2), and Find's selections never (#35 D9).
  await page.waitForTimeout(300)
  expect(await clipboardWrites(app!)).toEqual(['alpha\ngamma'])
})
