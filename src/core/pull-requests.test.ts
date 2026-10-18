import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitIn, type GitRunner } from './git'
import { NOT_GITHUB, compareUrl, pushForPullRequest } from './pull-requests'

// Open pull request (#38): the compare URL GitHub opens for a pushed branch (D4).

describe('compareUrl', () => {
  it('accepts the GitHub remote forms', () => {
    for (const url of [
      'https://github.com/acme/widget.git',
      'https://github.com/acme/widget',
      'git@github.com:acme/widget.git',
      'ssh://git@github.com:22/acme/widget',
      'ssh://git@github.com/acme/widget.git',
      'https://me@github.com/acme/widget/',
      'HTTPS://GitHub.COM/acme/widget.git'
    ]) {
      expect(compareUrl(url, 'card-1'), url).toBe(
        'https://github.com/acme/widget/compare/card-1?expand=1'
      )
    }
  })

  it('refuses any other host or shape', () => {
    for (const url of [
      'https://github.com.evil.com/a/b',
      'https://evil.com/github.com/a/b',
      'git@gitlab.com:a/b',
      'https://gitlab.com/acme/widget.git',
      'https://github.com/acme',
      'https://github.com/acme/widget/extra',
      'https://github.com/ac me/widget',
      'https://github.com/acme/wid?get',
      'http://github.com/acme/widget',
      'git@github.com:acme/widget/x',
      '/srv/remote.git',
      ''
    ]) {
      expect(compareUrl(url, 'card-1'), url).toBeNull()
    }
  })

  it("percent-encodes each part of the branch and keeps its '/'s", () => {
    expect(compareUrl('git@github.com:acme/widget.git', 'feat/ä b')).toBe(
      'https://github.com/acme/widget/compare/feat/%C3%A4%20b?expand=1'
    )
    expect(compareUrl('git@github.com:acme/widget.git', 'topic/x#1')).toBe(
      'https://github.com/acme/widget/compare/topic/x%231?expand=1'
    )
  })
})

// On real throwaway repositories: `repo` is a clone of the local bare `remote.git`, whose
// `origin` has the GitHub URL `https://github.com/acme/widget.git` and `remote.git` as its push
// URL; it is on `card-1` with one commit of its own.

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

describe('pushForPullRequest', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drovr-pr-'))
    remote = join(dir, 'remote.git')
    repo = join(dir, 'repo')
    const seed = join(dir, 'seed')
    git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
    mkdirSync(seed)
    git(seed, 'init', '-q', '-b', 'main')
    git(seed, 'config', 'user.email', 'test@example.com')
    git(seed, 'config', 'user.name', 'Test')
    commit(seed, 'a.txt', 'one\n', 'first')
    git(seed, 'push', '-q', remote, 'main')
    git(dir, 'clone', '-q', remote, repo)
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/widget.git')
    git(repo, 'config', 'remote.origin.pushurl', remote)
    git(repo, 'switch', '-q', '-c', 'card-1')
    commit(repo, 'b.txt', 'card\n', 'card work')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("pushes the branch as origin's upstream, then gives its compare page", async () => {
    const result = await pushForPullRequest(repo, run)
    expect(result).toEqual({
      ok: true,
      url: 'https://github.com/acme/widget/compare/card-1?expand=1'
    })
    expect(git(remote, 'rev-parse', 'card-1')).toBe(git(repo, 'rev-parse', 'HEAD'))
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'card-1@{upstream}')).toBe('origin/card-1')
  })

  it("uses the upstream's remote, not origin, for the URL", async () => {
    git(repo, 'remote', 'add', 'fork', 'git@github.com:me/widget-fork.git')
    git(repo, 'config', 'remote.fork.pushurl', remote)
    git(repo, 'push', '-q', '--set-upstream', 'fork', 'card-1')
    commit(repo, 'c.txt', 'more\n', 'more work')
    const result = await pushForPullRequest(repo, run)
    expect(result).toEqual({
      ok: true,
      url: 'https://github.com/me/widget-fork/compare/card-1?expand=1'
    })
    expect(git(remote, 'rev-parse', 'card-1')).toBe(git(repo, 'rev-parse', 'HEAD'))
  })

  it('pushes the live branch, its parts encoded', async () => {
    git(repo, 'switch', '-q', '-c', 'topic/x')
    const result = await pushForPullRequest(repo, run)
    expect(result).toEqual({
      ok: true,
      url: 'https://github.com/acme/widget/compare/topic/x?expand=1'
    })
    expect(git(remote, 'rev-parse', 'topic/x')).toBe(git(repo, 'rev-parse', 'HEAD'))
  })

  it('still pushes to a remote that is not on GitHub, and says so', async () => {
    git(repo, 'remote', 'set-url', 'origin', 'https://gitlab.com/acme/widget.git')
    const result = await pushForPullRequest(repo, run)
    expect(result).toEqual({ ok: false, reason: NOT_GITHUB })
    expect(git(remote, 'rev-parse', 'card-1')).toBe(git(repo, 'rev-parse', 'HEAD'))
  })

  it("gives git's rejection and no URL when the push is refused, never forcing", async () => {
    const other = join(dir, 'other')
    git(dir, 'clone', '-q', remote, other)
    git(other, 'config', 'user.email', 'test@example.com')
    git(other, 'config', 'user.name', 'Test')
    git(other, 'switch', '-q', '-c', 'card-1')
    commit(other, 'x.txt', 'theirs\n', 'theirs')
    git(other, 'push', '-q', 'origin', 'card-1')
    const theirs = git(other, 'rev-parse', 'HEAD')

    const result = await pushForPullRequest(repo, run)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toContain('rejected')
    expect(git(remote, 'rev-parse', 'card-1')).toBe(theirs)
  })

  it("gives the open pull request's page for the pushed branch when one is known (D9)", async () => {
    const asked: string[] = []
    const known = (branch: string): string | null => {
      asked.push(branch)
      return branch === 'card-1' ? 'https://github.com/acme/widget/pull/12' : null
    }
    expect(await pushForPullRequest(repo, run, known)).toEqual({
      ok: true,
      url: 'https://github.com/acme/widget/pull/12'
    })
    expect(git(remote, 'rev-parse', 'card-1')).toBe(git(repo, 'rev-parse', 'HEAD'))
    git(repo, 'switch', '-q', '-c', 'topic/x')
    expect(await pushForPullRequest(repo, run, known)).toEqual({
      ok: true,
      url: 'https://github.com/acme/widget/compare/topic/x?expand=1'
    })
    expect(asked).toEqual(['card-1', 'topic/x'])
  })

  it('refuses a detached HEAD, pushing nothing', async () => {
    git(repo, 'switch', '-q', '--detach')
    expect(await pushForPullRequest(repo, run)).toEqual({ ok: false, reason: 'Not on a branch' })
    expect(git(remote, 'branch', '--list', 'card-1')).toBe('')
  })
})
