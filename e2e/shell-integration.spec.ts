import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, expectCardOpen } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Shell integration (#45): the marks a shell sends around its prompts and commands (OSC 133,
// OSC 633, OSC 7), and what Drovr shows from them: a failed command's mark on its line (D6).

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

/** Launches with the Shell setting `shell`, and a workspace on `root` with plain cards. */
async function launchWithShell(shell: string): Promise<void> {
  dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'drovr-settings.json'),
    JSON.stringify({ version: 1, settings: { shell } })
  )
  ;({ app, page } = await launchApp({ dataDir }))
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
