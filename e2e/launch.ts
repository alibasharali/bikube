import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDirs: string[] = []

/** A fresh, empty data directory for one test's saved board (#8 D11); see `removeDataDirs`. */
export function newDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'drovr-data-'))
  dataDirs.push(dir)
  return dir
}

/** Deletes every data directory `newDataDir` made; call after the test's apps are closed. */
export function removeDataDirs(): void {
  for (const dir of dataDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

export interface LaunchOptions {
  /** Where the app keeps its saved board; a fresh one when omitted. Reuse it to restart. */
  dataDir?: string
  /** The environment to launch with; defaults to this process's. */
  env?: Record<string, string>
  /** Extra Electron arguments after `--no-sandbox` (and the dev build's `.` before it). */
  args?: string[]
  /**
   * A packaged app's executable (e.g. `dist/linux-unpacked/drovr`) to launch instead of the dev
   * build; it loads its own bundled app, so no `.` is passed.
   */
  executablePath?: string
  /** Called with the main process's stderr from the start. */
  onStderr?: (chunk: string) => void
}

export interface Launched {
  app: ElectronApplication
  page: Page
  dataDir: string
}

/**
 * Launches the built app (or the packaged executable given as `executablePath`) with its own data
 * directory (`DROVR_USER_DATA_DIR`, #8 D11), so no test shares or touches a real board, and
 * waits for its window. `--no-sandbox`: CI and containers have no setuid chrome-sandbox.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<Launched> {
  const dataDir = options.dataDir ?? newDataDir()
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.env ?? process.env)) {
    if (value !== undefined) base[key] = value
  }
  const app = await electron.launch({
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    args: [...(options.executablePath ? [] : ['.']), '--no-sandbox', ...(options.args ?? [])],
    env: { ...base, DROVR_USER_DATA_DIR: dataDir }
  })
  const onStderr = options.onStderr
  if (onStderr) app.process().stderr?.on('data', (chunk: Buffer) => onStderr(chunk.toString()))
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid=app]')
  return { app, page, dataDir }
}
