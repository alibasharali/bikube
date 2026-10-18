import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitIn, type GitRunner } from './git'
import { mergeCardBranch } from './merges'

// Merge into the workspace branch (#38 D11, D12), on real throwaway repositories: `repo` (the
// workspace folder) is a clone of the local bare `remote.git` on `main`, and `card` is its
// worktree on `card-1` with one commit of its own.

const runner: GitRunner = ({ args, cwd, env, timeoutMs }) =>
  new Promise((resolve) => {
    const child = execFile(
      'git',
      args,
      { cwd, env, timeout: timeoutMs, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const timedOut = error !== null && error.killed === true
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ code, stdout, stderr, timedOut })
      }
    )
    child.stdin?.end()
  })

const run = gitIn(runner, process.env)

let dir: string
let repo: string
let card: string

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const commit = (cwd: string, file: string, text: string, message: string): void => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', message)
}

const expected = { cardBranch: 'card-1', branch: 'main' }

describe('mergeCardBranch', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drovr-merge-'))
    const remote = join(dir, 'remote.git')
    repo = join(dir, 'repo')
    card = join(dir, 'card')
    git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
    git(dir, 'clone', '-q', remote, repo)
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'switch', '-q', '-c', 'main')
    commit(repo, 'a.txt', 'one\n', 'first')
    git(repo, 'push', '-q', 'origin', 'main')
    git(repo, 'worktree', 'add', '-q', '-b', 'card-1', card)
    commit(card, 'b.txt', 'card\n', 'card work')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('fast-forwards the workspace branch, then is already up to date', async () => {
    expect(await mergeCardBranch(repo, card, expected, run)).toEqual({
      ok: true,
      note: 'Merged card-1 into main'
    })
    expect(git(repo, 'log', '-1', '--format=%s', 'main')).toBe('card work')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(await mergeCardBranch(repo, card, expected, run)).toEqual({
      ok: true,
      note: 'Already up to date'
    })
  })

  it('refuses a workspace folder with uncommitted changes to tracked files, not untracked ones', async () => {
    const main = git(repo, 'rev-parse', 'main')
    writeFileSync(join(repo, 'a.txt'), 'changed\n')
    expect(await mergeCardBranch(repo, card, expected, run)).toEqual({
      ok: false,
      reason: 'The workspace folder has uncommitted changes: commit or stash them first'
    })
    expect(git(repo, 'rev-parse', 'main')).toBe(main)
    git(repo, 'checkout', '--', 'a.txt')
    writeFileSync(join(repo, 'loose.txt'), 'untracked\n')
    expect(await mergeCardBranch(repo, card, expected, run)).toEqual({
      ok: true,
      note: 'Merged card-1 into main'
    })
  })

  it('aborts a conflicting merge, leaving the workspace folder as it was', async () => {
    commit(card, 'a.txt', 'card\n', 'card a')
    commit(repo, 'a.txt', 'main\n', 'main a')
    const main = git(repo, 'rev-parse', 'main')
    expect(await mergeCardBranch(repo, card, expected, run)).toEqual({
      ok: false,
      reason: 'Merge conflict in a.txt: nothing was merged'
    })
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(git(repo, 'rev-parse', 'main')).toBe(main)
  })

  it('lists at most 5 conflicting files, then how many more', async () => {
    const files = ['a.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt', 'g.txt', 'h.txt']
    for (const [cwd, text] of [
      [card, 'card\n'],
      [repo, 'main\n']
    ] as const) {
      for (const file of files) writeFileSync(join(cwd, file), text)
      git(cwd, 'add', ...files)
      git(cwd, 'commit', '-q', '-m', 'both')
    }
    expect(await mergeCardBranch(repo, card, expected, run)).toEqual({
      ok: false,
      reason: 'Merge conflict in a.txt, c.txt, d.txt, e.txt, f.txt and 2 more: nothing was merged'
    })
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('refuses when either branch is no longer the one the confirmation named (D12)', async () => {
    const main = git(repo, 'rev-parse', 'main')
    git(card, 'switch', '-q', '-c', 'topic/x')
    expect(await mergeCardBranch(repo, card, expected, run)).toEqual({
      ok: false,
      reason: "The card's branch changed: try again"
    })
    git(card, 'switch', '-q', 'card-1')
    git(repo, 'switch', '-q', '-c', 'other')
    expect(await mergeCardBranch(repo, card, expected, run)).toEqual({
      ok: false,
      reason: "The workspace folder's branch changed: try again"
    })
    git(repo, 'switch', '-q', '--detach', 'main')
    expect(await mergeCardBranch(repo, card, expected, run)).toEqual({
      ok: false,
      reason: "The workspace folder's branch changed: try again"
    })
    expect(git(repo, 'rev-parse', 'main')).toBe(main)
    expect(git(repo, 'rev-parse', 'other')).toBe(main)
  })

  it('refuses a worktree from another repository, running nothing in either (D12)', async () => {
    const other = join(dir, 'other')
    git(dir, 'init', '-q', '-b', 'card-1', other)
    git(other, 'config', 'user.email', 'test@example.com')
    git(other, 'config', 'user.name', 'Test')
    commit(other, 'z.txt', 'other\n', 'other work')
    const main = git(repo, 'rev-parse', 'main')
    const seen: string[][] = []
    const watched: typeof run = (cwd, args) => {
      seen.push(args)
      return run(cwd, args)
    }
    expect(await mergeCardBranch(repo, other, expected, watched)).toEqual({
      ok: false,
      reason: "The card's worktree is not in this repository"
    })
    expect(seen.every((args) => args[0] === 'rev-parse')).toBe(true)
    expect(git(repo, 'rev-parse', 'main')).toBe(main)
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })
})
