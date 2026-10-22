import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createWorktree,
  removeWorktree,
  repoFolder,
  repoInfo,
  worktreeDirty,
  type Run,
  type WorktreeFs
} from './worktrees'

const run: Run = (command, args, cwd) =>
  new Promise((resolve) => {
    execFile(command, args, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({ code, stdout, stderr })
    })
  })

const fs: WorktreeFs = {
  exists: async (path) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },
  mkdirp: async (path) => {
    await mkdir(path, { recursive: true })
  }
}

let dir: string
let repo: string
let worktreesRoot: string

const git = async (...args: string[]): Promise<string> => {
  const result = await run('git', args, repo)
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

const create = (branch: string, at = repo): ReturnType<typeof createWorktree> =>
  createWorktree({ dir: at, branch, worktreesRoot, platform: process.platform }, run, fs)

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bikube-worktrees-'))
  repo = join(dir, 'repo')
  worktreesRoot = join(dir, 'worktrees')
  mkdirSync(join(repo, 'app'), { recursive: true })
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  // An ignored folder (like node_modules) and an ignored local file.
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\nlocal.conf\n')
  writeFileSync(join(repo, 'app', 'index.ts'), 'export {}\n')
  await git('add', '.')
  await git('commit', '-q', '-m', 'first')
  mkdirSync(join(repo, 'node_modules', 'left-pad'), { recursive: true })
  writeFileSync(join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')
  writeFileSync(join(repo, 'local.conf'), 'port=4000\n')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('worktrees', () => {
  it('reads the repository, its branch and the workspace folder inside it', async () => {
    expect(await repoInfo(join(repo, 'app'), run)).toMatchObject({
      prefix: 'app/',
      branch: 'main',
      branches: ['main']
    })
    expect(await repoInfo(dir, run)).toBeNull()
  })

  it('creates the worktree on a new branch from HEAD, with the ignored files copied', async () => {
    const result = await create('bikube/fix-login')
    expect(result).toMatchObject({ ok: true, branch: 'bikube/fix-login', notCopied: [] })
    if (!result.ok) return
    const root = await git('rev-parse', '--show-toplevel')
    expect(result.path).toBe(join(worktreesRoot, repoFolder(root), 'fix-login'))
    expect(result.directory).toBe(result.path)
    expect(readFileSync(join(result.path, 'app', 'index.ts'), 'utf8')).toBe('export {}\n')
    expect(readFileSync(join(result.path, 'local.conf'), 'utf8')).toBe('port=4000\n')
    expect(existsSync(join(result.path, 'node_modules', 'left-pad', 'index.js'))).toBe(true)
    expect((await run('git', ['branch', '--show-current'], result.path)).stdout).toBe(
      'bikube/fix-login\n'
    )
    // The repository itself is untouched: still on main, with nothing new to commit.
    expect(await git('branch', '--show-current')).toBe('main')
    expect(await git('status', '--porcelain')).toBe('')
  })

  it("puts the card in the workspace's own folder inside the worktree", async () => {
    const result = await create('bikube/app', join(repo, 'app'))
    if (!result.ok) throw new Error(result.reason)
    expect(result.directory).toBe(join(result.path, 'app'))
  })

  it('refuses a branch that exists or is invalid, and a folder outside a repository', async () => {
    expect(await create('main')).toEqual({ ok: false, reason: 'Branch already exists' })
    expect(await create('bad name')).toEqual({ ok: false, reason: 'Not a valid branch name' })
    expect(await create('bikube/x', dir)).toEqual({ ok: false, reason: 'not a git repository' })
  })

  it('picks a free folder when the name is taken', async () => {
    const first = await create('a/same')
    const second = await create('b/same')
    if (!first.ok || !second.ok) throw new Error('not created')
    expect(second.path).toBe(`${first.path}-2`)
  })

  it('tells uncommitted changes, and removes the worktree keeping its branch', async () => {
    const result = await create('bikube/work')
    if (!result.ok) throw new Error(result.reason)
    expect(await worktreeDirty(result.path, run)).toBe(false)
    writeFileSync(join(result.path, 'app', 'new.ts'), 'x\n')
    expect(await worktreeDirty(result.path, run)).toBe(true)

    expect((await removeWorktree(repo, result.path, false, run, fs)).ok).toBe(false)
    expect(await removeWorktree(repo, result.path, true, run, fs)).toEqual({ ok: true })
    expect(existsSync(result.path)).toBe(false)
    expect(await git('branch', '--list', 'bikube/work')).toContain('bikube/work')
  })

  it('prunes a worktree whose folder is already gone', async () => {
    const result = await create('bikube/gone')
    if (!result.ok) throw new Error(result.reason)
    rmSync(result.path, { recursive: true, force: true })
    expect(await removeWorktree(repo, result.path, false, run, fs)).toEqual({ ok: true })
    expect(await git('worktree', 'list')).not.toContain(result.path)
  })
})
