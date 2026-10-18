import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readOnlyGit, spawnRunner, type Git } from './git'
import { changedFolders, readStatus, type FileChange } from './git-status'

// The Files tab's changes (#55 D10, D16) on real throwaway repositories: `repo` has committed
// `README.md`, `src/a.ts`, `src/b.ts` and a `.gitignore` with `dist/`.

let dir: string
let repo: string

const realGit = readOnlyGit(spawnRunner(spawn, process.platform), process.env)

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8'
  })

const write = (path: string, text = ''): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), text)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drovr-status-'))
  repo = join(dir, 'repo')
  mkdirSync(repo)
  write('README.md', '# repo\n')
  write('src/a.ts', 'a\n')
  write('src/b.ts', 'export const b = 2\n')
  write('.gitignore', 'dist/\n')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  write('dist/out.js', 'built\n')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** The changes as `path letter[ from]`, sorted. */
async function changes(folder: string, gitImpl: Git = realGit): Promise<string[]> {
  const status = await readStatus(folder, gitImpl)
  if (!status.ok) throw new Error(status.reason)
  return status.changes.map((c) => `${c.path} ${c.letter}${c.from ? ` ${c.from}` : ''}`).sort()
}

describe('readStatus', () => {
  it('#55 AC16: letters for modified, untracked, deleted, renamed and added, ignored ones left out', async () => {
    write('src/a.ts', 'changed\n')
    write('src/new.ts')
    unlinkSync(join(repo, 'README.md'))
    git(repo, 'mv', 'src/b.ts', 'src/c.ts')
    write('added.ts')
    git(repo, 'add', 'added.ts')
    write('with space "q".ts')
    expect(await changes(repo)).toEqual([
      'README.md D',
      'added.ts A',
      'src/a.ts M',
      'src/c.ts R src/b.ts',
      'src/new.ts U',
      'with space "q".ts U'
    ])
  })

  it('combines staged and unstaged into one letter', async () => {
    write('src/a.ts', 'staged\n')
    git(repo, 'add', 'src/a.ts')
    write('src/a.ts', 'and again\n')
    write('fresh.ts', 'one\n')
    git(repo, 'add', 'fresh.ts')
    write('fresh.ts', 'two\n')
    git(repo, 'rm', '-q', '--cached', 'src/b.ts')
    // Removed from the index but still on disk: deleted against HEAD, one row.
    expect(await changes(repo)).toEqual(['fresh.ts A', 'src/a.ts M', 'src/b.ts D'])
  })

  it('marks a conflicted file C', async () => {
    git(repo, 'switch', '-q', '-c', 'other')
    write('src/a.ts', 'other\n')
    git(repo, 'commit', '-q', '-am', 'other')
    git(repo, 'switch', '-q', 'main')
    write('src/a.ts', 'main\n')
    git(repo, 'commit', '-q', '-am', 'main')
    try {
      git(repo, 'merge', '-q', 'other')
    } catch {
      // The conflict.
    }
    expect(await changes(repo)).toEqual(['src/a.ts C'])
  })

  it('in a subfolder: only paths inside it, relative to it; a rename from outside still marks', async () => {
    write('src/a.ts', 'changed\n')
    write('top.ts')
    git(repo, 'mv', 'README.md', 'src/readme.md')
    expect(await changes(join(repo, 'src'))).toEqual(['a.ts M', 'readme.md R README.md'])
  })

  it('reads a worktree as its own repository', async () => {
    const tree = join(dir, 'tree')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', tree)
    writeFileSync(join(tree, 'src', 'a.ts'), 'tree\n')
    write('src/b.ts', 'main\n')
    expect(await changes(tree)).toEqual(['src/a.ts M'])
  })

  it('says when the folder is not a repository, and runs read-only git without optional locks', async () => {
    const plain = join(dir, 'plain')
    mkdirSync(plain)
    expect(await readStatus(plain, realGit)).toEqual({ ok: false, reason: 'not-repository' })
    const calls: string[][] = []
    const spy: Git = (cwd, args) => {
      calls.push(args)
      return realGit(cwd, args)
    }
    await readStatus(repo, spy)
    expect(calls.length).toBeGreaterThan(0)
    for (const args of calls) {
      expect(['status', 'rev-parse']).toContain(
        args.find((a) => !a.startsWith('-') && !a.includes('='))
      )
    }
  })

  it('fails without claiming a repository when git times out', async () => {
    const slow: Git = async () => ({ code: 1, stdout: '', stderr: '', timedOut: true })
    expect(await readStatus(repo, slow)).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('changedFolders', () => {
  it('#55 AC16: every folder leading to a change, the root included', () => {
    const list: FileChange[] = [
      { path: 'src/deep/x.ts', letter: 'M' },
      { path: 'README.md', letter: 'D' }
    ]
    expect([...changedFolders(list)].sort()).toEqual(['', 'src', 'src/deep'])
    expect([...changedFolders([])]).toEqual([])
  })
})
