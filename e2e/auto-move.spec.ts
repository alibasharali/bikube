import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// Automatic moves (#42): a workspace's rules, set in its Edit dialog (D6), saved (D7).

let app: ElectronApplication | undefined
let page: Page
let root: string
let dataDir: string

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-auto-move-'))
  dataDir = newDataDir()
  ;({ app, page } = await launchApp({ dataDir }))
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

const RULES = ['When working', 'When waiting for you', 'When stopped'] as const

/** A rule's select in the open workspace dialog, found by its label. */
const rule = (label: (typeof RULES)[number]): Locator =>
  page.getByTestId('workspace-dialog').getByLabel(label, { exact: true })

const column = (name: string): Locator =>
  page.getByTestId('column').filter({ has: page.getByRole('heading', { name, exact: true }) })

async function renameColumn(from: string, to: string): Promise<void> {
  await column(from).getByTestId('column-menu').click()
  await page.getByTestId('menu-rename').click()
  await page.getByTestId('column-rename-input').fill(to)
  await page.getByTestId('column-rename-input').press('Enter')
  await expect(column(to)).toHaveCount(1)
}

/** A workspace `alpha` with columns Backlog, Running, Needs me, Done (the spec's board). */
async function createWorkspace(name = 'alpha'): Promise<void> {
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  const dir = join(root, name)
  mkdirSync(dir)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill(name)
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
  await renameColumn('In Progress', 'Running')
  await renameColumn('Review', 'Needs me')
}

async function openEdit(index = 0): Promise<void> {
  const row = page.locator('.workspace-row').nth(index)
  await row.hover()
  await row.getByTestId('workspace-edit').click()
  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
}

async function closeDialog(button: 'workspace-submit' | 'workspace-cancel'): Promise<void> {
  await page.getByTestId(button).click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)
}

/** The labels of a select's options, in order. */
const optionLabels = (select: Locator): Promise<string[]> =>
  select.locator('option').allTextContents()

/** The label of a select's chosen option. */
const chosen = (select: Locator): Promise<string> =>
  select.evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.textContent ?? '')

test('#42 AC7: the Edit dialog sets the rules, Save keeps them, Cancel changes nothing', async () => {
  await createWorkspace()

  // The Create dialog has no rules.
  await page.getByTestId('workspace-add').click()
  await expect(page.getByTestId('workspace-dialog')).toBeVisible()
  await expect(page.getByText('Move cards automatically')).toHaveCount(0)
  await expect(rule('When working')).toHaveCount(0)
  await closeDialog('workspace-cancel')

  await openEdit()
  await expect(
    page.getByRole('group', { name: 'Move cards automatically', exact: true })
  ).toBeVisible()
  for (const label of RULES) {
    await expect(rule(label)).toBeVisible()
    expect(await chosen(rule(label))).toBe("Don't move")
    expect(await optionLabels(rule(label))).toEqual([
      "Don't move",
      'Backlog',
      'Running',
      'Needs me',
      'Done'
    ])
  }
  await rule('When waiting for you').selectOption({ label: 'Needs me' })
  await closeDialog('workspace-submit')

  await openEdit()
  expect(await chosen(rule('When waiting for you'))).toBe('Needs me')
  expect(await chosen(rule('When working'))).toBe("Don't move")
  // Cancel keeps the saved rules.
  await rule('When waiting for you').selectOption({ label: 'Done' })
  await rule('When stopped').selectOption({ label: 'Done' })
  await closeDialog('workspace-cancel')

  await openEdit()
  expect(await chosen(rule('When waiting for you'))).toBe('Needs me')
  expect(await chosen(rule('When stopped'))).toBe("Don't move")
  // Don't move turns a rule off again.
  await rule('When waiting for you').selectOption({ label: "Don't move" })
  await closeDialog('workspace-submit')
  await openEdit()
  expect(await chosen(rule('When waiting for you'))).toBe("Don't move")
})

test('#42 AC8: renaming the rule’s column keeps it, deleting the column turns it off', async () => {
  await createWorkspace()
  await openEdit()
  await rule('When waiting for you').selectOption({ label: 'Needs me' })
  await closeDialog('workspace-submit')

  await renameColumn('Needs me', 'Attention')
  await openEdit()
  expect(await chosen(rule('When waiting for you'))).toBe('Attention')
  await closeDialog('workspace-cancel')

  await column('Attention').getByTestId('column-menu').click()
  await page.getByTestId('menu-delete').click()
  await expect(column('Attention')).toHaveCount(0)
  await openEdit()
  expect(await chosen(rule('When waiting for you'))).toBe("Don't move")
  expect(await optionLabels(rule('When waiting for you'))).toEqual([
    "Don't move",
    'Backlog',
    'Running',
    'Done'
  ])
})

test('#42 AC9: the rules survive a restart and are in the state file', async () => {
  await createWorkspace('alpha')
  await createWorkspace('beta')
  await openEdit(0)
  await rule('When waiting for you').selectOption({ label: 'Needs me' })
  await closeDialog('workspace-submit')

  await app?.close()
  ;({ app, page } = await launchApp({ dataDir }))

  await openEdit(0)
  expect(await chosen(rule('When waiting for you'))).toBe('Needs me')
  expect(await chosen(rule('When working'))).toBe("Don't move")
  expect(await chosen(rule('When stopped'))).toBe("Don't move")
  await closeDialog('workspace-cancel')
  const saved = JSON.parse(readFileSync(join(dataDir, 'drovr-state.json'), 'utf8'))
  const [alpha, beta] = saved.state.workspaces
  const needsMe = alpha.columns.find((c: { name: string }) => c.name === 'Needs me')
  expect(alpha.autoMove).toEqual({ waiting: needsMe.id })
  expect(beta).not.toHaveProperty('autoMove')
})
