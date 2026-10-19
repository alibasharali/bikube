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
