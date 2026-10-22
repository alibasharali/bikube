/**
 * A card's own git worktree: created from the workspace's repository on a new branch, with the
 * repository's git-ignored files (node_modules, local config…) copied in copy-on-write where the file
 * system allows it; checked for uncommitted changes and removed when its card is deleted. Plain
 * TS with the commands injected, so Vitest runs it against real throwaway repositories.
 */
import { branchProblem, worktreeFolder } from './worktree-names'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs `command` with `args` in `cwd` without a shell; never throws. */
export type Run = (command: string, args: string[], cwd?: string) => Promise<RunResult>

export interface WorktreeFs {
  exists(path: string): Promise<boolean>
  mkdirp(path: string): Promise<void>
}

export interface RepoInfo {
  /** The repository's top folder. */
  root: string
  /** The workspace folder's path inside it, '' at the top, else ending in `/`. */
  prefix: string
  /** The checked-out branch; null on a detached HEAD. */
  branch: string | null
  /** Every local branch, for picking a free name. */
  branches: string[]
}

/** The repository `dir` is in, or null when it isn't in one (or git is missing). */
export async function repoInfo(dir: string, run: Run): Promise<RepoInfo | null> {
  const top = await run('git', ['rev-parse', '--show-toplevel', '--show-prefix'], dir)
  if (top.code !== 0) return null
  const [root = '', prefix = ''] = top.stdout.split('\n')
  if (!root) return null
  const head = await run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], dir)
  const refs = await run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], dir)
  return {
    root,
    prefix,
    branch: head.code === 0 ? head.stdout.trim() || null : null,
    branches: refs.code === 0 ? refs.stdout.split('\n').filter(Boolean) : []
  }
}

export interface CreateRequest {
  /** The workspace's folder: the repository, or a folder inside it. */
  dir: string
  /** The new branch, made from the repository's current HEAD. */
  branch: string
  /** Where Bikube keeps worktrees: one folder per repository inside it. */
  worktreesRoot: string
  platform: NodeJS.Platform
}

export type CreateResult =
  | {
      ok: true
      /** The worktree's top folder, for removing it later. */
      path: string
      branch: string
      /** The card's directory: the workspace's place inside the worktree. */
      directory: string
      /** Ignored entries that couldn't be copied; the worktree works without them. */
      notCopied: string[]
    }
  | { ok: false; reason: string }

/**
 * Creates the worktree on a new `branch` from HEAD, in `<worktreesRoot>/<repo>-<id>/<folder>`
 * (a free folder name), then copies the git-ignored files into it.
 */
export async function createWorktree(
  request: CreateRequest,
  run: Run,
  fs: WorktreeFs
): Promise<CreateResult> {
  const problem = branchProblem(request.branch)
  if (problem) return { ok: false, reason: problem }
  const repo = await repoInfo(request.dir, run)
  if (!repo) return { ok: false, reason: 'not a git repository' }
  const valid = await run('git', ['check-ref-format', '--branch', request.branch], repo.root)
  if (valid.code !== 0) return { ok: false, reason: 'Not a valid branch name' }
  if (repo.branches.includes(request.branch)) return { ok: false, reason: 'Branch already exists' }

  const parent = join(request.worktreesRoot, repoFolder(repo.root))
  await fs.mkdirp(parent)
  const folder = worktreeFolder(request.branch)
  let path = join(parent, folder)
  for (let n = 2; await fs.exists(path); n++) path = join(parent, `${folder}-${n}`)

  const added = await run('git', ['worktree', 'add', '-b', request.branch, path, 'HEAD'], repo.root)
  if (added.code !== 0)
    return { ok: false, reason: firstLine(added.stderr) || 'git worktree failed' }

  const notCopied = await copyIgnored(repo.root, path, run, fs, request.platform)
  return {
    ok: true,
    path,
    branch: request.branch,
    directory: repo.prefix ? join(path, repo.prefix.replace(/\/$/, '')) : path,
    notCopied
  }
}

/**
 * Copies every git-ignored entry of the repository (whole ignored folders as one entry) into the
 * same place in the worktree: copy-on-write clones on macOS (APFS) and on Linux file systems with
 * reflinks, a plain copy where those aren't available. Returns the entries that failed.
 */
async function copyIgnored(
  root: string,
  worktree: string,
  run: Run,
  fs: WorktreeFs,
  platform: NodeJS.Platform
): Promise<string[]> {
  const listed = await run(
    'git',
    ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
    root
  )
  if (listed.code !== 0) return []
  const entries = listed.stdout
    .split('\0')
    .map((entry) => entry.replace(/\/$/, ''))
    .filter(Boolean)
  const failed: string[] = []
  for (const entry of entries) {
    const from = join(root, entry)
    const to = join(worktree, entry)
    await fs.mkdirp(dirname(to))
    if (!(await copy(from, to, run, platform))) failed.push(entry)
  }
  return failed
}

async function copy(
  from: string,
  to: string,
  run: Run,
  platform: NodeJS.Platform
): Promise<boolean> {
  // -c clones on APFS and fails where it can't; --reflink=auto falls back to a copy by itself.
  if (platform === 'darwin') {
    if ((await run('cp', ['-c', '-R', from, to])).code === 0) return true
    return (await run('cp', ['-R', from, to])).code === 0
  }
  return (await run('cp', ['-R', '--reflink=auto', from, to])).code === 0
}

/** Whether the worktree at `path` has uncommitted changes (untracked files count); null if unknown. */
export async function worktreeDirty(path: string, run: Run): Promise<boolean | null> {
  const status = await run('git', ['status', '--porcelain', '--untracked-files=normal'], path)
  return status.code === 0 ? status.stdout.trim() !== '' : null
}

/**
 * Removes the worktree at `path` (its branch stays, so committed work is kept), with `force` even
 * with uncommitted changes. A folder already gone is pruned from the repository's list.
 */
export async function removeWorktree(
  repoDir: string,
  path: string,
  force: boolean,
  run: Run,
  fs: WorktreeFs
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const repo = await repoInfo(repoDir, run)
  if (!repo) return { ok: false, reason: 'not a git repository' }
  if (!(await fs.exists(path))) {
    await run('git', ['worktree', 'prune'], repo.root)
    return { ok: true }
  }
  const args = ['worktree', 'remove', ...(force ? ['--force', '--force'] : []), path]
  const removed = await run('git', args, repo.root)
  return removed.code === 0
    ? { ok: true }
    : { ok: false, reason: firstLine(removed.stderr) || 'git worktree remove failed' }
}

/** A folder name for the repository at `root`: its name and a short stable id of its path. */
export function repoFolder(root: string): string {
  const name = root.slice(root.lastIndexOf('/') + 1).replace(/[^A-Za-z0-9._-]/g, '-') || 'repo'
  let hash = 0
  for (const c of root) hash = (Math.imul(hash, 31) + c.codePointAt(0)!) >>> 0
  return `${name}-${hash.toString(16).padStart(8, '0').slice(0, 6)}`
}

function firstLine(text: string): string {
  return (
    text
      .trim()
      .split('\n')[0]
      ?.replace(/^fatal:\s*/, '') ?? ''
  )
}

// POSIX path helpers, so this stays free of Node imports.
function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}
