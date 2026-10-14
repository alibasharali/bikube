import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
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
  /** Called with the main process's stderr from the start (of the launch kept, after a retry). */
  onStderr?: (chunk: string) => void
}

export interface Launched {
  app: ElectronApplication
  page: Page
  dataDir: string
}

/**
 * How long one launch may take to bring its window and the app's root (#23 D2): two attempts fit
 * in the 60 s test timeout. `DROVR_E2E_WINDOW_TIMEOUT_MS` overrides it (a number above 0).
 */
const WINDOW_TIMEOUT_MS = ((): number => {
  const ms = Number(process.env['DROVR_E2E_WINDOW_TIMEOUT_MS'])
  return Number.isFinite(ms) && ms > 0 ? ms : 25_000
})()

/**
 * Launches the built app (or the packaged executable given as `executablePath`) with its own data
 * directory (`DROVR_USER_DATA_DIR`, #8 D11), so no test shares or touches a real board, and
 * waits for its window. `--no-sandbox`: CI and containers have no setuid chrome-sandbox.
 * A launch that brings no window is logged with its stderr, killed and tried once more (#23 D2).
 */
export async function launchApp(options: LaunchOptions = {}): Promise<Launched> {
  const dataDir = options.dataDir ?? newDataDir()
  try {
    return await launchOnce(options, dataDir)
  } catch (first) {
    console.warn(`launchApp: no window, launching again: ${String(first)}`)
    // The retry gets its own time on top of the test's.
    test.info().setTimeout(test.info().timeout + WINDOW_TIMEOUT_MS)
    try {
      return await launchOnce(options, dataDir)
    } catch (second) {
      throw new Error(`launchApp: no window twice:\n${String(first)}\n${String(second)}`, {
        cause: second
      })
    }
  }
}

async function launchOnce(options: LaunchOptions, dataDir: string): Promise<Launched> {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.env ?? process.env)) {
    if (value !== undefined) base[key] = value
  }
  const deadline = Date.now() + WINDOW_TIMEOUT_MS
  const app = await electron.launch({
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    args: [...(options.executablePath ? [] : ['.']), '--no-sandbox', ...(options.args ?? [])],
    env: { ...base, DROVR_USER_DATA_DIR: dataDir },
    timeout: WINDOW_TIMEOUT_MS
  })
  // `onStderr` hears only the launch that is kept: what came before the window is replayed then.
  let stderr = ''
  let onStderr: ((chunk: string) => void) | undefined
  app.process().stderr?.on('data', (chunk: Buffer) => {
    if (onStderr) onStderr(chunk.toString())
    else stderr += chunk.toString()
  })
  try {
    const page = await app.firstWindow({ timeout: Math.max(1, deadline - Date.now()) })
    await page.waitForSelector('[data-testid=app]', { timeout: Math.max(1, deadline - Date.now()) })
    if (options.onStderr) {
      onStderr = options.onStderr
      if (stderr) onStderr(stderr)
    }
    return { app, page, dataDir }
  } catch (error) {
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${reason}\n--- stderr ---\n${stderr}`, { cause: error })
  }
}
