import type { ElectronApplication } from '@playwright/test'
import { existsSync } from 'node:fs'
import { editorCandidates, type NamedEditor } from '../src/core/editor-candidates'

/**
 * Whether a real `editor` is installed where a test's fake home and fake login PATH can't hide it
 * (#70 D1): at one of its installers' paths outside the home, or as one of its command names in
 * `/usr/bin` or `/bin`, which the fake login PATH keeps. A test that needs it found nowhere is
 * skipped there (CI has none).
 */
export function installedOutsideHome(editor: NamedEditor): boolean {
  const candidates = editorCandidates(editor, process.platform, '/nonexistent-home')
  const names = candidates.filter((c) => !c.startsWith('/'))
  return [
    ...candidates.filter((c) => c.startsWith('/')),
    ...names.flatMap((name) => [`/usr/bin/${name}`, `/bin/${name}`])
  ].some((path) => existsSync(path))
}

/** Replaces `shell.openPath` in `app`'s main with a recorder answering `error` ('' for opened, #70 D3). */
export async function recordOpenPath(app: ElectronApplication, error = ''): Promise<void> {
  await app.evaluate(({ shell }, error) => {
    const opened: string[] = []
    ;(globalThis as { openedPaths?: string[] }).openedPaths = opened
    shell.openPath = async (path: string) => {
      opened.push(path)
      return error
    }
  }, error)
}

/** The paths `recordOpenPath`'s recorder was given. */
export const openedPaths = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => [...((globalThis as { openedPaths?: string[] }).openedPaths ?? [])])
