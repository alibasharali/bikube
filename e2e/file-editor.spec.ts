import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { backToBoard, expectCardOpen, NEW_SHELL } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The file editor (#83): a file opened from the main window's Files tab shows in the workspace's
// editor view, one tab per file, with a sidebar row each; pictures, binary and too-large files
// show what they are with Open in <editor>.

let app: ElectronApplication | undefined
let page: Page
let root: string
let folder: string

/** A plain PNG: 1×1, one pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikube-editor-'))
  folder = join(root, 'proj')
  const files: Record<string, string | Buffer> = {
    'src/a.ts': "export const a = 'hello'\n",
    'b.md': '# Notes\n',
    'pic.png': PNG,
    'bin.dat': Buffer.from([0x61, 0x00, 0x62]),
    'big.log': Buffer.alloc(6 * 1024 * 1024, 'x')
  }
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true })
    writeFileSync(join(folder, path), body)
  }
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

const editorLog = (): string => join(root, 'editors.log')
const editorRuns = (): string[] =>
  existsSync(editorLog()) ? readFileSync(editorLog(), 'utf8').trimEnd().split('\n') : []

/**
 * Launches with a login shell (`/bin/sh -l`) whose PATH is a fake `bin` holding a fake `code`
 * that logs its arguments, and the system folders, so a real editor never runs.
 */
async function launch(): Promise<void> {
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  mkdirSync(home, { recursive: true })
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(home, '.profile'), `PATH='${bin}':/usr/bin:/bin; export PATH\n`)
  writeFileSync(
    join(bin, 'code'),
    `#!/bin/sh\n{ echo "run $(basename "$0")"; printf '%s\\n' "$@"; } >> '${editorLog()}'\n`
  )
  chmodSync(join(bin, 'code'), 0o755)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  ;({ app, page } = await launchApp({
    dataDir: newDataDir(),
    env: { ...env, SHELL: '/bin/sh', HOME: home, BIKUBE_HOME_DIR: home }
  }))
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(folder)
  await page.getByTestId('workspace-name').fill('proj')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

const filesTab = (): Locator => page.getByTestId('side-panel').getByTestId('files-tab')
const row = (path: string): Locator =>
  filesTab().locator(`[data-testid=files-row][data-path="${path}"]`)
const editor = (): Locator => page.getByTestId('file-editor')
const tabs = (): Locator => editor().getByTestId('file-editor-tab')
const activeTab = (): Locator =>
  editor().locator('[data-testid=file-editor-tab][aria-selected=true]')
const fileRows = (): Locator => page.getByTestId('sidebar').getByTestId('workspace-file')

/** Opens `path` from the Files tab with a double-click, expanding `src` first when needed. */
async function openFromFiles(path: string): Promise<void> {
  if (path.startsWith('src/') && (await row('src/a.ts').count()) === 0) await row('src').dblclick()
  await row(path).dblclick()
}

/** The computed colour of the first token span in the editor whose text is `text`. */
const tokenColour = (text: string): Promise<string> =>
  editor()
    .locator('.cm-content span', { hasText: text })
    .first()
    .evaluate((span) => getComputedStyle(span).color)

test('AC1: a double-click or Enter in the Files tab opens the file in the editor, not VS Code', async () => {
  await launch()
  // The terminal's font, as its xterm has it.
  await page.keyboard.press(NEW_SHELL)
  await expectCardOpen(page, 'Terminal 1')
  const font = await page.evaluate(() => {
    const host = document.querySelector('[data-testid=card-view] [data-testid=terminal]') as
      (HTMLElement & { __xterm?: { options: { fontFamily: string; fontSize: number } } }) | null
    return { family: host!.__xterm!.options.fontFamily, size: host!.__xterm!.options.fontSize }
  })
  await backToBoard(page)

  await openFromFiles('src/a.ts')
  await expect(editor()).toBeVisible()
  await expect(page.getByTestId('board')).toHaveCount(0)
  await expect(tabs()).toHaveCount(1)
  await expect(activeTab()).toContainText('a.ts')
  await expect(editor().locator('.cm-content')).toHaveText("export const a = 'hello'")
  await expect(
    editor().locator('.cm-lineNumbers .cm-gutterElement', { hasText: '1' })
  ).toBeVisible()
  // TypeScript's highlighting, loaded lazily: a keyword and a string in different colours.
  await expect.poll(() => tokenColour('const')).not.toBe(await tokenColour('hello'))
  const keyword = await tokenColour('const')
  expect(keyword).not.toBe(await tokenColour("'hello'"))
  const content = await editor()
    .locator('.cm-content')
    .evaluate((e) => ({
      family: getComputedStyle(e).fontFamily,
      size: getComputedStyle(e).fontSize
    }))
  expect(content.size).toBe(`${font.size}px`)
  expect(content.family.replace(/\s+/g, '')).toBe(font.family.replace(/\s+/g, ''))

  // Its sidebar row, under the workspace, marked current.
  await expect(fileRows()).toHaveText(['a.ts'])
  await expect(fileRows().first()).toHaveAttribute('aria-current', 'true')
  await expect(fileRows().first()).toHaveAttribute('title', 'src/a.ts')

  // Enter on the selected file in the tree does the same: the one tab, in front.
  await row('src/a.ts').click()
  await page.keyboard.press('Enter')
  await expect(tabs()).toHaveCount(1)
  await page.waitForTimeout(500)
  expect(editorRuns()).toEqual([])
})

test('AC3: tabs and sidebar rows, a row bringing the editor back after a card, Back to the board', async () => {
  await launch()
  await openFromFiles('src/a.ts')
  await expect(activeTab()).toContainText('a.ts')
  await openFromFiles('b.md')
  await expect(activeTab()).toContainText('b.md')
  await openFromFiles('src/a.ts')
  await expect(tabs()).toHaveCount(2)
  await expect(tabs()).toContainText(['a.ts', 'b.md'])
  await expect(activeTab()).toContainText('a.ts')
  await expect(fileRows()).toHaveText(['a.ts', 'b.md'])
  await expect(fileRows().nth(0)).toHaveAttribute('aria-current', 'true')

  await fileRows().nth(1).click()
  await expect(activeTab()).toContainText('b.md')
  await expect(editor().locator('.cm-content')).toHaveText('# Notes')
  await expect(fileRows().nth(1)).toHaveAttribute('aria-current', 'true')

  // A card opened, then a's row: the editor back with both tabs.
  await page.keyboard.press(NEW_SHELL)
  await expectCardOpen(page, 'Terminal 1')
  await expect(editor()).toHaveCount(0)
  await expect(fileRows().nth(0)).not.toHaveAttribute('aria-current', 'true')
  await fileRows().nth(0).click()
  await expect(editor()).toBeVisible()
  await expect(tabs()).toHaveCount(2)
  await expect(activeTab()).toContainText('a.ts')

  // Back: the board, both rows still listed.
  await backToBoard(page)
  await expect(editor()).toHaveCount(0)
  await expect(fileRows()).toHaveText(['a.ts', 'b.md'])

  // The view's close button closes every tab: the board, no rows.
  await fileRows().nth(1).click()
  await editor().getByTestId('file-editor-close').click()
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(fileRows()).toHaveCount(0)
})

test('AC8: a picture, a binary and a too-large file, each with Open in VS Code', async () => {
  await launch()
  const openExternal = editor().getByTestId('file-editor-open-external')

  await openFromFiles('pic.png')
  const image = editor().getByTestId('file-editor-image')
  await expect(image).toBeVisible()
  expect(await image.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  await expect(openExternal).toHaveText('Open in VS Code')
  await openExternal.click()
  await expect.poll(editorRuns).toEqual(['run code', folder, join(folder, 'pic.png')])

  await openFromFiles('bin.dat')
  await expect(editor().getByTestId('file-editor-message')).toHaveText('Binary file')
  await openExternal.click()
  await expect
    .poll(() => editorRuns().slice(3))
    .toEqual(['run code', folder, join(folder, 'bin.dat')])

  await openFromFiles('big.log')
  await expect(editor().getByTestId('file-editor-message')).toHaveText(
    'Too large to open here (6.0 MB)'
  )
  await openExternal.click()
  await expect
    .poll(() => editorRuns().slice(6))
    .toEqual(['run code', folder, join(folder, 'big.log')])
})

test('AC2: a file row ⋯ menu, by hover or right-click, opens it in VS Code with no tab', async () => {
  await launch()
  await row('src').dblclick()
  const a = row('src/a.ts')
  await expect(a).toBeVisible()
  const menuButton = a.getByTestId('files-row-menu')
  // Folders have none; the menu is there for files only.
  await expect(row('src').getByTestId('files-row-menu')).toHaveCount(0)

  // Hover shows the ⋯; its item reads Settings > Editor's choice.
  const opacity = (button: Locator): Promise<string> =>
    button.evaluate((e) => getComputedStyle(e).opacity)
  await page.mouse.move(0, 0)
  await expect.poll(() => opacity(menuButton)).toBe('0')
  await a.hover()
  await expect.poll(() => opacity(menuButton)).toBe('1')
  await menuButton.click()
  const item = page.getByTestId('files-row-open-external')
  await expect(item).toHaveText('Open in VS Code')
  await item.click()
  await expect.poll(editorRuns).toEqual(['run code', folder, join(folder, 'src', 'a.ts')])
  await expect(editor()).toHaveCount(0)
  await expect(fileRows()).toHaveCount(0)

  // A right-click opens the same menu.
  await row('b.md').click({ button: 'right' })
  await expect(row('b.md').getByTestId('files-row-menu')).toHaveAttribute('aria-expanded', 'true')
  await page.getByTestId('files-row-open-external').click()
  await expect.poll(() => editorRuns().slice(3)).toEqual(['run code', folder, join(folder, 'b.md')])
  await expect(editor()).toHaveCount(0)
  await expect(page.getByTestId('board')).toBeVisible()

  // From the keyboard: Tab from the focused row reaches its ⋯; Enter opens the menu, not the file.
  await row('b.md').click()
  await page.keyboard.press('Tab')
  await expect(row('b.md').getByTestId('files-row-menu')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('files-row-open-external')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(row('b.md').getByTestId('files-row-menu')).toBeFocused()
  await expect(page.getByTestId('files-row-open-external')).toHaveCount(0)
  await page.waitForTimeout(300)
  await expect(editor()).toHaveCount(0)
})

test('AC2, AC13: a card window keeps the external editor; editor IPC from it or a subframe is refused', async () => {
  await launch()
  await page.keyboard.press(NEW_SHELL)
  await expectCardOpen(page, 'Terminal 1')
  const opened = app!.waitForEvent('window')
  await page.getByTestId('titlebar-open-in-window').click()
  const cardPage = await opened
  const cardRow = (path: string): Locator =>
    cardPage.getByTestId('side-panel').locator(`[data-testid=files-row][data-path="${path}"]`)
  await expect(cardRow('b.md')).toBeVisible()

  // A double-click runs VS Code there: the card window has no editor view (D2, D5).
  await cardRow('b.md').dblclick()
  await expect.poll(editorRuns).toEqual(['run code', folder, join(folder, 'b.md')])
  // Its ⋯ menu is the same.
  await cardRow('pic.png').click({ button: 'right' })
  await cardPage.getByTestId('files-row-open-external').click()
  await expect
    .poll(() => editorRuns().slice(3))
    .toEqual(['run code', folder, join(folder, 'pic.png')])
  await expect(page.getByTestId('file-editor')).toHaveCount(0)
  await expect(fileRows()).toHaveCount(0)

  // Main's own editor handlers, asked from the card window's frame and from a subframe of the
  // main window: each refused before anything is read or written (D6, AC13). A card window has
  // no preload, so the request is handed to the registered handler with that frame as sender.
  await page.evaluate(() => {
    const frame = document.createElement('iframe')
    frame.setAttribute('data-testid', 'e2e-subframe')
    frame.srcdoc = '<p>sub</p>'
    document.body.append(frame)
  })
  await expect
    .poll(() =>
      app!.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find(
          (w) => !w.webContents.getURL().startsWith('about:')
        )
        return main?.webContents.mainFrame.frames.length ?? 0
      })
    )
    .toBeGreaterThan(0)
  const target = join(folder, 'b.md')
  const answers = await app!.evaluate(
    async ({ BrowserWindow, ipcMain }, { folder, target }) => {
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>
        }
      )._invokeHandlers
      const windows = BrowserWindow.getAllWindows()
      const card = windows.find((w) => w.webContents.getURL().startsWith('about:'))!
      const main = windows.find((w) => w !== card)!
      const senders = [
        { sender: card.webContents, senderFrame: card.webContents.mainFrame },
        { sender: main.webContents, senderFrame: main.webContents.mainFrame.frames[0] }
      ]
      const ref = { kind: 'folder', folder, path: 'b.md' }
      const write = {
        text: 'gone',
        eol: 'lf',
        bom: false,
        base: { size: 0, mtimeMs: 0, sha256: '' }
      }
      const calls: [string, unknown[]][] = [
        ['editor:read', [ref]],
        ['editor:stat', [ref]],
        ['editor:write', [ref, write]],
        ['editor:read', [{ kind: 'listed', folder, path: target }]]
      ]
      const out: string[] = []
      for (const event of senders) {
        for (const [channel, args] of calls) {
          try {
            await handlers.get(channel)!(event, ...args)
            out.push(`${channel} answered`)
          } catch (error) {
            out.push(String((error as Error).message))
          }
        }
      }
      // The main window's own frame is answered, so the refusals above are the sender check's.
      const own = (await handlers.get('editor:read')!(
        { sender: main.webContents, senderFrame: main.webContents.mainFrame },
        ref
      )) as { kind: string }
      out.push(`own ${own.kind}`)
      return out
    },
    { folder, target }
  )
  expect(answers).toEqual([
    ...['editor:read', 'editor:stat', 'editor:write', 'editor:read'].map(
      (channel) => `${channel} rejected: untrusted sender`
    ),
    ...['editor:read', 'editor:stat', 'editor:write', 'editor:read'].map(
      (channel) => `${channel} rejected: untrusted sender`
    ),
    'own text'
  ])
  expect(readFileSync(target, 'utf8')).toBe('# Notes\n')
})
