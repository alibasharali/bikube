import { expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, newDataDir, removeDataDirs } from './launch'

// Themes and settings (#10). Each test launches with its own data directory.

let app: ElectronApplication | undefined

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
  removeDataDirs()
})

test('AC1: with no settings file and a dark OS appearance the board looks as before and nothing is written', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page, dataDir } = launched
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(20, 21, 26)')
  // Give a stray write the save interval (200 ms) and more to land before checking.
  await page.waitForTimeout(500)
  expect(existsSync(join(dataDir, 'drovr-settings.json'))).toBe(false)
})

test('the light palette applies under a light OS appearance with theme System', async () => {
  const launched = await launchApp()
  app = launched.app
  const { page } = launched
  await page.emulateMedia({ colorScheme: 'light' })
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(246, 247, 249)')
})

test('the window background matches the resolved theme from the start', async () => {
  const launched = await launchApp()
  app = launched.app
  const [dark, background] = await app.evaluate(({ BrowserWindow, nativeTheme }) => [
    nativeTheme.shouldUseDarkColors,
    BrowserWindow.getAllWindows()[0]!.getBackgroundColor()
  ])
  expect(background.toLowerCase()).toBe(dark ? '#14151a' : '#f6f7f9')
})

test('a saved Light theme gives a light window and board from the start', async () => {
  const dataDir = newDataDir()
  writeFileSync(
    join(dataDir, 'drovr-settings.json'),
    '{"version":1,"settings":{"theme":"light","fontSize":13,"fontFamily":"Menlo, Consolas, monospace"}}'
  )
  const launched = await launchApp({ dataDir })
  app = launched.app
  const background = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getBackgroundColor()
  )
  expect(background.toLowerCase()).toBe('#f6f7f9')
  expect(await launched.page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(246, 247, 249)'
  )
})
