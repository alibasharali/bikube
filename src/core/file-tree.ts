/**
 * The side panel's Files tab listing (#55 D7, D8, D9, D16): one folder's entries at a time,
 * read by main inside the folder the tab shows. Plain TS: the file system and git are injected
 * (real ones by default), so Vitest drives real temporary folders and repositories.
 */

import { readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Git } from './git'

/** The most entries one folder lists (D7); the rest are counted in `more`. */
export const FOLDER_CAP = 2000

/** Longest path a listing or open request may name inside the shown folder. */
export const MAX_TREE_PATH_LENGTH = 4096

/** One entry of a listed folder. */
export interface TreeEntry {
  name: string
  /** Expands like a folder: a folder, or a symlink to a folder inside the shown folder (D9). */
  folder: boolean
  /** A symbolic link, listed with an arrow (D9). */
  symlink?: true
  /** git ignores it (D8). */
  ignored?: true
}

export type FolderListing =
  { ok: true; entries: TreeEntry[]; more: number } | { ok: false; reason: 'outside' | 'unreadable' }

interface DirentLike {
  name: string
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** The file system calls a listing makes. */
export interface TreeFs {
  realpath(path: string): Promise<string>
  readdir(path: string, options: { withFileTypes: true }): Promise<DirentLike[]>
  stat(path: string): Promise<{ isDirectory(): boolean }>
}

const nodeFs: TreeFs = { realpath, readdir, stat }

/**
 * A path inside the shown folder as the renderer names it: relative, `/`-separated, `''` for the
 * folder itself, bounded, no NUL.
 */
export function isTreePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= MAX_TREE_PATH_LENGTH &&
    !path.includes('\0') &&
    !isAbsolute(path)
  )
}

const within = (base: string, path: string): boolean => {
  const rel = relative(base, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * The real path of `path` (relative to the absolute folder `root`) when it resolves inside
 * `root`'s real path, symlinks followed (D16); null when it escapes (`..`, a symlink pointing
 * out), doesn't exist or isn't a valid path. A `..` escape is refused before the file system is
 * asked anything.
 */
export async function insideFolder(
  root: string,
  path: unknown,
  fs: Pick<TreeFs, 'realpath'> = nodeFs
): Promise<string | null> {
  if (!isAbsolute(root) || !isTreePath(path)) return null
  const named = resolve(root, path)
  if (!within(root, named)) return null
  try {
    const rootReal = await fs.realpath(root)
    const real = await fs.realpath(named)
    return within(rootReal, real) ? real : null
  } catch {
    return null
  }
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Entry names in the tree's order (D7): case-insensitive, natural (`file2` before `file10`). */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

/** Undoes git's C-style quoting of a path it prints (`core.quotePath=false`: only `"`, `\` and control characters). */
export function unquoteGitPath(line: string): string {
  if (!line.startsWith('"') || !line.endsWith('"') || line.length < 2) return line
  const body = line.slice(1, -1)
  const bytes: number[] = []
  const simple: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 }
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'))
      continue
    }
    const next = body[i + 1] ?? ''
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8))
      i += 3
    } else {
      bytes.push(simple[next] ?? next.charCodeAt(0))
      i += 1
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/** How many names one `check-ignore` is given, to keep its command line short. */
const CHECK_IGNORE_BATCH = 500

/**
 * Which of `names` (entries of the folder `dir`, a real path) git ignores (D8), as
 * `git check-ignore` says; none outside a repository or when git fails.
 */
export async function ignoredNames(dir: string, names: string[], git: Git): Promise<Set<string>> {
  const ignored = new Set<string>()
  for (let at = 0; at < names.length; at += CHECK_IGNORE_BATCH) {
    const batch = names.slice(at, at + CHECK_IGNORE_BATCH)
    // `./` keeps a name like `:(glob)x` from reading as pathspec magic; git prints it back.
    const out = await git(dir, [
      '-c',
      'core.quotePath=false',
      'check-ignore',
      '--',
      ...batch.map((name) => `./${name}`)
    ])
    // 0: some ignored, 1: none; anything else (128: not a repository) dims nothing.
    if (out.timedOut || (out.code !== 0 && out.code !== 1)) return new Set()
    for (const line of out.stdout.split('\n')) {
      const path = unquoteGitPath(line)
      if (path.startsWith('./')) ignored.add(path.slice(2))
    }
  }
  return ignored
}

/**
 * The entries of the folder `path` inside the shown folder `root` (D7, D8, D9, D16): every entry
 * but `.git`, folders first, then files, each by `compareNames`; the first `FOLDER_CAP`, with the
 * rest counted in `more`. A symlink is a folder only when it points to a folder inside `root`.
 * With `git`, the entries git ignores are marked. Refused (`outside`, nothing read) when `path`
 * resolves outside `root`; `unreadable` when it isn't a folder that can be read.
 */
export async function listFolder(
  root: string,
  path: unknown,
  { fs = nodeFs, git = null }: { fs?: TreeFs; git?: Git | null } = {}
): Promise<FolderListing> {
  const real = await insideFolder(root, path, fs)
  if (real === null) return { ok: false, reason: 'outside' }
  let rootReal: string
  let dirents: DirentLike[]
  try {
    rootReal = await fs.realpath(root)
    dirents = await fs.readdir(real, { withFileTypes: true })
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  const entries = await Promise.all(
    dirents
      .filter((d) => d.name !== '.git')
      .map(async (d): Promise<TreeEntry> => {
        if (!d.isSymbolicLink()) return { name: d.name, folder: d.isDirectory() }
        let folder = false
        try {
          const target = await fs.realpath(join(real, d.name))
          folder = within(rootReal, target) && (await fs.stat(target)).isDirectory()
        } catch {
          // Broken: a leaf (D9).
        }
        return { name: d.name, folder, symlink: true }
      })
  )
  entries.sort((a, b) => (a.folder === b.folder ? compareNames(a.name, b.name) : a.folder ? -1 : 1))
  const shown = entries.slice(0, FOLDER_CAP)
  if (git && shown.length > 0) {
    const ignored = await ignoredNames(
      real,
      shown.map((e) => e.name),
      git
    )
    for (const entry of shown) if (ignored.has(entry.name)) entry.ignored = true
  }
  return { ok: true, entries: shown, more: entries.length - shown.length }
}
