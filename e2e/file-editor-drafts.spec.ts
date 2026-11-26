import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The file editor's drafts (#83 D11, D13): a dirty tab's text is kept on this machine across a
// quit, never in the state or sync file, and a file deleted under a tab shows `Deleted on disk`.

let app: ElectronApplication | undefined
let page: Page
let dataDir: string
let root: string
let folder: string

const A_TEXT = "export const a = 'hello'\n"

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikube-editor-keep-'))
  folder = join(root, 'proj')
  for (const [path, body] of Object.entries({ 'src/a.ts': A_TEXT, 'b.md': '# Notes\n' })) {
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

/** Launches on `dataDir` (a fresh one the first time). */
async function launch(): Promise<void> {
  ;({ app, page, dataDir } = await launchApp(dataDir ? { dataDir } : {}))
}

async function createWorkspace(): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(folder)
  await page.getByTestId('workspace-name').fill('proj')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

const darwin = process.platform === 'darwin'
const SAVE = darwin ? 'Meta+s' : 'Control+s'
const filesTab = (): Locator => page.getByTestId('side-panel').getByTestId('files-tab')
const row = (path: string): Locator =>
  filesTab().locator(`[data-testid=files-row][data-path="${path}"]`)
const editor = (): Locator => page.getByTestId('file-editor')
const code = (): Locator => editor().locator('.cm-content')
const tabDirty = (): Locator => editor().getByTestId('file-editor-tab-dirty')
const bar = (): Locator => editor().getByTestId('file-editor-bar')
const fileRows = (): Locator => page.getByTestId('sidebar').getByTestId('workspace-file')
const draftsDir = (): string => join(dataDir, 'drafts')
const drafts = (): string[] => (existsSync(draftsDir()) ? readdirSync(draftsDir()) : [])
const mode = (path: string): number => statSync(path).mode & 0o777

async function openFromFiles(path: string): Promise<void> {
  if (path.startsWith('src/') && (await row('src/a.ts').count()) === 0) await row('src').dblclick()
  await row(path).dblclick()
}

async function typeAtStart(text: string): Promise<void> {
  await code().locator('.cm-line').first().click()
  await page.keyboard.press(darwin ? 'Meta+ArrowUp' : 'Control+Home')
  await page.keyboard.type(text)
}

test('AC9: a dirty tab’s draft survives a quit, only on this machine; saving deletes it', async () => {
  dataDir = ''
  await launch()
  // A Sync folder, so the sync file holds the board (#13).
  const sync = join(root, 'sync')
  mkdirSync(sync)
  const syncFile = join(sync, 'bikube-board.json')
  const settings = page.getByTestId('settings-dialog')
  await page.getByTestId('settings-open').click()
  await settings.getByTestId('settings-section-sync').click()
  await settings.getByTestId('settings-sync-folder').fill(sync)
  await settings.getByTestId('settings-sync-folder').press('Enter')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toHaveCount(0)
  await createWorkspace()
  await expect
    .poll(() => (existsSync(syncFile) ? readFileSync(syncFile, 'utf8') : ''))
    .toContain('"proj"')

  await openFromFiles('src/a.ts')
  await openFromFiles('b.md')
  await expect(fileRows()).toHaveText(['a.ts', 'b.md'])
  await fileRows().nth(0).click()
  await typeAtStart('draft')
  await expect(tabDirty()).toBeVisible()
  // Quit at once, well inside the 2 s: the quit save writes the draft.
  await app!.close()
  app = undefined

  expect(readFileSync(join(folder, 'src', 'a.ts'), 'utf8')).toBe(A_TEXT)
  expect(mode(draftsDir())).toBe(0o700)
  expect(drafts()).toHaveLength(1)
  expect(mode(join(draftsDir(), drafts()[0]))).toBe(0o600)
  expect(readFileSync(join(draftsDir(), drafts()[0]), 'utf8')).toContain('draft')
  for (const file of [join(dataDir, 'bikube-state.json'), syncFile]) {
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('"proj"')
    expect(text).not.toContain('draft')
  }

  await launch()
  // The board in front, only a.ts in the sidebar, dirty.
  await expect(page.getByTestId('board')).toBeVisible()
  await expect(editor()).toHaveCount(0)
  await expect(fileRows()).toHaveText(['a.ts'])
  await expect(fileRows().getByTestId('workspace-file-dirty')).toBeVisible()
  await fileRows().nth(0).click()
  await expect(code()).toHaveText("draftexport const a = 'hello'")
  await expect(tabDirty()).toBeVisible()
  await expect(bar()).toHaveCount(0)
  expect(readFileSync(join(folder, 'src', 'a.ts'), 'utf8')).toBe(A_TEXT)

  // Saving writes it and deletes the draft.
  await code().locator('.cm-line').first().click()
  await page.keyboard.press(SAVE)
  await expect(tabDirty()).toHaveCount(0)
  await expect.poll(() => readFileSync(join(folder, 'src', 'a.ts'), 'utf8')).toBe('draft' + A_TEXT)
  await expect.poll(drafts).toEqual([])
})

test('AC9: a draft saved 2 s after the edit, whose file changed before the next launch, shows the bar', async () => {
  dataDir = ''
  await launch()
  await createWorkspace()
  await openFromFiles('src/a.ts')
  await typeAtStart('mine')
  // Written 2 s after the last edit, before any quit.
  await expect.poll(drafts, { timeout: 5000 }).toHaveLength(1)
  await app!.close()
  app = undefined
  writeFileSync(join(folder, 'src', 'a.ts'), 'outside\n')

  await launch()
  await expect(fileRows()).toHaveText(['a.ts'])
  await fileRows().nth(0).click()
  await expect(code()).toHaveText("mineexport const a = 'hello'")
  await expect(bar()).toHaveText(/a\.ts changed on disk/)
  // Reload drops the draft: the disk text, clean, no draft kept.
  await bar().getByTestId('file-editor-reload').click()
  await expect(code()).toHaveText('outside')
  await expect(tabDirty()).toHaveCount(0)
  await expect.poll(drafts).toEqual([])
})

test('D11, D13: a file deleted under a dirty tab offers Save and Discard; a clean one is read-only with Close', async () => {
  dataDir = ''
  await launch()
  await createWorkspace()
  const file = join(folder, 'src', 'a.ts')
  await openFromFiles('src/a.ts')
  await typeAtStart('x')
  await expect(tabDirty()).toBeVisible()

  // Dirty: Save writes it again.
  rmSync(file)
  await expect(bar()).toContainText('Deleted on disk', { timeout: 4000 })
  await expect(bar().getByTestId('file-editor-bar-close')).toHaveCount(0)
  await bar().getByTestId('file-editor-bar-save').click()
  await expect(bar()).toHaveCount(0)
  await expect(tabDirty()).toHaveCount(0)
  expect(readFileSync(file, 'utf8')).toBe('x' + A_TEXT)

  // Dirty again: Discard closes the tab, writes nothing and keeps no draft.
  await typeAtStart('y')
  await expect.poll(drafts, { timeout: 5000 }).toHaveLength(1)
  rmSync(file)
  await expect(bar().getByTestId('file-editor-bar-discard')).toBeVisible({ timeout: 4000 })
  await bar().getByTestId('file-editor-bar-discard').click()
  await expect(editor()).toHaveCount(0)
  await expect(fileRows()).toHaveCount(0)
  expect(existsSync(file)).toBe(false)
  await expect.poll(drafts).toEqual([])

  // Clean: the tab stays, read-only, with Close.
  await openFromFiles('b.md')
  await editor().getByTestId('file-editor-mode-edit').click()
  await expect(code()).toHaveText('# Notes')
  rmSync(join(folder, 'b.md'))
  await expect(bar()).toContainText('Deleted on disk', { timeout: 4000 })
  await expect(bar().getByTestId('file-editor-bar-save')).toHaveCount(0)
  await expect(code()).toHaveAttribute('contenteditable', 'false')
  await bar().getByTestId('file-editor-bar-close').click()
  await expect(editor()).toHaveCount(0)
})
