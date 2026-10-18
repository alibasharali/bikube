/**
 * The title bar's branch menu (#33): reads a folder's local and remote branches and switches
 * between them. Plain TS with git injected (`GitRunner`), so Vitest drives real throwaway
 * repositories. Every command gets the same no-prompt environment and timeout (D12): main runs
 * it through `spawnRunner`, no shell, stdin closed, without a controlling terminal.
 */

import type { spawn as nodeSpawn } from 'node:child_process'
import { branchProblem } from './worktree-names'

/** One git command: its arguments (never through a shell), folder, environment and time limit. */
export interface GitCall {
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}

export interface GitOutput {
  code: number
  stdout: string
  stderr: string
  /** Killed at `timeoutMs`. */
  timedOut?: boolean
  /** stdout went past `OUTPUT_MAX`: `stdout` is only its start, possibly cut mid-record. */
  truncated?: boolean
}

/** Runs `git` with the call's arguments; never throws. */
export type GitRunner = (call: GitCall) => Promise<GitOutput>

/** The most output kept from one command's stdout or stderr. */
const OUTPUT_MAX = 16 * 1024 * 1024

/**
 * The `GitRunner` main uses (D12): `git` started with `spawn` (no shell), stdin closed, and off
 * Windows `detached`, i.e. in a session of its own (`setsid`) with no controlling terminal, so ssh
 * can't open `/dev/tty` to ask for a password or passphrase even when `GIT_SSH` keeps it out of
 * batch mode and Drovr was started from a terminal. (`execFile` drops `detached`.) At `timeoutMs`
 * the command's whole process group (git, ssh, a credential helper) gets SIGTERM; on Windows,
 * where `detached` would open a console, git alone.
 */
export function spawnRunner(spawn: typeof nodeSpawn, platform: NodeJS.Platform): GitRunner {
  const detached = platform !== 'win32'
  return ({ args, cwd, env, timeoutMs }) =>
    new Promise((done) => {
      const child = spawn('git', args, {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        ...(detached ? { detached: true } : {})
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let truncated = false
      let settled = false
      const finish = (output: GitOutput): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        done(output)
      }
      const timer = setTimeout(() => {
        timedOut = true
        try {
          if (detached && child.pid !== undefined) process.kill(-child.pid, 'SIGTERM')
          else child.kill()
        } catch {
          child.kill()
        }
      }, timeoutMs)
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        const room = OUTPUT_MAX - stdout.length
        if (chunk.length > room) truncated = true
        if (room > 0) stdout += chunk.slice(0, room)
      })
      child.stderr?.on('data', (chunk: string) => {
        if (stderr.length < OUTPUT_MAX) stderr += chunk
      })
      child.on('error', (error) =>
        finish({ code: 1, stdout, stderr: stderr || error.message, timedOut, truncated })
      )
      child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr, timedOut, truncated }))
    })
}

/** A git command's whole time (D12): long enough for a slow fetch, short of a hung prompt. */
export const GIT_TIMEOUT_MS = 2 * 60 * 1000

export const CREDENTIAL_HINT = 'Set up an SSH key or a git credential helper for this remote.'

/** How long git's message may be in the menu's error line (D6). */
const MESSAGE_MAX = 400

/**
 * `base` (main's environment) with every way git or ssh could ask for input turned off (D12): no
 * terminal prompt, no askpass program (an empty one counts as none), ssh in batch mode. The user's
 * own ssh is kept, in git's order: `GIT_SSH_COMMAND`, else the folder's `core.sshCommand`
 * (`sshCommand`), each with `-o BatchMode=yes` added; else `GIT_SSH` is left alone; else plain
 * `ssh`. Keys in an agent and credential helpers still work.
 */
export function gitEnv(
  base: Record<string, string | undefined>,
  sshCommand: string | null = null
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) if (value !== undefined) env[key] = value
  const ssh =
    base.GIT_SSH_COMMAND?.trim() || sshCommand?.trim() || (base.GIT_SSH?.trim() ? null : 'ssh')
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    GCM_INTERACTIVE: 'never',
    ...(ssh ? { GIT_SSH_COMMAND: `${ssh} -o BatchMode=yes` } : {})
  }
}

/** Runs one git command in `dir` with the no-prompt environment and the timeout. */
export type Git = (dir: string, args: string[]) => Promise<GitOutput>

/**
 * A `Git` over `runner`, with `base` as the environment to start from. Without `GIT_SSH_COMMAND`
 * in `base`, each command first reads `core.sshCommand` in its folder (with no ssh involved).
 */
export function gitIn(runner: GitRunner, base: Record<string, string | undefined> = {}): Git {
  const plain = gitEnv(base)
  const call = (cwd: string, args: string[], env: Record<string, string>): Promise<GitOutput> =>
    runner({ args, cwd, env, timeoutMs: GIT_TIMEOUT_MS })
  return async (cwd, args) => {
    if (base.GIT_SSH_COMMAND?.trim()) return call(cwd, args, plain)
    const config = await call(cwd, ['config', '--get', 'core.sshCommand'], plain)
    const sshCommand = config.code === 0 ? config.stdout.trim() || null : null
    return call(cwd, args, sshCommand ? gitEnv(base, sshCommand) : plain)
  }
}

/**
 * A `Git` for read-only local commands (#55 D16: `status`, `check-ignore`, `rev-parse`) over
 * `runner`, with the no-prompt environment from `base`: every command gets
 * `--no-optional-locks`, so a polled read never takes the index lock a running agent's git
 * needs. Unlike `gitIn` it never reads `core.sshCommand` first: these commands reach no remote.
 */
export function readOnlyGit(runner: GitRunner, base: Record<string, string | undefined> = {}): Git {
  const env = gitEnv(base)
  return (cwd, args) =>
    runner({
      args: ['--no-optional-locks', ...args],
      cwd,
      env,
      timeoutMs: GIT_TIMEOUT_MS
    })
}

export interface RemoteBranches {
  /** The remote's name, e.g. `origin`. */
  name: string
  /** Its branches without the remote's prefix and without `HEAD`, sorted by name. */
  branches: string[]
}

export interface BranchList {
  /** The checked-out branch; null on a detached HEAD. */
  current: string | null
  /** Every local branch, sorted by name with the current one first. */
  local: string[]
  /** One entry per remote, sorted by name; each as the last fetch left it. */
  remotes: RemoteBranches[]
}

export type GitResult = { ok: true } | { ok: false; reason: string }

/** A new branch's outcome: `name` when the name was refused before git ran (D7). */
export type NewBranchResult = { ok: true } | { ok: false; reason: string; name?: true }

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Whether `dir` is inside a git work tree (D15): main asks before running any other git command
 * there. False outside one, in a `.git` folder or without git.
 */
export async function inRepository(dir: string, run: Git): Promise<boolean> {
  const inside = await run(dir, ['rev-parse', '--is-inside-work-tree'])
  return inside.code === 0 && !inside.timedOut && inside.stdout.trim() === 'true'
}

/** The branches of the repository `dir` is in, or null outside one (or without git). */
export async function listBranches(dir: string, run: Git): Promise<BranchList | null> {
  if (!(await inRepository(dir, run))) return null
  const [head, refs, remotes] = await Promise.all([
    run(dir, ['symbolic-ref', '--quiet', 'HEAD']),
    run(dir, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']),
    run(dir, ['remote'])
  ])
  const current = headBranch(head)
  const names = refs.code === 0 ? refs.stdout.split('\n').filter(Boolean) : []
  const local = names
    .filter((ref) => ref.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length))
    .sort((a, b) => (a === current ? -1 : b === current ? 1 : byName(a, b)))
  // Longest remote names first, so `up/stream` wins over `up` for `refs/remotes/up/stream/x`.
  const remoteNames = (remotes.code === 0 ? remotes.stdout.split('\n') : [])
    .map((name) => name.trim())
    .filter(Boolean)
  const byLength = [...remoteNames].sort((a, b) => b.length - a.length)
  const branches = new Map<string, string[]>(remoteNames.map((name) => [name, []]))
  for (const ref of names) {
    if (!ref.startsWith('refs/remotes/')) continue
    const rest = ref.slice('refs/remotes/'.length)
    const remote = byLength.find((name) => rest.startsWith(`${name}/`))
    if (!remote) continue
    const branch = rest.slice(remote.length + 1)
    if (branch && branch !== 'HEAD') branches.get(remote)!.push(branch)
  }
  return {
    current,
    local,
    remotes: remoteNames
      .sort(byName)
      .map((name) => ({ name, branches: branches.get(name)!.sort(byName) }))
  }
}

/**
 * Switches `dir`'s repository to the local `branch` (D4); only a branch `for-each-ref` lists is
 * run (D15). A refusal (changes it would overwrite, a branch checked out elsewhere) changes
 * nothing and gives git's message (D6).
 */
export async function switchBranch(dir: string, branch: string, run: Git): Promise<GitResult> {
  const list = await listBranches(dir, run)
  if (!list) return { ok: false, reason: 'not a git repository' }
  if (!list.local.includes(branch)) return { ok: false, reason: `No branch ${branch}` }
  if (branch === list.current) return { ok: true }
  return switchTo(dir, branch, run)
}

/** `git switch <branch>`, after `check-ref-format` (a name like `-f` would read as an option). */
async function switchTo(dir: string, branch: string, run: Git): Promise<GitResult> {
  if (!(await validBranchName(dir, branch, run))) return { ok: false, reason: INVALID_NAME }
  return outcome(await run(dir, ['switch', '--no-guess', branch]), 'switch')
}

const INVALID_NAME = 'Not a valid branch name'

/** Whether git takes `name` as a branch name (D15); a new branch's check too (D7). */
export async function validBranchName(dir: string, name: string, run: Git): Promise<boolean> {
  return (await run(dir, ['check-ref-format', '--branch', name])).code === 0
}

/**
 * Switches to `remote`'s `branch` (D5): to the local branch of that name when there is one, else
 * a new local branch tracking it (`git switch -c <branch> --track
 * refs/remotes/<remote>/<branch>`). Only a remote branch `for-each-ref` lists is run (D15).
 */
export async function trackBranch(
  dir: string,
  remote: string,
  branch: string,
  run: Git
): Promise<GitResult> {
  const list = await listBranches(dir, run)
  if (!list) return { ok: false, reason: 'not a git repository' }
  const listed = list.remotes.find((r) => r.name === remote)?.branches.includes(branch)
  if (!listed) return { ok: false, reason: `No branch ${remote}/${branch}` }
  if (list.local.includes(branch)) {
    return branch === list.current ? { ok: true } : switchTo(dir, branch, run)
  }
  if (!(await validBranchName(dir, branch, run))) return { ok: false, reason: INVALID_NAME }
  // The start point as a full ref, so a remote named like `-x` never reads as an option; git
  // still sets the upstream to `<remote>/<branch>`.
  const start = `refs/remotes/${remote}/${branch}`
  const args = ['switch', '--no-guess', '-c', branch, '--track', start]
  return outcome(await run(dir, args), 'switch')
}

/**
 * Creates the branch `name` at HEAD and switches to it (D7: `git switch -c <name>`). The name is
 * checked first, as for a worktree card's branch (`branchProblem`, then git's own
 * `check-ref-format --branch`, then the local branches); an empty, invalid or taken name runs
 * nothing and is refused with `name` set. git's own refusal changes nothing (D6).
 */
export async function createBranch(dir: string, name: string, run: Git): Promise<NewBranchResult> {
  const problem = branchProblem(name)
  if (problem) return { ok: false, reason: problem, name: true }
  const list = await listBranches(dir, run)
  if (!list) return { ok: false, reason: 'not a git repository' }
  if (!(await validBranchName(dir, name, run))) {
    return { ok: false, reason: INVALID_NAME, name: true }
  }
  if (list.local.includes(name)) return { ok: false, reason: 'Branch already exists', name: true }
  return outcome(await run(dir, ['switch', '--no-guess', '-c', name]), 'switch')
}

function outcome(output: GitOutput, command: string): GitResult {
  return output.code === 0 && !output.timedOut
    ? { ok: true }
    : { ok: false, reason: gitError(output, command) }
}

/**
 * What the menu's error line says when git fails (D6, D12): `git timed out`, else the meaningful
 * lines of git's stderr, followed by how to set up credentials when git needed some it couldn't
 * ask for. Meaningful: no hints, no blank lines, no progress or ref updates (a pull's or fetch's
 * `From …`, `a..b main -> origin/main`; ssh's or the remote's cause before git's own error is
 * kept), without the `error:`/`fatal:` prefixes. Over 400 characters, the last lines are kept
 * (git's refusal comes last), after a `…` line.
 */
export function gitError(output: GitOutput, command: string): string {
  if (output.timedOut) return 'git timed out'
  const lines = output.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^hint:/.test(line) && !PROGRESS.some((p) => p.test(line)))
  const kept = lines.map((line) => line.replace(/^(fatal|error):\s*/, ''))
  const message = trimToEnd(kept) || `git ${command} failed`
  return needsCredentials(output.stderr) ? `${message}\n${CREDENTIAL_HINT}` : message
}

/** The lines a fetch, pull or push prints on its way (trimmed): never the reason it failed. */
const PROGRESS = [
  /^Fetching \S+$/,
  /^(From|To) \S/,
  /^POST git-(upload|receive)-pack/,
  /^\+?\s*[0-9a-f]{4,}\.\.\.?[0-9a-f]{4,}\s/,
  /^[*=t-] \[(new (branch|tag|ref)|deleted|up to date|tag update)\]/
]

/**
 * `lines` as one text of at most 400 characters: whole lines from the start dropped for a `…`
 * line until it fits; a last line too long by itself is cut at its end instead.
 */
function trimToEnd(lines: string[]): string {
  const text = lines.join('\n')
  if (text.length <= MESSAGE_MAX) return text
  const last = lines[lines.length - 1]!
  if (last.length + 2 > MESSAGE_MAX) return `${last.slice(0, MESSAGE_MAX - 1)}…`
  let kept = [last]
  for (let i = lines.length - 2; i >= 0; i--) {
    const next = [lines[i]!, ...kept]
    if (next.join('\n').length + 2 > MESSAGE_MAX) break
    kept = next
  }
  return ['…', ...kept].join('\n')
}

/** What git and ssh print when they would have had to ask for a password, passphrase or key. */
const CREDENTIAL_FAILURES = [
  /terminal prompts disabled/i,
  /could not read (username|password)/i,
  /authentication failed/i,
  /permission denied \(/i,
  /host key verification failed/i
]

function needsCredentials(stderr: string): boolean {
  return CREDENTIAL_FAILURES.some((pattern) => pattern.test(stderr))
}

/** The current branch's commits ahead of and behind its upstream, as of the last fetch (D10). */
export interface AheadBehind {
  ahead: number
  behind: number
}

/**
 * How far the current branch is from its upstream (D10: `git rev-list --left-right --count
 * HEAD...@{upstream}`); null without an upstream, on a detached HEAD or outside a repository.
 */
export async function aheadBehind(dir: string, run: Git): Promise<AheadBehind | null> {
  const output = await run(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
  if (output.code !== 0 || output.timedOut) return null
  const [ahead, behind] = output.stdout.trim().split(/\s+/).map(Number)
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) return null
  return { ahead: ahead!, behind: behind! }
}

/** Fetch, Pull and Push (D8, D9): the note the menu shows on success, else git's message. */
export type SyncResult = { ok: true; note: string } | { ok: false; reason: string }

function synced(output: GitOutput, command: string, note: string): SyncResult {
  return output.code === 0 && !output.timedOut
    ? { ok: true, note }
    : { ok: false, reason: gitError(output, command) }
}

const NO_REMOTE: SyncResult = { ok: false, reason: 'This repository has no remote' }

/** The repository's remotes by name; empty when it has none. */
async function remoteNames(dir: string, run: Git): Promise<string[]> {
  const output = await run(dir, ['remote'])
  return output.code === 0 ? output.stdout.split('\n').filter(Boolean) : []
}

/** Fetches every remote, removing remote branches deleted there (D8: `git fetch --all --prune`). */
export async function fetchAll(dir: string, run: Git): Promise<SyncResult> {
  const result = synced(await run(dir, ['fetch', '--all', '--prune']), 'fetch', 'Fetched')
  // With no remote git fetches nothing and still succeeds.
  if (result.ok && (await remoteNames(dir, run)).length === 0) return NO_REMOTE
  return result
}

/** The checked-out branch; null on a detached HEAD or outside a repository. */
export async function currentBranch(dir: string, run: Git): Promise<string | null> {
  return headBranch(await run(dir, ['symbolic-ref', '--quiet', 'HEAD']))
}

/**
 * The branch `git symbolic-ref --quiet HEAD` names, without `refs/heads/` (not `--short`, which
 * gives `heads/v1` when a tag `v1` exists too); null for anything else, read as detached.
 */
function headBranch(head: GitOutput): string | null {
  const ref = head.code === 0 && !head.timedOut ? head.stdout.trim() : ''
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) || null : null
}

const NOT_ON_BRANCH: SyncResult = { ok: false, reason: 'Not on a branch' }

/**
 * Fast-forwards the current branch to its upstream (D9: `git pull --ff-only`); a diverged branch
 * is refused with git's message (D6). `Already up to date` when HEAD didn't move.
 */
export async function pull(dir: string, run: Git): Promise<SyncResult> {
  const branch = await currentBranch(dir, run)
  if (!branch) return NOT_ON_BRANCH
  let tracking = ''
  if (!(await hasUpstream(dir, run))) {
    const adopted = await adoptUpstream(dir, branch, run)
    if (!adopted.ok) return adopted
    tracking = ` · now tracking ${adopted.note}`
  }
  const before = await run(dir, ['rev-parse', 'HEAD'])
  const output = await run(dir, ['pull', '--ff-only'])
  const result = synced(output, 'pull', 'Pulled')
  if (!result.ok) return result
  const after = await run(dir, ['rev-parse', 'HEAD'])
  const moved = !(before.code === 0 && after.code === 0 && before.stdout === after.stdout)
  return { ok: true, note: `${moved ? 'Pulled' : 'Already up to date'}${tracking}` }
}

async function hasUpstream(dir: string, run: Git): Promise<boolean> {
  const output = await run(dir, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}'
  ])
  return output.code === 0 && !output.timedOut
}

/**
 * Makes the remote branch named like `branch` its upstream, as of the last fetch: `origin`'s, else
 * the one remote's that has it. The note is the upstream's name (`origin/main`).
 */
async function adoptUpstream(dir: string, branch: string, run: Git): Promise<SyncResult> {
  const list = await listBranches(dir, run)
  if (!list || list.remotes.length === 0) return NO_REMOTE
  const having = list.remotes.filter((r) => r.branches.includes(branch)).map((r) => r.name)
  const remote = having.includes('origin') ? 'origin' : having.length === 1 ? having[0] : undefined
  if (!remote) {
    if (having.length > 1)
      return { ok: false, reason: `No upstream: ${branch} is on more than one remote` }
    return list.remotes.some((r) => r.name === 'origin')
      ? { ok: false, reason: `No origin/${branch} to pull from: Push creates it` }
      : { ok: false, reason: `No upstream, and no remote has ${branch}` }
  }
  // The upstream as a full ref, so a remote named like `-x` never reads as an option; git refuses
  // branch names that start with `-`, and takes the local branch only by its short name.
  const output = await run(dir, [
    'branch',
    `--set-upstream-to=refs/remotes/${remote}/${branch}`,
    branch
  ])
  return synced(output, 'branch', `${remote}/${branch}`)
}

/**
 * Pushes the current branch (D9): to its upstream with `git push`; without one, to `origin` as
 * its new upstream (`git push --set-upstream origin refs/heads/<branch>`, the full ref so a name
 * can never read as an option). Never forced; a rejection is git's message (D6).
 */
export async function push(dir: string, run: Git): Promise<SyncResult> {
  const branch = await currentBranch(dir, run)
  if (!branch) return NOT_ON_BRANCH
  const upstream = await run(dir, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}'
  ])
  const args =
    upstream.code === 0 ? ['push'] : ['push', '--set-upstream', 'origin', `refs/heads/${branch}`]
  return synced(await run(dir, args), 'push', 'Pushed')
}
