import { execFile, execFileSync, spawn, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  aheadBehind,
  createBranch,
  fetchAll,
  gitError,
  pull,
  push,
  gitIn,
  inRepository,
  listBranches,
  spawnRunner,
  switchBranch,
  trackBranch,
  type GitCall,
  type GitRunner
} from './git'

// The branch menu's git operations (#33), on real throwaway repositories: `repo` is a clone of
// the local bare `remote.git` (its `origin`), on `main` with a local `feature`; the remote also
// has `remote-only`.

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
let remote: string

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const commit = (cwd: string, file: string, text: string, message: string): void => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', message)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drovr-git-'))
  remote = join(dir, 'remote.git')
  repo = join(dir, 'repo')
  const seed = join(dir, 'seed')
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
  mkdirSync(seed)
  git(seed, 'init', '-q', '-b', 'main')
  git(seed, 'config', 'user.email', 'test@example.com')
  git(seed, 'config', 'user.name', 'Test')
  commit(seed, 'a.txt', 'one\n', 'first')
  git(seed, 'branch', 'feature')
  git(seed, 'branch', 'remote-only')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', '-q', 'origin', 'main', 'feature', 'remote-only')
  git(dir, 'clone', '-q', remote, repo)
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'branch', 'feature', 'origin/feature')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('inRepository', () => {
  it('is true inside a work tree, false outside one, and runs nothing else', async () => {
    expect(await inRepository(repo, run)).toBe(true)
    expect(await inRepository(join(repo, '.git'), run)).toBe(false)
    expect(await inRepository(dir, run)).toBe(false)
    const { calls, runner } = recording()
    await inRepository('/repo', gitIn(runner))
    expect(calls.map((call) => call.args)).toEqual([
      ['config', '--get', 'core.sshCommand'],
      ['rev-parse', '--is-inside-work-tree']
    ])
  })
})

describe('listBranches', () => {
  it('lists the local branches, the current one first, then each remote by name', async () => {
    expect(await listBranches(repo, run)).toEqual({
      current: 'main',
      local: ['main', 'feature'],
      remotes: [{ name: 'origin', branches: ['feature', 'main', 'remote-only'] }]
    })
  })

  it('has no current branch on a detached HEAD, and no remote sections without remotes', async () => {
    git(repo, 'switch', '-q', '--detach')
    git(repo, 'remote', 'remove', 'origin')
    expect(await listBranches(repo, run)).toEqual({
      current: null,
      local: ['feature', 'main'],
      remotes: []
    })
  })

  it('is null outside a repository', async () => {
    expect(await listBranches(dir, run)).toBeNull()
  })

  it('marks the current branch when a tag has the same name, and pushes it as itself', async () => {
    git(repo, 'switch', '-q', '-c', 'v1')
    git(repo, 'tag', 'v1')
    expect((await listBranches(repo, run))?.current).toBe('v1')
    expect(await push(repo, run)).toEqual({ ok: true, note: 'Pushed' })
    expect(git(remote, 'rev-parse', 'refs/heads/v1')).toBe(git(repo, 'rev-parse', 'HEAD'))
  })
})

describe('switchBranch', () => {
  it('switches to a local branch', async () => {
    expect(await switchBranch(repo, 'feature', run)).toEqual({ ok: true })
    expect(git(repo, 'branch', '--show-current')).toBe('feature')
  })

  it("is refused with git's message when it would overwrite uncommitted changes", async () => {
    git(repo, 'switch', '-q', 'feature')
    commit(repo, 'a.txt', 'feature\n', 'on feature')
    git(repo, 'switch', '-q', 'main')
    writeFileSync(join(repo, 'a.txt'), 'mine\n')
    const result = await switchBranch(repo, 'feature', run)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('would be overwritten')
    expect(git(repo, 'branch', '--show-current')).toBe('main')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('mine\n')
  })

  it('runs nothing for a branch that is not a local one', async () => {
    const calls: string[][] = []
    const spy = gitIn(async (call) => {
      calls.push(call.args)
      return runner(call)
    }, process.env)
    expect(await switchBranch(repo, '--orphan=x', spy)).toEqual({
      ok: false,
      reason: 'No branch --orphan=x'
    })
    expect(await switchBranch(repo, 'remote-only', spy)).toMatchObject({ ok: false })
    expect(calls.filter((args) => args[0] === 'switch')).toEqual([])
  })

  it('runs nothing for a listed ref that is not a valid branch name', async () => {
    git(repo, 'update-ref', 'refs/heads/-f', 'HEAD')
    const calls: string[][] = []
    const spy = gitIn(async (call) => {
      calls.push(call.args)
      return runner(call)
    }, process.env)
    expect(await switchBranch(repo, '-f', spy)).toEqual({
      ok: false,
      reason: 'Not a valid branch name'
    })
    expect(calls.filter((args) => args[0] === 'switch')).toEqual([])
  })
})

describe('trackBranch', () => {
  it('creates a local branch tracking a remote one that has none, and switches to it', async () => {
    expect(await trackBranch(repo, 'origin', 'remote-only', run)).toEqual({ ok: true })
    expect(git(repo, 'branch', '--show-current')).toBe('remote-only')
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/remote-only')
  })

  it('switches to the existing local branch of the same name', async () => {
    expect(await trackBranch(repo, 'origin', 'feature', run)).toEqual({ ok: true })
    expect(git(repo, 'branch', '--show-current')).toBe('feature')
    expect(git(repo, 'branch', '--list', '--format=%(refname:short)')).toBe('feature\nmain')
  })

  it('tracks a branch of a remote whose name starts with a dash, as a ref', async () => {
    git(repo, 'config', 'remote.-x.url', remote)
    git(repo, 'config', 'remote.-x.fetch', '+refs/heads/*:refs/remotes/-x/*')
    git(repo, 'fetch', '-q', '--', '-x')
    const calls: string[][] = []
    const spy = gitIn(async (call) => {
      calls.push(call.args)
      return runner(call)
    }, process.env)
    expect(await trackBranch(repo, '-x', 'remote-only', spy)).toEqual({ ok: true })
    expect(calls).toContainEqual([
      'switch',
      '--no-guess',
      '-c',
      'remote-only',
      '--track',
      'refs/remotes/-x/remote-only'
    ])
    expect(git(repo, 'branch', '--show-current')).toBe('remote-only')
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('-x/remote-only')
  })

  it('runs nothing for a remote branch the remote does not list', async () => {
    const calls: string[][] = []
    const spy = gitIn(async (call) => {
      calls.push(call.args)
      return runner(call)
    }, process.env)
    expect(await trackBranch(repo, 'origin', 'nope', spy)).toMatchObject({ ok: false })
    expect(await trackBranch(repo, 'upstream', 'main', spy)).toMatchObject({ ok: false })
    expect(calls.filter((args) => args[0] === 'switch')).toEqual([])
  })
})

describe('createBranch', () => {
  it('creates the branch at HEAD and switches to it', async () => {
    const head = git(repo, 'rev-parse', 'HEAD')
    expect(await createBranch(repo, 'topic/x', run)).toEqual({ ok: true })
    expect(git(repo, 'branch', '--show-current')).toBe('topic/x')
    expect(git(repo, 'rev-parse', 'topic/x')).toBe(head)
  })

  it('refuses an empty, invalid or taken name and runs no switch', async () => {
    const calls: string[][] = []
    const spy = gitIn(async (call) => {
      calls.push(call.args)
      return runner(call)
    }, process.env)
    expect(await createBranch(repo, '', spy)).toEqual({
      ok: false,
      reason: 'Enter a branch name',
      name: true
    })
    for (const bad of ['a..b', '-f', '@{-1}', 'x.lock']) {
      expect(await createBranch(repo, bad, spy)).toEqual({
        ok: false,
        reason: 'Not a valid branch name',
        name: true
      })
    }
    expect(await createBranch(repo, 'feature', spy)).toEqual({
      ok: false,
      reason: 'Branch already exists',
      name: true
    })
    expect(calls.filter((args) => args[0] === 'switch')).toEqual([])
    expect(git(repo, 'branch', '--show-current')).toBe('main')
  })

  it('asks git whether the name is valid', async () => {
    const calls: string[][] = []
    const spy = gitIn(async (call) => {
      calls.push(call.args)
      return runner(call)
    }, process.env)
    await createBranch(repo, 'topic/y', spy)
    expect(calls).toContainEqual(['check-ref-format', '--branch', 'topic/y'])
    expect(calls).toContainEqual(['switch', '--no-guess', '-c', 'topic/y'])
  })
})

/** A second clone of `remote.git`, as another machine pushing to it. */
function otherClone(): string {
  const other = join(dir, 'other')
  git(dir, 'clone', '-q', remote, other)
  git(other, 'config', 'user.email', 'test@example.com')
  git(other, 'config', 'user.name', 'Test')
  return other
}

describe('aheadBehind', () => {
  it("counts the current branch's commits against its upstream as of the last fetch", async () => {
    expect(await aheadBehind(repo, run)).toEqual({ ahead: 0, behind: 0 })
    const other = otherClone()
    commit(other, 'b.txt', 'theirs\n', 'theirs')
    git(other, 'push', '-q', 'origin', 'main')
    commit(repo, 'c.txt', 'one\n', 'mine 1')
    commit(repo, 'd.txt', 'two\n', 'mine 2')
    expect(await aheadBehind(repo, run)).toEqual({ ahead: 2, behind: 0 })
    git(repo, 'fetch', '-q')
    expect(await aheadBehind(repo, run)).toEqual({ ahead: 2, behind: 1 })
  })

  it('is null without an upstream, and on a detached HEAD', async () => {
    git(repo, 'switch', '-q', '-c', 'solo')
    expect(await aheadBehind(repo, run)).toBeNull()
    git(repo, 'switch', '-q', '--detach')
    expect(await aheadBehind(repo, run)).toBeNull()
  })
})

describe('fetchAll', () => {
  it('fetches every remote, dropping branches deleted there', async () => {
    const other = otherClone()
    git(other, 'push', '-q', 'origin', 'main:new-one')
    git(other, 'push', '-q', 'origin', '--delete', 'remote-only')
    expect(await fetchAll(repo, run)).toEqual({ ok: true, note: 'Fetched' })
    expect((await listBranches(repo, run))!.remotes).toEqual([
      { name: 'origin', branches: ['feature', 'main', 'new-one'] }
    ])
  })

  it('runs git fetch --all --prune without prompts', async () => {
    const { calls, runner } = recording()
    await fetchAll('/repo', gitIn(runner, { PATH: '/usr/bin' }))
    const fetch = calls.find((call) => call.args[0] === 'fetch')!
    expect(fetch.args).toEqual(['fetch', '--all', '--prune'])
    expect(fetch.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' })
    expect(fetch.timeoutMs).toBe(120_000)
  })

  it("gives git's message and the credential hint when the remote wants a password", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="drovr"' })
      response.end()
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    try {
      const { port } = server.address() as AddressInfo
      git(repo, 'remote', 'set-url', 'origin', `http://127.0.0.1:${port}/repo.git`)
      git(repo, 'config', 'remote.origin.proxy', '')
      const result = await fetchAll(repo, run)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.reason).toMatch(
        /\nSet up an SSH key or a git credential helper for this remote\.$/
      )
    } finally {
      server.close()
    }
  })

  it('says so when the repository has no remote, instead of Fetched', async () => {
    git(repo, 'remote', 'remove', 'origin')
    expect(await fetchAll(repo, run)).toEqual({
      ok: false,
      reason: 'This repository has no remote'
    })
  })

  it('reads a timeout as such', async () => {
    const timedOut: GitRunner = async (call) =>
      call.args[0] === 'fetch'
        ? { code: 1, stdout: '', stderr: '', timedOut: true }
        : { code: 1, stdout: '', stderr: '' }
    expect(await fetchAll('/repo', gitIn(timedOut))).toEqual({
      ok: false,
      reason: 'git timed out'
    })
  })
})

describe('pull', () => {
  it('fast-forwards to the upstream, or says it is already up to date', async () => {
    const other = otherClone()
    commit(other, 'b.txt', 'theirs\n', 'theirs')
    git(other, 'push', '-q', 'origin', 'main')
    expect(await pull(repo, run)).toEqual({ ok: true, note: 'Pulled' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(other, 'rev-parse', 'HEAD'))
    expect(await aheadBehind(repo, run)).toEqual({ ahead: 0, behind: 0 })
    expect(await pull(repo, run)).toEqual({ ok: true, note: 'Already up to date' })
  })

  it("refuses a diverged branch with git's message and changes nothing", async () => {
    const other = otherClone()
    commit(other, 'b.txt', 'theirs\n', 'theirs')
    git(other, 'push', '-q', 'origin', 'main')
    commit(repo, 'c.txt', 'mine\n', 'mine')
    const head = git(repo, 'rev-parse', 'HEAD')
    const result = await pull(repo, run)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('Not possible to fast-forward')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('runs git pull --ff-only, and nothing on a detached HEAD', async () => {
    const calls: string[][] = []
    const spy = gitIn(async (call) => {
      calls.push(call.args)
      return runner(call)
    }, process.env)
    await pull(repo, spy)
    expect(calls).toContainEqual(['pull', '--ff-only'])
    calls.length = 0
    git(repo, 'switch', '-q', '--detach')
    expect(await pull(repo, spy)).toEqual({ ok: false, reason: 'Not on a branch' })
    expect(calls.filter((args) => args[0] === 'pull')).toEqual([])
  })
})

describe('pull without an upstream', () => {
  /** `repo`'s `main` with its upstream unset, as after `git init` and `git remote add`. */
  const untrack = (): void => {
    git(repo, 'branch', '--unset-upstream')
  }

  it("tracks the remote's branch of the same name, then pulls", async () => {
    untrack()
    const other = otherClone()
    commit(other, 'b.txt', 'theirs\n', 'theirs')
    git(other, 'push', '-q', 'origin', 'main')
    git(repo, 'fetch', '-q')
    expect(await pull(repo, run)).toEqual({ ok: true, note: 'Pulled · now tracking origin/main' })
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/main')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(other, 'rev-parse', 'HEAD'))
  })

  it('says when it was already up to date', async () => {
    untrack()
    expect(await pull(repo, run)).toEqual({
      ok: true,
      note: 'Already up to date · now tracking origin/main'
    })
  })

  it('prefers origin, else the one remote with that branch', async () => {
    untrack()
    git(repo, 'remote', 'add', 'aaa', remote)
    git(repo, 'fetch', '-q', 'aaa')
    await pull(repo, run)
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/main')
    git(repo, 'branch', '--unset-upstream')
    git(repo, 'remote', 'remove', 'origin')
    await pull(repo, run)
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('aaa/main')
  })

  it('tracks nothing when two remotes other than origin have the branch', async () => {
    untrack()
    git(repo, 'remote', 'rename', 'origin', 'one')
    git(repo, 'remote', 'add', 'two', remote)
    git(repo, 'fetch', '-q', 'two')
    expect(await pull(repo, run)).toEqual({
      ok: false,
      reason: 'No upstream: main is on more than one remote'
    })
    expect(() => git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toThrow()
  })

  it('says Push creates it when no remote has the branch', async () => {
    git(repo, 'switch', '-q', '-c', 'topic/new')
    expect(await pull(repo, run)).toEqual({
      ok: false,
      reason: 'No origin/topic/new to pull from: Push creates it'
    })
  })

  it('says so when the repository has no remote', async () => {
    untrack()
    git(repo, 'remote', 'remove', 'origin')
    expect(await pull(repo, run)).toEqual({ ok: false, reason: 'This repository has no remote' })
  })
})

describe('push', () => {
  it('pushes a branch without an upstream to origin and makes it its upstream', async () => {
    git(repo, 'switch', '-q', '-c', 'topic/x')
    commit(repo, 'c.txt', 'mine\n', 'mine')
    expect(await aheadBehind(repo, run)).toBeNull()
    expect(await push(repo, run)).toEqual({ ok: true, note: 'Pushed' })
    expect(git(remote, 'rev-parse', 'topic/x')).toBe(git(repo, 'rev-parse', 'HEAD'))
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/topic/x')
    expect(await aheadBehind(repo, run)).toEqual({ ahead: 0, behind: 0 })
  })

  it('pushes a branch with an upstream to it', async () => {
    commit(repo, 'c.txt', 'mine\n', 'mine')
    expect(await push(repo, run)).toEqual({ ok: true, note: 'Pushed' })
    expect(git(remote, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'HEAD'))
  })

  it("is rejected with git's message when the remote moved ahead, never forced", async () => {
    const other = otherClone()
    commit(other, 'b.txt', 'theirs\n', 'theirs')
    git(other, 'push', '-q', 'origin', 'main')
    commit(repo, 'c.txt', 'mine\n', 'mine')
    const result = await push(repo, run)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('rejected')
    expect(git(remote, 'rev-parse', 'main')).toBe(git(other, 'rev-parse', 'HEAD'))
  })

  it('runs git push, or --set-upstream origin with the branch as a ref; nothing detached', async () => {
    const calls: string[][] = []
    const spy = gitIn(async (call) => {
      calls.push(call.args)
      return runner(call)
    }, process.env)
    await push(repo, spy)
    expect(calls).toContainEqual(['push'])
    git(repo, 'switch', '-q', '-c', 'topic/y')
    await push(repo, spy)
    expect(calls).toContainEqual(['push', '--set-upstream', 'origin', 'refs/heads/topic/y'])
    expect(calls.flat()).not.toContain('--force')
    calls.length = 0
    git(repo, 'switch', '-q', '--detach')
    expect(await push(repo, spy)).toEqual({ ok: false, reason: 'Not on a branch' })
    expect(calls.filter((args) => args[0] === 'push')).toEqual([])
  })

  it("gives git's error without an origin remote", async () => {
    git(repo, 'switch', '-q', '-c', 'topic/z')
    git(repo, 'remote', 'remove', 'origin')
    const result = await push(repo, run)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('origin')
  })
})

describe('gitError', () => {
  it("keeps git's meaningful lines, without hints or prefixes", () => {
    const stderr = [
      'error: Your local changes to the following files would be overwritten by checkout:',
      '\ta.txt',
      'hint: try stashing',
      '',
      'Aborting',
      ''
    ].join('\n')
    expect(gitError({ code: 1, stdout: '', stderr }, 'switch')).toBe(
      'Your local changes to the following files would be overwritten by checkout:\na.txt\nAborting'
    )
  })

  it("keeps git's refusal after a long fetch preamble", () => {
    const updates = Array.from(
      { length: 20 },
      (_, i) => `   1a2b3c${i}..4d5e6f${i}  branch-${i}     -> origin/branch-${i}`
    )
    const stderr = [
      'POST git-upload-pack (175 bytes)',
      'Fetching origin',
      'From https://example.com/team/project',
      ...updates,
      ' * [new branch]      topic      -> origin/topic',
      ' + 0a1b2c3...4d5e6f7 forced     -> origin/forced  (forced update)',
      ' - [deleted]         (none)     -> origin/gone',
      'hint: Diverging branches can’t be fast-forwarded, you need to either:',
      'hint:   git merge --no-ff',
      'fatal: Not possible to fast-forward, aborting.',
      ''
    ].join('\n')
    expect(gitError({ code: 128, stdout: '', stderr }, 'pull')).toBe(
      'Not possible to fast-forward, aborting.'
    )
  })

  it("keeps the cause ssh or the remote printed before git's own error", () => {
    const ssh = [
      'Fetching origin',
      'ssh: connect to host example.com port 22: Connection refused',
      'fatal: Could not read from remote repository.'
    ].join('\n')
    expect(gitError({ code: 128, stdout: '', stderr: ssh }, 'fetch')).toBe(
      'ssh: connect to host example.com port 22: Connection refused\n' +
        'Could not read from remote repository.'
    )
    const hook = [
      'remote: error: GH006: Protected branch update failed for refs/heads/main.',
      'To github.com:team/project.git',
      ' ! [remote rejected] main -> main (protected branch hook declined)',
      "error: failed to push some refs to 'github.com:team/project.git'"
    ].join('\n')
    expect(gitError({ code: 1, stdout: '', stderr: hook }, 'push')).toBe(
      'remote: error: GH006: Protected branch update failed for refs/heads/main.\n' +
        '! [remote rejected] main -> main (protected branch hook declined)\n' +
        "failed to push some refs to 'github.com:team/project.git'"
    )
  })

  it('drops progress and ref updates when git printed no error line', () => {
    const stderr = [
      'Fetching origin',
      'From /tmp/remote',
      '   1a2b3c4..4d5e6f7  main       -> origin/main',
      'Something else went wrong',
      ''
    ].join('\n')
    expect(gitError({ code: 1, stdout: '', stderr }, 'fetch')).toBe('Something else went wrong')
  })

  it('keeps the end of a long message of many lines', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `remote: line ${i} of the hook output`)
    const stderr = [' ! [remote rejected] main -> main (pre-receive hook declined)', ...lines]
      .concat('error: failed to push some refs')
      .join('\n')
    const message = gitError({ code: 1, stdout: '', stderr }, 'push')
    expect(message.length).toBeLessThanOrEqual(400)
    expect(message.startsWith('…\n')).toBe(true)
    expect(message.endsWith('failed to push some refs')).toBe(true)
  })

  it('trims a long message to 400 characters', () => {
    const message = gitError({ code: 1, stdout: '', stderr: `fatal: ${'x'.repeat(1000)}` }, 'push')
    expect(message).toHaveLength(400)
    expect(message.endsWith('…')).toBe(true)
  })

  it('names the command when git said nothing, and a timeout as such', () => {
    expect(gitError({ code: 128, stdout: '', stderr: '' }, 'fetch')).toBe('git fetch failed')
    expect(gitError({ code: 1, stdout: '', stderr: 'partial', timedOut: true }, 'fetch')).toBe(
      'git timed out'
    )
  })

  it('ends with how to set up credentials when git needed some', () => {
    for (const stderr of [
      "fatal: could not read Username for 'http://127.0.0.1:1': terminal prompts disabled",
      'git@example.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
      'Host key verification failed.'
    ]) {
      expect(gitError({ code: 128, stdout: '', stderr }, 'fetch')).toMatch(
        /\nSet up an SSH key or a git credential helper for this remote\.$/
      )
    }
  })
})

/** A runner that records every call and answers `git config --get core.sshCommand` with `config`. */
function recording(config = ''): { calls: GitCall[]; runner: GitRunner } {
  const calls: GitCall[] = []
  return {
    calls,
    runner: async (call) => {
      calls.push(call)
      const lookup = call.args.join(' ') === 'config --get core.sshCommand'
      if (lookup) {
        return config
          ? { code: 0, stdout: `${config}\n`, stderr: '' }
          : { code: 1, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
  }
}

/** The environment `base` gives the command `switch feature`, with `config` as core.sshCommand. */
async function commandEnv(
  base: Record<string, string | undefined>,
  config = ''
): Promise<Record<string, string>> {
  const { calls, runner } = recording(config)
  await gitIn(runner, base)('/repo', ['switch', 'feature'])
  return calls.find((call) => call.args[0] === 'switch')!.env
}

describe('gitIn', () => {
  it('runs every command without prompts, in batch mode, with a two-minute limit', async () => {
    const { calls, runner } = recording()
    const git = gitIn(runner, {
      PATH: '/usr/bin',
      HOME: '/home/me',
      GIT_ASKPASS: '/usr/bin/ksshaskpass',
      UNSET: undefined
    })
    await git('/repo', ['switch', 'feature'])
    expect(calls.filter((call) => call.args[0] === 'switch')).toEqual([
      {
        args: ['switch', 'feature'],
        cwd: '/repo',
        timeoutMs: 120_000,
        env: {
          PATH: '/usr/bin',
          HOME: '/home/me',
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
          SSH_ASKPASS_REQUIRE: 'never',
          GCM_INTERACTIVE: 'never',
          GIT_SSH_COMMAND: 'ssh -o BatchMode=yes'
        }
      }
    ])
  })

  it("keeps the user's GIT_SSH_COMMAND, in batch mode, before any core.sshCommand", async () => {
    const env = await commandEnv({ GIT_SSH_COMMAND: 'ssh -i ~/.ssh/work' }, 'ssh -i ~/.ssh/other')
    expect(env.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/work -o BatchMode=yes')
  })

  it("keeps the folder's core.sshCommand, in batch mode, before GIT_SSH", async () => {
    const env = await commandEnv({ GIT_SSH: '/usr/bin/plink' }, 'ssh -i ~/.ssh/work')
    expect(env.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/work -o BatchMode=yes')
  })

  it("leaves the user's GIT_SSH alone, still without prompts", async () => {
    const env = await commandEnv({ GIT_SSH: '/usr/local/bin/my-ssh' })
    expect(env).not.toHaveProperty('GIT_SSH_COMMAND')
    expect(env).toMatchObject({
      GIT_SSH: '/usr/local/bin/my-ssh',
      GIT_TERMINAL_PROMPT: '0',
      SSH_ASKPASS_REQUIRE: 'never'
    })
  })

  it('reads core.sshCommand in the folder the command runs in', async () => {
    git(repo, 'config', 'core.sshCommand', 'ssh -i /keys/repo')
    const calls: GitCall[] = []
    const base = { PATH: process.env.PATH, HOME: process.env.HOME }
    await gitIn(async (call) => {
      calls.push(call)
      return runner(call)
    }, base)(repo, ['status'])
    const status = calls.find((call) => call.args[0] === 'status')!
    expect(status.env.GIT_SSH_COMMAND).toBe('ssh -i /keys/repo -o BatchMode=yes')
  })
})

describe('spawnRunner', () => {
  it('runs git in a session of its own off Windows, so ssh has no terminal to ask on', async () => {
    const options: SpawnOptions[] = []
    const fake = ((command: string, args: string[], opts: SpawnOptions) => {
      options.push(opts)
      return spawn(command, args, opts)
    }) as typeof spawn
    const call = {
      args: ['--version'],
      cwd: dir,
      env: { PATH: process.env.PATH! },
      timeoutMs: 5000
    }
    const output = await spawnRunner(fake, 'linux')(call)
    expect(output).toMatchObject({ code: 0, timedOut: false })
    expect(output.stdout).toMatch(/^git version /)
    expect(await spawnRunner(fake, 'win32')(call)).toMatchObject({ code: 0 })
    expect(options.map((opts) => opts.detached)).toEqual([true, undefined])
    expect(options[0]).toMatchObject({ cwd: dir, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  })

  it('reads a non-zero exit, and ends a command at its time limit', async () => {
    const real = spawnRunner(spawn, process.platform)
    const env = { PATH: process.env.PATH!, HOME: dir }
    const failed = await real({ args: ['rev-parse', 'HEAD'], cwd: dir, env, timeoutMs: 5000 })
    expect(failed).toMatchObject({ code: 128, timedOut: false })
    expect(failed.stderr).toMatch(/not a git repository/)
    const started = Date.now()
    const slow = await real({
      args: ['-c', 'alias.slow=!sleep 30', 'slow'],
      cwd: dir,
      env,
      timeoutMs: 300
    })
    expect(slow.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})
