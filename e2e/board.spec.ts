import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backToBoard, boardCard, expectCardOpen } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Board and workspaces smoke tests. The native folder picker can't be driven
// headlessly, so the dialog is filled by typing the path (spec: test seams).

let app: ElectronApplication
let page: Page
let root: string

/** Makes an existing directory named `name` inside this test's temp root. */
function makeDir(name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-e2e-'))
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await app?.close()
  removeDataDirs()
})

async function openCreateDialog(): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
}

/** Creates a workspace through the dialog; the name defaults from the path when omitted. */
async function createWorkspace(dir: string, name?: string): Promise<void> {
  await openCreateDialog()
  await page.getByTestId('workspace-directory').fill(dir)
  if (name !== undefined) await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** Shows the board of the workspace row at `index`, then its toolbar's Edit or Delete. */
async function rowAction(
  index: number,
  testId: 'workspace-edit' | 'workspace-delete'
): Promise<void> {
  const row = page.locator('.workspace-row').nth(index)
  await row.getByTestId('workspace-item').click()
  await row.page().getByTestId(testId).click()
}

const columnNames = (): Promise<string[]> => page.getByTestId('column-name').allTextContents()

function column(name: string): ReturnType<Page['locator']> {
  return page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
}

async function addColumn(name: string): Promise<void> {
  await page.getByTestId('add-column').click()
  await page.getByTestId('add-column-input').fill(name)
  await page.getByTestId('add-column-input').press('Enter')
}

async function columnAction(name: string, action: string): Promise<void> {
  await column(name).getByTestId('column-menu').click()
  await page.getByTestId(action).click()
}

test('AC1/AC10: opens to the empty state, spike UI is gone', async () => {
  await expect(page.getByTestId('workspace-item')).toHaveCount(0)
  await expect(page.getByTestId('empty-state')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create workspace' }).first()).toBeVisible()
  await expect(page.getByTestId('create-workspace')).toBeVisible()
  await expect(page.getByTestId('terminal-count')).toHaveCount(0)
  await expect(page.getByTestId('new-terminal')).toHaveCount(0)
  await expect(page.getByText('1 terminal')).toHaveCount(0)
  await expect(page.locator('.toolbar')).toHaveCount(0)
})

test('AC2: create via dialog defaults the name and shows the default columns', async () => {
  const dir = makeDir('alpha')
  await page.getByTestId('create-workspace').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await expect(page.getByTestId('workspace-name')).toHaveValue('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  const items = page.getByTestId('workspace-item')
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('alpha')
  await expect(items.first()).toHaveAttribute('aria-current', 'true')
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await expect.poll(columnNames).toEqual(['Backlog', 'In Progress', 'Review', 'Done'])
})

test('AC3: validation errors are inline and block creation', async () => {
  const alphaDir = makeDir('alpha')
  await createWorkspace(alphaDir)
  const otherDir = makeDir('other')
  const file = join(root, 'a-file.txt')
  writeFileSync(file, 'x')

  await openCreateDialog()
  await page.getByTestId('workspace-directory').fill(otherDir)
  await page.getByTestId('workspace-name').fill('Alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-name')).toBeVisible()

  await page.getByTestId('workspace-name').fill('   ')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-name')).toBeVisible()

  await page.getByTestId('workspace-name').fill('beta')
  await page.getByTestId('workspace-directory').fill(join(root, 'missing'))
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-directory')).toBeVisible()

  await page.getByTestId('workspace-directory').fill(file)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-directory')).toBeVisible()

  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
  await page.getByTestId('workspace-cancel').click()
  await expect(page.getByTestId('workspace-item')).toHaveCount(1)
})

test('AC4: switching shows independent boards', async () => {
  await createWorkspace(makeDir('alpha'))
  await createWorkspace(makeDir('beta'))
  const items = page.getByTestId('workspace-item')
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'true')

  await items.nth(0).click()
  await expect(items.nth(0)).toHaveAttribute('aria-current', 'true')
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await addColumn('QA')
  await expect.poll(columnNames).toEqual(['Backlog', 'In Progress', 'Review', 'Done', 'QA'])

  await items.nth(1).click()
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(items.nth(0)).not.toHaveAttribute('aria-current', 'true')
  await expect(page.getByTestId('board-title')).toHaveText('beta')
  await expect.poll(columnNames).toEqual(['Backlog', 'In Progress', 'Review', 'Done'])
})

test('#31 AC16: Ctrl+1…9 select the workspaces in sidebar order; a missing number does nothing', async () => {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  for (const name of ['alpha', 'beta', 'gamma']) await createWorkspace(makeDir(name))
  await page.getByTestId('workspace-item').nth(0).click()
  await expect(page.getByTestId('board-title')).toHaveText('alpha')

  await page.keyboard.press(`${mod}+2`)
  await expect(page.getByTestId('board-title')).toHaveText('beta')
  await page.keyboard.press(`${mod}+3`)
  await expect(page.getByTestId('board-title')).toHaveText('gamma')
  await page.keyboard.press(`${mod}+1`)
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await page.keyboard.press(`${mod}+5`)
  await page.waitForTimeout(300)
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await expect(page.getByTestId('workspace-item').nth(0)).toHaveAttribute('aria-current', 'true')

  // A dialog owns the keyboard: the shortcut does nothing behind it.
  await openCreateDialog()
  await page.keyboard.press(`${mod}+2`)
  await page.waitForTimeout(300)
  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
  await page.getByTestId('workspace-cancel').click()
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
})

// Moving workspaces in the sidebar (#32): drag and drop, Alt+Up/Down.

/** Creates `alpha`, `beta` and `gamma` in that order and makes `alpha` active (#32 ACs). */
async function threeWorkspaces(): Promise<void> {
  for (const name of ['alpha', 'beta', 'gamma']) await createWorkspace(makeDir(name))
  await workspaceRow('alpha').getByTestId('workspace-item').click()
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
}

const workspaceRow = (name: string): Locator =>
  page.locator('.workspace-row').filter({
    has: page.locator('.workspace-name').getByText(name, { exact: true })
  })

const sidebarNames = (): Locator => page.locator('.workspace-name')

/** Checks that `alpha` is still the active workspace and its board is shown (#32 D2). */
async function expectAlphaActive(): Promise<void> {
  await expect(workspaceRow('alpha').getByTestId('workspace-item')).toHaveAttribute(
    'aria-current',
    'true'
  )
  await expect(page.locator('[aria-current=true]')).toHaveCount(1)
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
}

/**
 * Starts a real pointer drag of workspace `name`'s row and moves over `target` at `y` (a fraction
 * of its height, 0.25 = top half), with intermediate moves so HTML5 drag and drop runs.
 */
async function dragWorkspaceOver(name: string, target: Locator, y = 0.5): Promise<void> {
  const from = await workspaceRow(name).getByTestId('workspace-item').boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('nothing to drag')
  await page.mouse.move(from.x + from.width / 3, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 3 + 5, from.y + from.height / 2 + 5, { steps: 3 })
  await page.mouse.move(to.x + to.width / 3, to.y + to.height * y, { steps: 10 })
}

async function dragWorkspace(name: string, target: Locator, y = 0.5): Promise<void> {
  await dragWorkspaceOver(name, target, y)
  await page.mouse.up()
}

test('#32 AC2/AC3: dragging a workspace onto the top or bottom half of a row moves it', async () => {
  await threeWorkspaces()

  await dragWorkspaceOver('gamma', workspaceRow('alpha'), 0.25)
  await expect(workspaceRow('gamma')).toHaveClass(/workspace-dragging/)
  await expect(workspaceRow('alpha')).toHaveAttribute('data-drop', 'before')
  await expect(page.locator('[data-drop]')).toHaveCount(1)
  await page.mouse.up()
  await expect(sidebarNames()).toHaveText(['gamma', 'alpha', 'beta'])
  await expect(page.locator('[data-drop]')).toHaveCount(0)
  await expect(workspaceRow('gamma')).not.toHaveClass(/workspace-dragging/)
  // A drag never selects a workspace (D4).
  await expectAlphaActive()

  await dragWorkspace('gamma', workspaceRow('beta'), 0.75)
  await expect(sidebarNames()).toHaveText(['alpha', 'beta', 'gamma'])
  await dragWorkspace('alpha', workspaceRow('gamma'), 0.75)
  await expect(sidebarNames()).toHaveText(['beta', 'gamma', 'alpha'])
  await expectAlphaActive()

  // The collapsed sidebar's rows drag too (D4); there they are named by their labels.
  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
  // Its width animates: read the rows' boxes once it is a rail.
  await expect
    .poll(() => page.getByTestId('sidebar').evaluate((el) => el.getBoundingClientRect().width))
    .toBeLessThan(100)
  const items = page.getByTestId('workspace-item')
  const railRow = (name: string): Locator =>
    page.locator('.workspace-row').filter({ has: page.getByLabel(name, { exact: true }) })
  const from = await railRow('alpha').boundingBox()
  const to = await railRow('beta').boundingBox()
  if (!from || !to) throw new Error('nothing to drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 3, from.y + from.height / 2 + 5, { steps: 3 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.25, { steps: 10 })
  await expect(railRow('beta')).toHaveAttribute('data-drop', 'before')
  await page.mouse.up()
  await expect
    .poll(() => items.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))))
    .toEqual(['alpha', 'beta', 'gamma'])
  await expect(page.locator('[data-drop]')).toHaveCount(0)
  await expect(railRow('alpha').getByTestId('workspace-item')).toHaveAttribute(
    'aria-current',
    'true'
  )
  await expect(page.locator('[aria-current=true]')).toHaveCount(1)
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
})

test('#32 AC4: Esc, or releasing outside the sidebar, cancels a workspace drag', async () => {
  await threeWorkspaces()

  await dragWorkspaceOver('gamma', workspaceRow('alpha'), 0.25)
  await expect(workspaceRow('alpha')).toHaveAttribute('data-drop', 'before')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(sidebarNames()).toHaveText(['alpha', 'beta', 'gamma'])
  await expect(page.locator('[data-drop]')).toHaveCount(0)
  await expect(workspaceRow('gamma')).not.toHaveClass(/workspace-dragging/)
  await expectAlphaActive()

  // Released over the board: no column takes a workspace either (D4).
  await dragWorkspace('gamma', column('Backlog'))
  await expect(sidebarNames()).toHaveText(['alpha', 'beta', 'gamma'])
  await expect(page.locator('[data-drop]')).toHaveCount(0)
  await expect(workspaceRow('gamma')).not.toHaveClass(/workspace-dragging/)
  await expectAlphaActive()
})

/** The open card's terminal buffer as one string. */
const bufferText = (): Promise<string> =>
  page.evaluate(() => {
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
    if (!buffer) return ''
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++)
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
    return lines.join('\n')
  })

test('#32 AC5: a running card is unaffected when its workspace is dragged; cards never drop on the sidebar', async () => {
  await threeWorkspaces()
  await workspaceRow('beta').getByTestId('workspace-item').click()
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('api')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'api')
  await page.keyboard.type('printf bikube-marker; sleep 30')
  await page.keyboard.press('Enter')
  await expect.poll(bufferText).toContain('bikube-marker\n')
  await backToBoard(page)

  // A card dragged over the sidebar shows no line and drops nothing (D4).
  const from = await boardCard(page, 'api').getByTestId('card-open').boundingBox()
  const to = await workspaceRow('alpha').boundingBox()
  if (!from || !to) throw new Error('nothing to drag')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 5, from.y + from.height / 2 + 5, { steps: 3 })
  await page.mouse.move(to.x + to.width / 3, to.y + to.height * 0.25, { steps: 10 })
  await expect(page.locator('.workspace-row[data-drop]')).toHaveCount(0)
  await page.mouse.up()
  await expect(sidebarNames()).toHaveText(['alpha', 'beta', 'gamma'])
  await expect(column('Backlog').getByTestId('card-title')).toHaveText(['api'])

  // `beta` is left with its card open at full size; the move keeps that view (D2).
  await boardCard(page, 'api').getByTestId('card-open').click()
  await expectCardOpen(page, 'api')
  await workspaceRow('alpha').getByTestId('workspace-item').click()
  await expectAlphaActive()
  await dragWorkspace('beta', workspaceRow('alpha'), 0.25)
  await expect(sidebarNames()).toHaveText(['beta', 'alpha', 'gamma'])
  await expectAlphaActive()

  // Mod+1, now beta's: it comes back to its card (a click would show its board, #31 D19).
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+1`)
  await expectCardOpen(page, 'api')
  await expect.poll(bufferText).toContain('bikube-marker\n')
  await backToBoard(page)
  await expect(page.getByTestId('board-title')).toHaveText('beta')
  await expect(boardCard(page, 'api').getByTestId('card-status-label')).toHaveText('Running')
  await expect(boardCard(page, 'api').getByTestId('card-status-line')).toHaveText('bikube-marker')
})

test('#32 AC6: Alt+Up and Alt+Down move the focused workspace row and keep its focus', async () => {
  await threeWorkspaces()
  const beta = workspaceRow('beta').getByTestId('workspace-item')
  await beta.focus()

  await page.keyboard.press('Alt+ArrowUp')
  await expect(sidebarNames()).toHaveText(['beta', 'alpha', 'gamma'])
  await expect(beta).toBeFocused()
  await page.keyboard.press('Alt+ArrowUp')
  await page.waitForTimeout(200)
  await expect(sidebarNames()).toHaveText(['beta', 'alpha', 'gamma'])
  await expect(beta).toBeFocused()
  await expectAlphaActive()

  await page.keyboard.press('Alt+ArrowDown')
  await expect(sidebarNames()).toHaveText(['alpha', 'beta', 'gamma'])
  await expect(beta).toBeFocused()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(sidebarNames()).toHaveText(['alpha', 'gamma', 'beta'])
  await expect(beta).toBeFocused()
  await expectAlphaActive()

  // Plain arrows move nothing; Enter still selects (D5).
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(200)
  await expect(sidebarNames()).toHaveText(['alpha', 'gamma', 'beta'])
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('board-title')).toHaveText('beta')
})

test('#32 AC7: Mod+1 switches to the workspace now at the top', async () => {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await threeWorkspaces()
  await dragWorkspace('gamma', workspaceRow('alpha'), 0.25)
  await expect(sidebarNames()).toHaveText(['gamma', 'alpha', 'beta'])

  await page.keyboard.press(`${mod}+1`)
  await expect(page.getByTestId('board-title')).toHaveText('gamma')
  await page.keyboard.press(`${mod}+2`)
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
})

test('AC5: edit renames, changes directory and rejects duplicates', async () => {
  await createWorkspace(makeDir('alpha'))
  await createWorkspace(makeDir('beta'))
  const items = page.getByTestId('workspace-item')
  const newDir = makeDir('elsewhere')

  await items.nth(0).click()
  await rowAction(0, 'workspace-edit')
  await page.getByTestId('workspace-name').fill('Beta')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-name')).toBeVisible()

  await page.getByTestId('workspace-name').fill('gamma')
  await page.getByTestId('workspace-directory').fill(newDir)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect(items.nth(0)).toContainText('gamma')
  await expect(page.getByTestId('board-title')).toHaveText('gamma')
  // The folder is in the title bar now (full path in its tooltip).
  await expect(page.getByTestId('board-location')).toHaveAttribute(
    'title',
    new RegExp(`^${newDir}\\n`)
  )

  // An invalid new directory is rejected the same way.
  await rowAction(0, 'workspace-edit')
  await page.getByTestId('workspace-directory').fill(join(root, 'missing'))
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-error-directory')).toBeVisible()
})

test('AC6: delete with cancel and confirm, then the empty state', async () => {
  await createWorkspace(makeDir('alpha'))
  await createWorkspace(makeDir('beta'))
  const items = page.getByTestId('workspace-item')
  await items.nth(0).click()

  await rowAction(0, 'workspace-delete')
  await expect(page.getByTestId('confirm-dialog')).toContainText('alpha')
  await page.getByTestId('confirm-cancel').click()
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect(items).toHaveCount(2)

  await rowAction(0, 'workspace-delete')
  await page.getByTestId('confirm-delete').click()
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('beta')
  await expect(items.first()).toHaveAttribute('aria-current', 'true')
  await expect(page.getByTestId('board-title')).toHaveText('beta')

  await rowAction(0, 'workspace-delete')
  await page.getByTestId('confirm-delete').click()
  await expect(items).toHaveCount(0)
  await expect(page.getByTestId('empty-state')).toBeVisible()
})

test("the workspace toolbar holds the active workspace's Agent setup, Edit and Delete, on its board only", async () => {
  await createWorkspace(makeDir('alpha'))
  await createWorkspace(makeDir('beta'))
  const items = page.getByTestId('workspace-item')
  const toolbar = page.getByTestId('workspace-toolbar')
  await items.nth(0).click()
  await expect(toolbar.getByRole('button')).toHaveText(['Agent setup', 'Edit', 'Delete', ''])
  await expect(toolbar.getByRole('button').last()).toHaveAccessibleName('New terminal')
  await expect(toolbar.getByTestId('workspace-edit')).toHaveAttribute('aria-label', 'Edit alpha')
  // The sidebar no longer shows them over the workspace's name.
  await items.nth(0).hover()
  await expect(page.locator('.workspace-row').getByTestId('workspace-edit')).toHaveCount(0)
  await expect(page.locator('.workspace-row').getByTestId('workspace-delete')).toHaveCount(0)

  await items.nth(1).click()
  await expect(toolbar.getByTestId('workspace-delete')).toHaveAttribute('aria-label', 'Delete beta')

  // An open card fills the main area: no toolbar until Back.
  await column('Backlog').getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('api')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'api')
  await expect(toolbar).toHaveCount(0)
  await backToBoard(page)
  await expect(toolbar).toBeVisible()
})

test('AC7: column add, rename, move, delete and validation', async () => {
  await createWorkspace(makeDir('alpha'))

  await addColumn('QA')
  await expect(page.getByTestId('column')).toHaveCount(5)

  // Rename In Progress -> Doing via the menu.
  await columnAction('In Progress', 'menu-rename')
  await page.getByTestId('column-rename-input').fill('Doing')
  await page.getByTestId('column-rename-input').press('Enter')

  // Move Done left, delete Review.
  await columnAction('Done', 'menu-move-left')
  await columnAction('Review', 'menu-delete')
  await expect.poll(columnNames).toEqual(['Backlog', 'Doing', 'Done', 'QA'])

  // Duplicate (case-insensitive) and empty names are rejected.
  await page.getByTestId('add-column').click()
  await page.getByTestId('add-column-input').fill('doing')
  await page.getByTestId('add-column-input').press('Enter')
  await expect(page.getByTestId('column-error')).toBeVisible()
  await page.getByTestId('add-column-input').fill('   ')
  await page.getByTestId('add-column-input').press('Enter')
  await expect(page.getByTestId('column-error')).toBeVisible()
  await page.getByTestId('add-column-input').press('Escape')
  await expect.poll(columnNames).toEqual(['Backlog', 'Doing', 'Done', 'QA'])

  // Double-click renames inline; a duplicate is rejected.
  await page.getByRole('heading', { name: 'QA', exact: true }).dblclick()
  await page.getByTestId('column-rename-input').fill('Backlog')
  await page.getByTestId('column-rename-input').press('Enter')
  await expect(page.getByTestId('column-error')).toBeVisible()
  await page.getByTestId('column-rename-input').press('Escape')
  await expect.poll(columnNames).toEqual(['Backlog', 'Doing', 'Done', 'QA'])

  // The last remaining column cannot be deleted.
  await columnAction('QA', 'menu-delete')
  await columnAction('Done', 'menu-delete')
  await columnAction('Doing', 'menu-delete')
  await expect(page.getByTestId('column')).toHaveCount(1)
  await page.getByTestId('column-menu').click()
  await expect(page.getByTestId('menu-delete')).toBeDisabled()
})

test('AC8: sidebar collapses to a rail and expands again', async () => {
  await createWorkspace(makeDir('alpha'))
  const sidebar = page.getByTestId('sidebar')
  const expandedWidth = (await sidebar.boundingBox())!.width

  await page.getByTestId('sidebar-toggle').click()
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true')
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(expandedWidth)
  const item = page.getByRole('button', { name: 'alpha', exact: true })
  await expect(item).toBeVisible()
  await expect(item).toHaveAttribute('aria-current', 'true')

  await page.getByTestId('sidebar-toggle').click()
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false')
  await expect(page.getByTestId('workspace-item')).toContainText('alpha')
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(expandedWidth)
})

test('AC9: Esc cancels and Enter submits dialogs and inline edits', async () => {
  const dir = makeDir('alpha')

  await page.getByTestId('create-workspace').click()

  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect(page.getByTestId('workspace-item')).toHaveCount(0)

  await page.getByTestId('create-workspace').click()

  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').press('Enter')
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect(page.getByTestId('workspace-item')).toHaveCount(1)

  await rowAction(0, 'workspace-delete')
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect(page.getByTestId('workspace-item')).toHaveCount(1)

  await page.getByRole('heading', { name: 'Backlog', exact: true }).dblclick()
  await page.getByTestId('column-rename-input').fill('Ideas')
  await page.getByTestId('column-rename-input').press('Escape')
  await expect.poll(columnNames).toContain('Backlog')
  await expect.poll(columnNames).not.toContain('Ideas')

  await page.getByRole('heading', { name: 'Backlog', exact: true }).dblclick()
  await page.getByTestId('column-rename-input').fill('Ideas')
  await page.getByTestId('column-rename-input').press('Enter')
  await expect.poll(columnNames).toContain('Ideas')
})

test('#14 AC7: off macOS the menu bar is hidden and auto-hides', async () => {
  test.skip(process.platform === 'darwin', 'macOS keeps its app menu (#14 D9)')
  const menuBar = await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows()
    return { visible: window.isMenuBarVisible(), autoHide: window.isMenuBarAutoHide() }
  })
  expect(menuBar).toEqual({ visible: false, autoHide: true })
})

/** The sidebar badge of the workspace row at `index`. */
const badge = (index = 0): Locator => page.getByTestId('workspace-badge').nth(index)

test('#59 AC1: a logo picked on create shows in the badge, expanded and collapsed', async () => {
  await openCreateDialog()
  await page.getByTestId('workspace-directory').fill(makeDir('alpha'))
  const none = page.getByTestId('workspace-logo-none')
  await expect(none).toBeChecked()
  // None shows the Name field's initial as it reads now (D3).
  await expect(page.locator('label:has([data-testid="workspace-logo-none"])')).toHaveText('A')
  await page.getByTestId('workspace-name').fill('beta')
  await expect(page.locator('label:has([data-testid="workspace-logo-none"])')).toHaveText('B')
  const rocket = page.getByRole('radio', { name: 'Rocket', exact: true })
  await expect(rocket).toHaveAttribute('title', 'Rocket')
  await rocket.check()
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  await expect(badge()).toHaveAttribute('data-logo', 'rocket')
  await expect(badge().locator('svg')).toBeVisible()
  await expect(badge()).toHaveText('')
  await page.getByTestId('sidebar-toggle').click()
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
  await expect(badge()).toHaveAttribute('data-logo', 'rocket')
  await expect(badge().locator('svg')).toBeVisible()
})

test('#59 AC2: editing shows the logo checked; None clears it, Cancel keeps it', async () => {
  await openCreateDialog()
  await page.getByTestId('workspace-directory').fill(makeDir('alpha'))
  await page.getByTestId('workspace-logo-rocket').check()
  await page.getByTestId('workspace-submit').click()
  await expect(badge()).toHaveAttribute('data-logo', 'rocket')

  // Cancel after picking another logo leaves the badge as it was.
  await rowAction(0, 'workspace-edit')
  await expect(page.getByTestId('workspace-logo-rocket')).toBeChecked()
  await page.getByTestId('workspace-logo-database').check()
  await page.getByTestId('workspace-cancel').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect(badge()).toHaveAttribute('data-logo', 'rocket')

  // None and Save brings the initial letter back.
  await rowAction(0, 'workspace-edit')
  await expect(page.getByTestId('workspace-logo-rocket')).toBeChecked()
  await page.getByTestId('workspace-logo-none').check()
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect(badge()).not.toHaveAttribute('data-logo')
  await expect(badge()).toHaveText('A')
})
