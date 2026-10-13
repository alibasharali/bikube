import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch'

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
  root = mkdtempSync(join(tmpdir(), 'drovr-e2e-'))
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await app?.close()
})

async function openCreateDialog(): Promise<void> {
  await page.getByTestId('workspace-add').click()
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

/** Row actions only appear while the row is hovered or focused. */
async function rowAction(
  index: number,
  testId: 'workspace-edit' | 'workspace-delete'
): Promise<void> {
  const row = page.locator('.workspace-row').nth(index)
  await row.hover()
  await row.getByTestId(testId).click()
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
  await page.getByTestId('workspace-directory').fill(dir)
  await expect(page.getByTestId('workspace-name')).toHaveValue('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  const items = page.getByTestId('workspace-item')
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('alpha')
  await expect(items.first()).toHaveAttribute('aria-current', 'true')
  await expect(page.getByTestId('board-title')).toHaveText('alpha')
  await expect.poll(columnNames).toEqual(['Backlog', 'Running', 'Needs me', 'Done'])
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
  await addColumn('Review')
  await expect.poll(columnNames).toEqual(['Backlog', 'Running', 'Needs me', 'Done', 'Review'])

  await items.nth(1).click()
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(items.nth(0)).not.toHaveAttribute('aria-current', 'true')
  await expect(page.getByTestId('board-title')).toHaveText('beta')
  await expect.poll(columnNames).toEqual(['Backlog', 'Running', 'Needs me', 'Done'])
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
  await expect(page.getByTestId('board')).toContainText(newDir)

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

test('AC7: column add, rename, move, delete and validation', async () => {
  await createWorkspace(makeDir('alpha'))

  await addColumn('Review')
  await expect(page.getByTestId('column')).toHaveCount(5)

  // Rename Running -> Doing via the menu.
  await columnAction('Running', 'menu-rename')
  await page.getByTestId('column-rename-input').fill('Doing')
  await page.getByTestId('column-rename-input').press('Enter')

  // Move Done left, delete Needs me.
  await columnAction('Done', 'menu-move-left')
  await columnAction('Needs me', 'menu-delete')
  await expect.poll(columnNames).toEqual(['Backlog', 'Doing', 'Done', 'Review'])

  // Duplicate (case-insensitive) and empty names are rejected.
  await page.getByTestId('add-column').click()
  await page.getByTestId('add-column-input').fill('doing')
  await page.getByTestId('add-column-input').press('Enter')
  await expect(page.getByTestId('column-error')).toBeVisible()
  await page.getByTestId('add-column-input').fill('   ')
  await page.getByTestId('add-column-input').press('Enter')
  await expect(page.getByTestId('column-error')).toBeVisible()
  await page.getByTestId('add-column-input').press('Escape')
  await expect.poll(columnNames).toEqual(['Backlog', 'Doing', 'Done', 'Review'])

  // Double-click renames inline; a duplicate is rejected.
  await page.getByRole('heading', { name: 'Review', exact: true }).dblclick()
  await page.getByTestId('column-rename-input').fill('Backlog')
  await page.getByTestId('column-rename-input').press('Enter')
  await expect(page.getByTestId('column-error')).toBeVisible()
  await page.getByTestId('column-rename-input').press('Escape')
  await expect.poll(columnNames).toEqual(['Backlog', 'Doing', 'Done', 'Review'])

  // The last remaining column cannot be deleted.
  await columnAction('Review', 'menu-delete')
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
  await page.getByTestId('workspace-directory').fill(dir)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await expect(page.getByTestId('workspace-item')).toHaveCount(0)

  await page.getByTestId('create-workspace').click()
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
