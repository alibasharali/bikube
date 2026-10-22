import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHORTCUTS, backToBoard, expectCardOpen, splitRight, zoomPane } from './card-view'
import { clipboardWrites, recordClipboardWrites } from './clipboard-writes'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'
import { showShells } from './shells-tab'

// A workspace's shells: the Default shell and named shells with a startup command, above the board.

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string
let dir: string

const darwin = process.platform === 'darwin'
const OPEN_SHELL = darwin ? 'Meta+T' : 'Control+Shift+T'

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-shells-'))
  dir = join(root, 'alpha')
  mkdirSync(dir)
  ;({ app, page, dataDir } = await launchApp())
  await createWorkspace()
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

async function createWorkspace(): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await showShells(page)
}

const shell = (name: string): Locator =>
  page.locator(`[data-testid="shell"][data-shell-name="${name}"]`)

/** The open terminal's buffer, one trimmed string per line. */
function lines(): Promise<string[]> {
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
    const out: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      out.push(buffer.getLine(i)?.translateToString(true).trim() ?? '')
    }
    return out
  })
}

async function newShell(name: string, command: string, autostart = false): Promise<void> {
  await page.getByTestId('shell-add').click()
  await page.getByTestId('shell-name').fill(name)
  await page.getByTestId('shell-command').fill(command)
  if (autostart) await page.getByTestId('shell-autostart').check()
  await page.getByTestId('shell-submit').click()
  await expect(page.getByTestId('shell-dialog')).toHaveCount(0)
}

async function shellMenu(name: string, action: string): Promise<void> {
  await shell(name).getByTestId('shell-menu').click()
  await page.getByTestId(`shell-menu-${action}`).click()
}

const running = (name: string): Promise<string | null> =>
  shell(name).getByTestId('shell-open').getAttribute('data-running')

test('the Default shell opens a plain shell in the workspace folder, also by its shortcut', async () => {
  await expect(page.getByTestId('shell')).toHaveCount(1)
  await shell('Default').getByTestId('shell-open').click()
  await expectCardOpen(page, 'Default')
  await expect(page.getByTestId('titlebar-shell-tag')).toHaveText('Shell')
  await page.getByTestId('card-view').getByTestId('terminal').click()
  await page.keyboard.type('echo "in=$PWD"')
  await page.keyboard.press('Enter')
  await expect.poll(lines).toContain(`in=${dir}`)
  await backToBoard(page)
  // Running: the board's own cards are untouched, and the shortcut brings it back.
  await expect(page.getByTestId('card')).toHaveCount(0)
  await expect.poll(() => running('Default')).toBe('true')
  await page.keyboard.press(OPEN_SHELL)
  await expectCardOpen(page, 'Default')
  await expect.poll(lines).toContain(`in=${dir}`)
})

test('a named shell types its command each time it starts; restart, close, edit and delete', async () => {
  await newShell('Dev server', 'echo serving-$((40+2))')
  await expect(shell('Dev server')).toContainText('echo serving-$((40+2))')
  await shell('Dev server').getByTestId('shell-open').click()
  await expectCardOpen(page, 'Dev server')
  await expect.poll(lines).toContain('serving-42')
  await backToBoard(page)

  // Close stops it; opening it again starts it and types the command again.
  await shellMenu('Dev server', 'close')
  await expect.poll(() => running('Dev server')).toBe('false')
  await shell('Dev server').getByTestId('shell-open').click()
  await expect.poll(async () => (await lines()).filter((l) => l === 'serving-42').length).toBe(1)
  await backToBoard(page)

  // Restart runs the command in a fresh shell.
  await shellMenu('Dev server', 'restart')
  await expect.poll(() => running('Dev server')).toBe('true')

  // Edit renames it and changes its command; saved.
  await shellMenu('Dev server', 'edit')
  await page.getByTestId('shell-name').fill('Web')
  await page.getByTestId('shell-command').fill('echo web')
  await page.getByTestId('shell-submit').click()
  await expect(shell('Web')).toContainText('echo web')
  const saved = (): string => readFileSync(join(dataDir, 'bikube-state.json'), 'utf8')
  await expect.poll(saved).toContain('"name":"Web","command":"echo web"')

  // Delete asks while it runs, then it's gone.
  await shellMenu('Web', 'delete')
  await page.getByTestId('confirm-delete').click()
  await expect(shell('Web')).toHaveCount(0)
  await expect(page.getByTestId('shell')).toHaveCount(1)
})

test('a trigger runs its command in the background and shows done or failed; a click while it runs opens it', async () => {
  // A trigger needs a command.
  await page.getByTestId('shell-add').click()
  const dialog = page.getByTestId('shell-dialog')
  await expect(dialog.getByTestId('shell-type-shell')).toBeChecked()
  await dialog.getByTestId('shell-type-trigger').check()
  await expect(dialog.getByTestId('shell-type-hint')).toContainText(
    'runs the command in the background'
  )
  await dialog.getByTestId('shell-name').fill('Build')
  await dialog.getByTestId('shell-submit').click()
  await expect(dialog.getByTestId('shell-error-command')).toHaveText('A trigger needs a command')
  await dialog.getByTestId('shell-command').fill('sleep 1; echo built-$((40+2))')
  await dialog.getByTestId('shell-submit').click()
  await expect(dialog).toHaveCount(0)
  const status = shell('Build').getByTestId('trigger-status')
  await expect(shell('Build').getByTestId('shell-open')).toHaveAttribute('data-type', 'trigger')
  await expect(status).toHaveAttribute('data-status', 'idle')
  // Shown as typed, without the `; exit`.
  await expect(shell('Build')).toContainText('sleep 1; echo built-$((40+2))')

  // A click runs it out of sight and out of the sidebar, then it is done with its last line.
  const tree = page.getByTestId('workspace-terminal')
  await shell('Build').getByTestId('shell-open').click()
  await expect(status).toHaveAttribute('data-status', 'running')
  await expect(page.getByTestId('card-view')).toHaveCount(0)
  await expect(tree).toHaveCount(0)
  await expect(status).toHaveAttribute('data-status', 'done', { timeout: 10_000 })
  await expect(status).toHaveAttribute('title', 'Done: built-42')
  await expect.poll(() => running('Build')).toBe('false')

  // A failing command: failed, with its exit code and last line; a click runs it again.
  await shellMenu('Build', 'edit')
  await expect(dialog.getByTestId('shell-type-trigger')).toBeChecked()
  await dialog.getByTestId('shell-command').fill('echo step-$((0+1)); echo broke-$((1+1)); false')
  await dialog.getByTestId('shell-submit').click()
  await expect(shell('Build').getByTestId('trigger-failure')).toHaveCount(0)
  await shell('Build').getByTestId('shell-open').click()
  await expect(status).toHaveAttribute('data-status', 'failed', { timeout: 10_000 })
  await expect(status).toHaveAttribute('title', 'Failed (exit 1): broke-2')
  // Its last line shows under the row; a click opens what it printed, from the typed line on.
  const failure = shell('Build').getByTestId('trigger-failure')
  await expect(failure.getByTestId('trigger-failure-line')).toHaveText('broke-2')
  await failure.getByTestId('trigger-failure-toggle').click()
  const outputDialog = page.getByTestId('trigger-failure-dialog')
  await expect(outputDialog.getByRole('heading')).toHaveText('Build: Failed (exit 1)')
  await expect(outputDialog.getByTestId('trigger-failure-command')).toHaveText(
    'echo step-$((0+1)); echo broke-$((1+1)); false'
  )
  await expect(outputDialog.getByTestId('trigger-failure-output')).toHaveText('step-1\nbroke-2')
  await outputDialog.getByTestId('trigger-failure-close').click()
  await expect(outputDialog).toHaveCount(0)

  // A command that printed nothing says so, and shows nothing printed before it.
  await shellMenu('Build', 'edit')
  await dialog.getByTestId('shell-command').fill('false')
  await dialog.getByTestId('shell-submit').click()
  await shell('Build').getByTestId('shell-open').click()
  await expect(failure.getByTestId('trigger-failure-line')).toHaveText('Failed (exit 1)', {
    timeout: 10_000
  })
  await failure.getByTestId('trigger-failure-toggle').click()
  await expect(outputDialog.getByTestId('trigger-failure-empty')).toHaveText('It printed nothing.')
  await page.keyboard.press('Escape')
  await expect(outputDialog).toHaveCount(0)

  // While it runs, a click opens it, and from then on it is in the sidebar.
  await shellMenu('Build', 'edit')
  await dialog.getByTestId('shell-command').fill('echo waiting-$((40+3)); sleep 30')
  await dialog.getByTestId('shell-submit').click()
  await shell('Build').getByTestId('shell-open').click()
  await expect(status).toHaveAttribute('data-status', 'running')
  await expect(failure).toHaveCount(0)
  await shell('Build').getByTestId('shell-open').click()
  await expectCardOpen(page, 'Build')
  await expect.poll(lines).toContain('waiting-43')
  await backToBoard(page)
  await expect(tree).toHaveText(['Build'])

  // Closed, it is idle again, not failed.
  await shellMenu('Build', 'close')
  await expect(status).toHaveAttribute('data-status', 'idle')
})

test('Close pane in a shell asks to close it on the first press', async () => {
  await newShell('Dev', 'echo dev-$((40+2))')
  await shell('Dev').getByTestId('shell-open').click()
  await expectCardOpen(page, 'Dev')
  await expect.poll(lines).toContain('dev-42')
  // One press: the modifier's keydown re-renders the view before the key's (a shell's card is
  // built anew each render), which must not drop the shortcut.
  await page.keyboard.press(SHORTCUTS.closePane)
  await expect(page.getByTestId('confirm-close')).toBeVisible()
  await page.getByTestId('confirm-close').click()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect.poll(() => running('Dev')).toBe('false')
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

const notifications = (): Promise<{ title: string; body: string }[]> =>
  page.evaluate(() =>
    (window as unknown as { __sent: { title: string; body: string }[] }).__sent.map(
      ({ title, body }) => ({ title, body })
    )
  )

test("a failed trigger's dialog shows all it printed, copies it and runs it again; a failure out of sight notifies", async () => {
  await recordClipboardWrites(app!)
  await stubNotifications()
  await page.getByTestId('shell-add').click()
  const dialog = page.getByTestId('shell-dialog')
  await dialog.getByTestId('shell-type-trigger').check()
  await dialog.getByTestId('shell-name').fill('Test')
  // More lines than the screen holds; the typed line holds none of them.
  await dialog
    .getByTestId('shell-command')
    .fill("seq 1 150 | sed 's/^/line-/'; echo boom-$((6*7)); sleep 1; false")
  await dialog.getByTestId('shell-submit').click()
  await expect(dialog).toHaveCount(0)

  // Run with the Shells tab in view: no notification.
  const status = shell('Test').getByTestId('trigger-status')
  await shell('Test').getByTestId('shell-open').click()
  await expect(status).toHaveAttribute('data-status', 'failed', { timeout: 10_000 })
  const failure = shell('Test').getByTestId('trigger-failure')
  await expect(failure.getByTestId('trigger-failure-line')).toHaveText('boom-42')
  expect(await notifications()).toEqual([])

  // Every line, from the first, scrolled to the end; Copy copies them.
  await failure.getByTestId('trigger-failure-toggle').click()
  const output = page.getByTestId('trigger-failure-output')
  const expected = [...Array.from({ length: 150 }, (_, i) => `line-${i + 1}`), 'boom-42'].join('\n')
  await expect(output).toHaveText(expected)
  await expect
    .poll(() =>
      output.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2)
    )
    .toBe(true)
  await page.getByTestId('trigger-failure-copy').click()
  await expect(page.getByTestId('trigger-failure-copy')).toHaveText('Copied')
  await expect.poll(() => clipboardWrites(app!)).toEqual([expected])

  // Run again closes the dialog and runs it; with the Files tab showing, its failure notifies.
  await page.getByTestId('trigger-failure-run').click()
  await expect(page.getByTestId('trigger-failure-dialog')).toHaveCount(0)
  await expect(status).toHaveAttribute('data-status', 'running')
  await page.getByTestId('side-panel-tab-files').click()
  await expect
    .poll(notifications, { timeout: 10_000 })
    .toEqual([{ title: 'Test', body: 'Failed (exit 1) · alpha\nboom-42' }])

  // Its click shows the Shells tab with the output open.
  await page.evaluate(() =>
    (window as unknown as { __sent: { click: () => void }[] }).__sent[0].click()
  )
  await expect(page.getByTestId('side-panel-tab-shells')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('trigger-failure-dialog')).toBeVisible()
  await expect(output).toContainText('boom-42')
})

test('a shell must have a name and a one-line command; the Default one has no edit or delete', async () => {
  await page.getByTestId('shell-add').click()
  await page.getByTestId('shell-submit').click()
  await expect(page.getByTestId('shell-error-name')).toHaveText('Name is required')
  await page.getByTestId('shell-cancel').click()
  await shell('Default').getByTestId('shell-menu').click()
  await expect(page.getByTestId('shell-menu-edit')).toHaveCount(0)
  await expect(page.getByTestId('shell-menu-delete')).toHaveCount(0)
})

test('a shell set to start with the workspace starts when the app opens it, and shells are kept', async () => {
  await newShell('Watcher', 'echo watching', true)
  await expect(shell('Watcher')).toBeVisible()
  await app!.close()
  ;({ app, page } = await launchApp({ dataDir }))
  await expect(shell('Watcher')).toBeVisible()
  await expect.poll(() => running('Watcher')).toBe('true')
  await expect.poll(() => running('Default')).toBe('false')
})

test('the title bar shows the workspace folder, and the board has no header of its own', async () => {
  await expect(page.getByTestId('board-location')).toBeVisible()
  await expect(page.getByTestId('board-location')).toHaveAttribute('title', new RegExp(`^${dir}`))
  await expect(page.locator('.board-header')).toHaveCount(0)
  // New workspaces get the task columns.
  await expect(page.getByRole('heading', { name: 'In Progress' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible()
  // The Shell choice is gone from new cards.
  await page.getByTestId('column').first().getByTestId('new-card').click()
  // Read by value: an agent the login shell lacks reads `(not installed)`.
  const options = await page
    .getByTestId('new-card-startup')
    .locator('option')
    .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value))
  expect(options).not.toContain('shell')
  expect(options[0]).toBe('claude')
})

test('#48 AC7: the Default shell split into 2 panes zooms its focused pane and restores it', async () => {
  await page.keyboard.press(OPEN_SHELL)
  await expectCardOpen(page, 'Default')
  const panes = page.getByTestId('card-view').getByTestId('pane')
  const chip = page.getByTestId('card-view').getByTestId('pane-zoom')
  await expect(panes).toHaveCount(1)
  await splitRight(page)
  await expect(panes).toHaveCount(2)
  await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true')

  await zoomPane(page)
  await expect(chip).toHaveText('Zoomed · 2 panes')
  await expect(panes.nth(0)).toBeHidden()
  await expect(panes.nth(1)).toBeVisible()
  await zoomPane(page)
  await expect(chip).toHaveCount(0)
  await expect(panes.nth(0)).toBeVisible()
  await expect(panes.nth(1)).toBeVisible()
  await expect(panes.nth(1)).toHaveAttribute('data-focused', 'true')
})

test('a shell and a trigger show their type, and a trigger turned into a shell opens on a click', async () => {
  await page.getByTestId('shell-add').click()
  const dialog = page.getByTestId('shell-dialog')
  await dialog.getByTestId('shell-type-trigger').check()
  await dialog.getByTestId('shell-name').fill('Watcher')
  await dialog.getByTestId('shell-command').fill('echo watching-$((40+2)); sleep 30')
  await dialog.getByTestId('shell-submit').click()
  await expect(dialog).toHaveCount(0)
  await expect(shell('Default').getByTestId('shell-open')).toHaveAttribute('data-type', 'shell')
  await expect(shell('Default').getByTestId('trigger-status')).toHaveCount(0)
  await expect(shell('Watcher').getByTestId('trigger-status')).toHaveCount(1)

  await shellMenu('Watcher', 'edit')
  await dialog.getByTestId('shell-type-shell').check()
  await dialog.getByTestId('shell-submit').click()
  await expect(shell('Watcher').getByTestId('shell-open')).toHaveAttribute('data-type', 'shell')
  await shell('Watcher').getByTestId('shell-open').click()
  await expectCardOpen(page, 'Watcher')
  await expect.poll(lines).toContain('watching-42')
})

test('with the panel hidden, the title bar counts running shells and opens the Shells tab', async () => {
  const chip = page.getByTestId('titlebar-shells')
  await shell('Default').getByTestId('shell-start').click()
  await expect.poll(() => running('Default')).toBe('true')
  // Shown only while the panel is hidden.
  await expect(chip).toHaveCount(0)
  await page.getByTestId('side-panel-tab-files').click()
  await page.getByTestId('titlebar-panel').click()
  await expect(page.getByTestId('side-panel')).toHaveCount(0)
  await expect(chip).toHaveText('1 shell')
  await expect(chip).toHaveAttribute('title', 'Running: Default shell. Show them in the panel')
  await chip.click()
  await expect(page.getByTestId('side-panel')).toBeVisible()
  await expect(page.getByTestId('side-panel-tab-shells')).toHaveAttribute('aria-selected', 'true')
  await expect(chip).toHaveCount(0)

  // Nothing running, nothing shown.
  await shell('Default').getByTestId('shell-stop').click()
  await expect.poll(() => running('Default')).toBe('false')
  await page.getByTestId('titlebar-panel').click()
  await expect(chip).toHaveCount(0)
})
