import { expect, test, type ElectronApplication } from '@playwright/test'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CLAUDE_INSTRUCTION, claudeSettings } from '../src/core/claude-hooks'
import { backToBoard, expectCardOpen } from './card-view'
import { launchApp, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The packaged Linux app (#14 AC4, D8): `npm run test:packaged` packs it (`npm run pack`), then
// this checks the unpacked app's files and launches its executable once, under xvfb, with a
// `board status` round trip. Not part of `npm run test:smoke` (playwright.config.ts ignores it).

const unpacked = resolve(__dirname, '..', 'dist', 'linux-unpacked')
const executable = join(unpacked, 'drovr')
const resources = join(unpacked, 'resources')

let app: ElectronApplication | undefined
let root: string | undefined

test.skip(
  process.platform !== 'linux',
  'the packaged check runs on Linux only (dist/linux-unpacked)'
)

test.beforeAll(() => {
  if (!existsSync(executable)) {
    throw new Error(
      `${executable} is missing: run \`npm run pack\` first (npm run test:packaged does)`
    )
  }
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

test('AC4: the unpacked app has an executable board wrapper and the unpacked CLI module', () => {
  const board = join(resources, 'bin', 'board')
  expect(statSync(board).isFile()).toBe(true)
  expect(() => accessSync(board, constants.X_OK)).not.toThrow()
  expect(existsSync(join(resources, 'app.asar.unpacked', 'out', 'main', 'board-cli.js'))).toBe(true)
})

test('#31 AC12: the Claude settings file and its instruction ship beside board, outside the asar', () => {
  const settings = readFileSync(join(resources, 'bin', 'claude-settings.json'), 'utf8')
  expect(settings).toBe(claudeSettings())
  expect(readFileSync(join(resources, 'bin', 'claude-instruction.txt'), 'utf8')).toBe(
    `${CLAUDE_INSTRUCTION}\n`
  )
})

test('the unpacked app ships the third-party notices', () => {
  expect(statSync(join(resources, 'THIRD_PARTY_NOTICES')).isFile()).toBe(true)
})

test('AC4: the packaged app opens, makes a workspace and a card, and board status shows on it', async () => {
  root = mkdtempSync(join(tmpdir(), 'drovr-packaged-'))
  const dir = join(root, 'alpha')
  mkdirSync(dir)

  const launched = await launchApp({ executablePath: executable })
  app = launched.app
  const page = launched.page

  await page.getByTestId('workspace-add').click()

  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(dir)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await expect(page.getByTestId('workspace-dialog')).toHaveCount(0)

  const backlog = page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
  await backlog.getByTestId('new-card').click()
  await page.getByTestId('new-card-input').fill('api')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'api')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement?.closest('[data-testid=card-view] [data-testid=terminal]') != null
      )
    )
    .toBe(true)

  await page.keyboard.type('board status . packaged')
  await page.keyboard.press('Enter')
  await backToBoard(page)
  const card = page
    .getByTestId('card')
    .filter({ has: page.getByTestId('card-title').getByText('api', { exact: true }) })
  // The first `board` starts the packaged executable as Node from a cold disk cache.
  await expect(card.getByTestId('card-agent-status')).toHaveText('packaged', {
    timeout: 20_000
  })
  await expect(card.getByTestId('card-status-label')).toHaveText('Running')
})
