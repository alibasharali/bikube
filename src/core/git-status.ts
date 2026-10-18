/**
 * The Files tab's changes (#55 D10, D16): what `git status` reports inside the shown folder, one
 * letter per path, read by main with read-only git (`rev-parse`, `status`; the runner adds
 * `--no-optional-locks`). Plain TS with git injected, so Vitest drives real repositories.
 */

import type { Git } from './git'

/**
 * `M` modified, `A` added (staged new file), `D` deleted, `U` untracked, `R` renamed, `C`
 * conflicted (unmerged).
 */
export type ChangeLetter = 'M' | 'A' | 'D' | 'U' | 'R' | 'C'

/** One changed path inside the shown folder. */
export interface FileChange {
  /** Relative to the shown folder, `/`-separated. */
  path: string
  letter: ChangeLetter
  /** A rename's old path, relative to the repository as git reports it. */
  from?: string
}

export type FolderStatus =
  { ok: true; changes: FileChange[] } | { ok: false; reason: 'not-repository' | 'failed' }

/** When one path is reported twice (deleted from the index, still on disk), the first of these wins. */
const PRIORITY: ChangeLetter[] = ['C', 'D', 'R', 'A', 'M', 'U']

/** The rest of `record` after its first `fields` space-separated fields: the path. */
const pathAfter = (record: string, fields: number): string => {
  let at = 0
  for (let i = 0; i < fields; i++) {
    at = record.indexOf(' ', at) + 1
    if (at === 0) return ''
  }
  return record.slice(at)
}

/** Staged (`x`) and unstaged (`y`) combined into one letter against HEAD (D10). */
function ordinaryLetter(x: string, y: string): ChangeLetter {
  if (x === 'D' || y === 'D') return 'D'
  if (x === 'A') return 'A'
  return 'M'
}

/**
 * The changes in `git status --porcelain=v2 -z` output, paths relative to the repository: one
 * per path, staged and unstaged combined.
 */
export function parseStatus(stdout: string): FileChange[] {
  const records = stdout.split('\0')
  const byPath = new Map<string, FileChange>()
  const add = (change: FileChange): void => {
    if (!change.path) return
    const before = byPath.get(change.path)
    if (before && PRIORITY.indexOf(before.letter) <= PRIORITY.indexOf(change.letter)) return
    byPath.set(change.path, change)
  }
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    const kind = record[0]
    const x = record[2] ?? '.'
    const y = record[3] ?? '.'
    if (kind === '1') {
      add({ path: pathAfter(record, 8), letter: ordinaryLetter(x, y) })
    } else if (kind === '2') {
      // A rename or copy: the next record is its old path.
      const from = records[++i] ?? ''
      const path = pathAfter(record, 9)
      if (y === 'D') add({ path, letter: 'D' })
      else if (x === 'R' || y === 'R') add({ path, letter: 'R', from })
      else add({ path, letter: 'A' })
    } else if (kind === 'u') {
      add({ path: pathAfter(record, 10), letter: 'C' })
    } else if (kind === '?') {
      // A nested repository is reported as its folder, with a trailing slash.
      add({ path: record.slice(2).replace(/\/$/, ''), letter: 'U' })
    }
  }
  return [...byPath.values()]
}

const NOT_REPOSITORY = /not a git repository|must be run in a work tree/i

/**
 * The changes inside `folder` (D10): staged, unstaged and untracked against HEAD, ignored files
 * left out, with paths relative to `folder` and paths outside it dropped. A rename keeps its old
 * path as git reports it, inside the folder or not. `not-repository` outside a work tree;
 * `failed` when git fails otherwise (a timeout), so a refresh can keep what it had.
 */
export async function readStatus(folder: string, git: Git): Promise<FolderStatus> {
  const prefix = await git(folder, ['rev-parse', '--show-prefix'])
  if (prefix.timedOut) return { ok: false, reason: 'failed' }
  if (prefix.code !== 0) {
    return { ok: false, reason: NOT_REPOSITORY.test(prefix.stderr) ? 'not-repository' : 'failed' }
  }
  const status = await git(folder, [
    '-c',
    'core.quotePath=false',
    'status',
    '--porcelain=v2',
    '-z',
    '--untracked-files=all',
    '--find-renames'
  ])
  if (status.timedOut || status.code !== 0) {
    return {
      ok: false,
      reason: !status.timedOut && NOT_REPOSITORY.test(status.stderr) ? 'not-repository' : 'failed'
    }
  }
  const base = prefix.stdout.replace(/\n$/, '')
  const changes: FileChange[] = []
  for (const change of parseStatus(status.stdout)) {
    if (!change.path.startsWith(base)) continue
    const path = change.path.slice(base.length)
    if (path) changes.push({ ...change, path })
  }
  return { ok: true, changes }
}

/** Every folder leading to a changed path (D10's dots), `''` (the shown folder) included. */
export function changedFolders(changes: readonly FileChange[]): Set<string> {
  const folders = new Set<string>()
  for (const { path } of changes) {
    const parts = path.split('/')
    for (let i = 0; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'))
  }
  return folders
}
