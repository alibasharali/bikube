/**
 * The Agent setup page's Open file and Reveal (#68 D27, D28). Main accepts only a path that its
 * last read of the workspace folder listed (`AgentSetupSnapshot.paths`): any other path, Bikube's
 * own Claude Code settings among them, is refused and nothing runs. Plain TS: main injects the
 * editor's dependencies and Electron's `shell.showItemInFolder`.
 */

import { dirname, isAbsolute, resolve } from 'node:path'
import { isFile, openInFolder, type OpenDeps, type OpenResult } from './editor'

/** The files each workspace folder's last read listed, keyed by the folder however it is spelled. */
export class ListedPaths {
  private readonly byFolder = new Map<string, ReadonlySet<string>>()

  /** Replaces what `folder`'s last read listed. */
  set(folder: string, paths: Iterable<string>): void {
    this.byFolder.set(resolve(folder), new Set(paths))
  }

  /** Whether `folder`'s last read listed `path`, an absolute path as the read gave it. */
  has(folder: unknown, path: unknown): path is string {
    if (typeof folder !== 'string' || !isAbsolute(folder)) return false
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) return false
    return this.byFolder.get(resolve(folder))?.has(path) === true
  }
}

export interface FileActionDeps {
  listed: ListedPaths
  /** How Settings > Editor opens a file (`openFile`'s). */
  open: OpenDeps
  /** Electron's `shell.showItemInFolder`. */
  reveal: (path: string) => void
}

/**
 * Opens `path` with Settings > Editor, its own folder as the project folder (D27), when
 * `folder`'s last read listed it and it is still a file; else `refused` and nothing runs.
 */
export async function openListedFile(
  folder: unknown,
  path: unknown,
  deps: FileActionDeps
): Promise<OpenResult> {
  if (!deps.listed.has(folder, path) || !(await isFile(path))) {
    return { ok: false, reason: 'refused' }
  }
  return openInFolder(dirname(path), path, deps.open)
}

/**
 * Shows `path` in the OS file manager (D27) when `folder`'s last read listed it and it is still a
 * file; false (nothing shown) otherwise.
 */
export async function revealListedFile(
  folder: unknown,
  path: unknown,
  deps: FileActionDeps
): Promise<boolean> {
  if (!deps.listed.has(folder, path) || !(await isFile(path))) return false
  deps.reveal(path)
  return true
}
