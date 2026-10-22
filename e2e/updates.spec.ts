import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assetName } from '../src/core/updates'
import { backToBoard, expectCardOpen } from './card-view'
import { launchApp, newDataDir, removeDataDirs } from './launch'
import { plainCards } from './plain-cards'

// The updater against a local release feed (BIKUBE_UPDATE_FEED, honoured by the development build
// only): its file is a zip of a fake `Bikube.app` on macOS, a fake AppImage on Linux, and an
// install replaces a fake app in a temporary folder (BIKUBE_UPDATE_TARGET), never Bikube itself.

const NAME = assetName('0.3.0', process.platform, process.arch)
test.skip(NAME === null, 'the updater installs only on Apple silicon macOS and x64 Linux')

const MAC = process.platform === 'darwin'

let root: string
let server: Server
let base: string
/**
 * What the feed answers: the latest release's version, an HTTP status, a damaged checksum, and
 * whether its file is attached yet.
 */
let feed: { version: string; status: number; badDigest: boolean; fileMissing: boolean }
let files: Map<string, Buffer>
let app: ElectronApplication | undefined
let page: Page

/** The fake app an install replaces, and the text inside it that tells old from new. */
const target = (): string => join(root, 'apps', MAC ? 'Bikube.app' : 'Bikube.AppImage')
const marker = (): string => (MAC ? join(target(), 'Contents', 'marker') : target())

/** The release file for `version`: a zipped `.app` holding `new <version>`, or that text. */
function releaseFile(version: string): Buffer {
  if (!MAC) return Buffer.from(`new ${version}`)
  const build = join(root, `build-${version}`)
  mkdirSync(join(build, 'Bikube.app', 'Contents'), { recursive: true })
  writeFileSync(join(build, 'Bikube.app', 'Contents', 'marker'), `new ${version}`)
  const zip = join(build, 'release.zip')
  execFileSync('ditto', ['-c', '-k', '--keepParent', join(build, 'Bikube.app'), zip])
  return readFileSync(zip)
}

function latest(): unknown {
  const { version } = feed
  const name = assetName(version, process.platform, process.arch)!
  if (!files.has(name)) files.set(name, releaseFile(version))
  const file = files.get(name)!
  const digest = feed.badDigest ? '0'.repeat(64) : createHash('sha256').update(file).digest('hex')
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    published_at: '2026-10-13T09:00:00Z',
    html_url: `${base}tag/v${version}`,
    assets: feed.fileMissing
      ? []
      : [
          {
            name,
            browser_download_url: `${base}download/${name}`,
            size: file.length,
            digest: `sha256:${digest}`
          }
        ]
  }
}

test.beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'bikube-updates-'))
  feed = { version: '0.3.0', status: 200, badDigest: false, fileMissing: false }
  files = new Map()
  mkdirSync(join(root, 'apps'))
  if (MAC) {
    mkdirSync(join(target(), 'Contents'), { recursive: true })
    writeFileSync(marker(), 'old')
  } else {
    writeFileSync(target(), 'old')
  }
  server = createServer((req, res) => {
    if (req.url === '/latest') {
      if (feed.status !== 200) {
        res.writeHead(feed.status).end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(latest()))
      return
    }
    const file = files.get(decodeURIComponent((req.url ?? '').replace('/download/', '')))
    if (!file) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-length': file.length }).end(file)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})

test.afterEach(async () => {
  await app?.close().catch(() => undefined)
  app = undefined
  await new Promise((resolve) => server.close(resolve))
  removeDataDirs()
  rmSync(root, { recursive: true, force: true })
})

async function launch(
  options: { dataDir?: string; current?: string; withTarget?: boolean; waitingChecks?: number } = {}
): Promise<string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    BIKUBE_UPDATE_FEED: `${base}latest`,
    BIKUBE_UPDATE_CURRENT: options.current ?? '0.2.0',
    // A release whose file isn't up yet is checked again this soon (2 minutes in the app).
    BIKUBE_UPDATE_WAITING_MS: '300'
  }
  if (options.withTarget !== false) env['BIKUBE_UPDATE_TARGET'] = target()
  if (options.waitingChecks) env['BIKUBE_UPDATE_WAITING_CHECKS'] = String(options.waitingChecks)
  const launched = await launchApp({ dataDir: options.dataDir, env })
  app = launched.app
  page = launched.page
  return launched.dataDir
}

const button = (): Locator => page.getByTestId('update-button')
const popup = (): Locator => page.getByTestId('update-popup')
const install = (): Locator => popup().getByTestId('update-install')

async function openPopup(): Promise<void> {
  await button().click()
  await expect(popup()).toBeVisible()
}

/** Settings → About → Check for Updates: the popup opens with the check's outcome. */
async function checkFromSettings(): Promise<void> {
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-section-about').click()
  await page.getByTestId('settings-check-updates').click()
  await expect(page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect(popup()).toBeVisible()
}

/** Waits for the app's process to end, as an install makes it. */
async function exited(): Promise<void> {
  const child = app!.process()
  if (child.exitCode === null && child.signalCode === null)
    await new Promise((resolve) => child.once('exit', resolve))
  app = undefined
}

test('a newer release shows the button; the popup gives its version, size and date, then installs', async () => {
  await launch()
  await expect(button()).toHaveText('Update Available: 0.3.0')
  await openPopup()
  await expect(popup().getByTestId('update-version')).toHaveText('0.3.0')
  await expect(popup().getByTestId('update-size')).toHaveText(/\d+ KB/)
  await expect(popup().getByTestId('update-released')).toContainText('2026')
  await expect(install()).toHaveText('Install and Relaunch')
  await expect(popup()).toContainText('Or it installs when you quit Bikube.')
  // Nothing is replaced until the user installs.
  expect(readFileSync(marker(), 'utf8')).toBe('old')

  await install().click()
  await exited()
  await expect.poll(() => readFileSync(marker(), 'utf8')).toBe('new 0.3.0')
  expect(readdirSync(join(root, 'apps'))).toEqual([MAC ? 'Bikube.app' : 'Bikube.AppImage'])
})

test('Install and Relaunch names the running terminals; Cancel keeps everything', async () => {
  await launch()
  await page.getByTestId('workspace-add').click()
  await plainCards(page)
  await page.getByTestId('workspace-directory').fill(root)
  await page.getByTestId('workspace-name').fill('alpha')
  await page.getByTestId('workspace-submit').click()
  await page
    .getByTestId('column')
    .filter({ has: page.getByRole('heading', { name: 'Backlog', exact: true }) })
    .getByTestId('new-card')
    .click()
  await page.getByTestId('new-card-input').fill('api')
  await page.getByTestId('new-card-input').press('Enter')
  await expectCardOpen(page, 'api')
  await backToBoard(page)

  await openPopup()
  await expect(install()).toHaveText('Install and Relaunch')
  await install().click()
  const confirm = page.getByTestId('confirm-dialog')
  await expect(confirm).toContainText(
    'Bikube quits, installs the update and opens again. 1 terminal is running and will be stopped.'
  )
  await confirm.getByTestId('confirm-cancel').click()
  await expect(confirm).toHaveCount(0)
  await expect(button()).toBeVisible()
  expect(readFileSync(marker(), 'utf8')).toBe('old')

  await openPopup()
  await install().click()
  await page.getByTestId('update-confirm').click()
  await exited()
  await expect.poll(() => readFileSync(marker(), 'utf8')).toBe('new 0.3.0')
})

test('Later hides the button; the update still installs at quit', async () => {
  await launch()
  await openPopup()
  await expect(install()).toHaveText('Install and Relaunch')
  await popup().getByTestId('update-later').click()
  await expect(popup()).toHaveCount(0)
  await expect(button()).toHaveCount(0)

  await app!.close()
  app = undefined
  await expect.poll(() => readFileSync(marker(), 'utf8')).toBe('new 0.3.0')
})

test('Skip hides that version across a restart, never installs it, and a newer one shows', async () => {
  const dataDir = await launch()
  await openPopup()
  await popup().getByTestId('update-skip').click()
  await expect(button()).toHaveCount(0)
  await app!.close()
  app = undefined
  expect(readFileSync(marker(), 'utf8')).toBe('old')

  await launch({ dataDir })
  // The skipped version only shows when asked, offered as a download.
  await checkFromSettings()
  await expect(popup().getByTestId('update-version')).toHaveText('0.3.0')
  await expect(popup().getByTestId('update-skip')).toHaveCount(0)
  await expect(install()).toHaveText('Download Update')
  await page.keyboard.press('Escape')
  await expect(popup()).toHaveCount(0)
  await expect(button()).toHaveCount(0)
  await app!.close()
  app = undefined
  expect(readFileSync(marker(), 'utf8')).toBe('old')

  feed.version = '0.4.0'
  await launch({ dataDir })
  await expect(button()).toHaveText('Update Available: 0.4.0')
})

test('a version skipped after its download offers Install and Relaunch when checked, never Download', async () => {
  await launch()
  await openPopup()
  await expect(install()).toHaveText('Install and Relaunch')
  await popup().getByTestId('update-skip').click()
  await expect(button()).toHaveCount(0)

  await checkFromSettings()
  await expect(popup().getByTestId('update-version')).toHaveText('0.3.0')
  await expect(install()).toHaveText('Install and Relaunch')
  // Skipped: it no longer installs at quit, so the popup doesn't say it does.
  await expect(popup()).not.toContainText('Or it installs when you quit Bikube.')
  await page.keyboard.press('Escape')
  await app!.close()
  app = undefined
  expect(readFileSync(marker(), 'utf8')).toBe('old')
})

test('macOS: installs into a folder the user can’t write, as /Applications for a standard account', async () => {
  test.skip(!MAC, 'an AppImage is swapped in its folder, which must be writable')
  chmodSync(join(root, 'apps'), 0o555)
  try {
    await launch()
    await openPopup()
    await expect(install()).toHaveText('Install and Relaunch')
    await install().click()
    await exited()
    await expect.poll(() => readFileSync(marker(), 'utf8')).toBe('new 0.3.0')
  } finally {
    chmodSync(join(root, 'apps'), 0o755)
  }
  expect(readdirSync(target())).toEqual(['Contents'])
})

test('a release found before its file is up says so, then installs once the file appears', async () => {
  feed.fileMissing = true
  await launch()
  await openPopup()
  await expect(popup().getByTestId('update-waiting')).toHaveText(
    'The download for 0.3.0 isn’t ready yet. Bikube checks again in a few minutes.'
  )
  await expect(install()).toHaveText('Not Ready Yet')
  await expect(install()).toBeDisabled()
  await expect(popup().getByTestId('update-size')).toHaveCount(0)
  await expect(popup()).not.toContainText('can’t replace itself')

  // The release workflow attaches the file: the next check finds it, with no click.
  feed.fileMissing = false
  await expect(popup().getByTestId('update-size')).toBeVisible()
  await expect(install()).toHaveText('Install and Relaunch')
  await expect(popup().getByTestId('update-waiting')).toHaveCount(0)
})

test('once its rechecks are used up the popup stops promising one; a check from Settings starts them again', async () => {
  feed.fileMissing = true
  await launch({ waitingChecks: 2 })
  await openPopup()
  // Two rechecks find nothing: the popup stops promising one.
  await expect(popup().getByTestId('update-waiting')).toHaveText(
    'The download for 0.3.0 isn’t ready yet. Check for updates again later.'
  )
  await page.keyboard.press('Escape')

  // A newer version found by that check, still building: rechecked, and installed once its file is up.
  feed.version = '0.3.1'
  await checkFromSettings()
  await expect(popup().getByTestId('update-version')).toHaveText('0.3.1')
  await expect(popup().getByTestId('update-waiting')).toContainText('checks again in a few minutes')
  feed.fileMissing = false
  await expect(install()).toHaveText('Install and Relaunch')
})

test('a check from Settings says up to date, or that it failed', async () => {
  await launch({ current: '0.3.0' })
  await expect(button()).toHaveCount(0)
  await checkFromSettings()
  await expect(page.getByTestId('update-status')).toContainText('Bikube is up to date')
  await expect(page.getByTestId('update-status')).toContainText('Version 0.3.0 is the latest.')
  await page.keyboard.press('Escape')

  feed.status = 500
  await checkFromSettings()
  await expect(page.getByTestId('update-status')).toContainText('Couldn’t check for updates')
  await expect(page.getByTestId('update-status')).toContainText('500')
})

test('a damaged download is never installed; the popup offers the release page', async () => {
  feed.badDigest = true
  await launch()
  await openPopup()
  await expect(popup().getByTestId('update-error')).toContainText('checksum')
  await expect(install()).toHaveText('Download')
  await app!.close()
  app = undefined
  expect(readFileSync(marker(), 'utf8')).toBe('old')
})

test('an install that can’t swap the app keeps the old one and says so at the next launch', async () => {
  const dataDir = await launch()
  await openPopup()
  await expect(install()).toHaveText('Install and Relaunch')
  // What the install moves turns read-only after the download: the bundle (whose Contents macOS
  // swaps), or the AppImage's folder.
  const locked = MAC ? target() : join(root, 'apps')
  chmodSync(locked, 0o555)
  try {
    await install().click()
    await exited()
    await expect
      .poll(() => existsSync(join(dataDir, 'update-install-failed')), { timeout: 10_000 })
      .toBe(true)
  } finally {
    chmodSync(locked, 0o755)
  }
  expect(readFileSync(marker(), 'utf8')).toBe('old')

  await launch({ dataDir })
  await openPopup()
  await expect(popup().getByTestId('update-error')).toContainText('The last install failed')
  await expect(install()).toHaveText('Download')
  // Said once: the record is gone.
  expect(existsSync(join(dataDir, 'update-install-failed'))).toBe(false)
})

test('a failed install’s reason shows at the next launch also where Bikube can only link to the release', async () => {
  const dataDir = newDataDir()
  writeFileSync(join(dataDir, 'update-install-failed'), 'mv: Permission denied')
  await launch({ dataDir, withTarget: false })
  await openPopup()
  await expect(popup().getByTestId('update-error')).toContainText(
    'The last install failed (mv: Permission denied).'
  )
  await expect(install()).toHaveText('Download')
  expect(existsSync(join(dataDir, 'update-install-failed'))).toBe(false)
})

test('a copy Bikube cannot replace offers the release page instead', async () => {
  await launch({ withTarget: false })
  await openPopup()
  await expect(install()).toHaveText('Download')
  await expect(popup()).toContainText('can’t replace itself')
  await app!.close()
  app = undefined
  expect(existsSync(marker()) && readFileSync(marker(), 'utf8')).toBe('old')
})

test('Settings shows the version running', async () => {
  await launch({ dataDir: newDataDir(), current: '0.2.0' })
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-section-about').click()
  await expect(page.getByTestId('settings-version')).toHaveText('0.2.0')
})
